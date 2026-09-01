<script setup>
import { computed } from 'vue'

const props = defineProps({
  card: { type: Object, default: null }, // null => face-down card back
  size: { type: String, default: 'md' }, // sm | md | lg
  playable: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  glow: { type: Boolean, default: false }, // gentle "you can play this" ring
  urgent: { type: Boolean, default: false }, // "you must stack this" ring
  animateIn: { type: String, default: '' }, // '', 'deal', 'flip', 'fly', 'pop'
})

const sizes = {
  sm: 'w-10 h-14 rounded-lg',
  md: 'w-16 h-24 rounded-xl',
  lg: 'w-20 h-28 rounded-xl',
}

const enterAnim = {
  deal: 'animate-deal-in',
  flip: 'animate-flip-in',
  fly: 'animate-fly-in',
  pop: 'animate-pop',
  '': '',
}

// Fallback tint shown behind the artwork while it loads (or if it 404s).
const bgClass = computed(() => {
  const c = props.card
  if (!c) return 'bg-slate-800'
  return (
    {
      red: 'bg-uno-red',
      yellow: 'bg-uno-yellow',
      green: 'bg-uno-green',
      blue: 'bg-uno-blue',
      black: 'bg-gradient-to-br from-neutral-800 to-black',
    }[c.color] || 'bg-slate-800'
  )
})

const imageSrc = computed(() => {
  const c = props.card
  if (!c) return null
  if (c.type === 'wild') return '/cards/wild.jpg'
  if (c.type === 'wild4') return '/cards/wild-draw4.jpg'
  const key = c.type === 'number' ? c.value : c.type // skip | reverse | draw2
  return `/cards/${c.color}-${key}.jpg`
})

const altText = computed(() => {
  const c = props.card
  if (!c) return 'Face-down card'
  if (c.type === 'number') return `${c.color} ${c.value}`
  if (c.type === 'wild') return 'Wild'
  if (c.type === 'wild4') return 'Wild Draw Four'
  return `${c.color} ${c.label}`
})
</script>

<template>
  <div
    class="relative select-none card-shadow overflow-hidden border-2 border-white/80 transition-transform"
    :class="[
      sizes[size],
      bgClass,
      enterAnim[animateIn],
      playable && !disabled ? 'cursor-pointer hover:-translate-y-2 hover:shadow-2xl' : '',
      disabled ? 'opacity-50' : '',
      urgent ? 'animate-stack-pulse border-uno-red' : glow ? 'animate-ring-pulse border-uno-yellow' : '',
    ]"
  >
    <template v-if="!card">
      <div class="flex h-full w-full items-center justify-center rounded-[inherit] bg-slate-900">
        <div class="h-2/3 w-2/3 rounded-full border-4 border-uno-red/80"></div>
      </div>
    </template>
    <img v-else :src="imageSrc" :alt="altText" draggable="false" class="h-full w-full rounded-[inherit] object-cover" />
  </div>
</template>
