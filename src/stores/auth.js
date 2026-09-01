import { defineStore } from 'pinia'
import { ensureSignedIn, watchAuth } from '../firebase.js'

const NAME_KEY = 'uno.displayName'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    uid: null,
    name: localStorage.getItem(NAME_KEY) || '',
    ready: false,
  }),
  getters: {
    isSignedIn: (state) => !!state.uid,
  },
  actions: {
    init() {
      watchAuth((user) => {
        this.uid = user?.uid ?? null
        if (user?.displayName) this.name = user.displayName
        this.ready = true
      })
    },
    setName(name) {
      this.name = name
      localStorage.setItem(NAME_KEY, name)
    },
    async signIn(name) {
      const finalName = (name || this.name || 'Player').trim().slice(0, 20)
      const user = await ensureSignedIn(finalName)
      this.uid = user.uid
      this.setName(finalName)
      return user
    },
  },
})
