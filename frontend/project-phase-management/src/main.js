import { createApp } from 'vue'
import App from './App.vue'

// Vuetify
import 'vuetify/styles'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { aliases, mdi } from 'vuetify/iconsets/mdi'

// PrimeVue
import PrimeVue from 'primevue/config'
import Aura from '@primevue/themes/aura'
import 'primeicons/primeicons.css'

// Pinia
import { createPinia } from 'pinia'
import router from './router'
import { useProjectsStore } from './stores/projects'

// Local style
import './style.css'

const app = createApp(App)

const vuetify = createVuetify({
  components,
  directives,
  icons: {
    defaultSet: 'mdi',
    aliases,
    sets: { mdi },
  },
})

const pinia = createPinia()
app.use(pinia)

// Start fetchInitData BEFORE app.use(router) — router.install triggers the initial
// navigation immediately, which fires beforeEach. If the preload is already in-flight,
// the guard's own fetchInitData() call will share the same promise (store deduplication)
// instead of racing against a fresh request.
try {
  useProjectsStore(pinia).fetchInitData().catch(() => {})
} catch {
  // ignore
}

app.use(router)
app.use(vuetify)
app.use(PrimeVue, {
  theme: { preset: Aura },
  zIndex: { overlay: 3000 },
})

// Mount only after the router has confirmed the initial navigation (all guards resolved).
// This prevents the brief flash where the app renders at the start location before
// the async beforeEach guard finishes and the actual route is committed.
router.isReady().then(() => app.mount('#app'))
