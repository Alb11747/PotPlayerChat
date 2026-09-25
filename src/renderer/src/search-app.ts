import { flushSync, mount } from 'svelte'
import Search from './components/Search.svelte'
import type { SearchContext } from './core/search-window'

export function mountSearch(
  target: HTMLElement,
  context: SearchContext,
  earlyInput: HTMLInputElement
): void {
  // Subscribe before yielding so edits cannot fall between reading and binding the field.
  flushSync(() => mount(Search, { target, props: { context, earlyInput } }))
}
