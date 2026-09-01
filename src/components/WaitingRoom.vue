<script setup>
import { computed } from 'vue'
import { MIN_PLAYERS } from '../lib/uno/constants.js'

const props = defineProps({
  room: { type: Object, required: true },
  uid: { type: String, required: true },
})
const emit = defineEmits(['start', 'leave'])

const isHost = computed(() => props.room.hostUid === props.uid)
const canStart = computed(() => props.room.players.length >= MIN_PLAYERS)
</script>

<template>
  <div class="mx-auto max-w-lg px-4 py-10">
    <div class="mb-6 text-center">
      <p class="text-sm uppercase tracking-widest text-slate-500">Invite code</p>
      <p class="mt-1 font-display text-5xl font-extrabold tracking-[0.25em] text-uno-yellow">{{ room.code }}</p>
      <p class="mt-2 text-sm text-slate-400">Share this code — friends can join from the home screen.</p>
    </div>

    <div class="rounded-2xl border border-white/10 bg-white/5 p-5">
      <div class="mb-3 flex items-center justify-between">
        <p class="font-display font-semibold text-slate-200">Players ({{ room.players.length }})</p>
        <p class="text-xs text-slate-500">Playing to {{ room.targetScore }} pts</p>
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
