import './assets/main.css'
import './assets/search-input.css'
import { takePopupContext } from './core/popup-window'
import type { SearchContext } from './core/search-window'
import { prepareSearchInput } from './core/search-input'

const shell = document.getElementById('search-bootstrap')!
const input = shell.querySelector('input')!
const status = shell.querySelector('[role="status"]')!
const target = document.getElementById('app')!
const context = takePopupContext<SearchContext>()
const earlyInput = prepareSearchInput(input, context?.initialSearch ?? '')
const closeOnEscape = (event: KeyboardEvent): void => {
  if (event.key === 'Escape' && !event.isComposing) window.close()
}
window.addEventListener('keydown', closeOnEscape)

async function startSearch(): Promise<void> {
  try {
    if (!context) throw new Error('No search context is available')
    // Paint the native field before evaluating the transcript/service graph.
    await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
    const { mountSearch } = await import('./search-app')
    await earlyInput.finishComposition()
    mountSearch(target, context, input)
    // Never reparent the field: Chromium clears native undo on DOM moves.
    shell.dataset['ready'] = 'true'
    status.remove()
  } catch (error) {
    console.error('Unable to open Search:', error)
    status.textContent = 'Unable to load Search. Close this window and try again.'
  } finally {
    earlyInput.dispose()
  }
}

void startSearch()
