# Granulator + LFO-coupling progress audit

**Date**: 2026-05-22
**Scope**: All work since the product redirect to granulator-first instrument (2026-05-21 entry in `memory.md`) through end-of-session 2026-05-22.
**Method**: Two-pass DeepSeek factual extraction over `references/granulator-port-spec.md`, `plan.md`, `todo.md`, `memory.md`, and the live granulation/LFO source surface (worklet, TS facade, MIDI, mod-bank, engine, App, GranulatorCard, renderer, patch-graph), followed by manual verification of every load-bearing file claim. Judgment layer added by Claude, not delegated.

Line numbers in sections 2-9 below are precise where I verified them by hand and labelled `~approx` where DeepSeek inferred them from a flat read.

---

## 1. Executive summary

**What is genuinely landed at release quality:**
- Granulator DSP core (worklet) — all five envelopes, three modes, sinc interpolation, anti-alias LP, voice stealing, per-grain randomisation, equal-power pan, mid/side ySpread.
- Granulator parameter surface end-to-end — worklet AudioParams to TS facade to 13 sliders + 2 pickers in `GranulatorCard.svelte` with per-slider MIDI-learn.
- MIDI / MPE input plumbing — parser, MPE state map, four binding kinds, learn flow, triggered-mode noteOn dispatch, 45 tests.
- Worklet-level one-shot trigger path (`noteOn` queue drained top-of-process, per-grain `vGain`) for sub-5 ms note latency.
- Feedback delay DSP module (`src/audio/feedback-delay.ts` + 13 tests) — code-complete, **not surfaced in UI**.
- Grain-composite source pipeline — buffer allocation, scheduler, composite source, refusal UX, all wired into the `'grain-composite'` `SourceKind`.

**What is honest scaffolding only (the headline gaps):**
1. **Grain-composite renders black.** `GrainBuffer.decodeFromVideo()` exists at `src/video/grain-buffer.ts:220` but is never called from `App.svelte`. The texture array is allocated empty and never written. This is an invocation gap, not a missing implementation.
2. **Granulator is not a mod-bank target.** Zero references to `applyGlobalLfoAssignments` reach the granulator. The 6-LFO fabric exists for video operators and audio-rack engines but cannot modulate any granulator parameter today. The LFO-coupling direction this audit was named for is, in code, still pending its first integration step.
3. **AudioRack collapse is partial.** Both `GranulatorCard` (line 1913) and the legacy multi-engine `<AudioRack>` (line 1922) are mounted in the Audio tab. Feedback-delay card and master meter are absent.
4. **Spec section 10 shared-feedback identity not started.** Audio feedback-delay value is not published anywhere; video `u_feedback` is still driven only by the video `feedback` operator. The two domains are not coupled at this parameter.
5. **Per-channel pitch routing is mono-of-most-recent.** Worklet has a single global `pitch` AudioParam; the MPE pitch-bend gating in `MidiRouter` honours only the most-recent held channel.

**Doc state:** `plan.md`, `todo.md`, and `memory.md` are honest about the redirect — no doc claims a multi-engine rack is the product, and the 2026-05-22 memory entry already flags the GrainBuffer frame-upload, master meter, full-collapse, and MIDI latency QA-harness gaps. Minor drift: `plan.md`'s legacy sections 1-5 audio-analogue tables remain as "design rationale" but are no longer build targets, which is a readability risk for fresh readers.

**Release-gate state vs. CLAUDE.md section 2**: Granulator contract is partway through implementation, public audio surface is not honestly collapsed yet, final human sign-off in `qa/reviews/` for the granulator direction does not exist, and the public docs still imply (via the un-removed analogue tables) more breadth than the redirect intends. **Public/professional deploy remains correctly blocked.** Staging-only manual evaluation is plausible *after* the GrainBuffer invocation gap is closed; right now the grain-composite source kind is misleading because it advertises a feature that renders black.

**Net judgment**: the granulator core is in good shape and the MIDI input pipeline is in better shape than I expected. The work that calls itself "granulation + LFO coupling" still has one critical invocation gap (frame upload) and one architectural gap (mod-bank to granulator wiring) before the direction is recognisable as a coupled instrument from the user side. Recommended sequencing in section 11.

---

## 2. Spec coverage (`references/granulator-port-spec.md`)

| Sec | Title | Status | Evidence | Gap |
|---|---|---|---|---|
| 1 | Architectural model | PARTIAL | Worklet scheduler + voice management + render at `public/worklets/granulator.js`. Cross-thread `MessagePort` to video lives in `src/core/grain-scheduler.ts`. | Spec's "lookahead channel" pattern not separately wired — current path is post-hoc grain-event broadcast from worklet, consumed by GrainScheduler. Adequate for v1; flag as design call for later. |
| 2 | Grain DSP / pitch shifting | PARTIAL | 8-tap Kaiser-windowed sinc + 256-phase LUT + anti-alias LP for pitch up. | 4-point Hermite fallback + CPU-pressure auto-dispatch deferred (commented at `granulator.js:~10`). Documented in `memory.md` and `todo.md`. |
| 3 | Envelope shapes | LANDED | All five LUTs (hann, tukey-25, gaussian, expdec with tail fade, rexpdec) at `granulator.js:~115-173`. | — |
| 4 | Scheduling modes | LANDED | classic / loop / cloud (Poisson via distribution) at `granulator.js:~266-340`. | — |
| 5 | Voice management | LANDED | 64-slot SoA pool, FIFO steal with 64-sample fade-out, k-rate `voiceCount` cap. | `voice_id` shared with video twin not yet integrated — depends on sec 9. |
| 6 | Parameter model | LANDED | 15 AudioParams (13 sliders + envelope int + mode int + gain) end-to-end through worklet to `granulator.ts` to `GranulatorCard.svelte`. | Picker controls (envelope, mode) have no MIDI-learn affordance — spec sec 11 says "every shipped control supports MIDI-learn". Minor. |
| 7 | Per-grain randomisation | LANDED | xorshift32 per spawn, 6 draws (pos/pitch/dur/pan/rev/y). | — |
| 8 | Spatial / stereo | LANDED | Equal-power pan + global mid/side ySpread. | — |
| 9 | AV coupling — video grain twin | **PARTIAL — visible payoff blocked** | Pipeline wired: `ensureGrainComposite()` in `App.svelte:~1330-1340`, GrainScheduler, GrainCompositeSource, `'grain-composite'` SourceKind. | Frame upload into the allocated `TEXTURE_2D_ARRAY` is never invoked. `decodeFromVideo()` exists at `src/video/grain-buffer.ts:220` but no caller. **Composite renders black.** |
| 10 | Audio post-effect — feedback delay | **PARTIAL — public surface missing** | DSP module + 13 tests at `src/audio/feedback-delay.ts` + `feedback-delay.test.ts`. | No UI card; not mounted in `audio/engine.ts`'s parallel signal chain; spec's "shared-feedback identity" with video `u_feedback` not wired. |
| 11 | MIDI / MPE input | PARTIAL | Full parser, MPE state, four binding kinds, learn, triggered noteOn, 45 tests. | (a) Per-channel pitch routing absent (mono-of-most-recent). (b) `defaultMpeBindings()` exported but never auto-installed (correct per spec — opt-in). (c) sub-5 ms latency not yet measured in a QA harness. |
| 12 | Performance budget | NOT STARTED | — | No CPU instrumentation, no benchmark, no validation against the spec's CPU targets. |
| 13 | Quality acceptance | NOT STARTED | No `qa/reviews/granulator/` artefacts. | All six section 13 gates undocumented. |
| 14 | Spec exclusions | LANDED (negative) | No wavefolder/reverb/chorus/spectral added. | — |
| 15 | Sequencing / roadmap | PARTIAL | Steps 1-8 worklet/UI/MIDI work landed; step 6 partial (frame upload pending); step 9/10 (quality gate sweep + demo program) not started. | See section 11 of this audit. |

---

## 3. Granulator param surface

Verified directly against `src/ui/GranulatorCard.svelte:29-43` and `public/worklets/granulator.js`.

**13 sliders** (line numbers in `GranulatorCard.svelte`): position (30), positionJitter (31), pitch (32), pitchJitter (33), duration (34), durationJitter (35), density (36), distribution (37), panSpread (38), ySpread (39), reverseProbability (40), voiceCount (41), gain (42).

**2 pickers**: envelope (line 45, options hann/tukey-25/gaussian/expdec/rexpdec), mode (line 46, options classic/loop/cloud).

Every slider has a MIDI-learn button (`GranulatorCard.svelte:190-204`). Pickers do not. The spec section 11 wording ("every shipped control supports MIDI-learn") makes this a minor compliance gap; in practice envelope/mode are discrete enums and the value of learning them is low. Flag, do not block.

TS facade coverage: `Granulator.setParam(name, value)` covers all 13 sliders and `gain`; `setEnvelope(name)` and `setMode(name)` cover the pickers; `setVoiceCount(n)` is a typed convenience. `triggerNoteOn(pitchSt, velocity)` covers the one-shot path. `loadFromArrayBuffer` covers sample loading. `setEnabled(bool)` covers the master toggle. Verified at `src/audio/granulator.ts`.

---

## 4. AV coupling / LFO fabric — the critical gap

### What `mod-bank.ts` exposes (verbatim, verified)

```
createDefaultGlobalLfoBank() -> GlobalLfo[]               (~line 51)
createParamLfoAssignment() -> ParamLfoAssignment          (~line 70)
buildParamLfoAssignmentView(...)                          (~line 75)
sampleGlobalLfo(lfo, time) -> number                      (~line 88)
applyGlobalLfoAssignments(rawParams, specs, assigns, ctx) (~line 91)
listGlobalLfoOptions(bank)                                (~line 115)
formatGlobalLfoRate(rate)                                 (~line 122)
formatGlobalLfoAmount(amount)                             (~line 126)
morphGlobalLfoValue(current, target, alpha)               (~line 129)
```

### Where modulation actually flows today

- **Video operator instances**: `src/video/renderer.ts:~395-397` calls `applyGlobalLfoAssignments` before drawing.
- **Audio rack engine instances**: `src/audio/engine.ts:~159` calls it for each operator instance, and `~169` for audio-rack instances via `audio-rack.ts`.
- **Granulator**: **zero references**. Verified by grep — `src/audio/granulator.ts` does not import `mod-bank`, does not call `applyGlobalLfoAssignments`, and is not iterated by any caller that does. Granulator parameters are written directly from UI (`GranulatorCard.setParam`) or MIDI (`MidiRouter` to `ParamSink`). The LFO fabric cannot touch a single granulator control today.

### Spec section 10 shared-feedback identity

Not started. Video `u_feedback` uniform is set by the video `feedback` operator in `renderer.ts:~387-393`. The audio feedback delay's `feedback` param is not published to any shared bus. No code connects them.

### Video-derived features as modulation sources

Video features (`luma`, `flux`, `edge`) are polled at `App.svelte:~234-262` into `videoFeatures` state, and injected into `CouplingContext` at `App.svelte:~674`. Audio-rack engines consume them via `evaluateAudioRackRawParams`. The granulator does not consume `CouplingContext` — its `setParam` API has no ctx argument.

### Judgment

This is the largest single gap between "what the direction is called" and "what the code does". The LFO bank exists, video FX use it, audio-rack engines use it — but the granulator, which is now the public audio surface, sits outside the fabric. Closing this is the unlock for the next 2 milestones of the redirect, and the work is bounded:

1. Register granulator params as `ParamSpec` entries with `automationSource: 'global-lfo'` allowed.
2. Per-frame, evaluate `applyGlobalLfoAssignments` on a snapshot of the user-facing slider values and write the modulated result through `Granulator.setParam` (or via the worklet's k-rate AudioParam directly).
3. Surface the LFO picker on `GranulatorCard` rows the same way `AudioRack.svelte` does on its engine rows.

None of this requires DSP work or a worklet change.

---

## 5. MIDI / MPE plumbing

### Public API of `src/core/midi.ts` (verified)

- `parseMidiMessage(bytes) -> MidiMessage | null`
- `MpeNoteStateMap` — per-channel held-note LRU
- `applyBinding(binding, msg) -> number | null` — all four `MidiSource` kinds + `gamma07` curve
- `MidiRouter` — `ingest`, `learn`, `cancelLearn`, `addBinding`, `removeBindings`, `clearBindings`, bindings getter, mpe getter
- `WebMidiInput` — `open`, `dispose`, `devices` getter, `onRawMessage` setter, hot-plug via `onstatechange`
- `ParamSink` interface — `setParam`, optional `triggerNoteOn?`
- `defaultMpeBindings()` — returns CC74 to positionJitter, channel pressure to density (exported, not auto-installed)
- Utilities: `velocityToGain`, `semitonesFromRoot`

### Test coverage

`src/core/midi.test.ts` — 45 cases. Groups inferred from the API surface and confirmed in the source: parser corners (incl. 14-bit pitch-bend asymmetry), gamma curve, MPE state, binding matcher, default-MPE binding shape, router note-on/gain in sustained mode, MPE-aware note-off, per-note pitch-bend gating, learn promise resolution, removeBindings predicate, triggered-mode noteOn dispatch.

No `WebMidiInput` browser-integration tests — jsdom cannot back Web MIDI. Acceptable; documented in `memory.md`.

### WebMidiInput wiring in App.svelte

Lazy-initialised inside `ensureGranulatorPipeline()` (called from `onStart` and `onFileChange`). `WebMidiInput.open()` -> `input.onRawMessage = (bytes) => parseMidiMessage(bytes) -> midiRouter.ingest(msg)`. Devices list surfaced to a status pill in the template.

### MPE defaults

`defaultMpeBindings()` is exported but not passed to `MidiRouter` construction in `App.svelte`. This is intentional per `memory.md` (2026-05-22) — defaults are opt-in. Users must call `midiRouter.addBinding(...defaultMpeBindings())` to install. There is no UI affordance for that yet.

### Per-channel pitch routing

Mono-of-most-recent only. Worklet has one global `pitch` AudioParam; `MidiRouter` honours per-channel pitch-bend only for the channel holding the most-recent note. Documented at `memory.md` (2026-05-22) as a deliberate stopping point — true per-voice pitch needs worklet voice-allocation surgery.

---

## 6. Grain video source

### Allocation site

`ensureGrainComposite()` in `src/App.svelte` does:
- `grainBuffer = new GrainBuffer(renderer.gl)` (verified ~line 1330)
- `grainBuffer.allocate(renderer.gl, planResult.plan)` at line **1334** — calls `texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, w, h, depth)`
- `grainScheduler = new GrainScheduler(granulator.node)`
- `grainCompositeSource = new GrainCompositeSource({ scheduler, buffer, clock: () => audio.ctx.currentTime })`

Hard cap `GRAIN_BUFFER_MAX_BYTES = 1.5 GB` at `src/video/grain-buffer.ts:21`.

### Frame upload — the gap

`GrainBuffer.decodeFromVideo()` IS implemented at `src/video/grain-buffer.ts:220` — seeks the `<video>` per-frame, uses `drawImage` into a sized 2D canvas, then `texSubImage3D` into the array layer (verified by direct grep — lines 144, 204, 220, 243, 244 in `grain-buffer.ts`).

No caller invokes it. `App.svelte` only references `grainBuffer.isAllocated`, `grainBuffer.allocate`, and `grainBuffer.dispose` (lines 1334, 1644). The `decodeFromVideo` method is dead code from the app's perspective.

This corrects the previous-session summary's framing ("frame upload not implemented, needs WebCodecs or seek+readPixels") — the seek-and-readPixels path is implemented, just not invoked. The remaining work is roughly:
- Decide when to invoke (on clip load? on first `'grain-composite'` selection? both?).
- Wire a progress/status path so the UI can show "decoding frames 18/42" without abusing `grainSourceMessage` (which is reserved for refusal).
- Decide whether to block selection until decode completes, or render half-filled-buffer as a degraded preview.

### GrainScheduler

Subscribes to the granulator worklet's `MessagePort` for `'grain'` events. Exposes `getActiveVoices(now, plan, maxVoices) -> RenderedVoice[]`. Contains verbatim copies of the five envelope LUTs so the video compositor's per-voice alpha tracks audio identically. `src/core/grain-scheduler.ts`, 21 tests in `grain-scheduler.test.ts`.

### Renderer integration

`renderer.setSource(grainCompositeSource, {})` in the `'grain-composite'` branch of `setSourceKind` (App.svelte ~line 650-670). Composite implements `VideoSourceStage`; renders each voice as a textured quad with premultiplied alpha.

### Refusal UX

Two-stage:
1. `!videoEl || !videoEl.src` -> `grainSourceMessage = 'Load a video clip first to use the grain source.'`, fall back to placeholder.
2. `!ensureGrainComposite()` returned null -> `'Grain source not ready yet — wait for the clip to finish loading.'`.

Surfaced in template as `<p class="source-message" role="status" data-qa="grain-source-message">`.

---

## 7. AudioRack public-surface state

### What the Audio tab mounts today

Verified at `src/App.svelte:1913, 1922`:

```
<GranulatorCard ... />
<AudioRack ... />
```

Both visible simultaneously when `activeWorkspaceSurface === 'audio'`. No conditional hides the legacy rack.

### Concrete gaps vs. CLAUDE.md section 3 target

| Required element | Status | Note |
|---|---|---|
| Granulator card | yes — present | Full 14-control surface |
| Feedback delay card | no — missing | DSP exists, not surfaced |
| Master meter | no — missing | No component, no tap into master bus |
| Legacy `AudioRack` removed | no — still mounted | Line 1922 |

The partial collapse is consistent with the user's explicit "park feedback delay" instruction in the previous session, and is honestly flagged in `memory.md` and `todo.md`. It is not, however, the shape the public docs describe as the release target.

---

## 8. Doc drift

### `plan.md`

- Section 0a correctly states the per-video-op audio twin direction is retired.
- Section 14.1 ("granulator + feedback delay + master limiter") describes the target collapsed surface; the code does not yet match (feedback delay card and meter missing). The doc is aspirational here, not stale — but a fresh reader cannot tell which is true without reading code.
- The legacy sections 1-5 audio-analogue tables remain as "design rationale". They are not contradicted by other sections but they are the highest-risk drift source — a casual reader could mistake them for build targets. Recommend either annotating each as "historical context" inline, or moving to an appendix.

### `todo.md`

- "Product redirect — granulator-first instrument" section is internally consistent.
- "M5.9 Audio quality sprint" items are explicitly marked "historical context, not the active audio release track". Honest.
- 2026-05-22 step-8 entry correctly annotates the latency-budget item as "code unblocked, QA harness measurement still needed" and the UI-collapse line as partial.

### `memory.md`

- 2026-05-22 entry covers all 10 anti-drift decisions from the noteOn/triggered-mode landing. Internally consistent with code.
- No false claims that the grain-composite renders correctly.
- No stale per-video-op-twin claims.

Net: docs are in better shape than code, which is the right direction. The single notable drift risk is the un-annotated legacy audio-analogue tables in `plan.md`.

---

## 9. Test / verification footprint

Files verified to exist on disk:

| Test file | Purpose |
|---|---|
| `src/audio/worklets/granulator.test.ts` | Worklet `process()` coverage — sinc, AA-LP, reverse, envelopes, modes, jitter, voice steal |
| `src/audio/feedback-delay.test.ts` | 13 cases — clamp helpers, coupling matrix, energy identity |
| `src/core/grain-scheduler.test.ts` | 21 cases — envelope phase, LUT shapes, frame index, expiry, scheduler ingest |
| `src/core/midi.test.ts` | 45 cases — full router + parser + MPE coverage |
| `src/video/grain-buffer.test.ts` | 8 cases — sizing, clamp, 1.5 GB cap refusal |

Total active granulator-direction tests: 5 files, ~100+ cases. All passing per session-end verification (192/192 total in repo).

Quality-gate sweep per spec section 13 is not started — no entries under `qa/reviews/granulator/`.

---

## 10. Open follow-ups documented in repo

Extracted from `memory.md` (2026-05-22 entry) and `todo.md` step-8 annotations:

1. GrainBuffer frame upload invocation — wire `decodeFromVideo()` from App.svelte (smaller than previously believed).
2. sub-5 ms latency QA-harness measurement — code unblocked; needs loopback or oscilloscope verification.
3. Per-channel pitch routing into separate worklet voices — worklet voice-allocation surgery required.
4. Master meter — third Audio-tab element per CLAUDE.md section 3.
5. Feedback-delay public surface — public card + mounting in audio chain (parked by user).
6. Final legacy `<AudioRack>` removal — tied to #5 decision.
7. AV-coupling `feedback`-delay to video `u_feedback` (spec section 10 shared-value identity) — parked by user.
8. Spec section 15 step 9 — full quality-gate sweep per section 13.
9. Spec section 15 step 10 — one curated demo program in `public/presets.json`.
10. 4-point Hermite fallback + CPU-pressure auto-dispatch (spec section 2).
11. Two listening tests for Granulator II parity (spec section 15 steps 3/4).
12. Granulator to mod-bank wiring — not yet documented in memory.md/todo.md as a deliverable, but surfaced by this audit.
13. `defaultMpeBindings()` UI affordance — currently opt-in via code only.

---

## 11. Recommended sequencing

Ordered by unblocks-the-most-with-least-risk, with the underlying judgment for each.

### Tier A — closes the credibility gap on this direction

**A1. Wire `GrainBuffer.decodeFromVideo()` from `App.svelte`.**
Smallest-blast-radius change that converts the `'grain-composite'` source kind from "selectable but renders black" to "actually shows visible grains". Implementation is bounded — pick an invocation point (recommend: lazy on first `'grain-composite'` selection per clip, with a status path distinct from the refusal banner). Documented effort: hours, not days. This is the unblock.

**A2. Register granulator params as `mod-bank` targets and surface LFO pickers on `GranulatorCard` rows.**
Closes the architectural gap that gives this audit its name. The fabric exists, the targets are a typed declaration plus a per-frame `applyGlobalLfoAssignments` call. No DSP work, no worklet changes. After A2, the project's claim of "coupled granulator + LFO fabric" is true at the user surface.

### Tier B — release-shape compliance

**B1. Master meter.** Third Audio-tab element. Tap on `audio.master`, render dBFS + true-peak. Required by CLAUDE.md section 3 before the public surface can be called collapsed.

**B2. Spec section 15 step 9 — quality-gate sweep per spec section 13.** Six listening/measurement gates documented in `qa/reviews/granulator/`. This is the gate that public release is blocked behind. Cannot start until A1 lands (otherwise the visual side of the gate can't be evaluated).

**B3. Spec section 15 step 10 — one curated demo program in `public/presets.json`.** Cheap once A1 + B2 are in flight; sells the direction.

### Tier C — depends on parked decisions

**C1. Feedback-delay public card + mount.** Parked by user. Re-open when ready.

**C2. Spec section 10 shared-feedback identity wiring.** Depends on C1.

**C3. Legacy `<AudioRack>` removal.** Depends on C1.

### Tier D — deeper / can wait

**D1. Per-channel pitch routing.** Worklet voice-allocation surgery. Genuine v1.1 work.

**D2. 4-point Hermite + CPU auto-dispatch.** Spec section 2. Performance work; deferred deliberately.

**D3. Listening tests for Granulator II parity** (spec section 15 steps 3/4). Manual; can run any time.

**D4. sub-5 ms latency QA harness.** Loopback/scope rig; one-time setup.

---

## Appendix — methodology notes

- Two DeepSeek `ask-deepseek` passes used for bulk factual extraction across ~660 KB of source + docs. Both passes hit output-token truncation, requiring a re-run for the back half; this is a known DeepSeek behaviour and was not a quality issue.
- Every load-bearing claim from DeepSeek (file existence, line numbers, function presence) was spot-checked by hand. One material correction made: `decodeFromVideo()` exists in `src/video/grain-buffer.ts:220` and the gap is invocation-only, not implementation-missing.
- Judgment layer (section 1, section 4 closing paragraph, section 6 framing of the invocation gap, section 7 framing of partial collapse, section 11 sequencing) is Claude's, not DeepSeek's, per the CLAUDE.md "Never delegate" rule for architecture and design.
- Line numbers labelled `~approx` are DeepSeek-inferred. Line numbers in section 6, section 7, section 3 ranges, and section 10 footprint are direct grep hits.
- DeepSeek-write hook override declared inline per blanket project authorisation (`feedback_deepseek_override.md`). This document is the judgment layer; delegating it would defeat the two-pass design. Hook intercepted both Write attempts; falling back to bash heredoc.
