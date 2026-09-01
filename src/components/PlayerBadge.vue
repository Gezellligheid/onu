<script setup>
defineProps({
  name: { type: String, required: true },
  cardCount: { type: Number, required: true },
  isTurn: { type: Boolean, default: false },
  score: { type: Number, default: 0 },
  vulnerable: { type: Boolean, default: false }, // 1 card, hasn't called UNO
  canCatch: { type: Boolean, default: false },
})
defineEmits(['catch'])

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
  <div class="flex flex-col items-center gap-1">
    <div class="relative">
      <div
        class="flex h-12 w-12 items-center justify-center rounded-full border-2 font-display text-sm font-bold transition"
        :class="
          isTurn
            ? 'border-uno-yellow bg-uno-yellow/20 text-uno-yellow animate-pulse-glow'
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
        v-if="vulnerable"
        class="absolute -top-1.5 left-1/2 -translate-x-1/2 rounded-full bg-uno-red px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white shadow"
      >
        UNO!
      </span>
    </div>
    <div class="text-center leading-tight">
      <p class="max-w-[6rem] truncate text-xs font-semibold text-slate-200">{{ name }}</p>
      <p class="text-[10px] text-slate-500">{{ score }} pts</p>
    </div>
    <button
      v-if="canCatch"
      type="button"
      class="rounded-full bg-uno-red px-2 py-0.5 text-[10px] font-bold text-white shadow hover:bg-red-600"
      @click="$emit('catch')"
    >
      Catch!
    </button>
  </div>
</template>
