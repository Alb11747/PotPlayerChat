import { mount } from 'svelte'
import './assets/main.css'
import PreviewWindow from './components/PreviewWindow.svelte'
import { takePreviewContext } from './core/preview-window'

const context = takePreviewContext()
const target = document.getElementById('app')!
if (context) {
  mount(PreviewWindow, { target, props: { context } })
  window.addEventListener('beforeunload', () => context.restoreFocus())
} else {
  target.textContent = 'This preview is no longer available. Open it again from chat.'
}
