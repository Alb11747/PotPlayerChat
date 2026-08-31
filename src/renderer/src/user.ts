import { mount } from 'svelte'

import './assets/main.css'
import UserWindow from './components/UserWindow.svelte'
import { takeUserContext } from './core/user-window'

const context = takeUserContext()
const target = document.getElementById('app')!
let app = null

if (!context) {
  console.error('No user context is available')
  target.textContent = 'Unable to load the user context.'
} else {
  app = mount(UserWindow, {
    target,
    props: { context }
  })
}

export default app
