export function isDev(): boolean {
  return __dirname.indexOf('app.asar') === -1
}
