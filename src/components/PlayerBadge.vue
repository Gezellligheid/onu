<script setup>
import { computed } from 'vue'
import CardFan from './CardFan.vue'

const props = defineProps({
  name: { type: String, required: true },
  cards: { type: Array, required: true },
  isTurn: { type: Boolean, default: false },
  score: { type: Number, default: 0 },
  vulnerable: { type: Boolean, default: false }, // 1 card, hasn't called UNO
  canCatch: { type: Boolean, default: false },
  waitingOn: { type: Boolean, default: false }, // must respond to a pending draw stack
  eliminated: { type: Boolean, default: false }, // No Mercy: knocked out (25+ cards), sitting out the rest of the round
})
defineEmits(['catch'])

const cardCount = computed(() => props.cards.length)

function initials(n) {
  return n
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}
</script>

<template>
  <div class="relative flex flex-col items-center gap-0.5" :class="eliminated ? 'opacity-40 grayscale' : ''">
    <div
      v-if="isTurn && !eliminated"
      class="pointer-events-none absolute -inset-5 -z-10 animate-pulse rounded-full bg-uno-yellow/40 blur-xl"
      aria-hidden="true"
    ></div>
    <CardFan :cards="cards" />
    <div class="relative">
      <div
        class="flex h-12 w-12 items-center justify-center rounded-full border-2 font-display text-sm font-bold transition"
        :class="
          isTurn && !eliminated
            ? 'border-uno-yellow bg-uno-yellow/20 text-uno-yellow animate-turn-ring'
            : 'border-white/20 bg-slate-800 text-slate-300'
        "
      >
        {{ initials(name) }}
      </div>
      <span
        class="absolute -bottom-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-950 px-1 text-[10px] font-bold text-white ring-2 ring-slate-900"
      >
        {{ cardCount }}
      </span>
      <span
        v-if="eliminated"
        class="absolute -top-1.5 left-1/2 -translate-x-1/2 rounded-full bg-slate-700 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-200 shadow"
      >
        OUT
      </span>
      <span
        v-else-if="vulnerable"
        class="absolute -top-1.5 left-1/2 -translate-x-1/2 animate-pulse-glow rounded-full bg-uno-red px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white shadow"
      >
        UNO!
      </span>
      <span
        v-if="isTurn && !eliminated"
        class="absolute -bottom-3 left-1/2 -translate-x-1/2 text-uno-yellow drop-shadow"
        aria-hidden="true"
      >
        ▲
      </span>
    </div>
    <div class="text-center leading-tight">
      <p class="max-w-[6rem] truncate text-xs font-semibold" :class="isTurn && !eliminated ? 'text-uno-yellow' : 'text-slate-200'">
        {{ name }}
      </p>
      <p class="text-[10px] text-slate-500">{{ score }} pts</p>
    </div>
    <p v-if="waitingOn && !eliminated" class="animate-pulse text-[10px] font-bold text-uno-red">must respond!</p>
    <button
      v-if="canCatch && !eliminated"
      type="button"
      class="animate-pulse-glow rounded-full bg-uno-red px-4 py-1.5 text-sm font-bold text-white shadow-lg hover:bg-red-600"
      @click="$emit('catch')"
    >
      Catch!
    </button>
  </div>
</template>
