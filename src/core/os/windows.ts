import type { HWND } from '@/types/globals'
import { logTime } from '@/utils/debug'
import koffi from 'koffi'
import { tasklist, type TasklistWindow, type TasklistWindowVerbose } from 'tasklist'
import { promisify } from 'util'

const user32 = koffi.load('user32.dll')

// Fixes bug where generated code is duplicated in the output
const initializedBoxed = koffi as unknown as { initialized: boolean }
if (!initializedBoxed.initialized) {
  initializedBoxed.initialized = true

  // koffi.alias('HWND', koffi.pointer('HANDLE', koffi.opaque()))
  koffi.alias('HWND', 'uintptr_t') // Opaque pointers can't be used with IPC

  koffi.alias('DWORD', 'uint32_t')
  koffi.alias('UINT', 'uint32_t')
  koffi.alias('BOOL', 'int32_t')
  koffi.alias('LRESULT', 'intptr_t')
  koffi.alias('WPARAM', 'uintptr_t')
  koffi.alias('LPARAM', 'intptr_t')
  koffi.alias('LPCSTR', 'string')
  koffi.alias('LPSTR', 'string')
  koffi.alias('LPWSTR', 'string')
}

export async function sendMessage(
  hwnd: HWND,
  msg: number,
  wParam: number,
  lParam: number
): Promise<number> {
  const result = Buffer.alloc(koffi.sizeof('intptr_t'))
  const succeeded = await SendMessageTimeoutW(
    hwnd,
    msg,
    wParam,
    lParam,
    SMTO_ABORTIFHUNG | SMTO_ERRORONEXIT,
    250,
    result
  )
  // The API status is separate from the signed message result: zero is a valid
  // playback position and -1 is PotPlayer's stopped status.
  if (!succeeded) throw new Error('PotPlayer window message failed or timed out')
  return result.length === 8 ? Number(result.readBigInt64LE()) : result.readInt32LE()
}

const GetForegroundWindow = promisify(user32.func('HWND __stdcall GetForegroundWindow()').async)
export function getForegroundWindow(): Promise<HWND> {
  return GetForegroundWindow()
}

const GetWindowTextA = promisify(
  user32.func('int __stdcall GetWindowTextA(HWND hWnd, LPSTR lpString, int nMaxCount)').async
)
const GetWindowTextW = promisify(
  user32.func('int __stdcall GetWindowTextW(HWND hWnd, LPWSTR lpString, int nMaxCount)').async
)
const SendMessageTimeoutW = promisify(
  user32.func(
    'LRESULT __stdcall SendMessageTimeoutW(HWND hWnd, UINT Msg, WPARAM wParam, LPARAM lParam, UINT fuFlags, UINT uTimeout, uintptr_t *lpdwResult)'
  ).async
)
// WM_GETTEXT receives a buffer address rather than an integer LPARAM.
const SendWindowTextTimeoutW = promisify(
  user32.func(
    'LRESULT __stdcall SendMessageTimeoutW(HWND hWnd, UINT Msg, WPARAM wParam, void *lParam, UINT fuFlags, UINT uTimeout, uintptr_t *lpdwResult)'
  ).async
)
const GetClassNameW = promisify(
  user32.func('int __stdcall GetClassNameW(HWND hWnd, LPWSTR lpClassName, int nMaxCount)').async
)
const titleBufferSize = 1024
const WM_GETTEXT = 0x000d
const SMTO_ABORTIFHUNG = 0x0002
const SMTO_ERRORONEXIT = 0x0020

function readWindowTextBuffer(buffer: Buffer, unicode: boolean): string {
  return buffer.toString(unicode ? 'utf16le' : 'utf8').replace(/\0.*$/s, '')
}

export async function getWindowText(hwnd: HWND, unicode: boolean = false): Promise<string> {
  const buffer = Buffer.alloc(titleBufferSize * (unicode ? 2 : 1))
  if (unicode) {
    await GetWindowTextW(hwnd, buffer, titleBufferSize)
  } else {
    await GetWindowTextA(hwnd, buffer, titleBufferSize)
  }
  return readWindowTextBuffer(buffer, unicode)
}

/**
 * Requests the caption from the target window with a bounded wait. The regular
 * GetWindowText path remains as a fallback for windows that reject WM_GETTEXT.
 */
export async function getLiveWindowText(hwnd: HWND, timeoutMs = 250): Promise<string> {
  const buffer = Buffer.alloc(titleBufferSize * 2)
  const result = Buffer.alloc(koffi.sizeof('intptr_t'))
  try {
    const succeeded = await SendWindowTextTimeoutW(
      hwnd,
      WM_GETTEXT,
      titleBufferSize,
      buffer,
      SMTO_ABORTIFHUNG,
      timeoutMs,
      result
    )
    if (succeeded) {
      const title = readWindowTextBuffer(buffer, true)
      if (title) return title
    }
  } catch (error) {
    console.debug('Direct window title query failed; using GetWindowTextW fallback:', error)
  }
  return getWindowText(hwnd, true)
}

const FindWindowExA = promisify(
  user32.func(
    'HWND __stdcall FindWindowExA(HWND hwndParent, HWND hwndChildAfter, LPCSTR lpszClass, LPCSTR lpszWindow)'
  ).async
)
const GetWindowThreadProcessId = promisify(
  user32.func('DWORD __stdcall GetWindowThreadProcessId(HWND hWnd, _Out_ DWORD *lpdwProcessId)')
    .async
)

const potPlayerWindowClasses = new Set(['PotPlayer64', 'PotPlayer'])

export async function findPotPlayerHwndByPid(pid: number): Promise<HWND | null> {
  console.debug(`Searching for PotPlayer window with PID ${pid}`)

  const hwnds: HWND[] = []
  let hwndCount = 0

  await logTime('FindPotPlayerWindowByPid', async () => {
    try {
      let hCurWnd: HWND = await FindWindowExA(0, 0, 0, 0)

      while (hCurWnd) {
        hwndCount++

        const pidBuffer = Buffer.alloc(4)
        await GetWindowThreadProcessId(hCurWnd, pidBuffer)
        const foundPid = pidBuffer.readUInt32LE(0)
        if (foundPid === pid) {
          const classBuffer = Buffer.alloc(256 * 2)
          await GetClassNameW(hCurWnd, classBuffer, 256)
          const className = readWindowTextBuffer(classBuffer, true)
          if (potPlayerWindowClasses.has(className)) hwnds.push(hCurWnd)
        }

        hCurWnd = await FindWindowExA(0, hCurWnd, 0, 0)
      }
    } catch (error) {
      console.error(`Error while searching for PotPlayer window with PID ${pid}:`, error)
    }
  })

  console.debug(`Searched ${hwndCount} windows for PID ${pid}`)

  if (hwnds.length === 0) {
    return null
  } else if (hwnds.length > 1) {
    console.warn(`Multiple PotPlayer windows found for PID ${pid}:`, hwnds)
  }

  return hwnds[0]!
}

export async function getWindowsByExe<V extends boolean>(
  exeName: string,
  verbose: V
): Promise<V extends true ? TasklistWindowVerbose[] : TasklistWindow[]> {
  console.debug(`Fetching windows for executable: ${exeName}`)
  return await logTime('TaskList', () =>
    tasklist({
      filter: [`IMAGENAME eq ${exeName}`],
      verbose
    })
  )
}
