<script setup>
defineProps({ show: { type: Boolean, default: false }, cancelable: { type: Boolean, default: false } })
const emit = defineEmits(['choose', 'cancel'])

const options = [
  { key: 'red', label: 'Red', cls: 'bg-uno-red' },
  { key: 'yellow', label: 'Yellow', cls: 'bg-uno-yellow' },
  { key: 'green', label: 'Green', cls: 'bg-uno-green' },
  { key: 'blue', label: 'Blue', cls: 'bg-uno-blue' },
]
</script>

<template>
  <div v-if="show" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
    <div class="animate-pop relative rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
      <!-- Only offered when a card was tentatively picked from hand (not yet
      played) — backs out to the hand so a different card can be chosen
      instead. The starting-color and Color Roulette picks aren't tied to a
      card selection, so they don't get this. -->
      <button
        v-if="cancelable"
        type="button"
        aria-label="Cancel"
        class="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/10 hover:text-slate-100"
        @click="emit('cancel')"
      >
        ✕
      </button>
      <p class="mb-4 text-center font-display text-lg font-bold text-slate-100">Choose a color</p>
      <div class="grid grid-cols-2 gap-3">
        <button
          v-for="o in options"
          :key="o.key"
          type="button"
          class="h-20 w-24 rounded-xl border-2 border-white/30 font-display font-bold text-white shadow-lg transition hover:scale-105 active:scale-95"
          :class="o.cls"
          @click="emit('choose', o.key)"
        >
          {{ o.label }}
        </button>
      </div>
    </div>
  </div>
</template>
