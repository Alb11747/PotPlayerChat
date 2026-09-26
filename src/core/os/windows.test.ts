import type { HWND } from '@/types/globals'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  message: vi.fn(),
  alias: vi.fn(),
  sizeof: vi.fn(),
  declarations: [] as string[]
}))

vi.mock('koffi', () => ({
  default: {
    alias: mocks.alias,
    sizeof: mocks.sizeof,
    load: () => ({
      func: (declaration: string) => {
        mocks.declarations.push(declaration)
        return { async: mocks.message }
      }
    })
  }
}))
vi.mock('tasklist', () => ({ tasklist: vi.fn() }))

import { sendMessage } from './windows'

describe('bounded native window messages', () => {
  beforeEach(() => {
    mocks.message.mockReset()
    mocks.sizeof.mockReturnValue(8)
  })

  it.each([4, 8])('preserves signed message results with %i-byte pointers', async (pointerSize) => {
    mocks.sizeof.mockReturnValue(pointerSize)
    for (const messageResult of [0, -1, 123456]) {
      mocks.message.mockImplementation((...args: unknown[]) => {
        const buffer = args[6] as Buffer
        expect(buffer.length).toBe(pointerSize)
        if (pointerSize === 8) buffer.writeBigInt64LE(BigInt(messageResult))
        else buffer.writeInt32LE(messageResult)
        ;(args[7] as (error: Error | null, status: number) => void)(null, 1)
      })
      expect(await sendMessage(1 as unknown as HWND, 1024, 20484, 0)).toBe(messageResult)
      expect(mocks.message).toHaveBeenLastCalledWith(
        1,
        1024,
        20484,
        0,
        0x22,
        250,
        expect.any(Buffer),
        expect.any(Function)
      )
    }
  })

  it('rejects a timeout/failure instead of interpreting the result buffer as zero', async () => {
    mocks.message.mockImplementation((...args: unknown[]) => {
      ;(args[7] as (error: Error | null, status: number) => void)(null, 0)
    })
    await expect(sendMessage(1 as unknown as HWND, 1024, 20484, 0)).rejects.toThrow(
      'failed or timed out'
    )
  })

  it('propagates native invocation errors', async () => {
    const error = new Error('Native call failed')
    mocks.message.mockImplementation((...args: unknown[]) => {
      ;(args[7] as (error: Error) => void)(error)
    })
    await expect(sendMessage(1 as unknown as HWND, 1024, 20484, 0)).rejects.toBe(error)
  })

  it('uses pointer-sized Win32 integer aliases and never binds unbounded SendMessageW', () => {
    expect(mocks.alias).toHaveBeenCalledWith('HWND', 'uintptr_t')
    expect(mocks.alias).toHaveBeenCalledWith('WPARAM', 'uintptr_t')
    expect(mocks.alias).toHaveBeenCalledWith('LPARAM', 'intptr_t')
    expect(mocks.alias).toHaveBeenCalledWith('LRESULT', 'intptr_t')
    expect(mocks.declarations.some((declaration) => declaration.includes(' SendMessageW('))).toBe(
      false
    )
  })
})
