# memory.md — av-synth decision log

A running record of project-level decisions, design tensions, and open questions. **Append-only** in normal use — when a decision changes, add a new entry referencing the old one rather than rewriting history.

This file is project-scoped engineering memory, distinct from Claude's harness memory at `~/.claude/projects/-Users-marcscully-Projects-av-synth/memory/` (which holds cross-session preferences and user-feedback).

---

## Decisions

### 2026-05-16 — Build stack chosen

**Decision**: Vite + TypeScript + Svelte for the shell; raw WebGL2 for video; Web Audio API + custom AudioWorklets for audio.

**Why**:
- User asked for "professional, productisable" but was unsure of the tooling.
- Svelte gives a component model for the patch UI without React's bundle weight or runtime overhead. Output is lean enough to ship as a public web app.
- TypeScript keeps the cross-domain coupling types honest — `ParamSpec`, operator registries, the coupling table are all type-driven.
- Raw WebGL2 (no three.js / regl) because the entire product is a hand-built operator zoo; an abstraction layer would fight the design.
- AudioWorklet (not Tone.js) because every operator wants sample-accurate DSP that mirrors a GLSL fragment shader. Built-in Web Audio nodes are still used where they're a perfect fit (Delay, Biquad, Analyser, Gain).

**Reversibility**: medium. Swapping Svelte → React or lit later is a UI-layer rewrite, not architectural. Swapping audio engine is harder; commit carefully.

---

### 2026-05-16 — One coupling table, both renderers subscribe

**Decision**: All AV math lives in `src/core/coupling.ts` as the executable form of `plan.md`. Renderers never read raw slider values — they read mapped values from the coupling layer.

**Why**: Prevents AV drift. If the audio operator and the video operator each have their own interpretation of a slider's range/curve, they diverge under non-linear mappings. One spec, two evaluators.

**How to apply**: every new operator MUST register a `CouplingSpec` before the renderer touches it. PR review-rule.

---

### 2026-05-16 — `osc(N)` maps to `N Hz` by default

**Decision**: The unit law for spatial→temporal frequency is `f_audio (Hz) = baseFreq · f_spatial (cps)` with `baseFreq` defaulting to **1 Hz/cps**, so `osc(60)` plays at 60 Hz.

**Why**: User intuition. `osc(440)` should sound like A4. The alternative — using `baseFreq = 110 Hz` so `osc(1)` = A2 — is musically nicer but breaks the live-coding mental model (most Hydra examples use `osc(20..200)` which would then sit in the multi-kHz range).

**Open**: revisit when transport / scale-snap features arrive. Maybe make `baseFreq` a snap-able musical anchor.

---

### 2026-05-16 — `feedback` reframed as preset shorthand for `src(o0).blend(…)`

**Decision**: The prototype's first-class `feedback` parameter is not a Hydra concept. In the new architecture, expose `src(oN)` + `blend()` properly, and offer `feedback` as a UI shortcut.

**Why**: Hydra fidelity. Lets users compose feedback in chains, not only as a global mood knob.

---

### 2026-05-16 — `posterize` is the prototype's `crush`; add missing `gamma`

**Note**: The prototype calls its quantisation parameter `crush` but it's mathematically Hydra's `posterize`. Rename in the port; preserve `crush` as a UI label if needed. Add the `gamma` (pre-quantisation curve) parameter currently absent.

---

### 2026-05-16 — Prototype `shift` is chromatic-aberration, not Hydra `shift`

**Note**: The prototype's `u_shift` does RGB *spatial* offset (chromatic aberration). Hydra's `shift` does hue-shift per channel. Two different operators with the same name. Decision: keep the prototype effect under a new name (`chromaShift` or `aberrate`), and implement true Hydra `shift` per `plan.md §3.2`.

---

## Open mathematical questions

(Mirrored from `plan.md §11` — resolve here as decisions land.)

- [ ] Spatial-frequency unit for sources (provisional: `osc(N)` = `N Hz`, see above; revisit with transport).
- [ ] 3-band crossover frequencies for `color()` (provisional: 300 Hz / 3 kHz; expose in `core/coupling.ts` as a constant).
- [ ] `hue` pitch-shift law: octaves (`2^amount`) vs cents (`1200·amount`). UI presentation, not math.
- [ ] `scrollX` (time-domain delay) vs `scrollY` (stereo pan) asymmetry. Defensible if we think of X as the "time" axis of a delay line and Y as the spatial axis — analogous to the visual where X is horizontal and Y is vertical. Provisional.
- [ ] `colorama` chaotic-map choice: Hénon (2D, smoother) vs logistic (1D, sharper bifurcation). Provisional: logistic for predictability, swap to Hénon if it sounds boring.
- [ ] `solid` RGB → triad mapping. Options: fifth+octave `(1, 3/2, 2)`; major triad `(1, 5/4, 3/2)`; tritone `(1, √2, 2)`. UI-selectable, default fifth+octave for consonance.

## Design tensions to track

- **Live-code vs visual-patch.** The live-code editor (M4) and the future drag-wire patch UI both target the same graph. Keep the graph the source of truth so neither becomes the canonical front-end. The editor *generates* graph updates; the patch UI *manipulates* the graph. Same model, two views.
- **Hydra dialect tolerance.** Hydra users paste snippets expecting them to run. Our parser/eval must accept Hydra's API verbatim (no required `await`, no required imports). Trade-off: leaks Hydra's globals into the live-code scope. Acceptable.
- **Bidirectional coupling latency.** Audio→video reaction takes ~1 audio block (≈3 ms). Video→audio takes ~1 frame (~16 ms). The asymmetry will be audible when running feedback loops at fast rates. Document, then look at whether a sub-frame video analysis (e.g. running analysis in the audio worklet from a shared ring buffer of canvas reads) is worth the complexity.

## Notes that don't belong elsewhere

- Personal global rule: post-push verification via `mcp__github__list_commits` + Playwright screenshot. Applies here once we have a deployed URL.
- DeepSeek delegation rules apply: every survey of the 999-line prototype goes through `ask-deepseek`; every test/config file goes through `deepseek-write`.
