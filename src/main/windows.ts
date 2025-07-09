import type { HWND } from '@/types/globals'
import koffi from 'koffi'
import NodeCache from 'node-cache'
import { tasklist, type TasklistWindow, type TasklistWindowVerbose } from 'tasklist'
import { promisify } from 'util'

const user32 = koffi.load('user32.dll')

// Fixes bug where generated code is duplicated in the output
const initializedBoxed = koffi as unknown as { initialized: boolean }
if (!initializedBoxed.initialized) {
  initializedBoxed.initialized = true

  // koffi.alias('HWND', koffi.pointer('HANDLE', koffi.opaque()))
  koffi.alias('HWND', 'uint64_t') // Opaque pointers can't be used with ipc, so we use uint64_t instead

  koffi.alias('DWORD', 'uint32_t')
  koffi.alias('UINT', 'uint32_t')
  koffi.alias('BOOL', 'int32_t')
  koffi.alias('LRESULT', 'int')
  koffi.alias('WPARAM', 'uint32_t')
  koffi.alias('LPARAM', 'void *')
  koffi.alias('LPCSTR', 'string')
  koffi.alias('LPSTR', 'string')
  koffi.alias('LPWSTR', 'string')
}

const SendMessageW = promisify(
  user32.func('LRESULT __stdcall SendMessageW(HWND hWnd, UINT Msg, WPARAM wParam, LPARAM lParam)')
    .async
)
export function sendMessage(
  hwnd: HWND,
  msg: number,
  wParam: number,
  lParam: number
): Promise<number> {
  return SendMessageW(hwnd, msg, wParam, lParam)
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
const titleBufferSize = 1024
const titleBuffer = Buffer.alloc(titleBufferSize)
let titleBufferLocked = false

export async function getWindowText(hwnd: HWND, unicode: boolean = false): Promise<string> {
  if (titleBufferLocked) throw new Error('Title buffer is locked, cannot get window text')
  titleBufferLocked = true

  let title: string
  if (unicode) {
    await GetWindowTextW(hwnd, titleBuffer, titleBufferSize)
    title = titleBuffer.toString('utf16le').replace(/\0.*$/, '')
  } else {
    await GetWindowTextA(hwnd, titleBuffer, titleBufferSize)
    title = titleBuffer.toString('utf8').replace(/\0.*$/, '')
  }

  titleBufferLocked = false
  return title
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

export async function findHwndByPidAndTitle(
  pid: number,
  title: string
): Promise<{ hwnd: HWND; title: string } | null> {
  console.debug(`Searching for window with PID ${pid} and title:`, title)

  const hwnds: { hwnd: HWND; title: string }[] = []
  let hwndCount = 0

  try {
    console.time('FindWindowByPidAndTitle')
    let hCurWnd: HWND = await FindWindowExA(0, 0, 0, 0)

    while (hCurWnd) {
      hwndCount++

      const pidBuffer = Buffer.alloc(4)
      await GetWindowThreadProcessId(hCurWnd, pidBuffer)
      const foundPid = pidBuffer.readUInt32LE(0)
      if (foundPid === pid) {
        const currentTitle = await getWindowText(hCurWnd, false)
        if (currentTitle === title) {
          hwnds.push({ hwnd: hCurWnd, title: await getWindowText(hCurWnd, true) })
          if (process.env['NODE_ENV'] === 'production') break
        }
      }

      hCurWnd = await FindWindowExA(0, hCurWnd, 0, 0)
    }
  } catch (error) {
    console.error(`Error while searching for window with PID ${pid} and title "${title}":`, error)
    return null
  } finally {
    console.timeEnd('FindWindowByPidAndTitle')
    console.debug(`Searched ${hwndCount} windows for PID ${pid}`)
  }

  if (hwnds.length === 0) {
    return null
  } else if (hwnds.length > 1) {
    console.warn(`Multiple windows found for PID ${pid}:`, hwnds.map((h) => h.title).join(', '))
  }

  return hwnds[0]!
}

const pidByHwndCache = new NodeCache({ stdTTL: 2 * 60 * 60, checkperiod: 24 * 60 * 60 })

export async function getHwndByPidAndTitle(
  pid: number,
  title: string
): Promise<{ hwnd: HWND; title: string } | null> {
  const cached = pidByHwndCache.get<{ hwnd: HWND; title: string }>(pid)
  if (cached !== undefined) {
    return cached
  }
  const { hwnd = null, title: displayTitle = null } =
    (await findHwndByPidAndTitle(pid, title)) ?? {}
  if (hwnd === null || displayTitle === null) return null
  pidByHwndCache.set(pid, { hwnd, title: displayTitle })
  return { hwnd, title: displayTitle }
}

export async function getWindowsByExe<V extends boolean>(
  exeName: string,
  verbose: V
): Promise<V extends true ? TasklistWindowVerbose[] : TasklistWindow[]> {
  console.debug(`Fetching windows for executable: ${exeName}`)
  console.time('TaskList')
  const result = await tasklist({
    filter: [`IMAGENAME eq ${exeName}`],
    verbose
  })
  console.timeEnd('TaskList')
  return result
}
