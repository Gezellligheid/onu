<script setup>
import { computed } from 'vue'

const props = defineProps({
  game: { type: Object, required: true },
  isHost: { type: Boolean, default: false },
})
const emit = defineEmits(['next-round', 'back-to-lobby'])

const isGameOver = computed(() => props.game.status === 'game-over')

const ranked = computed(() => {
  return props.game.playerOrder
    .map((uid) => ({
      uid,
      name: props.game.players.find((p) => p.uid === uid)?.name ?? 'Player',
      score: props.game.scores[uid] ?? 0,
    }))
    .sort((a, b) => b.score - a.score)
})

const winnerName = computed(
  () => props.game.players.find((p) => p.uid === (props.game.gameWinner ?? props.game.roundWinner))?.name ?? 'Someone',
)
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
    <div class="w-full max-w-sm animate-pop rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
      <div class="mb-4 text-center">
        <p class="font-display text-2xl font-extrabold" :class="isGameOver ? 'text-uno-yellow' : 'text-slate-100'">
          {{ isGameOver ? '🏆 Game Over!' : 'Round Over' }}
        </p>
        <p class="mt-1 text-sm text-slate-400">
          <span class="font-semibold text-slate-200">{{ winnerName }}</span>
          {{ isGameOver ? `wins the game with ${game.scores[game.gameWinner]} points!` : `wins the round — +${game.roundPoints} points` }}
        </p>
      </div>

      <div class="mb-5 divide-y divide-white/5 overflow-hidden rounded-xl border border-white/10">
        <div
          v-for="(p, i) in ranked"
          :key="p.uid"
          class="flex items-center justify-between px-4 py-2"
          :class="i === 0 ? 'bg-uno-yellow/10' : 'bg-white/[0.02]'"
        >
          <div class="flex items-center gap-2">
            <span class="w-5 text-sm font-bold text-slate-500">#{{ i + 1 }}</span>
            <span class="text-sm font-medium text-slate-200">{{ p.name }}</span>
          </div>
          <span class="font-display font-bold text-slate-100">{{ p.score }}</span>
        </div>
      </div>

      <p class="mb-4 text-center text-xs text-slate-500">First to {{ game.targetScore }} points wins the game.</p>

      <button
        v-if="!isGameOver"
        type="button"
        class="w-full rounded-lg bg-gradient-to-r from-uno-red via-uno-yellow to-uno-blue py-3 font-display font-bold text-white shadow disabled:opacity-40"
        :disabled="!isHost"
        @click="emit('next-round')"
      >
        {{ isHost ? 'Deal Next Round' : 'Waiting for host…' }}
      </button>
      <button
        v-else
        type="button"
        class="w-full rounded-lg bg-gradient-to-r from-uno-red via-uno-yellow to-uno-blue py-3 font-display font-bold text-white shadow disabled:opacity-40"
        :disabled="!isHost"
        @click="emit('back-to-lobby')"
      >
        {{ isHost ? 'Back to Lobby' : 'Waiting for host…' }}
      </button>
    </div>
  </div>
</template>
