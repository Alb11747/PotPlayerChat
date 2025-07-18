import electron, { shell } from 'electron'
import sanitizeHtml from 'sanitize-html'

export async function getLinkPreview(
  url: string,
  chatterinoBaseUrl: string = 'https://chatterino.alb11747.com/link_resolver/'
): Promise<{ status: number; thumbnail?: string; tooltip?: string; link: string } | null> {
  try {
    if (
      !url ||
      typeof url !== 'string' ||
      (!url.startsWith('http://') && !url.startsWith('https://'))
    ) {
      return null
    }

    const encodedUrl = encodeURIComponent(url)
    console.debug(`Fetching link preview for: ${url}`)
    if (!chatterinoBaseUrl.endsWith('/')) chatterinoBaseUrl += '/'
    const response = await fetch(chatterinoBaseUrl + encodedUrl)

    if (!response.ok) {
      console.warn(`Link preview failed for ${url}: HTTP ${response.status}`)
      return null
    }

    const data = await response.json()

    console.debug(`Link preview fetched for: ${url}`)

    return {
      status: data.status || 200,
      thumbnail: data.thumbnail,
      tooltip: decodeURIComponent(data.tooltip || ''),
      link: data.link || url
    }
  } catch (error) {
    console.warn('Failed to fetch link preview:', error)
    return null
  }
}

export function initLinks(): void {
  const ipcMain = electron.ipcMain

  ipcMain.handle('openUrl', async (_event, url: string) => {
    if (
      url &&
      typeof url === 'string' &&
      (url.startsWith('http://') || url.startsWith('https://'))
    ) {
      await shell.openExternal(url)
    } else {
      console.warn('Invalid URL provided to open-url handler:', url)
    }
  })

  ipcMain.handle('getLinkPreview', async (_event, url: string) => {
    return await getLinkPreview(url)
  })

  ipcMain.handle('sanitizeHtml', async (_event, html: string) => {
    return sanitizeHtml(html)
  })
}
