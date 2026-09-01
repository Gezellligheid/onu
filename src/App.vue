<script setup>
import { missingFirebaseConfig } from './firebase.js'
</script>

<template>
  <div class="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100">
    <div v-if="missingFirebaseConfig" class="flex min-h-screen items-center justify-center p-6">
      <div class="max-w-md rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6 text-center">
        <h1 class="font-display text-xl font-bold text-amber-300">Firebase is not configured</h1>
        <p class="mt-2 text-sm text-amber-100/80">
          Copy <code class="rounded bg-black/30 px-1">.env.example</code> to <code class="rounded bg-black/30 px-1">.env</code>
          and fill in your Firebase project keys, then restart the dev server.
        </p>
      </div>
    </div>
    <router-view v-else />
  </div>
</template>
