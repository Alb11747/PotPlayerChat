declare module 'tasklist' {
  import type { Transform } from 'stream'

  export interface TasklistOptions {
    filter?: string[]
    verbose?: boolean
    apps?: boolean
    modules?: string[]
    services?: boolean
    system?: string
    username?: string
    password?: string
  }

  export interface TasklistWindow {
    imageName: string
    pid: number
    sessionName: string
    sessionNumber: number
    memUsage: number
  }

  export interface TasklistWindowVerbose extends TasklistWindow {
    status: 'Running' | 'Suspended' | 'Not Responding' | 'Unknown'
    username: string
    cpuTime: number
    windowTitle: string
  }

  export type TasklistResult = TasklistWindow | TasklistWindowVerbose

  export function tasklist<T extends boolean = false>(
    options?: TasklistOptions & { verbose?: T }
  ): Promise<T extends true ? TasklistWindowVerbose[] : TasklistWindow[]>

  export function tasklistStream(options?: TasklistOptions): Transform
}
