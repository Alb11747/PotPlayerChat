// Appearance initialization reads CSS tokens while component modules load.
import './assets/main.css'
import { mount } from 'svelte'

import App from './App.svelte'

const app = mount(App, {
  target: document.getElementById('app')!
})

export default app
