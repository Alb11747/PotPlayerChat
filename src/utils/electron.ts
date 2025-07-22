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
  protected value: T | symbol = IpcPromiseBase.nullValue

  constructor(
    protected ipc: Ipc,
    public readonly channel: string,
    protected updatable: boolean = false
  ) {
    this.promise = this.getPromise()
  }

  async get(): Promise<T | null> {
    if (this.value !== (this.constructor as typeof IpcPromiseBase).nullValue) return this.value as T
    const value = await this.promise
    if (!this.updatable && this instanceof IpcPromiseMain) this.promise = this.getPromise()
    return value
  }

  protected abstract once(fn: HandlerFn<T>): void
  protected abstract on(fn: HandlerFn<T>): void

  protected getPromise(): Promise<T | null> {
    return new Promise((resolve) => {
      this.once((_, data: T) => {
        if (isObjectClass(data, 'ArrayBuffer')) console.debug(`Loaded ${this.channel}`)
        else console.debug(`Loaded ${this.channel}:`, data)
        resolve(data)

        if (!this.updatable) return

        this.on((_event, data: T) => {
          if (isObjectClass(data, 'ArrayBuffer')) console.debug(`Updated ${this.channel}`)
          else console.debug(`Updated ${this.channel}:`, data)

          this.value = data
        })
      })
    })
  }
}

export class IpcPromiseMain<T = unknown> extends IpcPromiseBase<T, IpcMain> {
  protected once(fn: HandlerFn<T>): void {
    this.ipc.handleOnce(this.channel, fn)
  }
  protected on(fn: HandlerFn<T>): void {
    this.ipc.handle(this.channel, fn)
  }
}

export class IpcPromiseRenderer<T = unknown> extends IpcPromiseBase<T, IpcRenderer> {
  protected once(fn: HandlerFn<T>): void {
    this.ipc.once(this.channel, fn)
  }
  protected on(fn: HandlerFn<T>): void {
    this.ipc.on(this.channel, fn)
  }
}
