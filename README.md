# UNO Online

Real-time multiplayer UNO for you and your friends — built with Vue 3, Tailwind CSS, and Firebase (Authentication + Firestore). Create a room, share the invite code, and play.

## Features

- **Invite-code multiplayer** — one player creates a room and gets a short code (e.g. `K7QXM`); everyone else joins by typing it in. No lobbies to browse, no accounts to create.
- **Firebase anonymous auth** — sign-in is just a display name, backed by Firebase Anonymous Authentication under the hood.
- **Real-time sync** — game state lives in Firestore and syncs to every player instantly via `onSnapshot` listeners.
- **Round table layout** — opponents are seated in an arc around the discard/draw piles, like sitting around a real table, with their hands shown as fanned card backs (so you always see at a glance how many cards everyone's holding).
- **Real card artwork**, animated dealing/playing/drawing, and synthesized sound effects (see [Look & feel](#look--feel)).
- **Clear turn & playable-card cues** — the active player glows, your playable cards get a pulsing highlight, and the draw pile tells you when you must draw.
- **House rules**: stacking +2/+4 cards, draw-until-playable, an unlimited draw pile, and a 10-second AFK auto-play (see [Rules implemented](#rules-implemented--classic-mode)).
- **Two game modes** — Classic UNO, or [UNO No Mercy](#game-modes) (Mattel's 2023 elimination variant), chosen by the host at room creation.
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
- **Hands are open by design** — every player's actual cards are shown to everyone (fanned card backs became fanned card *faces*), not just counts. This is a deliberate casual/couch-co-op mode, not a bug: it turns the shared game document's inherent lack of secrecy (see below) into a feature instead of a leak.
- All game state, including every hand, lives in one shared Firestore document that all players read — there's no server-side concept of "this hand belongs to this player" enforced by the backend, only by the UI. If you want genuinely hidden hands later, that requires moving the authoritative game logic into a Cloud Function or another server component that keeps each player's hand in a doc only they can read. The `src/lib/uno/engine.js` module is a pure, framework-free rules engine, so it could be dropped into a Cloud Function largely as-is if you want to go that route.

## Game modes

The host picks a mode when creating a room; it's fixed for that room's lifetime.

- **Classic** — standard UNO plus the house rules below.
- **UNO No Mercy** — a from-scratch implementation of Mattel's [UNO Show 'Em No Mercy](https://service.mattel.com/instruction_sheets/HVW18-Eng.pdf) (2023), a genuinely different 168-card game: value-tiered Draw stacking (+2/+4/+6/+10, any Draw card of equal-or-higher value can stack, not just matching types), **Discard All** and **Skip Everyone** action cards, a **7's Swap** (forces a full hand swap with a player of your choice — click their seat at the table to pick who) and **0's Pass** (everyone's hand passes to the next player), **Wild Color Roulette** (the next player picks a color, then reveals cards from the draw pile until they hit it), and the **Mercy rule**: reach 25 cards in hand and you're knocked out for the rest of the round (your cards re-enter the deck on the next reshuffle), with the last player standing winning outright. None of its four wild cards (Reverse Draw 4, Draw 6, Draw 10, Color Roulette) have a "choose a color" step — that's a classic-only mechanic, and there's no plain "Wild" card in this deck at all. Scoring adds a 250-point bonus per knockout. Every card count here (including the non-uniform ones — Draw Four and Skip Everyone only get 2 copies per color instead of 3; the four wilds split 8/8/4/4, not evenly) was hand-verified off real card photos rather than assumed. Implementation lives in `src/lib/no-mercy/` as a fully parallel rules engine — see [Project structure](#project-structure).

## Rules implemented — Classic mode

Based on the [official rules](https://www.unorules.com/), plus a few common house rules called out below:

- 108-card deck: four colors × (one 0, two each of 1–9, two Skip, two Reverse, two Draw Two) + 4 Wild + 4 Wild Draw Four. The **draw pile is effectively unlimited** — if it and the discard pile both run dry (only realistic during a long stacking chain), a fresh shuffled deck is generated on the fly so a draw can never fail.
- 7 cards dealt to each player (2–10 players supported).
- Play must match the top card's color, number, or symbol; Wilds are always playable.
- **Skip** — next player loses their turn.
- **Reverse** — reverses turn order (acts as a Skip in 2-player games).
- **Draw Two / Wild Draw Four stacking (house rule)** — instead of drawing immediately, the next player may play another card of the *same* type (any color) to add to the pile and pass it along the chain grows (+2, +4, +6, …) until someone can't or won't stack, at which point they draw the whole accumulated total and their turn ends. While a stack is pending, only matching stack cards are legal — everything else is blocked until it's resolved.
- **Wild** — play any time; choose the next color.
- **Wild Draw Four** — starts (or extends) a stacking chain as above; choose the next color. (Enforcement of "you may only play this if you have no matching color" is honor-based, same as physical play — not blocked by the app.)
- **Draw-until-playable (house rule)** — if you have no legal play, drawing doesn't pass your turn: click the draw pile, and if that card isn't playable either, it's still your turn — click again. Once you draw something playable you may play it or keep it and pass. Each draw is its own click/animation, so it feels like actually drawing from a pile rather than an instant top-up. (The unlimited deck guarantees you'll eventually draw something playable.)
- **Forced +2/+4 penalty draws are automatic** — once it's your turn to answer a pending stack and you have no matching card to counter with, the cards are dealt to you on their own (no clicking) — but still one at a time with the same fly/sound animation, not an instant dump. If you *do* have a card that could extend the stack, it's still your call: play it to keep the chain going, or click the draw pile yourself to take the total instead.
- **Calling UNO** — strict rule: the "UNO!" button only appears in the exact moment you're about to play your second-to-last card (your turn, holding exactly 2, with a legal play). It can't be called before that or after the fact — if you play down to 1 card without having called it, any other player can hit **Catch!** to make you draw 2 penalty cards, with no way to self-rescue after the fact.
- **10-second AFK auto-play** — if whoever needs to act (play/draw/pass/pick a color) hasn't done anything for 10 seconds, the app plays a random legal move for them so the game never stalls on an idle player (if that move is a forced multi-card draw, it draws the rest of it in quick succession rather than waiting another 10s per card). A countdown appears in the last few seconds before it kicks in.
- A round ends the instant a player empties their hand; a fresh round is dealt automatically for the next hand.
- Illegal starting flips are handled per the rules (a Wild Draw Four starter is reshuffled back in; Draw Two/Skip/Reverse/Wild starters apply their effect to the first turn, without a stacking opportunity since no one's had a turn yet).

## Look & feel

- **Card artwork** — both modes use real photographed card faces: classic in `public/cards/` (`{color}-{value|skip|reverse|draw2}.jpg`, plus `wild.jpg` / `wild-draw4.jpg`), No Mercy in `public/cards/no-mercy/` (`{color}-{value|type}.jpg`), both user-supplied, not downloaded by this app. The No Mercy set was cropped with [`scripts/crop-no-mercy-cards.mjs`](scripts/crop-no-mercy-cards.mjs) out of `nomercycards/`, a set of print-sheet images (each a 5×2 grid of card faces) — that script is also how the deck's exact (and non-uniform) card counts were verified: one crop per unique design, counted straight off the sheets rather than assumed. Both card sets are rendered by [`PlayingCard.vue`](src/components/PlayingCard.vue), keyed off each card's `nm` flag; the face-down back is drawn with CSS so no back-of-card image is needed either way.
- **Animations** — cards visibly fly from a player's hand to the discard pile when played, and from the draw pile to whoever's drawing (each one its own flight, matching the click-per-card draw rule above); the discard pile flips when the top card changes, the draw pile pops on every draw, playable cards get a soft pulsing ring (a red pulsing ring instead when you must respond to a +2/+4 stack), and an invalid action shakes your hand.
- **Seats are fixed, like a real table** — opponents sit in a permanent arc in turn order with "you" at the near edge, so walking around the arc *is* the play order. A big circular arrow behind the piles (mirrored when Reverse flips the direction) shows which way play currently flows, colored to match the current color.
- **Sound effects** are synthesized at runtime with the Web Audio API (see [`src/lib/sound.js`](src/lib/sound.js)) — no downloaded assets, no licensing/attribution questions, fully offline-capable. The exceptions are recorded clips (user-supplied, not sourced by this app) layered on top of their synthesized accents:
  - Calling "UNO!" → `public/sounds/uno-calls/`
  - Playing Skip → `public/sounds/blocked/`
  - Playing Reverse → `public/sounds/rotate/`
  - The current color changing (a color match, or a Wild/Wild+4 choosing one) → `public/sounds/colors/{red,yellow,green,blue}.m4a`, the exact color, not random
  - A Wild +4 specifically being played (not a plain Wild) → `public/sounds/blackcard/` (this replaces the generic stacking blip for +4s — no separate "draw" sound plays at the moment a +4 is played, only when it's actually drawn)
  - A forced +2/+4 penalty draw → `public/sounds/drawstack/`, played **once** per penalty regardless of how many cards it draws (not once per card)

  When more than one of these applies to the same event (e.g. a Wild +4 both changes the color and gets its own cue), they queue instead of layering: each one is awaited until it's *actually* finished playing, then there's a fixed 0.25s gap before the next starts.

  A mute toggle sits in the top-right of the game screen and the preference persists via `localStorage`.
- **Turn clarity** — on your turn the table glows and the whole screen gets a soft pulsing yellow edge glow, the active seat's avatar has a pulsing ring, a little pointer, *and* a soft yellow halo behind the whole badge, and a banner in the center always says exactly what's happening ("Your turn", "X must respond to the +6 stack!", "Choose a color!", etc). The draw pile itself labels what it wants ("Draw!" or "Draw 4!") whenever you have no other option.
- **A 1-second beat between turns** — when the turn actually hands off to someone else (not a continuation, like drawing several cards in a row), everyone gets a synchronized 1-second pause to see what just happened before the new player can act — their hand stays visibly dimmed and unclickable ("Get ready…") until it clears. Doesn't apply to a player still mid-turn (deciding to play a just-drawn card, resolving a forced draw, etc), only to an actual handoff. The AFK timer accounts for it (it doesn't start ticking until the pause is over).

## Scoring / pointing system

Standard UNO scoring (classic mode), applied at the end of every round:

| Card | Points |
|---|---|
| Number card (0–9) | Face value |
| Draw Two / Reverse / Skip | 20 |
| Wild | 40 |
| Wild Draw Four | 50 |

When a player goes out, they're awarded the **sum of every other player's remaining hand**, added to their running total. The match continues, round after round, until someone's cumulative score reaches the target (**200, 300, or 500** for classic; **500, 1000, or 1500** for No Mercy, whose knockout bonuses run much higher — see [Game modes](#game-modes)), at which point they win the game and a final scoreboard is shown.

## Project structure

```
src/
  lib/uno/          classic game engine: deck, rules, stacking, scoring (no Vue/Firebase deps)
  lib/no-mercy/      UNO No Mercy game engine — same shape as lib/uno/, fully parallel rules
  lib/uno/shared.js  the two genuinely mode-agnostic helpers (shuffle, clone) both engines use
  lib/uno/modes.js   { classic, 'no-mercy' } registry — getEngine(mode) picks the right one
  lib/room.js       Firestore read/write layer (rooms, transactions, actions)
  lib/sound.js      synthesized Web Audio SFX engine
  firebase.js       Firebase app/auth/firestore init
  stores/           Pinia stores (auth, room)
  components/       PlayingCard, CardFan, PlayerBadge, GameBoard, modals, WaitingRoom
  views/            HomeView (create/join), RoomView (lobby ⇄ game switch)
public/cards/       classic mode's UNO card face artwork (see "Look & feel" above)
```
