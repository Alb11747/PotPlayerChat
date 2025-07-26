export function findChildByText(
  parentElement: Element | ChildNode,
  searchText: string
): ChildNode | null {
  for (const child of parentElement.childNodes) {
    const found = findChildByText(child, searchText)
    if (found) return found
    if (child.textContent && child.textContent.includes(searchText)) return child
  }
  return null
}
