<script setup>
import { computed, ref, watch } from 'vue'
import { MIN_PLAYERS, DEFAULT_TARGET_SCORE as CLASSIC_DEFAULT_SCORE } from '../lib/uno/constants.js'
import {
  DEFAULT_TARGET_SCORE as NO_MERCY_DEFAULT_SCORE,
  TARGET_SCORE_OPTIONS as NO_MERCY_SCORE_OPTIONS,
  DEFAULT_MERCY_LIMIT,
  MERCY_LIMIT_MIN,
} from '../lib/no-mercy/constants.js'
import { isEmbedded } from '../discord.js'

const props = defineProps({
  room: { type: Object, required: true },
  uid: { type: String, required: true },
})
const emit = defineEmits(['start', 'leave', 'update-settings'])

// Discord: everyone's already in the same room automatically, so there's no
// code to share — see HomeView's embedded auto-join flow.
const embedded = isEmbedded()

const isHost = computed(() => props.room.hostUid === props.uid)
const canStart = computed(() => props.room.players.length >= MIN_PLAYERS)

const CLASSIC_SCORE_OPTIONS = [200, 300, 500]
const scoreOptions = computed(() => (props.room.mode === 'no-mercy' ? NO_MERCY_SCORE_OPTIONS : CLASSIC_SCORE_OPTIONS))

// The host can (re-)configure a still-in-lobby room's ruleset here — the
// only way to reach anything but Classic defaults for a Discord auto-bound
// room, which skips HomeView's create-time settings form entirely.
const mercyLimitDraft = ref(props.room.mercyLimit ?? DEFAULT_MERCY_LIMIT)
watch(
  () => props.room.mercyLimit,
  (v) => {
    mercyLimitDraft.value = v ?? DEFAULT_MERCY_LIMIT
  },
)

function saveSettings(patch) {
  emit('update-settings', {
    mode: props.room.mode,
    targetScore: props.room.targetScore,
    jumpInEnabled: props.room.jumpInEnabled,
    mercyLimit: props.room.mercyLimit ?? DEFAULT_MERCY_LIMIT,
    ...patch,
  })
}

function setMode(mode) {
  saveSettings({
    mode,
    targetScore: mode === 'no-mercy' ? NO_MERCY_DEFAULT_SCORE : CLASSIC_DEFAULT_SCORE,
  })
}

function setTargetScore(targetScore) {
  saveSettings({ targetScore })
}

function toggleJumpIn() {
  saveSettings({ jumpInEnabled: !props.room.jumpInEnabled })
}

function commitMercyLimit() {
  const n = Math.round(Number(mercyLimitDraft.value))
  const mercyLimit = Number.isFinite(n) ? Math.max(MERCY_LIMIT_MIN, n) : DEFAULT_MERCY_LIMIT
  mercyLimitDraft.value = mercyLimit
  saveSettings({ mercyLimit })
}

const linkCopied = ref(false)
async function onShareRoom() {
  const url = `${window.location.origin}/room/${props.room.code}`
  if (navigator.share) {
    try {
      await navigator.share({ title: 'UNO Online', text: `Join my UNO game — room ${props.room.code}`, url })
      return
    } catch {
      // Cancelled or unsupported — fall through to copy.
    }
  }
  try {
    await navigator.clipboard.writeText(url)
    linkCopied.value = true
    setTimeout(() => (linkCopied.value = false), 2000)
  } catch {
    // Clipboard unavailable — nothing more we can do here.
  }
}
</script>

<template>
  <div class="mx-auto max-w-lg px-4 py-10">
    <div class="mb-6 text-center">
      <template v-if="!embedded">
        <p class="text-sm uppercase tracking-widest text-slate-500">Invite code</p>
        <p class="mt-1 font-display text-5xl font-extrabold tracking-[0.25em] text-uno-yellow">{{ room.code }}</p>
        <p class="mt-2 text-sm text-slate-400">Share this code — friends can join from the home screen.</p>
        <button
          type="button"
          class="mt-3 inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-white/20 hover:text-slate-100"
          @click="onShareRoom"
        >
          {{ linkCopied ? '✅ Link copied!' : '🔗 Copy invite link' }}
        </button>
        <br />
      </template>
      <span
        class="mt-3 inline-block rounded-full px-3 py-1 text-xs font-bold"
        :class="room.mode === 'no-mercy' ? 'bg-uno-red/20 text-uno-red' : 'bg-uno-yellow/20 text-uno-yellow'"
      >
        {{ room.mode === 'no-mercy' ? 'UNO No Mercy' : 'Classic' }}
      </span>
      <span v-if="room.jumpInEnabled" class="ml-2 mt-3 inline-block rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-slate-300">
        Jump-In
      </span>
    </div>

    <div class="rounded-2xl border border-white/10 bg-white/5 p-5">
      <div class="mb-3 flex items-center justify-between">
        <p class="font-display font-semibold text-slate-200">Players ({{ room.players.length }})</p>
        <p class="text-right text-xs text-slate-500">
          Playing to {{ room.targetScore }} pts
          <span v-if="room.mode === 'no-mercy'"><br />Mercy limit: {{ room.mercyLimit ?? 25 }} cards</span>
        </p>
      </div>
      <ul class="space-y-2">
        <li
          v-for="p in room.players"
          :key="p.uid"
          class="flex items-center justify-between rounded-lg bg-slate-900/60 px-3 py-2"
        >
          <span class="text-sm font-medium text-slate-200">{{ p.name }}</span>
          <span v-if="p.uid === room.hostUid" class="rounded-full bg-uno-yellow/20 px-2 py-0.5 text-[10px] font-bold text-uno-yellow">
            HOST
          </span>
        </li>
      </ul>
    </div>

    <div v-if="isHost" class="mt-4 rounded-2xl border border-white/10 bg-white/5 p-5">
      <p class="mb-3 font-display font-semibold text-slate-200">Game settings</p>

      <div class="mb-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          class="rounded-lg border py-2 text-sm font-semibold transition"
          :class="
            room.mode === 'classic'
              ? 'border-uno-yellow bg-uno-yellow/10 text-uno-yellow'
              : 'border-white/10 text-slate-400 hover:border-white/20'
          "
          @click="setMode('classic')"
        >
          Classic
        </button>
        <button
          type="button"
          class="rounded-lg border py-2 text-sm font-semibold transition"
          :class="
            room.mode === 'no-mercy'
              ? 'border-uno-red bg-uno-red/10 text-uno-red'
              : 'border-white/10 text-slate-400 hover:border-white/20'
          "
          @click="setMode('no-mercy')"
        >
          No Mercy
        </button>
      </div>

      <div class="mb-3 grid grid-cols-3 gap-2">
        <button
          v-for="s in scoreOptions"
          :key="s"
          type="button"
          class="rounded-lg border py-1.5 text-xs font-semibold transition"
          :class="
            room.targetScore === s
              ? 'border-uno-yellow bg-uno-yellow/10 text-uno-yellow'
              : 'border-white/10 text-slate-400 hover:border-white/20'
          "
          @click="setTargetScore(s)"
        >
          {{ s }} pts
        </button>
      </div>

      <div v-if="room.mode === 'no-mercy'" class="mb-3">
        <label class="mb-1 block text-xs font-medium text-slate-400">Mercy limit</label>
        <input
          v-model.number="mercyLimitDraft"
          type="number"
          :min="MERCY_LIMIT_MIN"
          step="1"
          @blur="commitMercyLimit"
          class="w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-100 outline-none ring-uno-red/60 focus:ring-2"
        />
      </div>

      <button
        type="button"
        class="flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition"
        :class="room.jumpInEnabled ? 'border-uno-yellow bg-uno-yellow/10' : 'border-white/10 hover:border-white/20'"
        @click="toggleJumpIn"
      >
        <span class="text-sm font-semibold" :class="room.jumpInEnabled ? 'text-uno-yellow' : 'text-slate-300'">Jump-In</span>
        <span
          class="relative h-5 w-9 shrink-0 rounded-full transition-colors"
          :class="room.jumpInEnabled ? 'bg-uno-yellow' : 'bg-slate-700'"
        >
          <span
            class="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform"
            :class="room.jumpInEnabled ? 'translate-x-[18px]' : 'translate-x-0.5'"
          ></span>
        </span>
      </button>
    </div>

    <div class="mt-6 space-y-3">
      <button
        v-if="isHost"
        type="button"
        :disabled="!canStart"
        class="w-full rounded-lg bg-gradient-to-r from-uno-red via-uno-yellow to-uno-blue py-3 font-display text-lg font-bold text-white shadow-lg transition active:scale-[0.99] disabled:opacity-40"
        @click="emit('start')"
      >
        {{ canStart ? 'Start Game' : `Need at least ${MIN_PLAYERS} players` }}
      </button>
      <p v-else class="text-center text-sm text-slate-400">Waiting for the host to start the game…</p>

      <button
        type="button"
        class="w-full rounded-lg border border-white/10 py-2.5 text-sm font-medium text-slate-400 transition hover:border-white/20 hover:text-slate-200"
        @click="emit('leave')"
      >
        Leave Room
      </button>
    </div>
  </div>
</template>
