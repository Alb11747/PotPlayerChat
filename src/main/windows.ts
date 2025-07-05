import type { HWND } from '@/types/globals'
import koffi from 'koffi'
import NodeCache from 'node-cache'
import { tasklist } from 'tasklist'
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
  koffi.alias('LPARAM', 'int32_t')
  koffi.alias('LPCSTR', 'string')
  koffi.alias('LPSTR', 'string')
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

const FindWindowExA = promisify(
  user32.func(
    'HWND __stdcall FindWindowExA(HWND hwndParent, HWND hwndChildAfter, LPCSTR lpszClass, LPCSTR lpszWindow)'
  ).async
)
const GetWindowThreadProcessId = promisify(
  user32.func('DWORD __stdcall GetWindowThreadProcessId(HWND hWnd, _Out_ DWORD *lpdwProcessId)')
    .async
)
const GetWindowTextA = promisify(
  user32.func('int __stdcall GetWindowTextA(HWND hWnd, LPSTR lpString, int nMaxCount)').async
)

export async function findHwndByPidAndTitle(pid: number, title: string): Promise<HWND | null> {
  console.debug(`Searching for window with PID ${pid} and title containing "${title}"`)

  const hwnds: { hwnd: HWND; title: string }[] = []
  let hCurWnd: HWND = await FindWindowExA(0, 0, 0, 0)

  while (hCurWnd) {
    const pidBuffer = Buffer.alloc(4)
    await GetWindowThreadProcessId(hCurWnd, pidBuffer)
    const foundPid = pidBuffer.readUInt32LE(0)
    if (foundPid === pid) {
      // Get window title
      const titleBuffer = Buffer.alloc(512)
      await GetWindowTextA(hCurWnd, titleBuffer, 512)
      const currentTitle = titleBuffer.toString('utf8').replace(/\0.*$/, '')
      if (currentTitle.includes(title)) {
        hwnds.push({ hwnd: hCurWnd, title: currentTitle })
        if (process.env.NODE_ENV === 'production') break
      }
    }

    hCurWnd = await FindWindowExA(0, hCurWnd, 0, 0)
  }

  if (hwnds.length === 0) {
    return null
  } else if (hwnds.length > 1) {
    console.warn(`Multiple windows found for PID ${pid}:`, hwnds.map((h) => h.title).join(', '))
  }

  return hwnds[0].hwnd
}

const pidByHwndCache = new NodeCache({ stdTTL: 2 * 60 * 60, checkperiod: 24 * 60 * 60 })

export async function getHwndByPidAndTitle(pid: number, title: string): Promise<HWND | null> {
  const cached = pidByHwndCache.get<HWND>(pid)
  if (cached !== undefined) {
    return cached
  }
  const hwnd = await findHwndByPidAndTitle(pid, title)
  if (hwnd !== null) {
    pidByHwndCache.set(pid, hwnd)
  }
  return hwnd
}

export type TasklistWindow = {
  imageName: string
  pid: number
  sessionName: string
  sessionNumber: number
  memUsage: number
  status: 'Running' | 'Suspended' | 'Not Responding' | 'Unknown'
  username: string
  cpuTime: number
  windowTitle: string
}

export async function getWindowsByExe(exeName: string): Promise<TasklistWindow[]> {
  console.debug(`Fetching windows for executable: ${exeName}`)
  return (await tasklist({
    filter: [`IMAGENAME eq ${exeName}`],
    verbose: true
  })) as TasklistWindow[]
}
