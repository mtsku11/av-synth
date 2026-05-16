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

### 2026-05-16 — `scale` audio is M2 passthrough; pitch-shift worklet is M3

**Decision**: For M2 the `scale` operator's audio side is a literal passthrough Gain. Video does proper UV zoom; audio does nothing.

**Why**: plan.md §2.2 calls for pitch / time scaling on the audio side. Web Audio has no built-in pitch shifter for streaming MediaElement sources. The clean implementation is a varispeed resampler AudioWorklet. Building that worklet is M3 work and would have blown out M2 scope.

**How to apply**: When implementing M3 audio worklets, replace `ScalePassthroughAudioStage` in `src/ops/scale.ts` with a resampler that respects `amount` as the pitch ratio. Update the coupling kind from `'visual-only'` to `'fully-coupled'`.

---

### 2026-05-16 — `rate` lives on `clock`, exposed via CouplingContext

**Decision**: The prototype's global `u_rate` LFO frequency is exposed as `clock.rate` (Svelte $state on the clock store). Operators read it via `CouplingContext.rate`, not by directly importing the clock.

**Why**: Hydra fidelity calls for per-operator rate via the `.fast(n)` array modifier (M3 work). For M2 we have one global rate that every operator can subscribe to, mirroring the prototype. Routing through CouplingContext keeps operators decoupled from the clock module — the renderer and the audio engine both populate the context, so operators never need to know where rate comes from.

**How to apply**: When implementing `.fast(n)` per-operator automation in M3, the per-op rate overrides ctx.rate locally. The clock-level `rate` becomes the fallback / global default.

---

### 2026-05-16 — `time` in CouplingContext sourced from AudioContext.currentTime

**Decision**: `CouplingContext.time` is the same scalar in both domains, set per-frame (video) or per-poll (audio) from `AudioContext.currentTime` when available, falling back to a perf-derived clock otherwise.

**Why**: For LFO-driven visuals to stay phase-locked with their audio counterpart, both domains must read the same time scalar. AudioContext is the master because it's sample-accurate; rAF can drift up to a frame. The fallback exists only because operators are constructed before `audio.init()` and the renderer is already running.

**How to apply**: Operator stages should always read `ctx.time` from setUniforms/setParams — never `performance.now()` or `Date.now()` directly. Tests that depend on time should pass a CouplingContext with a fixed time value.

---

### 2026-05-16 — Procedural sources: M3.2 audio approximations without worklets

**Decision**: `noise`, `voronoi`, `shape`, `gradient`, `solid` ship in M3 using only built-in Web Audio nodes. AudioWorklet versions are deferred. The pragmatic mappings are:

- `noise`: white-noise buffer → BiquadFilter (lowpass). cutoff = `scale · baseFreq`; `offset` is the cutoff LFO rate.
- `voronoi`: noise → biquad LP → VCA, with VCA gain driven by a sine LFO at `scale · baseFreq` reshaped through a smoothstep waveshaper (`blending` controls hardness). `speed` is k-rate cutoff wobble — a placeholder for the granular per-grain pitch-jitter called for in `plan.md §1.3`.
- `shape`: 8 OscillatorNodes at harmonics `k · sides + 1` of `FUNDAMENTAL_REF (110 Hz) · baseFreq`, amp `1/(k+1) · radius`, lowpass cutoff `baseFreq / smoothing`.
- `gradient`: noise → high-Q bandpass; cutoff log-swept at `speed · baseFreq` updated at the engine's 60Hz k-rate poll.
- `solid`: 3 OscillatorNodes at `f₀, f₀·1.5, f₀·2` (root + fifth + octave), amps = r/g/b/3, master = a; `f₀ = FUNDAMENTAL_REF · baseFreq`.

**Why**: AudioWorklet-grade implementations (true grain engine for voronoi, bandlimited additive for shape, log-swept biquad with continuous schedule for gradient) are real DSP work that would have blown out the M3 sources milestone. Built-in nodes get the AV-coupling story end-to-end now; worklets refine timbre later.

**How to apply**: When the M3 AudioWorklet pass happens (after sources, geometry, color, blend), replace these audio stages without touching the coupling specs. The control law is canonical — the implementation is the swappable part. `shape`/`solid` carry a `FUNDAMENTAL_REF = 110 Hz` constant that should hook into transport / scale-snap when those arrive.

Cross-ref: [[2026-05-16-source-architecture]].

---

### 2026-05-16 — Source architecture: separate registry from operators

**Decision**: Procedural sources (Hydra's `osc`, `noise`, `voronoi`, `shape`, `gradient`, `solid`) live in their own registry at `src/core/sources.ts` with `SourceDef` and `SourceInstance` mirroring `OperatorDef` / `OperatorInstance`. Coupling specs go through the same `coupling.ts` registry — sources are coupled operators, just with no upstream input.

`VideoSourceStage.render(gl, params, ctx)` was extended to receive the source's params object and the global `CouplingContext`. `AudioSourceStage` gained an optional `setParams(params, ctx)` called from the engine's 60Hz poll. External (non-procedural) sources — the existing `PlaceholderSource` / `VideoElementSource` and `SilentSource` / `VideoElementAudioSource` — are *not* registered with the source registry; they're host-level inputs picked alongside procedural sources from the UI chip-row.

**Why**: Sources and operators share the coupling story but differ structurally (no input texture, no AudioNode input). Keeping registries separate makes the renderer's source slot unambiguous and the source picker UI distinct. Coupling stays unified — the registry — because that's the product.

**How to apply**: When adding the next Hydra source (`noise`, `voronoi`, …), follow `src/sources/osc.ts` — separate file per source, frag shader under `src/video/shaders/source-<name>.frag`, registered via `src/sources/index.ts`. Audio analogues per `plan.md §1.2`–`§1.6`.

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
