// electron-builder configuration. It is code rather than YAML so every packaging command
// (pnpm scripts, build-and-install.ps1 and CI) stamps the same release version; see
// scripts/app-version.mts. electron-builder looks for this exact file name and loads it with jiti.
// It is not type-checked: with the project's baseUrl, the module name 'electron-builder' resolves
// to this file, so its Configuration type cannot be imported here.
import { appVersion } from './scripts/app-version.mjs'

export default {
  appId: 'com.electron.app',
  productName: 'PotPlayerChat',
  extraMetadata: { version: appVersion() },
  directories: {
    // Also holds installer.nsh, which electron-builder includes in the NSIS installer.
    buildResources: 'build'
  },
  files: [
    '!**/.vscode/*',
    '!src/*',
    '!scripts/**',
    '!tests/**',
    '!electron.vite.config.{js,ts,mjs,cjs}',
    '!electron-builder.ts',
    '!svelte.config.mjs',
    '!{.eslintcache,eslint.config.mjs,.prettierignore,.prettierrc.yaml,dev-app-update.yml,CHANGELOG.md,README.md}',
    '!{.env,.env.*,.npmrc,pnpm-lock.yaml}',
    '!{tsconfig.json,tsconfig.node.json,tsconfig.web.json}'
  ],
  asarUnpack: ['resources/**'],
  extraFiles: [
    {
      from: 'node_modules/regedit/vbs',
      to: 'resources/regedit/vbs',
      filter: ['**/*']
    }
  ],
  win: {
    executableName: 'PotPlayerChat'
  },
  nsis: {
    artifactName: '${name}-${version}-setup.${ext}',
    shortcutName: '${productName}',
    uninstallDisplayName: '${productName}',
    createDesktopShortcut: 'always'
  },
  mac: {
    entitlementsInherit: 'build/entitlements.mac.plist',
    extendInfo: [
      { NSCameraUsageDescription: "Application requests access to the device's camera." },
      { NSMicrophoneUsageDescription: "Application requests access to the device's microphone." },
      {
        NSDocumentsFolderUsageDescription:
          "Application requests access to the user's Documents folder."
      },
      {
        NSDownloadsFolderUsageDescription:
          "Application requests access to the user's Downloads folder."
      }
    ],
    notarize: false
  },
  dmg: {
    artifactName: '${name}-${version}.${ext}'
  },
  linux: {
    target: ['AppImage', 'snap', 'deb'],
    maintainer: 'electronjs.org',
    category: 'Utility'
  },
  appImage: {
    artifactName: '${name}-${version}.${ext}'
  },
  npmRebuild: false,
  // The updater resolves the newest non-prerelease GitHub release, then downloads from its
  // version tag, so a release published between check and download cannot break the download.
  // CI publishes one for every push to main (.github/workflows/build.yml).
  publish: {
    provider: 'github',
    owner: 'Alb11747',
    repo: 'PotPlayerChat'
  }
}
