import { mount } from 'svelte'

import './assets/main.css'
import Search from './components/Search.svelte'
import { takeSearchContext } from './core/search-window'

const context = takeSearchContext()
const target = document.getElementById('app')!
let app = null

if (!context) {
  console.error('No search context is available')
  target.textContent = 'Unable to load the search context.'
} else {
  app = mount(Search, {
    target,
    props: { context }
  })
}

export default app
