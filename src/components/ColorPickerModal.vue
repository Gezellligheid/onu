<script setup>
defineProps({ show: { type: Boolean, default: false } })
const emit = defineEmits(['choose'])

const options = [
  { key: 'red', label: 'Red', cls: 'bg-uno-red' },
  { key: 'yellow', label: 'Yellow', cls: 'bg-uno-yellow' },
  { key: 'green', label: 'Green', cls: 'bg-uno-green' },
  { key: 'blue', label: 'Blue', cls: 'bg-uno-blue' },
]
</script>

<template>
  <div v-if="show" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
    <div class="animate-pop rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
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
