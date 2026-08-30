import type { HWND } from '@/types/globals'
import type { PotPlayerInstance, PotPlayerWindow } from '@/types/potplayer'
import { isEqual } from '@/utils/objects'
import { TrailingRateLimiter } from '@/utils/rate-limit'
import { RecentValue } from '@/utils/state'

export const fullVerificationCooldownMs = 5_000
export const titleSynchronizationCooldownMs = 1_000
export const timelineJumpBaseAllowanceMs = 2 * 60 * 1_000
export const timelineJumpRateAllowanceMultiplier = 2

interface ManagedPotPlayerInstance extends PotPlayerInstance {
  titleStale: boolean
}

interface TimelineState {
  lastMediaTime: number
  lastWallTime: number
  recentRates: number[]
}

interface TitleSyncResult {
  changedPids: number[]
  failedPids: number[]
}

export interface PotPlayerManagerDependencies {
  discoverInstances: () => Promise<PotPlayerWindow[]>
  readTitle: (hwnd: HWND) => Promise<string>
  readCurrentTime: (hwnd: HWND) => Promise<number>
  readTotalTime: (hwnd: HWND) => Promise<number>
  onInstancesChanged: (
    instances: (PotPlayerInstance & { selected?: boolean })[]
  ) => void | Promise<void>
  now?: () => number
}

type ReadMode = 'background' | 'interactive'

export class PotPlayerInstanceManager {
  private readonly now: () => number
  private readonly verificationLimiter: TrailingRateLimiter<void>
  private readonly titleLimiter: TrailingRateLimiter<TitleSyncResult>
  private readonly recentActivePids = new RecentValue<number>()
  private readonly timelineByPid = new Map<number, TimelineState>()
  private readonly pendingVerificationReasons = new Set<string>()
  private readonly pendingTitlePids = new Set<number>()
  private readonly pendingTitleReasons = new Set<string>()
  private instances: ManagedPotPlayerInstance[] = []
  private selectedHwnd: HWND | null = null
  private lastEmittedInstances: (PotPlayerInstance & { selected?: boolean })[] = []

  public constructor(private readonly dependencies: PotPlayerManagerDependencies) {
    this.now = dependencies.now ?? Date.now
    this.verificationLimiter = new TrailingRateLimiter(fullVerificationCooldownMs, () =>
      this.verifyNow()
    )
    this.titleLimiter = new TrailingRateLimiter(titleSynchronizationCooldownMs, () =>
      this.synchronizePendingTitles()
    )
  }

  public getSelectedHwnd(): HWND | null {
    if (this.selectedHwnd) return this.selectedHwnd
    const activePid = this.recentActivePids.getRecent()
    return this.instances.find((instance) => instance.pid === activePid)?.hwnd ?? null
  }

  public async setSelectedHwnd(hwnd: HWND | null): Promise<void> {
    this.selectedHwnd = hwnd
    await this.emitIfChanged()
    await this.requestVerification('selection-changed')
  }

  public async noteActiveHwnd(hwnd: HWND): Promise<void> {
    const instance = this.instances.find((candidate) => candidate.hwnd === hwnd)
    if (!instance) return

    const previous = this.getSelectedHwnd()
    this.recentActivePids.add(instance.pid)
    if (this.selectedHwnd === null && previous !== this.getSelectedHwnd()) {
      await this.emitIfChanged()
    }
  }

  public requestVerificationBackground(reason: string): void {
    void this.requestVerification(reason).catch((error: unknown) => {
      console.error(`PotPlayer verification failed (${reason}):`, error)
    })
  }

  public async requestVerification(reason: string): Promise<void> {
    this.pendingVerificationReasons.add(reason)
    await this.verificationLimiter.request()
  }

  public async getInstances(): Promise<PotPlayerInstance[]> {
    await this.requestVerification('explicit-instance-list')
    await this.requestTitleSynchronization(
      this.instances.map((instance) => instance.pid),
      'explicit-instance-list'
    )
    return this.getInstanceSnapshot()
  }

  public getInstanceSnapshot(): PotPlayerInstance[] {
    return this.instances.map(({ pid, hwnd, title }) => ({ pid, hwnd, title }))
  }

  public async pollCurrentTime(): Promise<number | null> {
    const hwnd = this.getSelectedHwnd()
    if (!hwnd) return null
    return this.readCurrentTimeWithRecovery(hwnd, 'background')
  }

  public async getCurrentTime(hwnd: HWND): Promise<number> {
    const result = await this.readCurrentTimeWithRecovery(hwnd, 'interactive')
    return result ?? 0
  }

  public async getTotalTime(hwnd: HWND): Promise<number> {
    const result = await this.readNumberWithRecovery(
      hwnd,
      'interactive',
      'total-time',
      this.dependencies.readTotalTime,
      (value) => Number.isFinite(value) && value > 0
    )
    return result ?? 0
  }

  public async resolveExtraInfo<
    T extends PotPlayerInstance,
    R extends T & { channel: string; startTime: number; endTime: number }
  >(requested: T, resolver: (instance: T) => Promise<R | null>): Promise<R | null> {
    let instance = await this.getCanonicalInstance(requested)
    if (!instance) return null

    await this.requestTitleSynchronization([instance.pid], 'metadata-before-resolve')
    instance = this.findInstanceByPid(instance.pid)
    if (!instance) return null

    let result = await resolver(this.mergeCanonicalInstance(requested, instance))
    if (result) return result

    const beforeRecovery = { hwnd: instance.hwnd, title: instance.title }
    await this.requestTitleSynchronization([instance.pid], 'metadata-returned-null')
    instance = this.findInstanceByPid(instance.pid)
    if (!instance) return null

    const titleChanged =
      instance.hwnd !== beforeRecovery.hwnd || instance.title !== beforeRecovery.title
    if (titleChanged) {
      result = await resolver(this.mergeCanonicalInstance(requested, instance))
      if (!result) this.requestVerificationBackground('metadata-null-after-title-change')
      return result
    }

    await this.requestVerification('metadata-returned-null')
    instance = this.findInstanceByPid(instance.pid)
    if (!instance) return null
    return resolver(this.mergeCanonicalInstance(requested, instance))
  }

  private async verifyNow(): Promise<void> {
    const reasons = [...this.pendingVerificationReasons]
    this.pendingVerificationReasons.clear()
    const startedAt = performance.now()
    console.debug('Verifying PotPlayer instances', { reasons })

    const previousByPid = new Map(this.instances.map((instance) => [instance.pid, instance]))
    const selectedPid = this.instances.find((instance) => instance.hwnd === this.selectedHwnd)?.pid
    const discovered = await this.dependencies.discoverInstances()
    const seenPids = new Set<number>()
    const changedTopologyPids: number[] = []

    this.instances = discovered.flatMap((window) => {
      if (seenPids.has(window.pid)) {
        console.warn('Ignoring duplicate PotPlayer process during discovery:', window)
        return []
      }
      seenPids.add(window.pid)
      const previous = previousByPid.get(window.pid)
      if (!previous || previous.hwnd !== window.hwnd) changedTopologyPids.push(window.pid)
      return [
        {
          ...window,
          title: previous?.title ?? '',
          titleStale: true
        }
      ]
    })

    for (const pid of this.timelineByPid.keys()) {
      if (!seenPids.has(pid) || changedTopologyPids.includes(pid)) this.timelineByPid.delete(pid)
    }

    this.recentActivePids.filter(this.instances.map((instance) => instance.pid))
    if (selectedPid !== undefined) {
      this.selectedHwnd = this.findInstanceByPid(selectedPid)?.hwnd ?? null
    } else if (
      this.selectedHwnd &&
      !this.instances.some((instance) => instance.hwnd === this.selectedHwnd)
    ) {
      this.selectedHwnd = null
    }
    if (this.instances.length === 1 && this.selectedHwnd === null) {
      this.selectedHwnd = this.instances[0]!.hwnd
    }

    const allPids = this.instances.map((instance) => instance.pid)
    if (allPids.length > 0) {
      await this.requestTitleSynchronization(allPids, 'post-verification')
    } else {
      await this.emitIfChanged()
    }

    if (changedTopologyPids.length > 0) {
      this.requestTitleSynchronizationBackground(
        changedTopologyPids,
        'post-verification-confirmation'
      )
    }
    console.debug('PotPlayer verification complete', {
      reasons,
      instances: this.instances.length,
      elapsedMs: Math.round(performance.now() - startedAt)
    })
  }

  private requestTitleSynchronizationBackground(pids: number[], reason: string): void {
    void this.requestTitleSynchronization(pids, reason).catch((error: unknown) => {
      console.error(`PotPlayer title synchronization failed (${reason}):`, error)
    })
  }

  private async requestTitleSynchronization(
    pids: number[],
    reason: string
  ): Promise<TitleSyncResult> {
    for (const pid of pids) this.pendingTitlePids.add(pid)
    this.pendingTitleReasons.add(reason)
    return this.titleLimiter.request()
  }

  private async synchronizePendingTitles(): Promise<TitleSyncResult> {
    const pids = [...this.pendingTitlePids]
    const reasons = [...this.pendingTitleReasons]
    this.pendingTitlePids.clear()
    this.pendingTitleReasons.clear()
    const changedPids: number[] = []
    const failedPids: number[] = []
    const startedAt = performance.now()

    for (const pid of pids) {
      const instance = this.findInstanceByPid(pid)
      if (!instance) continue
      try {
        const title = await this.dependencies.readTitle(instance.hwnd)
        if (!title) throw new Error('PotPlayer returned an empty window title')
        instance.titleStale = false
        if (instance.title !== title) {
          instance.title = title
          changedPids.push(pid)
          this.timelineByPid.delete(pid)
        }
      } catch (error) {
        instance.titleStale = true
        failedPids.push(pid)
        console.warn('Failed to synchronize PotPlayer title', { pid, reasons, error })
      }
    }

    await this.emitIfChanged()
    const shouldEscalate = reasons.some((reason) => !reason.startsWith('post-verification'))
    if (failedPids.length > 0 && shouldEscalate) {
      this.requestVerificationBackground('title-synchronization-failed')
    }
    console.debug('PotPlayer title synchronization complete', {
      reasons,
      requested: pids.length,
      changed: changedPids.length,
      failed: failedPids.length,
      elapsedMs: Math.round(performance.now() - startedAt)
    })
    return { changedPids, failedPids }
  }

  private async readCurrentTimeWithRecovery(hwnd: HWND, mode: ReadMode): Promise<number | null> {
    const originalPid = this.findInstanceByHwnd(hwnd)?.pid ?? null
    const result = await this.readNumberWithRecovery(
      hwnd,
      mode,
      'current-time',
      this.dependencies.readCurrentTime,
      (value, instance) => this.isCurrentTimeValid(value, instance)
    )
    if (result === null) return null

    const instance = this.findInstanceForRetry(hwnd, originalPid)
    if (instance && Number.isFinite(result) && result >= 0) {
      this.recordTimelineSample(instance, result)
    }
    return result
  }

  private async readNumberWithRecovery(
    hwnd: HWND,
    mode: ReadMode,
    operation: string,
    reader: (hwnd: HWND) => Promise<number>,
    isValid: (value: number, instance: ManagedPotPlayerInstance | null) => boolean
  ): Promise<number | null> {
    const originalInstance = this.findInstanceByHwnd(hwnd)
    let firstValue: number | null = null
    let firstError: unknown = null
    try {
      firstValue = await reader(hwnd)
      if (isValid(firstValue, originalInstance)) return firstValue
    } catch (error) {
      firstError = error
    }

    if (operation === 'current-time' && originalInstance) {
      this.timelineByPid.delete(originalInstance.pid)
    }
    if (mode === 'background') {
      this.requestVerificationBackground(`${operation}-failed`)
      return null
    }

    await this.requestVerification(`${operation}-failed`)
    const retryInstance = this.findInstanceForRetry(hwnd, originalInstance?.pid ?? null)
    if (!retryInstance) {
      if (firstError) throw firstError
      return firstValue
    }

    try {
      const retryValue = await reader(retryInstance.hwnd)
      if (!isValid(retryValue, retryInstance)) {
        console.warn(`PotPlayer ${operation} remained invalid after recovery:`, retryValue)
      }
      return retryValue
    } catch (retryError) {
      console.error(`PotPlayer ${operation} retry failed:`, retryError)
      throw retryError
    }
  }

  private isCurrentTimeValid(value: number, instance: ManagedPotPlayerInstance | null): boolean {
    if (!Number.isFinite(value) || value < 0) return false
    if (value !== 0) return true
    if (!instance) return false
    const timeline = this.timelineByPid.get(instance.pid)
    return !timeline || timeline.lastMediaTime === 0
  }

  private recordTimelineSample(instance: ManagedPotPlayerInstance, mediaTime: number): void {
    const wallTime = this.now()
    const timeline = this.timelineByPid.get(instance.pid)
    if (!timeline) {
      this.timelineByPid.set(instance.pid, {
        lastMediaTime: mediaTime,
        lastWallTime: wallTime,
        recentRates: []
      })
      return
    }

    const wallDelta = wallTime - timeline.lastWallTime
    const mediaDelta = mediaTime - timeline.lastMediaTime
    if (wallDelta > 0) {
      const stableRate = this.getStablePlaybackRate(timeline.recentRates)
      const allowance =
        timelineJumpBaseAllowanceMs +
        timelineJumpRateAllowanceMultiplier * Math.abs(stableRate * wallDelta)
      const isJump = Math.abs(mediaDelta) > allowance
      if (isJump) {
        this.requestTitleSynchronizationBackground([instance.pid], 'timeline-jump')
      } else if (mediaDelta > 0) {
        const observedRate = mediaDelta / wallDelta
        if (Number.isFinite(observedRate) && observedRate > 0) {
          timeline.recentRates.push(observedRate)
          if (timeline.recentRates.length > 7) timeline.recentRates.shift()
        }
      }
    }

    timeline.lastMediaTime = mediaTime
    timeline.lastWallTime = wallTime
  }

  private getStablePlaybackRate(rates: number[]): number {
    if (rates.length === 0) return 1
    const sorted = [...rates].sort((a, b) => a - b)
    return sorted[Math.floor((sorted.length - 1) / 2)] ?? 1
  }

  private async getCanonicalInstance(
    requested: PotPlayerInstance
  ): Promise<ManagedPotPlayerInstance | null> {
    let instance = this.findInstanceByPid(requested.pid) ?? this.findInstanceByHwnd(requested.hwnd)
    if (instance) return instance
    await this.requestVerification('metadata-instance-missing')
    instance = this.findInstanceByPid(requested.pid) ?? this.findInstanceByHwnd(requested.hwnd)
    return instance ?? null
  }

  private findInstanceForRetry(
    originalHwnd: HWND,
    originalPid: number | null
  ): ManagedPotPlayerInstance | null {
    if (originalPid !== null) return this.findInstanceByPid(originalPid)
    const exact = this.findInstanceByHwnd(originalHwnd)
    if (exact) return exact
    return this.instances.length === 1 ? this.instances[0]! : null
  }

  private findInstanceByPid(pid: number): ManagedPotPlayerInstance | null {
    return this.instances.find((instance) => instance.pid === pid) ?? null
  }

  private findInstanceByHwnd(hwnd: HWND): ManagedPotPlayerInstance | null {
    return this.instances.find((instance) => instance.hwnd === hwnd) ?? null
  }

  private mergeCanonicalInstance<T extends PotPlayerInstance>(
    requested: T,
    canonical: ManagedPotPlayerInstance
  ): T {
    return {
      ...requested,
      pid: canonical.pid,
      hwnd: canonical.hwnd,
      title: canonical.title
    }
  }

  private async emitIfChanged(): Promise<void> {
    const selectedHwnd = this.getSelectedHwnd()
    const snapshot = this.instances.map(({ pid, hwnd, title }) => ({
      pid,
      hwnd,
      title,
      selected: hwnd === selectedHwnd
    }))
    if (isEqual(snapshot, this.lastEmittedInstances)) return
    this.lastEmittedInstances = snapshot
    await this.dependencies.onInstancesChanged(snapshot)
  }
}
