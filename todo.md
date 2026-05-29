# todo.md — av-synth build-out checklist

Live backlog only. Completed dated build narrative (M0–M6, the 2026-05-24→28 daily passes, audio-mapping/pitch-shifter history, granulator-redirect "landed" sub-bullets) was moved to [docs/archive/build-log.md](./docs/archive/build-log.md) on 2026-05-28; full verbose text is in git. `memory.md` remains the authoritative append-only decision log.

Check off as items close. Add dates next to completed items (`✅ 2026-05-16`). Success criterion for each item is listed; do not declare it done until the criterion is met.

## Current next step

Run a **quality sprint before public release**. The audio direction is singular: one benchmark-grade granulator, one feedback delay, one shared LFO/MIDI modulation fabric. The next meaningful progress is a curated video-first AV effects instrument with stateful temporal/motion/structure systems, flagship presets, a collapsed granulator-first audio surface, and QA that reflects that narrower product honestly. The presentation/post stack is a support layer, not the main release-track surface. The 2026-05-28 audit recommendations and the 2026-05-29 follow-up audit findings below are the most actionable near-term work.

## Live release blockers

Treat this section, `Granulator release gates` below, and the audit recommendations as the real backlog.

- [ ] **Canonical CPU re-measurement on a 2020-class Intel MBP (gate #5).** Replace the M4 Pro-only provisional row in the verdict doc with the reference-class measurement once hardware access exists.
- [ ] **D3 human listening sign-off.** Two human reviewers compare the committed av-synth listening pack against Granulator II and log verdicts in `qa/reviews/granulator/2026-05-24-d3-d4-harnesses.md`.
- [ ] **D4 real loopback/scope latency sign-off.** Run the external hardware measurement and log it in `qa/reviews/granulator/2026-05-24-d3-d4-harnesses.md`. The in-app proxy remains regression protection, not the final gate.
- [ ] **Final manual audible sign-off for explicit QA exceptions.** Close the older operator-family manual cases in `qa/reviews/` and note any conscious deferrals in writing.
- [ ] **First staging deploy + post-deploy smoke.** Publish the private/staging build, record the canonical URL in `deploy.md`, and run the smoke pass against the real host before talking about public release.

## Audit recommendations (2026-05-28)

From the full-project audit. `R1`–`R4` are the engineering findings (bugs / self-rule violations); `R5`–`R8` are product-shaping advice for a stronger AV instrument. Ordered by leverage.

- [x] **R1 — Fix the `qa/e2e` ESLint errors so `lint` exits 0.** ✅ 2026-05-29 — All ESLint errors and warnings eliminated. The S1 "unused imports" finding was a false positive: both `sampleGlobalLfo` and `ParamLfoAssignment` are actively used in `renderer.ts` (at lines 873, 1254, 1271). 16 `qa/e2e` unused-disable-directive warnings auto-fixed with `--fix`. `npx eslint .` now produces zero output.
- [ ] **R2 — Remove per-frame heap allocations from the render loop.** Partially addressed: `CouplingContext` spread removed, scratch buffers pre-allocated per step at `setPlan()` time. **Still incomplete** — see S2 in the 2026-05-29 follow-up audit for the remaining allocation sites (`Object.keys`/`Object.entries` in hot path, `bindRendererResources` object literals, grain-composite voice allocation). The render loop is not yet zero-alloc.
- [x] **R3 — Stop `readMotionEnergy()` from stalling the GPU pipeline.** ✅ 2026-05-28 — Reduced 25 individual `gl.readPixels` (25 GPU pipeline stalls) to 1 single call into a pre-allocated `Uint8Array` scratch buffer. 5×5 spatial grid sampling is preserved identically, computed from the CPU-side buffer. Buffer is rebuilt on resize. No async PBO needed: one stall every 120 ms is negligible. Decision + rationale in `memory.md`.
- [x] **R4 — Confirm master-bus true-peak compliance.** ✅ 2026-05-28 — b2.4 harness run: worst-case post-limit **truePeak −7.52 dBFS** (samplePeak −7.68 dBFS) at adversarial settings (density 200, 64 voices, gain 1.0, masterGain 0.7). Gate #6 re-affirmed. No limiter change needed — the current chain (softClip 4× + DynamicsCompressor threshold −1) holds with ~7.5 dB headroom. Note: 2 of 3 OfflineAudioContext runs produced silence (worklet port messages not flushed before startRendering); valid measurement is from run 1. Harness anomaly tracked in `memory.md`.
- [x] **R5 — Close the video-feature → video-param modulation loop.** ✅ 2026-05-28 — `VideoFeatureName` added to `coupling.ts`; `ParamLfoAssignment.videoFeature` field added to `mod-bank.ts`; `applyGlobalLfoAssignments` gains a video-feature branch (feature 0..1 mapped linearly to param [min, max]); `listGlobalLfoOptions` appended with `v.luma/v.flux/v.edge/v.motion` entries; both `Patch.svelte` and `GranulatorCard.svelte` pickers extended; `App.svelte` setters decode the `v:${feature}` encoding. The mod-bank routing is now bidirectional: assign any video feature to any param through the existing mod picker. Verify with a moving clip: pick any param, choose `v.motion` in the mod select, watch the param animate.
- [x] **R6 — Decide the `sourceBlend` op fate (= G7).** ✅ 2026-05-29 — Option B: folded four blend modes (over/add/multiply/screen) into `blend` op; deleted `sourceBlend.ts` and its shader. `blend` gains `mode` int param [0,3], default 0 (over) is backwards-compatible. Decision + rationale in `memory.md`.
- [x] **R7 — Expose bloom strength to the modulation bus.** ✅ 2026-05-29 — `bloomStrengthAssignment: ParamLfoAssignment` state added to `App.svelte`; `renderer.setBloomStrengthAssignment()` + `#bloomMod()` added to `renderer.ts`; zero-alloc inline computation (inlines `applyGlobalLfoAssignments` math for one param) applied at `gl.uniform1f(u_bloom_strength, quality.bloomStrength * this.#bloomMod(ctx))` inside the frame loop; mod picker ("bloom" label + select) added at the bottom of the video tab in the patch panel. Verify: assign `v.motion` or any LFO to bloom in the video tab, confirm the finish animates.
- [ ] **R8 — Capture opportunistic real-device latency/CPU data during the Remote-Desktop staging test.** The upcoming staging deploy (latency testing from work) is a chance to record partial real-hardware numbers that feed D4 latency and gate #5 CPU, rather than waiting for the ideal rig. Verify: numbers logged in `qa/reviews/granulator/`. Acceptance: partial real-hardware data recorded (cross-ref D4 + gate #5 above). **Cannot be implemented in code — requires physical hardware access during the staging test.**

## Follow-up audit findings (2026-05-29)

Independent re-audit of the full codebase (Opus 4.6). Confirms R3/R4/R5/R6/R7 as correctly closed, identifies remaining R2 gaps, and surfaces new items the 2026-05-28 audit did not flag. `S1`–`S3` are engineering defects; `S4`–`S6` are performance; `S7`–`S9` are product-shaping. Ordered by leverage.

- [x] **S1 — Delete unused imports in `renderer.ts` (lint blocker).** ✅ 2026-05-29 — False positive: both imports are actively used. All `qa/e2e` warnings auto-fixed. `npx eslint .` is now fully silent (0 errors, 0 warnings).
- [x] **S2 — Finish R2: eliminate remaining per-frame allocations.** ✅ 2026-05-29 — All three sites addressed:
  - **(a)** `Object.keys/entries` replaced with `for...in` in `applyGlobalLfoAssignments` (`mod-bank.ts`) and `evaluateVideoParams` (`coupling.ts`). No throwaway string arrays.
  - **(b)** `bindRendererResources` now mutates pre-allocated `VideoStageRendererResources` + sub-objects allocated once per step in `setPlan()` (`renderer.ts`). `VideoStageRendererResources` import added. `ownedStateScratch` held per-step; `res.ownedState` is set to the scratch or `null` per frame (reference assignment, not allocation).
  - **(c)** `GrainScheduler` pre-allocates 64 `MutableVoice` slots; `getActiveVoices` returns `ActiveVoiceView { voices, count }` — pool objects mutated in place, no array or object created per call. `grain-composite.ts` updated to use `{ voices, count }`. `resolveVoice` kept as exported function for test use. All 215 tests pass, lint clean.
- [x] **S3 — Batch grain-composite draw calls into a single instanced draw.** ✅ 2026-05-29 — `grain-composite.vert` converted to per-instance attributes (`layout(location=0..2)`: `a_center` vec2, `a_layer` float, `a_alpha` float); `grain-composite.frag` reads `v_layer`/`v_alpha` varyings instead of uniforms. `GrainCompositeSource` allocates a VAO + DYNAMIC_DRAW VBO in the constructor (pre-allocated `Float32Array` of `maxVoices×4` floats). `render()` fills the buffer zero-alloc and issues one `gl.drawArraysInstanced(TRIANGLE_STRIP, 0, 4, count)` regardless of voice count. `dispose()` deletes VAO and VBO. 224 tests pass, tsc clean.
- [x] **S4 — Guard against FM threshold click.** ✅ 2026-05-29 — Removed the hard `fmActive = fmAmount > 0.001` branch entirely. The FM accumulator (`fmAccPos`) is now always used as the read position. At fmAmount=0, `exp(LN2_12 * 0 * sin) = 1` so `fmAccPos += ratio` is identical to the old linear formula — no position jump possible at any fmAmount value. Added a `useFmExp = fmAmount > 1e-4` guard to skip the `Math.exp()` call when deviation would be ~5.78e-8 (inaudible). `fmPhase` always advances so re-engaging FM has no phase discontinuity. Removed the now-unused `start` local. All 215 unit tests pass.
- [x] **S5 — Add a structural sync check for duplicated worklet/main-thread constants.** ✅ 2026-05-29 — New test file `src/audio/granulator-constants.test.ts` reads `public/worklets/granulator.js` at test time, parses all top-level `const NAME = VALUE` declarations with a regex, then asserts each exported TS constant matches the parsed worklet value. Covers all four protocol surfaces: envelope LUT indices (grain-scheduler.ts), grain-event ring field offsets (grain-scheduler.ts), ring capacity (granulator.ts), and runtime-diag ring field offsets (granulator.ts). Exported the 12 grain-ring constants from grain-scheduler.ts and 20 runtime-diag constants from granulator.ts. 224 tests pass (9 new).
- [x] **S6 — Relabel `ySpread` to `width` in the UI.** ✅ 2026-05-29 — `GranulatorCard.svelte` label changed from `'y spread'` to `'width'`; unit changed from `'0–1'` to `'M/S'` to reflect the actual M/S stereo-width semantics. Internal parameter name unchanged.
- [x] **S7 — Binary-op shaders discard alpha (minor, document-only).** ✅ 2026-05-29 — Comment added above `BinaryVideoStage` in `blend.ts` documenting the alpha=1.0 invariant and the requirement to update all binary shaders if alpha compositing is ever needed.
- [x] **S8 — `drainRing` allocates new `GrainEvent` objects from the shared ring.** ✅ 2026-05-29
- [x] **S9 — Granulator worklet crashes on non-cross-origin-isolated pages (GitHub Pages).** ✅ 2026-05-29 — The AudioWorklet constructor evaluated `undefined instanceof SharedArrayBuffer` when COOP/COEP headers are absent (e.g. GitHub Pages), throwing a `TypeError` that killed the processor. Effect: silent audio, no grain events, grain composite black screen. Fix: `const _hasSAB = typeof SharedArrayBuffer === 'function'` guard added before all three `instanceof SharedArrayBuffer` blocks in the worklet constructor, and one additional guard in the `'loadShared'` message handler. The worklet now falls back gracefully to the message-port grain-event path and AudioWorklet `parameters` for controls. Runtime diagnostics still require SAB (shows "n/a" without it, which is expected). 224 tests pass, grain-composite probe passes. — `#events: GrainEvent[]` replaced with `#eventPool: MutableGrainEvent[]` (2048 pre-allocated slots, matching ring capacity) + `#eventCount` cursor. `#drainRing` writes fields directly into the next free pool slot with no `new`. `prune()` compacts by field-copy (no reference shuffling). `ingest()` copies fields into the pool (port-message path also zero-alloc). `getActiveVoices` and `activeCount` read from `#eventPool[0..#eventCount-1]`. Pool size of 2048 = `GRAIN_EVENT_RING_CAPACITY` ensures a full-ring drain can never overflow. 224 tests pass, tsc clean.

## Deferred / open follow-ups (non-blocking)

Carried over from completed passes (full context in git / `memory.md`). None block staging.

- [ ] **Binary blend characterisation pass (= G6).** Now feasible since `sourceB` is graph-addressable; wire a second source into the op-characterisation sweep and characterise the blend family against its own baseline directory.
- [ ] **`timeDisplace` samples post-chain history, not source history.** With `timeDisplace` as the only op it scrubs its own output, so `depth/scan/smear` read as subtle. Architectural fix: either a second source-anchored history ring, or honestly relabel as "post-chain time smear". Needs a scoped decision.
- [ ] **`flow` is bottlenecked by the motion estimator.** `motion-analysis.frag` does 8-direction block matching at a 1.75-pixel search radius — saturates on real footage, leaving a quantised noisy field. Same ceiling hits any routed `modulate*` consumer. Real fix is multi-scale / larger-radius search; architectural.
- [ ] **Calibrate `TEMPORAL_RANGE_LIMIT`.** Currently a conservative 0.45; tighten per-op after reviewing actual temporal ranges, otherwise the bounded-variance check only catches NaN / blow-up.
- [ ] **dataMosh manual capture/release trigger.** A user-triggered "snapshot now" to lock a specific I-frame reference. Needs a non-numeric input type in the UI / coupling layer.
- [ ] **Engine behaviour above density=200.** Internal degradation above ~2000 spawns/sec (saturated voice pool → near-silent). Not user-reachable today; surfaces if MIDI-modulated density bursts ever exceed the slider cap.
- [ ] **Grain composite intensity sustain.** Between-grain frames can still go black at defaults if duration/density leave gaps. Consider nudging default density/duration so 2–3 voices overlap continuously. Listen + watch before adjusting.
- [ ] **N-source routing.** v1 stays at exactly 2 sources; generalise to `sourceC`/`sourceD` when a third concrete caller earns it (rule of three). The graph-node shape generalises trivially.

## Granulator release gates (still open)

Must pass before any v1 release. See `plan.md §14` + `references/granulator-port-spec.md`.

- [ ] **Granulator listening-test panel** (`plan.md §14.9`) — ≥2 human reviewers comparing curated presets vs MPE Granulator II on identical source. Results in `qa/reviews/granulator/`. (= D3 above.)
- [ ] **Video grain engine performance + accuracy** (`plan.md §14.6`, spec §13) — frame-accurate scrubbing, ≥30 fps at 720p on 32 voices, grain onset/envelope alignment within one rendered frame plus one audio block.
- [ ] **MIDI input latency budget verified** (≤ 5 ms note-on → first audio grain). Code path ships; still needs a QA-harness/loopback measurement. (= D4 above.)
- [ ] **Video-derived features + modulation matrix UI.** `v.luma`/`v.flux`/`v.edge` as modulation sources (= R5), and MIDI CC / MPE + LFOs + video sources sharing one compact modulation-matrix UI (source picker + depth, not bespoke per-control automation).
- [ ] **One curated granulator demo program** in `public/presets.json` with full QA audit (held-vocal scrub + video freeze + FX-rack glass-warp).

## Active release tracks

- **Quality sprint (current implementation target)** — deepen the existing WebGL/FBO renderer and Web Audio/AudioWorklet stack, but narrow audio to the granulator-first instrument: bloom/history/displacement polish on video, benchmark-grade granulator delivery, one shared feedback delay, shared LFO/MIDI modulation, and the matching quality gates.
- **Product-surface cleanup (parallel release track)** — keep the video chain empty by default, split the product into distinct `Video` and `Audio` panels/tabs, organize both add-effect surfaces into user-facing families, make add/remove/reorder clearer, and treat built-in programs as the main on-ramp for strong looks.
- **Staging RC (private evaluation target)** — current shell/product path plus the best available quality sprint slice. Needed: audible sign-off, deploy workflow, first staging URL, post-deploy smoke.
- **Public v1** — everything in Staging RC plus quality-sprint sign-off. The core Hydra Color surface is now functionally covered, so the main remaining risk is perceived visual/audio quality plus whether the granulator-first workflow feels coherent. Live-code, full Hydra import, and alternate external-input surfaces are post-v1 unless the launch target changes.

## Standing items (always-on)

- [ ] After every meaningful change: update `memory.md` if a decision was made or a design tension surfaced
- [ ] Keep `plan.md` status flags (`present`/`partial`/`todo`) in sync with reality
- [ ] After every push: run the Post-Push Verification Protocol from `~/.claude/CLAUDE.md`

## Final phase — Electron desktop + WebGPU backend (planned, not started)

Spec lives in `plan.md §13`. Do not open this phase until all earlier release gates pass (video-first correction, Color `sum`/`.r .g .b .a`, Blend family, audible sign-off, public web release).

- [ ] Land `RenderBackend` interface in `src/video/renderer.ts` with `webgl2` as the only implementation (architectural precondition, can land during web phase).
- [ ] Make the operator registry backend-aware so CI fails if a registered op is missing a declared backend.
- [ ] Parametrise coupling acceptance tests over backends.
- [ ] Soak-test every AudioWorklet for zero allocations in `process()` before claiming desktop headroom.
- [ ] Electron scaffold: context-isolation on, `nodeIntegration: false`, narrow typed IPC bridge, locked CSP.
- [ ] WGSL ports of operators (per-family, mirror existing GLSL); WebGPU becomes default on desktop with WebGL2 as fallback toggle.
- [ ] At least one compute-only operator family (e.g. particle modulate, GPU-side audio analysis) shipped on desktop to justify the headroom claim.
- [ ] Code-signed installers for macOS (Apple Silicon + Intel) and Windows; Linux unsigned x64 build.
- [ ] Per-OS audible sign-off entries in `qa/reviews/`.
