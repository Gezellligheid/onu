import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router/index.js'
import './style.css'
import { useAuthStore } from './stores/auth.js'

const app = createApp(App)
app.use(createPinia())
app.use(router)

useAuthStore().init()

app.mount('#app')
