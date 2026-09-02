<script setup>
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth.js'
import { useRoomStore } from '../stores/room.js'
import { DEFAULT_TARGET_SCORE as CLASSIC_DEFAULT_SCORE } from '../lib/uno/constants.js'
import {
  DEFAULT_TARGET_SCORE as NO_MERCY_DEFAULT_SCORE,
  TARGET_SCORE_OPTIONS as NO_MERCY_SCORE_OPTIONS,
  DEFAULT_MERCY_LIMIT,
  MERCY_LIMIT_MIN,
} from '../lib/no-mercy/constants.js'

const router = useRouter()
const auth = useAuthStore()
const room = useRoomStore()

const mode = ref('create') // 'create' | 'join'
const name = ref(auth.name || '')
const joinCode = ref('')
const gameMode = ref('classic') // 'classic' | 'no-mercy' — host-chosen ruleset for a new room
const targetScore = ref(CLASSIC_DEFAULT_SCORE)
const mercyLimit = ref(DEFAULT_MERCY_LIMIT) // No Mercy only: hand size that knocks a player out
const jumpInEnabled = ref(false) // House rule, either mode: play an exact-match card out of turn
const loading = ref(false)
const error = ref('')

const CLASSIC_SCORE_OPTIONS = [200, 300, 500]
const scoreOptions = computed(() => (gameMode.value === 'no-mercy' ? NO_MERCY_SCORE_OPTIONS : CLASSIC_SCORE_OPTIONS))

function clampMercyLimit() {
  const n = Math.round(Number(mercyLimit.value))
  mercyLimit.value = Number.isFinite(n) ? Math.max(MERCY_LIMIT_MIN, n) : DEFAULT_MERCY_LIMIT
}

watch(gameMode, (m) => {
  targetScore.value = m === 'no-mercy' ? NO_MERCY_DEFAULT_SCORE : CLASSIC_DEFAULT_SCORE
})

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
      if (gameMode.value === 'no-mercy') clampMercyLimit()
      const code = await room.create({
        uid: user.uid,
        name: trimmedName,
        targetScore: targetScore.value,
        mode: gameMode.value,
        mercyLimit: gameMode.value === 'no-mercy' ? mercyLimit.value : undefined,
        jumpInEnabled: jumpInEnabled.value,
      })
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
          <label class="mb-1 block text-sm font-medium text-slate-300">Game mode</label>
          <div class="grid grid-cols-2 gap-2">
            <button
              type="button"
              class="rounded-lg border py-2 text-left text-sm font-semibold transition"
              :class="
                gameMode === 'classic'
                  ? 'border-uno-yellow bg-uno-yellow/10 text-uno-yellow'
                  : 'border-white/10 text-slate-400 hover:border-white/20'
              "
              @click="gameMode = 'classic'"
            >
              <span class="block px-1">Classic</span>
              <span class="block px-1 text-[10px] font-normal text-slate-500">Standard UNO rules</span>
            </button>
            <button
              type="button"
              class="rounded-lg border py-2 text-left text-sm font-semibold transition"
              :class="
                gameMode === 'no-mercy'
                  ? 'border-uno-red bg-uno-red/10 text-uno-red'
                  : 'border-white/10 text-slate-400 hover:border-white/20'
              "
              @click="gameMode = 'no-mercy'"
            >
              <span class="block px-1">No Mercy</span>
              <span class="block px-1 text-[10px] font-normal text-slate-500">Stacking, elimination, chaos</span>
            </button>
          </div>
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

        <div v-if="mode === 'create'" class="mb-5">
          <button
            type="button"
            class="flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left transition"
            :class="jumpInEnabled ? 'border-uno-yellow bg-uno-yellow/10' : 'border-white/10 hover:border-white/20'"
            @click="jumpInEnabled = !jumpInEnabled"
          >
            <span>
              <span class="block text-sm font-semibold" :class="jumpInEnabled ? 'text-uno-yellow' : 'text-slate-300'">Jump-In</span>
              <span class="block text-[10px] font-normal text-slate-500">
                Play an exact color+number/symbol match out of turn, any time
              </span>
            </span>
            <span
              class="relative h-6 w-11 shrink-0 rounded-full transition-colors"
              :class="jumpInEnabled ? 'bg-uno-yellow' : 'bg-slate-700'"
            >
              <span
                class="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform"
                :class="jumpInEnabled ? 'translate-x-[22px]' : 'translate-x-0.5'"
              ></span>
            </span>
          </button>
        </div>

        <div v-if="mode === 'create' && gameMode === 'no-mercy'" class="mb-5">
          <label class="mb-1 block text-sm font-medium text-slate-300">Mercy limit</label>
          <input
            v-model.number="mercyLimit"
            type="number"
            :min="MERCY_LIMIT_MIN"
            step="1"
            @blur="clampMercyLimit"
            class="w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-slate-100 outline-none ring-uno-red/60 focus:ring-2"
          />
          <p class="mt-1 px-1 text-[11px] text-slate-500">
            Cards in hand before you're knocked out for the round (min {{ MERCY_LIMIT_MIN }}).
          </p>
        </div>

        <div v-if="mode === 'join'" class="mb-5">
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
