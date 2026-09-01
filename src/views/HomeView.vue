<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth.js'
import { useRoomStore } from '../stores/room.js'
import { DEFAULT_TARGET_SCORE } from '../lib/uno/constants.js'

const router = useRouter()
const auth = useAuthStore()
const room = useRoomStore()

const mode = ref('create') // 'create' | 'join'
const name = ref(auth.name || '')
const joinCode = ref('')
const targetScore = ref(DEFAULT_TARGET_SCORE)
const loading = ref(false)
const error = ref('')

const scoreOptions = [200, 300, 500]

async function submit() {
  error.value = ''
  const trimmedName = name.value.trim()
  if (!trimmedName) {
    error.value = 'Enter a display name.'
    return
  }
  loading.value = true
  try {
    const user = await auth.signIn(trimmedName)
    if (mode.value === 'create') {
      const code = await room.create({ uid: user.uid, name: trimmedName, targetScore: targetScore.value })
      router.push({ name: 'room', params: { code } })
    } else {
      const code = joinCode.value.trim().toUpperCase()
      if (!code) {
        error.value = 'Enter an invite code.'
        loading.value = false
        return
      }
      await room.join({ code, uid: user.uid, name: trimmedName })
      router.push({ name: 'room', params: { code } })
    }
  } catch (e) {
    error.value = e.message || 'Something went wrong.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center px-4 py-10">
    <div class="w-full max-w-md">
      <div class="mb-8 text-center">
        <div class="mx-auto mb-3 flex h-16 w-16 rotate-[-10deg] items-center justify-center rounded-2xl bg-uno-red card-shadow">
          <span class="rotate-[10deg] font-display text-3xl font-extrabold text-white">0</span>
        </div>
        <h1 class="font-display text-4xl font-extrabold tracking-tight">UNO Online</h1>
        <p class="mt-1 text-slate-400">Play the classic card game with friends, anywhere.</p>
      </div>

      <div class="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-xl backdrop-blur">
        <label class="mb-1 block text-sm font-medium text-slate-300">Your name</label>
        <input
          v-model="name"
          maxlength="20"
          placeholder="e.g. Alex"
          class="mb-5 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-slate-100 outline-none ring-uno-yellow/60 placeholder:text-slate-500 focus:ring-2"
        />

        <div class="mb-5 grid grid-cols-2 gap-2 rounded-lg bg-slate-900/60 p-1">
          <button
            type="button"
            class="rounded-md py-2 text-sm font-semibold transition"
            :class="mode === 'create' ? 'bg-uno-red text-white shadow' : 'text-slate-400 hover:text-slate-200'"
            @click="mode = 'create'"
          >
            Create Room
          </button>
          <button
            type="button"
            class="rounded-md py-2 text-sm font-semibold transition"
            :class="mode === 'join' ? 'bg-uno-blue text-white shadow' : 'text-slate-400 hover:text-slate-200'"
            @click="mode = 'join'"
          >
            Join Room
          </button>
        </div>

        <div v-if="mode === 'create'" class="mb-5">
          <label class="mb-1 block text-sm font-medium text-slate-300">Play to</label>
          <div class="grid grid-cols-3 gap-2">
            <button
              v-for="s in scoreOptions"
              :key="s"
              type="button"
              class="rounded-lg border py-2 text-sm font-semibold transition"
              :class="
                targetScore === s
                  ? 'border-uno-yellow bg-uno-yellow/10 text-uno-yellow'
                  : 'border-white/10 text-slate-400 hover:border-white/20'
              "
              @click="targetScore = s"
            >
              {{ s }} pts
            </button>
          </div>
        </div>

        <div v-else class="mb-5">
          <label class="mb-1 block text-sm font-medium text-slate-300">Invite code</label>
          <input
            v-model="joinCode"
            maxlength="6"
            placeholder="e.g. K7QXM"
            class="w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-center font-display text-xl uppercase tracking-[0.3em] text-slate-100 outline-none ring-uno-blue/60 placeholder:tracking-normal placeholder:text-slate-500 focus:ring-2"
          />
        </div>

        <p v-if="error" class="mb-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{{ error }}</p>

        <button
          type="button"
          :disabled="loading"
          class="w-full rounded-lg bg-gradient-to-r from-uno-red via-uno-yellow to-uno-blue py-3 font-display text-lg font-bold text-white shadow-lg transition active:scale-[0.99] disabled:opacity-50"
          @click="submit"
        >
          {{ loading ? 'Please wait…' : mode === 'create' ? 'Create Room' : 'Join Room' }}
        </button>
      </div>

      <p class="mt-6 text-center text-xs text-slate-500">
        Signed in anonymously via Firebase — no password needed. Just share your invite code with friends.
      </p>
    </div>
  </div>
</template>
