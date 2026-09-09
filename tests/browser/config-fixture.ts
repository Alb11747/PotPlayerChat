/** Renderer-only fixture storage never reads or writes the installed app's settings. */
export class Conf {
  async get(): Promise<undefined> {
    return undefined
  }
  async set(): Promise<void> {
    return undefined
  }
  async delete(): Promise<void> {
    return undefined
  }
}
