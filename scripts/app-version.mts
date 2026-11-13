// Release version for packaged builds: package.json's major.minor plus the commit count of HEAD.
//
// The updater offers a release only when its version is higher than the running one, so every
// build of a later main commit must sort higher. The commit count does that without a version
// bump per commit, and a local build of a commit gets the same version as the CI release of it,
// so an installed local build is not offered the identical release. Amending or folding commits
// keeps the count; only a rewrite that drops commits from main could lower it, and main is never
// rewritten after it is published.
//
// Run directly to print the version: `node scripts/app-version.mts` (Node 24 strips the types).
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
}

export function appVersion(): string {
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    version: string
  }
  const [major, minor] = version.split('.')
  // A shallow clone counts only the fetched commits and would publish a lower version.
  if (git('rev-parse', '--is-shallow-repository') === 'true') {
    throw new Error('Cannot derive the app version from a shallow clone; fetch the full history.')
  }
  return `${major}.${minor}.${git('rev-list', '--count', 'HEAD')}`
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  console.log(appVersion())
}
