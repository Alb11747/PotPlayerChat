import { type BrowserWindow, type IpcMain, type IpcRenderer } from 'electron'
import { isObjectClass } from './objects'

export function isDescendantWindow(parentWindow: BrowserWindow, window: BrowserWindow): boolean {
  let parent = window.getParentWindow()
  while (parent) {
    if (parent === parentWindow) return true
    parent = parent.getParentWindow()
  }
  return false
}

type IpcLike = IpcMain | IpcRenderer
type HandlerFn<T> = (event: unknown, data: T) => void

abstract class IpcPromiseBase<T = unknown, Ipc extends IpcLike = IpcLike> {
  protected static nullValue: symbol = Symbol('null')
  protected promise: Promise<T | null>
  protected value: T | null | symbol = IpcPromiseBase.nullValue

  constructor(
    protected ipc: Ipc,
    public readonly channel: string,
    protected updatable: boolean = false
  ) {
    this.promise = this.getPromise()
  }

  async get(): Promise<T | null> {
    if (this.value !== (this.constructor as typeof IpcPromiseBase).nullValue)
      return this.value as T | null
    const value = await this.promise
    this.value = value
    return value
  }

  protected abstract on(fn: HandlerFn<T>): void
  protected abstract off(fn: HandlerFn<T>): void

  protected getPromise(options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<T | null> {
    const timeoutMs = options?.timeoutMs ?? 15000
    const signal = options?.signal
    return new Promise((resolve, reject) => {
      let settled = false
      let timeoutId: ReturnType<typeof setTimeout> | null = null
      let onUpdate: HandlerFn<T> | null = null

      const cleanup = (): void => {
        this.off(onInitial)
        if (timeoutId) {
          clearTimeout(timeoutId)
          timeoutId = null
        }
        if (signal) signal.removeEventListener('abort', onAbort)
      }

      const settleResolve = (data: T): void => {
        if (settled) return
        settled = true
        cleanup()
        if (isObjectClass(data, ArrayBuffer)) console.debug(`Loaded ${this.channel}`)
        else console.debug(`Loaded ${this.channel}:`, data)
        resolve(data)

        if (!this.updatable) return
        onUpdate = (_event, nextData: T) => {
          if (isObjectClass(nextData, ArrayBuffer)) console.debug(`Updated ${this.channel}`)
          else console.debug(`Updated ${this.channel}:`, nextData)
          this.value = nextData
        }
        this.on(onUpdate)
      }

      const settleReject = (error: Error): void => {
        if (settled) return
        settled = true
        cleanup()
        if (onUpdate) {
          this.off(onUpdate)
          onUpdate = null
        }
        reject(error)
      }

      const onAbort = (): void => {
        settleReject(new Error(`IPC "${this.channel}" aborted`))
      }

      const onInitial: HandlerFn<T> = (_event, data) => {
        settleResolve(data)
      }

      this.on(onInitial)

      if (timeoutMs > 0) {
        timeoutId = setTimeout(() => {
          settleReject(
            new Error(`Timed out waiting for IPC "${this.channel}" after ${timeoutMs}ms`)
          )
        }, timeoutMs)
      }

      if (signal) {
        if (signal.aborted) onAbort()
        else signal.addEventListener('abort', onAbort)
      }
    })
  }
}

export class IpcPromiseMain<T = unknown> extends IpcPromiseBase<T, IpcMain> {
  private onHandler: HandlerFn<T> | null = null

  protected on(fn: HandlerFn<T>): void {
    if (this.onHandler) this.ipc.removeListener(this.channel, this.onHandler as never)
    this.onHandler = fn
    this.ipc.on(this.channel, fn as never)
  }
  protected off(fn: HandlerFn<T>): void {
    this.ipc.removeListener(this.channel, fn as never)
    if (this.onHandler === fn) this.onHandler = null
  }

  override async get(): Promise<T | null> {
    const value = await super.get()
    if (this.updatable) this.promise = this.getPromise()
    return value
  }
}

export class IpcPromiseRenderer<T = unknown> extends IpcPromiseBase<T, IpcRenderer> {
  private onHandler: HandlerFn<T> | null = null

  protected on(fn: HandlerFn<T>): void {
    if (this.onHandler) this.ipc.removeListener(this.channel, this.onHandler)
    this.onHandler = fn
    this.ipc.on(this.channel, fn)
  }
  protected off(fn: HandlerFn<T>): void {
    this.ipc.removeListener(this.channel, fn)
    if (this.onHandler === fn) this.onHandler = null
  }

  public dispose(): void {
    if (!this.onHandler) return
    this.ipc.removeListener(this.channel, this.onHandler)
    this.onHandler = null
  }
}
