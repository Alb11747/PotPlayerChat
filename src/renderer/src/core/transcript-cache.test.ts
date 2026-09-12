import { describe, expect, it } from 'vitest'
import { createMessageLayoutDependencies } from './transcript-cache'

function row(id: string, channel?: string): { getId(): string; channel?: string } {
  return { getId: () => id, channel }
}

describe('transcript layout dependencies', () => {
  it('prepares replacement dependencies without mutating the published index', async () => {
    const original = createMessageLayoutDependencies()
    const first = row('one', 'channel')
    const removed = row('two', 'channel')
    original.retain([first, removed])
    original.record('one', new Set(['preview']))
    const next = await original.fork([first, row('three', 'other')])
    await next.completeFork()
    expect(next.channels.get('channel')).toEqual(new Set(['one']))
    expect(original.channels.get('channel')).toEqual(new Set(['one', 'two']))
    expect(next.urls.get('preview')).toEqual(new Set(['one']))
    expect(next.versions.get('one')).toBe(original.versions.get('one'))
    next.record('one', new Set(['new-preview']))
    expect(original.urls.get('preview')).toEqual(new Set(['one']))
  })
  it('replays asset and version changes arriving after a replacement was copied', async () => {
    const original = createMessageLayoutDependencies()
    const message = row('one', 'channel')
    original.retain([message])
    original.record('one', new Set(['old-thumbnail']))
    const next = await original.fork([message])
    original.record('one', new Set(['new-thumbnail']))
    original.invalidate('one')
    await next.completeFork()
    expect(next.urls.has('old-thumbnail')).toBe(false)
    expect(next.urls.get('new-thumbnail')).toEqual(new Set(['one']))
    expect(next.versions.get('one')).toBe(original.versions.get('one'))
  })
  it('indexes channel members before measurement and shares media dependencies across rows', () => {
    const dependencies = createMessageLayoutDependencies()
    dependencies.retain([row('one', 'channel'), row('two', 'channel'), row('three', 'other')])
    expect(dependencies.channels.get('channel')).toEqual(new Set(['one', 'two']))
    expect(dependencies.channels.get('other')).toEqual(new Set(['three']))
    expect(dependencies.urls.size).toBe(0)

    dependencies.record('one', new Set(['preview', 'shared-thumbnail']))
    dependencies.record('two', new Set(['shared-thumbnail']))
    dependencies.record('three', new Set(['other-thumbnail']))
    expect(dependencies.urls.get('preview')).toEqual(new Set(['one']))
    expect(dependencies.urls.get('shared-thumbnail')).toEqual(new Set(['one', 'two']))
    expect(dependencies.urls.get('other-thumbnail')).toEqual(new Set(['three']))
  })

  it('invalidates pre-registration DOM measurements while preserving measurements for stable dependencies', () => {
    const dependencies = createMessageLayoutDependencies()
    const message = row('one', 'channel')
    dependencies.retain([message])
    const beforeRegistration = dependencies.versions.get('one') ?? 0
    dependencies.record('one', new Set())
    const registered = dependencies.versions.get('one')!
    expect(registered).toBeGreaterThan(beforeRegistration)

    dependencies.record('one', new Set())
    dependencies.retain([message])
    expect(dependencies.versions.get('one')).toBe(registered)

    dependencies.record('one', new Set(['preview', 'thumbnail']))
    const withMedia = dependencies.versions.get('one')!
    expect(withMedia).toBeGreaterThan(registered)
    dependencies.record('one', new Set(['thumbnail', 'preview']))
    expect(dependencies.versions.get('one')).toBe(withMedia)
  })

  it('invalidates newly discovered media and removes obsolete reverse dependencies', () => {
    const dependencies = createMessageLayoutDependencies()
    dependencies.retain([row('one'), row('two')])
    dependencies.record('one', new Set(['preview', 'old-thumbnail']))
    dependencies.record('two', new Set(['old-thumbnail']))
    const before = dependencies.versions.get('one')!
    const otherVersion = dependencies.versions.get('two')

    dependencies.record('one', new Set(['preview', 'new-thumbnail']))
    expect(dependencies.versions.get('one')).toBeGreaterThan(before)
    expect(dependencies.versions.get('two')).toBe(otherVersion)
    expect(dependencies.urls.get('new-thumbnail')).toEqual(new Set(['one']))
    expect(dependencies.urls.get('old-thumbnail')).toEqual(new Set(['two']))

    dependencies.record('one', new Set())
    expect(dependencies.urls.has('preview')).toBe(false)
    expect(dependencies.urls.has('new-thumbnail')).toBe(false)
    expect(dependencies.urls.get('old-thumbnail')).toEqual(new Set(['two']))
  })

  it('drops stale dependencies and measurements when a message object is replaced under the same ID', () => {
    const dependencies = createMessageLayoutDependencies()
    const first = row('one', 'old-channel')
    const other = row('two', 'other')
    dependencies.retain([first, other])
    dependencies.record('one', new Set(['old-preview', 'shared-thumbnail']))
    dependencies.record('two', new Set(['shared-thumbnail']))
    const before = dependencies.versions.get('one')!
    const otherVersion = dependencies.versions.get('two')

    dependencies.retain([row('one', 'new-channel'), other])
    expect(dependencies.versions.get('one')).toBeGreaterThan(before)
    expect(dependencies.versions.get('two')).toBe(otherVersion)
    expect(dependencies.channels.has('old-channel')).toBe(false)
    expect(dependencies.channels.get('new-channel')).toEqual(new Set(['one']))
    expect(dependencies.urls.has('old-preview')).toBe(false)
    expect(dependencies.urls.get('shared-thumbnail')).toEqual(new Set(['two']))

    dependencies.record('one', new Set(['new-preview']))
    expect(dependencies.urls.get('new-preview')).toEqual(new Set(['one']))
  })

  it('evicts only removed rows and does not restore their media dependencies when an ID returns', () => {
    const dependencies = createMessageLayoutDependencies()
    const first = row('one', 'channel')
    const other = row('two', 'channel')
    dependencies.retain([first, other])
    dependencies.record('one', new Set(['preview', 'shared-thumbnail']))
    dependencies.record('two', new Set(['shared-thumbnail']))
    const otherVersion = dependencies.versions.get('two')

    dependencies.retain([other])
    expect(dependencies.channels.get('channel')).toEqual(new Set(['two']))
    expect(dependencies.versions.has('one')).toBe(false)
    expect(dependencies.versions.get('two')).toBe(otherVersion)
    expect(dependencies.urls.has('preview')).toBe(false)
    expect(dependencies.urls.get('shared-thumbnail')).toEqual(new Set(['two']))

    dependencies.retain([first, other])
    expect(dependencies.versions.has('one')).toBe(false)
    expect(dependencies.urls.get('shared-thumbnail')).toEqual(new Set(['two']))
    dependencies.retain([])
    expect(dependencies.channels.size).toBe(0)
    expect(dependencies.urls.size).toBe(0)
    expect(dependencies.versions.size).toBe(0)
  })
})
