<script setup>
import { computed } from 'vue'
import PlayingCard from './PlayingCard.vue'

const props = defineProps({
  cards: { type: Array, required: true }, // only .length is used unless reveal is on
  reveal: { type: Boolean, default: false }, // spectator mode (eliminated): show real faces, not backs
})

const count = computed(() => props.cards.length)

// Fixed-ish spread budget: spacing per card shrinks as the hand grows, so a
// big hand reads as a denser fan instead of sprawling wider and wider.
const offsetX = computed(() => Math.min(14, 120 / Math.max(count.value, 1)))
const rotateStep = computed(() => Math.min(8, 65 / Math.max(count.value, 1)))
const fanWidth = computed(() => Math.max(count.value - 1, 0) * offsetX.value + 40)

function style(i, total) {
  if (total <= 1) return { transform: 'translateX(-50%)', zIndex: i }
  const mid = (total - 1) / 2
  const offset = i - mid
  const rotate = offset * rotateStep.value
  const x = offset * offsetX.value
  const y = Math.abs(offset) * (offsetX.value * 0.2)
  return {
    transform: `translateX(calc(-50% + ${x}px)) translateY(${y}px) rotate(${rotate}deg)`,
    zIndex: i,
  }
}
</script>

<template>
  <div class="relative flex h-10 items-start justify-center" :style="{ width: `${fanWidth}px` }">
    <div v-for="i in count" :key="i" class="absolute left-1/2 top-0" :style="style(i - 1, count)">
      <PlayingCard :card="reveal ? cards[i - 1] : null" size="sm" />
    </div>
  </div>
</template>
