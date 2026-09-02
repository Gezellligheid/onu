<script setup>
import { computed } from 'vue'

const props = defineProps({
  card: { type: Object, default: null }, // null => face-down card back
  size: { type: String, default: 'md' }, // sm | md | lg | xl
  playable: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  glow: { type: Boolean, default: false }, // gentle "you can play this" ring
  urgent: { type: Boolean, default: false }, // "you must stack this" ring
  flash: { type: String, default: '' }, // '', 'yellow', 'red' — strobing "you must draw" border
  animateIn: { type: String, default: '' }, // '', 'deal', 'flip', 'fly', 'pop'
  tintColor: { type: String, default: '' }, // hex color: recolors a Wild/Wild+4's white artwork once a color has been chosen
})

const sizes = {
  sm: 'w-10 h-14 rounded-lg',
  md: 'w-16 h-24 rounded-xl',
  lg: 'w-[112px] h-[157px] rounded-2xl', // center piles
  xl: 'w-[134px] h-[202px] rounded-2xl', // your own hand
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

const showTint = computed(() => props.card && (props.card.type === 'wild' || props.card.type === 'wild4') && props.tintColor)

// UNO No Mercy cards ship with no downloadable real-product artwork (see
// README) — their faces are drawn here in pure CSS/SVG instead of a photo,
// styled with a jagged corner accent so they read as visually distinct
// from the photographed classic deck.
// No plain "Wild" card exists in this deck — every black card here is one
// of these four, none of which have a color-choice step (Color Roulette's
// color is picked by the NEXT player, to hunt for during its reveal).
const NM_WILD_TYPES = new Set(['wildReverseDraw4', 'wildDraw6', 'wildDraw10', 'wildColorRoulette'])
const NM_FACE = {
  skip: { big: '⊘', sub: 'SKIP' },
  reverse: { big: '⇄', sub: 'REVERSE' },
  draw2: { big: '+2', sub: '' },
  draw4: { big: '+4', sub: '' },
  discardAll: { big: 'ALL', sub: 'DISCARD' },
  skipEveryone: { big: '⊘', sub: 'SKIP ALL' },
  wildReverseDraw4: { big: '⇄+4', sub: 'WILD REVERSE' },
  wildDraw6: { big: '+6', sub: 'WILD' },
  wildDraw10: { big: '+10', sub: 'WILD' },
  wildColorRoulette: { big: '↻', sub: 'ROULETTE' },
}
const nmFace = computed(() => {
  const c = props.card
  if (!c) return null
  if (c.type === 'number') return { big: String(c.value), sub: '' }
  return NM_FACE[c.type] || { big: c.label || '?', sub: '' }
})
const nmIsWild = computed(() => props.card && NM_WILD_TYPES.has(props.card.type))
</script>

<template>
  <div
    class="relative select-none transition-transform"
    :class="[
      sizes[size],
      playable && !disabled ? 'cursor-pointer hover:-translate-y-2 hover:shadow-2xl' : '',
      flash === 'red'
        ? 'animate-flash-red'
        : flash === 'yellow'
          ? 'animate-flash-yellow'
          : urgent
            ? 'animate-stack-pulse'
            : glow
              ? 'animate-ring-pulse'
              : '',
    ]"
  >
    <!--
      The glow/flash rings above live on this OUTER element on purpose: the
      inner element below needs overflow-hidden to clip the artwork to its
      rounded corners, but overflow-hidden on an element also clips that
      same element's own box-shadow — which silently ate the "you must
      draw" flash border. Keeping the shadow on an unclipped ancestor fixes
      that.
    -->
    <div
      class="card-shadow relative h-full w-full overflow-hidden rounded-[inherit] border-2"
      :class="[
        bgClass,
        enterAnim[animateIn],
        disabled ? 'brightness-[0.45] saturate-[0.7]' : '',
        flash === 'red'
          ? 'border-uno-red'
          : flash === 'yellow'
            ? 'border-uno-yellow'
            : urgent
              ? 'border-uno-red'
              : glow
                ? 'border-uno-yellow'
                : 'border-white/80',
      ]"
    >
      <template v-if="!card">
        <div class="flex h-full w-full items-center justify-center rounded-[inherit] bg-slate-900">
          <div class="h-2/3 w-2/3 rounded-full border-4 border-uno-red/80"></div>
        </div>
      </template>
      <template v-else-if="card.nm">
        <div class="relative flex h-full w-full flex-col items-center justify-center rounded-[inherit]" :class="bgClass">
          <!-- Jagged corner accents distinguish No Mercy cards from the photographed classic deck -->
          <svg class="pointer-events-none absolute inset-0 h-full w-full opacity-40" viewBox="0 0 100 150" preserveAspectRatio="none">
            <polygon points="0,0 24,0 0,24" fill="white" />
            <polygon points="100,150 76,150 100,126" fill="white" />
          </svg>
          <div
            v-if="nmIsWild"
            class="absolute inset-[10%] grid grid-cols-2 grid-rows-2 gap-0.5 overflow-hidden opacity-90"
            :class="card.type === 'wildColorRoulette' ? 'rounded-full' : 'rounded-lg'"
          >
            <div class="bg-uno-red"></div>
            <div class="bg-uno-yellow"></div>
            <div class="bg-uno-green"></div>
            <div class="bg-uno-blue"></div>
          </div>
          <div
            class="relative z-10 flex items-center justify-center rounded-full bg-white/95 shadow"
            :class="size === 'sm' ? 'h-6 w-6' : size === 'md' ? 'h-9 w-9' : size === 'lg' ? 'h-12 w-12' : 'h-14 w-14'"
          >
            <span
              class="font-display font-extrabold leading-none text-uno-black"
              :class="size === 'sm' ? 'text-[9px]' : size === 'md' ? 'text-sm' : size === 'lg' ? 'text-lg' : 'text-xl'"
            >
              {{ nmFace.big }}
            </span>
          </div>
          <span
            v-if="nmFace.sub"
            class="relative z-10 mt-1 text-center font-display font-bold uppercase tracking-wide text-white drop-shadow"
            :class="size === 'sm' ? 'text-[5px]' : size === 'md' ? 'text-[7px]' : 'text-[9px]'"
          >
            {{ nmFace.sub }}
          </span>
        </div>
      </template>
      <template v-else>
        <img :src="imageSrc" :alt="altText" draggable="false" class="h-full w-full rounded-[inherit] object-cover" />
        <div
          v-if="showTint"
          class="pointer-events-none absolute inset-0 rounded-[inherit]"
          style="mix-blend-mode: color"
          :style="{ backgroundColor: tintColor }"
        ></div>
      </template>
    </div>
  </div>
</template>
