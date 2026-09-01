<script setup>
import { computed } from 'vue'
import PlayingCard from './PlayingCard.vue'

const props = defineProps({
  count: { type: Number, required: true },
  max: { type: Number, default: 7 },
})

const shown = computed(() => Math.min(props.count, props.max))
const overflow = computed(() => Math.max(0, props.count - props.max))

function style(i, total) {
  if (total <= 1) return { transform: 'translateX(-50%)' }
  const mid = (total - 1) / 2
  const offset = i - mid
  const rotate = offset * 9
  const x = offset * 11
  const y = Math.abs(offset) * 2.5
  return {
    transform: `translateX(calc(-50% + ${x}px)) translateY(${y}px) rotate(${rotate}deg)`,
    zIndex: i,
  }
}
</script>

<template>
  <div class="relative flex h-10 items-start justify-center" :style="{ width: `${Math.max(shown, 1) * 14 + 20}px` }">
    <div v-for="i in shown" :key="i" class="absolute left-1/2 top-0" :style="style(i - 1, shown)">
      <PlayingCard :card="null" size="sm" />
    </div>
    <span
      v-if="overflow > 0"
      class="absolute -right-1 -top-1 z-20 flex h-4 min-w-4 items-center justify-center rounded-full bg-slate-950 px-1 text-[9px] font-bold text-white ring-2 ring-slate-900"
    >
      +{{ overflow }}
    </span>
  </div>
</template>
