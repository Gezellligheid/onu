<script setup>
import { computed } from 'vue'

const props = defineProps({
  card: { type: Object, default: null }, // null => face-down card back
  size: { type: String, default: 'md' }, // sm | md | lg
  playable: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
})

const sizes = {
  sm: 'w-10 h-14 text-[10px] rounded-lg',
  md: 'w-16 h-24 text-sm rounded-xl',
  lg: 'w-20 h-28 text-base rounded-xl',
}

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

const textClass = computed(() => (props.card?.color === 'yellow' ? 'text-uno-black' : 'text-white'))

const symbol = computed(() => {
  const c = props.card
  if (!c) return ''
  if (c.type === 'number') return String(c.value)
  if (c.type === 'skip') return '⊘'
  if (c.type === 'reverse') return '⇄'
  if (c.type === 'draw2') return '+2'
  if (c.type === 'wild') return '★'
  if (c.type === 'wild4') return '+4'
  return ''
})

const isWildType = computed(() => props.card && (props.card.type === 'wild' || props.card.type === 'wild4'))
</script>

<template>
  <div
    class="relative select-none border-2 border-white/80 card-shadow flex items-center justify-center font-display font-extrabold transition-transform"
    :class="[
      sizes[size],
      bgClass,
      textClass,
      playable && !disabled ? 'cursor-pointer hover:-translate-y-2 hover:shadow-2xl' : '',
      disabled ? 'opacity-50' : '',
    ]"
  >
    <template v-if="!card">
      <div class="flex h-full w-full items-center justify-center rounded-[inherit] bg-slate-900">
        <div class="h-2/3 w-2/3 rounded-full border-4 border-uno-red/80"></div>
      </div>
    </template>
    <template v-else-if="isWildType">
      <div class="grid h-full w-full grid-cols-2 grid-rows-2 overflow-hidden rounded-[inherit]">
        <div class="bg-uno-red"></div>
        <div class="bg-uno-yellow"></div>
        <div class="bg-uno-green"></div>
        <div class="bg-uno-blue"></div>
      </div>
      <span class="absolute rounded-full bg-white/90 px-1.5 py-0.5 text-black drop-shadow">{{ symbol }}</span>
    </template>
    <template v-else>
      <span class="drop-shadow-sm">{{ symbol }}</span>
      <span class="absolute left-1 top-0.5 text-[0.6em] opacity-90">{{ symbol }}</span>
      <span class="absolute bottom-0.5 right-1 rotate-180 text-[0.6em] opacity-90">{{ symbol }}</span>
    </template>
  </div>
</template>
