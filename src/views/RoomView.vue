<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth.js'
import { useRoomStore } from '../stores/room.js'
import WaitingRoom from '../components/WaitingRoom.vue'
import GameBoard from '../components/GameBoard.vue'

const props = defineProps({ code: { type: String, required: true } })
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const roomStore = useRoomStore()

const nameInput = ref(auth.name || '')
const joining = ref(false)
const joinError = ref('')

const room = computed(() => roomStore.room)
const alreadyMember = computed(() => !!room.value && auth.uid && room.value.players.some((p) => p.uid === auth.uid))
const needsName = computed(() => auth.ready && !alreadyMember.value)

async function attach() {
  roomStore.watch(props.code)
}

async function submitJoin() {
  joinError.value = ''
  const name = nameInput.value.trim()
  if (!name) {
    joinError.value = 'Enter a display name.'
    return
  }
  joining.value = true
  try {
    const user = await auth.signIn(name)
    await roomStore.join({ code: props.code, uid: user.uid, name })
  } catch (e) {
    joinError.value = e.message || 'Could not join that room.'
  } finally {
    joining.value = false
  }
}

onMounted(attach)
onBeforeUnmount(() => roomStore.stopWatching())

watch(
  () => room.value,
  (val) => {
    if (auth.ready && val === null && roomStore.code) {
      // Room disappeared (host closed it / everyone left) or bad code.
    }
  },
)

async function onStart() {
  try {
    await roomStore.startGame(auth.uid)
  } catch (e) {
    joinError.value = e.message
  }
}

async function onLeave() {
  await roomStore.leave(auth.uid)
  router.push({ name: 'home' })
}
</script>

<template>
  <div v-if="roomStore.error" class="flex min-h-screen items-center justify-center px-4 text-center">
    <div>
      <p class="mb-4 text-slate-300">{{ roomStore.error }}</p>
      <router-link to="/" class="text-uno-blue underline">Back home</router-link>
    </div>
  </div>

  <div v-else-if="!room" class="flex min-h-screen items-center justify-center text-slate-500">Loading room…</div>

  <div v-else-if="needsName" class="flex min-h-screen items-center justify-center px-4">
    <div class="w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 p-6">
      <p class="mb-1 font-display text-lg font-bold text-slate-100">Join room {{ room.code }}</p>
      <p class="mb-4 text-sm text-slate-400">{{ room.players.length }} player(s) already in.</p>
      <input
        v-model="nameInput"
        maxlength="20"
        placeholder="Your name"
        class="mb-3 w-full rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-slate-100 outline-none ring-uno-yellow/60 focus:ring-2"
      />
      <p v-if="joinError" class="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{{ joinError }}</p>
      <button
        type="button"
        :disabled="joining"
        class="w-full rounded-lg bg-gradient-to-r from-uno-red via-uno-yellow to-uno-blue py-2.5 font-display font-bold text-white disabled:opacity-50"
        @click="submitJoin"
      >
        {{ joining ? 'Joining…' : 'Join' }}
      </button>
    </div>
  </div>

  <WaitingRoom v-else-if="room.status === 'lobby'" :room="room" :uid="auth.uid" @start="onStart" @leave="onLeave" />

  <GameBoard v-else />
</template>
