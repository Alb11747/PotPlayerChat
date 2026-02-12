export function findChildByText(
  parentElement: Element | ChildNode,
  searchText: string
): ChildNode | null {
  if (!searchText || searchText.trim() === '') return null
  for (const child of parentElement.childNodes) {
    const found = findChildByText(child, searchText)
    if (found) return found
    if (child.textContent && child.textContent.includes(searchText)) return child
  }
  return null
}

export function urlsToSrcset(
  urls: Record<string, string>,
  sizeMap?: Record<string, string>
): string {
  return Object.entries(urls)
    .map(([scale, url]) => `${url} ${sizeMap?.[scale] || `${scale}x`}`)
    .join(', ')
}
