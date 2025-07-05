import { mount } from 'svelte'

import './assets/main.css'
import Search from './components/Search.svelte'

const app = mount(Search, {
  target: document.getElementById('app')!
})

export default app
