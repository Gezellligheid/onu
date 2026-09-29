import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router/index.js'
import './style.css'
import { useAuthStore } from './stores/auth.js'
import { initDiscord } from './discord.js'

const app = createApp(App)
app.use(createPinia())
app.use(router)

// No-ops immediately outside Discord; inside it, patches Firebase's outbound
// requests through the activity's proxied origin before anything else runs.
initDiscord().then(() => {
  useAuthStore().init()
  app.mount('#app')
})
