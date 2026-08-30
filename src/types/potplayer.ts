import type { HWND } from '@/types/globals'

export interface PotPlayerWindow {
  pid: number
  hwnd: HWND
}

export interface PotPlayerInstance extends PotPlayerWindow {
  title: string
}
