# UNO Online

Real-time multiplayer UNO for you and your friends — built with Vue 3, Tailwind CSS, and Firebase (Authentication + Firestore). Create a room, share the invite code, and play.

## Features

- **Invite-code multiplayer** — one player creates a room and gets a short code (e.g. `K7QXM`); everyone else joins by typing it in. No lobbies to browse, no accounts to create.
- **Firebase anonymous auth** — sign-in is just a display name, backed by Firebase Anonymous Authentication under the hood.
- **Real-time sync** — game state lives in Firestore and syncs to every player instantly via `onSnapshot` listeners.
- **Full official ruleset** (see [Rules implemented](#rules-implemented) below), including UNO calling/catching.
- **Classic UNO scoring** — first to 200/300/500 points wins the match (see [Scoring](#scoring--pointing-system)).

## Tech stack

- Vue 3 (`<script setup>`) + Vite
- Tailwind CSS
- Pinia for client state
- Firebase Auth (anonymous) + Firestore (game state & realtime sync)
- Vue Router

## Setup

### 1. Create a Firebase project

1. Go to the [Firebase console](https://console.firebase.google.com/) and create a project.
2. **Authentication** → Sign-in method → enable **Anonymous**.
3. **Firestore Database** → create a database (production mode is fine).
4. **Project settings** → under "Your apps", add a Web app and copy the config values.
5. In **Firestore → Rules**, paste the contents of [`firestore.rules`](./firestore.rules) from this repo and publish. (Or deploy it with the Firebase CLI: `firebase deploy --only firestore:rules`.)

### 2. Configure the app

```bash
cp .env.example .env
```

Fill in the six `VITE_FIREBASE_*` values from your Firebase web app config.

### 3. Install & run

```bash
npm install
npm run dev
```

Open the printed local URL, enter a name, and create a room. Open it in another tab/device (or send the invite code to a friend) to test multiplayer.

### 4. Deploy (optional)

The app is a static Vite build, so it deploys anywhere static hosting is available — Firebase Hosting, Vercel, Netlify, etc.

```bash
npm run build
```

Then upload the `dist/` folder (or connect the repo) to your host of choice. Remember to set the same `VITE_FIREBASE_*` environment variables on the host.

## How multiplayer works

Each room is a single Firestore document at `rooms/{inviteCode}` holding the player list and the full game state (deck, hands, discard pile, turn order, scores). All players subscribe to that document in real time; whoever takes an action (play a card, draw, call UNO) writes the new state back inside a Firestore transaction, and everyone else's screen updates automatically.

### Security model

This is designed for casual games among friends, not tournament-grade anti-cheat:

- Anyone with the invite code can join a room (by design — that's the whole point of the code).
- All players' hands are technically present in the shared game document, but the UI only ever renders your own hand and opponents' card *counts*. A friend using dev tools could inspect the payload and see others' hands — the same trust model as most browser-based card game demos that don't run a dedicated backend.
- If you want hands to be cryptographically hidden from other clients (not just hidden in the UI), that requires moving the authoritative game logic into a Cloud Function or another server component that keeps each player's hand in a doc only they can read. The `src/lib/uno/engine.js` module is a pure, framework-free rules engine, so it could be dropped into a Cloud Function largely as-is if you want to go that route later.

## Rules implemented

Based on the [official rules](https://www.unorules.com/):

- 108-card deck: four colors × (one 0, two each of 1–9, two Skip, two Reverse, two Draw Two) + 4 Wild + 4 Wild Draw Four.
- 7 cards dealt to each player (2–10 players supported).
- Play must match the top card's color, number, or symbol; Wilds are always playable.
- **Skip** — next player loses their turn.
- **Reverse** — reverses turn order (acts as a Skip in 2-player games).
- **Draw Two** — next player draws 2 cards and loses their turn.
- **Wild** — play any time; choose the next color.
- **Wild Draw Four** — next player draws 4 cards and loses their turn; choose the next color. (Enforcement of "you may only play this if you have no matching color" is honor-based, same as physical play — not blocked by the app.)
- If you can't play, you draw one card and may immediately play it if it's legal; otherwise your turn passes.
- **Calling UNO** — a "UNO!" button appears once you're down to one card. If you don't call it, any other player can hit **Catch!** to make you draw 2 penalty cards.
- A round ends the instant a player empties their hand; a fresh round is dealt automatically for the next hand.
- Illegal starting flips are handled per the rules (a Wild Draw Four starter is reshuffled back in; Draw Two/Skip/Reverse/Wild starters apply their effect to the first turn).

## Scoring / pointing system

Standard UNO scoring, applied at the end of every round:

| Card | Points |
|---|---|
| Number card (0–9) | Face value |
| Draw Two / Reverse / Skip | 20 |
| Wild | 40 |
| Wild Draw Four | 50 |

When a player goes out, they're awarded the **sum of every other player's remaining hand**, added to their running total. The match continues, round after round, until someone's cumulative score reaches the target (**200, 300, or 500** — chosen by the host when creating the room), at which point they win the game and a final scoreboard is shown.

## Project structure

```
src/
  lib/uno/         pure game engine: deck, rules, scoring (no Vue/Firebase deps)
  lib/room.js       Firestore read/write layer (rooms, transactions, actions)
  firebase.js       Firebase app/auth/firestore init
  stores/           Pinia stores (auth, room)
  components/       PlayingCard, PlayerBadge, GameBoard, modals, WaitingRoom
  views/            HomeView (create/join), RoomView (lobby ⇄ game switch)
```
