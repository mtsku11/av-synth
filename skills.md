# skills.md — av-synth recipes & workflows

Terse reference for non-obvious workflows, gotchas, and patterns discovered during builds. Not a tutorial — a reminder for the next session.

---

## Operator implementation ceremony

Adding a video operator touches 6+ files and has mandatory QA + doc sync in the same change. Use `/op-add` for the guided workflow. Key gotchas:

- Operator names must match Hydra exactly for parity ops. Novel ops need a name decision in `memory.md` first.
- One operator = one fragment shader. No mega-shaders.
- Batch by subfamily (2–3 related ops), not by family. Stop for review after each batch.
- Do not add a public audio twin. The audio surface is granulator + feedback delay + limiter only.
- Do not add to `DEFAULT_CHAIN` unless defaults are identity in both domains.

---

## Knob vs Slider decision

- **Knobs**: all continuous params. `Knob.svelte` handles arbitrary `ParamSpec` ranges and curves via `mapFromCurve`/`mapToCurve`. `formatValue(spec, value)` handles unit-aware display.
- **Sliders**: only for choice/segmented params (discrete options rendered as buttons). Use `Slider` with `spec.choices` set.
- Canonical param specs live in `*-params.ts` files (e.g. `granulator-params.ts`, `feedback-delay-params.ts`). Never duplicate ranges in the UI layer.

---

## Running QA gates

- **Quick check**: `npm run check` (svelte-check, seconds)
- **Unit tests**: `npm run test:run` (vitest, ~10s)
- **Single operator audit**: `npm run qa:audit:cases -- -g audit-<op>` then `npm run qa:analyze -- audit-<op>`
- **Full audit**: `npm run qa:audit` (all cases + analyze)
- **Soak canary**: `/granulator-soak` or `GRANULATOR_SOAK_S=60 npx playwright test -c qa/playwright.config.ts -g b2.3 --reporter=list`
- **Full CI equivalent**: `npm run qa:ci`
- **Op characterisation**: `npm run qa:opSweep` (quick) or `npm run qa:opSweep:thorough` (full matrix). Use `BLESS=1` to update baselines.
- **Smoke on external server**: `PLAYWRIGHT_SERVER_MODE=external PLAYWRIGHT_BASE_URL=http://localhost:5173 npm run qa:smoke:external`

---

## Visual verification pattern

The source of truth for "does the user see the right thing" is the visible `<canvas>` element, not internal WebGL FBOs. Internal targets (`readPixelAt`, `readCenterPixel`) can stay lit when the canvas is black due to `preserveDrawingBuffer: false`. Use Playwright/chrome-devtools screenshots of the actual element.

---

## Zero-alloc render loop rules

The render loop (`requestAnimationFrame` path) must not allocate:
- No `new` inside the frame callback
- No `Object.keys()`/`Object.entries()` — use `for...in`
- No array spread or object spread — mutate pre-allocated scratch buffers
- Pre-allocate per-step scratch in `setPlan()`, not per-frame
- Grain scheduler uses a pooled `MutableVoice[]` with count cursor, not `new GrainEvent()`

---

## Dev server for Playwright

- `npm run dev` → `http://localhost:5173` (default)
- `npm run dev:http` → `http://127.0.0.1:4173` (fixed Playwright URL)
- `npm run preview:http` → same port, built preview (closer to production)
- Playwright auto-starts its own server if nothing is listening. Set `PLAYWRIGHT_SERVER_MODE=external` + `PLAYWRIGHT_BASE_URL` to use an existing one.

---

## Worklet sync discipline

Main-thread TS and AudioWorklet JS share protocol constants (ring field offsets, envelope indices, capacity). The structural sync test (`src/audio/granulator-constants.test.ts`) parses the worklet file and asserts TS exports match. If you change a constant in either file, change both and run the test.

---

## DeepSeek delegation

- `ask-deepseek <files> -q "question"` for reading 3+ files or files >400 lines
- `deepseek-write "spec" [-c files] [-o ~/.deepseek-out/<slug>]` for boilerplate >100 lines
- `deepseek-audit "topic" -s <sources> [-o out]` for fact extraction across files
- Output goes under `~/.deepseek-out/`, not `/tmp`
- Never delegate: debugging, architecture, security, code review, AV-coupling math

---

## Session bootstrap

Use `/session-start` at the beginning of each session. It reads the canonical file order (AGENTS.md → plan → todo → memory → qa/README → CLAUDE.md) and prints a compact status block with the current milestone, blocker count, and next action.
