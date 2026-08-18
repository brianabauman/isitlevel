# The Better Eye - Interface Contract

A local, offline, 1v1 perception game. Two players pass the laptop and face the same
challenge types; the game measures who has the more accurate eye.

## Hard constraints (both agents)

- Vanilla JS, CSS, HTML only. No frameworks, no CDN, no fetch, no ES modules
  (plain `<script>` tags so `file://` double-click works). No build step.
- Every file must pass `node --check` (for .js) and be self-contained.
- Target: latest Chrome/Safari on macOS, single laptop, mouse/trackpad + keyboard.

## Files and ownership

| File | Owner |
|---|---|
| `index.html` | already written, do not modify |
| `game.js`, `styles.css` | Agent A (shell) |
| `challenges.js`, `challenges.css` | Agent B (challenges) |

`index.html` loads, in order: `styles.css`, `challenges.css`, `challenges.js`, `game.js`.
`game.js` renders everything into `<div id="app">`. All challenge CSS selectors must be
scoped under `.challenge-stage` to avoid collisions. Shell CSS must not style anything
inside `.challenge-stage` except the container itself (size/position).

## Challenge API

`challenges.js` defines:

```js
window.CHALLENGES = [ challengeDef, ... ];  // exactly 5 entries
```

```js
challengeDef = {
  id: "hang-the-frame",          // kebab-case, unique
  title: "Hang the Frame",       // shown in round intro
  instruction: "Drag or use ← → to rotate the frame until it is perfectly level.",
  create(container, rng, difficulty) => instance
}
```

- `container`: an empty `div.challenge-stage` sized by the shell (fills most of the
  viewport). The instance renders its whole scene inside it.
- `rng`: `() => number` in [0,1), seeded by the shell per (round, player). All scene
  randomness MUST come from `rng` so difficulty is reproducible, EXCEPT purely cosmetic
  flourishes which may use `Math.random()`.
- `difficulty`: integer 1..3. Higher = subtler perturbations, busier scenes.

```js
instance = {
  getScore() => { error, unit, maxError },
  reveal() => void,   // draw the truth: guide lines, ghost of correct position, animated
  destroy() => void   // remove ALL document/window listeners, clear container
}
```

- `error`: number >= 0, distance from perfect in `unit` (e.g. `"°"`, `"% of width"`).
- `maxError`: the error at which the player scores 0 points. Choose it so a careless
  attempt scores near 0 and a good eye scores 700+. The shell computes points as
  `round(1000 * (1 - min(error / maxError, 1)) ** 1.6)`.
- Input: the instance attaches its own pointer/keyboard listeners when created.
  Drag AND arrow keys (Shift+arrow = coarse) must both work. The instance MUST NOT
  react to `Enter`, `Escape`, `Tab`, or `Space` - the shell owns those.
- After the shell calls `getScore()` it calls `reveal()`, waits ~1800 ms, then shows its
  own score overlay on top. `reveal()` should freeze input (further adjustments ignored).
- `destroy()` is always called before the container is reused.

## The 5 challenges (Agent B)

Real-world domestic scenes, not abstract geometry. Rich CSS scenery: gradient wall
textures, baseboards, furniture silhouettes, soft shadows, warm lamp light. Each scene
should look like a cozy room, with cosmetic variation between plays.

1. `hang-the-frame` - a framed painting on a wall, randomly rotated ±(1.5..6)°
   (range shrinks with difficulty). Player rotates it level. `unit: "°"`, maxError ~5.
2. `center-the-art` - artwork above a sofa, offset horizontally. Player drags it to the
   sofa's center. Error in % of wall width, maxError ~6.
3. `even-the-spacing` - three frames in a row; the middle one is off. Player slides it
   until the two gaps match. Error = gap difference in % of wall width, maxError ~5.
4. `match-the-heights` - two frames side by side at different heights; player moves one
   to match the other's vertical center. Error in % of wall height, maxError ~5.
5. Agent B's choice - one more perception task with the same domestic flavor
   (e.g. plumb a hanging plant, level a shelf of books, align a light switch).
   Same API, comparable scoring feel.

The true "perfect" position must be honestly derivable from the scene the player sees
(no hidden skewed reference). Reveal should feel satisfying: e.g. a laser level line
sweeping in, a spirit-level bubble settling, the ghost of the perfect position fading in.

## Shell (Agent A)

Screens, all rendered into `#app` by `game.js`:

1. Title screen - game name "The Better Eye", tagline, two name inputs
   (defaults "Player 1" / "Player 2"), Start button.
2. Round flow - 6 rounds. Each round: pick a challenge (each of the 5 appears at least
   once; the 6th is a random repeat), difficulty ramps 1→2→3 over the game.
   Per round: Player A handoff screen ("Pass the laptop - NAME, look away!") →
   challenge (instruction bar + "Lock it in" button, Enter also locks) → reveal +
   animated score count-up + a judgment line ("Laser eye." / "Respectable." /
   "Were your eyes open?") → same for Player B with a DIFFERENT rng seed
   (same challenge + difficulty) → round result banner (who took the round).
3. Seeding: mulberry32 (or similar). Seed per (round, player) derived from a fresh
   game seed, so the two players get different scenes of identical difficulty and
   neither can learn the answer from watching the other's reveal.
4. Scoring: points formula above, running scoreboard always visible during rounds
   (names, totals, round wins). Streak bonus: winning consecutive rounds adds
   +50 × (streak-1) with an on-screen callout.
5. Winner screen - final totals, biggest single-round gap, per-challenge best,
   confetti (pure CSS/JS), "Rematch" button that fully resets with a new game seed.
6. Polish: smooth screen transitions, animated score count-up, keyboard flow
   (Enter advances everywhere sensible). Dark, warm, tasteful look - this is a
   living-room game, not an enterprise dashboard.

## Fairness rules (both agents)

- Nothing on screen may leak the truth before reveal (no straight reference edges
  adjacent to the manipulated object unless intended as part of the task; wall texture
  must not form an obvious grid; window/door frames must be either clearly level - part
  of the room - or absent near the target). Judgment call: rooms ARE full of level
  lines; keep reference edges far enough from the target that the eye, not a ruler
  trick, does the work.
- Error metrics must be honest and symmetric (overshoot = undershoot).
