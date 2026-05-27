## Files read

- `src/ops/shared.ts:1-127`
- `src/ops/scrollX.ts:1-49`
- `src/ops/scrollY.ts:1-45`
- `src/ops/repeat.ts:1-66`
- `src/ops/repeatX.ts:1-45`
- `src/ops/repeatY.ts:1-45`
- `src/ops/channel.ts:1-33`
- `src/ops/modulate.ts:1-46`
- `src/ops/modulateDisplace.ts:1-42`
- `src/ops/modulateHue.ts:1-27`
- `src/ops/modulateHueRouted.ts:1-28`
- `src/ops/modulateKaleid.ts:1-27`
- `src/ops/modulatePixelate.ts:1-41`
- `src/ops/modulatePixelateRouted.ts:1-42`
- `src/ops/modulateRepeat.ts:1-61`
- `src/ops/modulateRepeatRouted.ts:1-62`
- `src/ops/modulateRotate.ts:1-41`
- `src/ops/modulateRotateRouted.ts:1-42`
- `src/ops/modulateRouted.ts:1-28`
- `src/ops/modulateScale.ts:1-41`
- `src/ops/modulateScaleRouted.ts:1-42`
- `src/ops/modulateScrollX.ts:1-43`
- `src/ops/modulateScrollY.ts:1-43`
- `src/ops/modulateScrollYRouted.ts:1-44`
- `src/core/operators.ts:1-681`
- `src/core/operators.test.ts:1-186`
- `src/core/presets.ts:1-450`
- `src/core/presets.test.ts:1-470`
- `public/worklets/granulator.js:1-1306`
- `src/audio/granulator.ts:1-531`
- `src/audio/worklets/granulator.test.ts:1-824`
- `src/App.svelte:1-3167`
- `src/ui/GranulatorCard.svelte:1-518`
- `references/granulator-port-spec.md:1-272`
- `qa/e2e/operator-registry-validation.spec.ts:1-18`

---

### Modulation helper layer (`shared.ts`)

- `UniformVideoStage` is a class implementing `VideoStage` that stores a pre-compiled program and an array of uniform spec/location pairs. The `setUniforms` method iterates all stored uniform bindings every frame (`src/ops/shared.ts:20-55`).
- `samplerUniform`, `vec4Uniform`, `paramUniform`, and `ctxUniform` are helper functions that create `UniformSpec` objects with type‑specific binders (`src/ops/shared.ts:57-86`).
- `PRIMARY_SOURCE_UNIFORM`, `PREV_FRAME_UNIFORM`, `ROUTED_SOURCE_UNIFORM`, `TIME_UNIFORM`, `RATE_UNIFORM` are the canonical uniform spec constants for standard textures and coupling context fields (`src/ops/shared.ts:88-92`).
- `passthroughParam(spec)` returns a `CoupledParam` whose `toVideo` is the identity function (`src/ops/shared.ts:94-99`).
- `createVideoOperatorDef(config)` builds an `OperatorDef` from a `VideoOperatorDefConfig` object. It forwards `.op`, `.inputArity`, `.paramOrder`, `.defaults`, `.audit`, and `.coupling`, and provides a `createVideoStage` factory that returns a `UniformVideoStage` (`src/ops/shared.ts:112-127`).

---

### Alias-family operators with audit metadata

**`scrollX.ts`**
- Uses `createVideoOperatorDef` with frag from `scrollX.frag`. Uniforms: `PRIMARY_SOURCE_UNIFORM`, `u_amount`, `u_speed`, `TIME_UNIFORM`. Params: `amount` (0..1, default 0), `speed` (-5..5, default 0). Defaults: `{ amount: 0, speed: 0 }`. Audit: `shaderPath: 'src/video/shaders/scrollX.frag'`, `neutralDefault: true`, `qaCaseIds: ['audit-scrollX-osc-sweep', 'audit-scrollX-video-cross-source']`, `qaCoverage: 'dedicated'` (`src/ops/scrollX.ts:11-49`).

**`scrollY.ts`**
- Same pattern. Audit: `qaCaseIds: ['audit-scrollY-osc-sweep', 'audit-scrollY-video-cross-source']`, `qaCoverage: 'dedicated'` (`src/ops/scrollY.ts:7-45`).

**`repeat.ts`**
- Params: `repeatX` (1-8, default 1), `repeatY` (1-8, default 1), `offsetX` (0-1, default 0), `offsetY` (0-1, default 0). Audit: `qaCaseIds: ['audit-repeat-osc-sweep', 'audit-repeat-video-cross-source']`, `qaCoverage: 'dedicated'` (`src/ops/repeat.ts:9-66`).

**`repeatX.ts`**
- Params: `reps` (1-8, default 1), `offset` (0-1, default 0). Audit: `qaCaseIds: ['audit-repeatX-osc-sweep', 'audit-repeatX-video-cross-source']`, `qaCoverage: 'dedicated'` (`src/ops/repeatX.ts:8-45`).

**`repeatY.ts`**
- Params: same as repeatX. Audit: `qaCaseIds: ['audit-repeatY-osc-sweep', 'audit-repeatY-video-cross-source']`, `qaCoverage: 'dedicated'` (`src/ops/repeatY.ts:8-45`).

**`channel.ts`**
- Defines `rDef`, `gDef`, `bDef`, `aDef` via `makeChannelDef`. Uses `createVideoOperatorDef` with frag from `channel.frag`. Uniforms: `PRIMARY_SOURCE_UNIFORM`, `vec4Uniform(u_weights, weights)`. No params. Audit: `shaderPath: 'src/video/shaders/channel.frag'`, `neutralDefault: false`, `qaCaseIds: ['audit-modulateDisplace-osc-sweep', 'audit-modulateDisplace-video-cross-source']`, `qaCoverage: 'shared'` (`src/ops/channel.ts:13-33`).

**Modulate family operators** (all use `createVideoOperatorDef`)
- `modulate.ts`: Uniforms `PRIMARY_SOURCE_UNIFORM`, `u_amount`, `TIME_UNIFORM`, `RATE_UNIFORM`. No audit block (`src/ops/modulate.ts:24-46`).
- `modulateDisplace.ts`: `inputArity: 2`, uniforms `PRIMARY_SOURCE_UNIFORM`, `ROUTED_SOURCE_UNIFORM`, `u_amount`, `u_bias`. No audit (`src/ops/modulateDisplace.ts:10-42`).
- `modulateHue.ts`: uniforms `PRIMARY_SOURCE_UNIFORM`, `PREV_FRAME_UNIFORM`, `u_amount`. No audit (`src/ops/modulateHue.ts:10-27`).
- `modulateHueRouted.ts`: `inputArity: 2`, uniforms `PRIMARY_SOURCE_UNIFORM`, `ROUTED_SOURCE_UNIFORM`, `u_amount`. No audit (`src/ops/modulateHueRouted.ts:10-28`).
- `modulateKaleid.ts`: uniforms `PRIMARY_SOURCE_UNIFORM`, `PREV_FRAME_UNIFORM`, `u_nSides`. No audit (`src/ops/modulateKaleid.ts:10-27`).
- `modulatePixelate.ts`: uniforms `PRIMARY_SOURCE_UNIFORM`, `PREV_FRAME_UNIFORM`, `u_multiple`, `u_offset`. No audit (`src/ops/modulatePixelate.ts:10-41`).
- `modulatePixelateRouted.ts`: `inputArity: 2`, uniforms `PRIMARY_SOURCE_UNIFORM`, `ROUTED_SOURCE_UNIFORM`, `u_multiple`, `u_offset`. No audit (`src/ops/modulatePixelateRouted.ts:10-42`).
- `modulateRepeat.ts`: uniforms `PRIMARY_SOURCE_UNIFORM`, `PREV_FRAME_UNIFORM`, `u_repeatX`, `u_repeatY`, `u_offsetX`, `u_offsetY`. No audit (`src/ops/modulateRepeat.ts:10-61`).
- `modulateRepeatRouted.ts`: `inputArity: 2`, uniforms `PRIMARY_SOURCE_UNIFORM`, `ROUTED_SOURCE_UNIFORM`, `u_repeatX`, `u_repeatY`, ``modulateRotate.ts`: uniforms `PRIMARY_SOURCE_UNIFORM`, `PREV_FRAME_UNIFORM`, `u_multiple`, `u_offset`. Params: `multiple` (-1..1, default 0, unit `rad`), `offset` (-π..π, default 0, unit `rad`). No audit (`src/ops/modulateRotate.ts:10-41`).

`modulateRotateRouted.ts`: `inputArity: 2`, uniforms `PRIMARY_SOURCE_UNIFORM`, `ROUTED_SOURCE_UNIFORM`, `u_multiple`, `u_offset`. Same param ranges as modulateRotate. No audit (`src/ops/modulateRotateRouted.ts:10-42`).

`modulateRouted.ts`: `inputArity: 2`, uniforms `PRIMARY_SOURCE_UNIFORM`, `ROUTED_SOURCE_UNIFORM`, `u_amount`. Params: `amount` (0..1, default 0). No audit (`src/ops/modulateRouted.ts:10-28`).

`modulateScale.ts`: uniforms `PRIMARY_SOURCE_UNIFORM`, `PREV_FRAME_UNIFORM`, `u_multiple`, `u_offset`. Params: `multiple` (-1..1, default 0, unit `ratio`), `offset` (0.5..2, default 1, unit `ratio`). No audit (`src/ops/modulateScale.ts:10-41`).

`modulateScaleRouted.ts`: `inputArity: 2`, uniforms `PRIMARY_SOURCE_UNIFORM`, `ROUTED_SOURCE_UNIFORM`, `u_multiple`, `u_offset`. Same ranges as modulateScale. No audit (`src/ops/modulateScaleRouted.ts:10-42`).

`modulateScrollX.ts`: uniforms `PRIMARY_SOURCE_UNIFORM`, `PREV_FRAME_UNIFORM`, `u_amount`, `u_speed`, `TIME_UNIFORM`. Params: `amount` (0..1, default 0), `speed` (-5..5, default 0, unit `hz`). No audit (`src/ops/modulateScrollX.ts:11-43`).

`modulateScrollY.ts`: same uniform/param pattern as modulateScrollX. No audit (`src/ops/modulateScrollY.ts:11-43`).

`modulateScrollYRouted.ts`: `inputArity: 2`, uniforms `PRIMARY_SOURCE_UNIFORM`, `ROUTED_SOURCE_UNIFORM`, `u_amount`, `u_speed`, `TIME_UNIFORM`. Same ranges as modulateScrollX/Y. No audit (`src/ops/modulateScrollYRouted.ts:11-44`).

---

### Operator registry & UI metadata (`operators.ts`, `operators.test.ts`)

- `OperatorDef` interface has optional `audit?: { shaderPath, neutralDefault, qaCaseIds, qaCoverage }` (`src/core/operators.ts:119-124`).
- `registerOp(def)` validates audit metadata: `shaderPath` must be non-empty and `qaCaseIds` must have at least one entry (`src/core/operators.ts:594-601`).
- `OPERATOR_UI_META` defines `r`, `g`, `b`, `a` entries under `family: 'Finish'` but none of these four has `coreParams` (`src/core/operators.ts:286-305`).
- `scrollX`, `scrollY`, `repeat`, `repeatX`, `repeatY` each have `OperatorUiMeta` entries with `family: 'Motion'` and core param lists (`src/core/operators.ts:432-461`).
- `operators.test.ts` "keeps every existing operator ID registered" test asserts `listOps()` equals `EXPECTED_OPERATOR_IDS` which includes every operator listed above (`src/core/operators.test.ts:10-82,86`).
- `operators.test.ts` "groups product-surface operators" test asserts `r`, `sum`, and the eight field-op pack (pinchBulge, polarRipple, sinkSourceField, spiralField, domainFold, gyreField, turbulenceWarp, magneticDipole) are in `family: 'Finish'` or `family: 'Feedback'` respectively (`src/core/operators.test.ts:93-123`).
- `operators.test.ts` "keeps audited alias-family operators wired" test asserts every audited op has an existing shader file and QA case file, and that `isNeutralInstance` matches `audit.neutralDefault` (`src/core/operators.test.ts:165-185`).

---

### Presets system (`presets.ts`, `presets.test.ts`)

- `applyProgramAudio()` calls `applyProgramAudioState(program.audio, handlers)` and handles `granulator` block (slider params, envelope, mode, quality) plus `feedbackDelay` block (`src/core/presets.ts:406-450`).
- `applyProgramAudioState` filters: non-finite numbers are skipped; unknown enum strings are skipped; `name === 'envelope'`/`'mode'`/`'quality'` route through dedicated handlers (`src/core/presets.ts:411-443`).
- `presets.test.ts` "routes every granulator value through the callback" test asserts all 7 granulator and 3 feedback-delay calls are made in order (`src/core/presets.test.ts:378-411`).
- `presets.test.ts` "applies a resolved audio state without a full program wrapper" test calls `applyProgramAudioState` directly with a granulator+feedbackDelay object (`src/core/presets.test.ts:456-469`).

---

### Granulator worklet (`public/worklets/granulator.js`)

- The worklet declares `parameterDescriptors` returning an empty array — no AudioParam descriptors (`public/worklets/granulator.js:251-253`).
- Controls arrive through a shared control snapshot (`SharedArrayBuffer`) when available, with port-message fallback (`public/worklets/granulator.js:344-353, 455-461`).
- In `process()`, when `hasSharedControls` is true, all control values are read from `this.controlCache[...]` via direct indexed reads — no dynamic `parameters[name]` lookups (`public/worklets/granulator.js:920-946`). When false, the non-SAB fallback uses `this.readControl(parameters, name, index)` which increments `this.parameterLookupCount` (`public/worklets/granulator.js:571-579, 947-983`).
- `spawnGrain()` is called from two places: the pending-note drain (line 1004) and the density scheduler loop (line 1029). It advances the master PRNG and spawns with resolved per-grain values (`public/worklets/granulator.js:657-761`).
- The worklet's `SINC_LUT_BALANCED` is 8-tap; `SINC_LUT_HIGH` is 12-tap (`public/worklets/granulator.js:246-247`).
- Hermite fallback is gated by `INTERP_COST_BUDGET_BALANCED=192` and `INTERP_COST_BUDGET_HIGH=384` (`public/worklets/granulator.js:110-111`).
- Adaptive quality logic: when `adaptiveQuality && quality === QUALITY_HIGH` and the high budget is exceeded, the worklet tries the balanced sinc tap count first; only then falls to ECO/Hermite (`public/worklets/granulator.js:1086-1097`).

---

### Granulator wrapper (`src/audio/granulator.ts`)

- `Granulator.create()` is async: it calls `ensureAudioWorklets(ctx)` then constructs the `Granulator` instance (`src/audio/granulator.ts:308-311`).
- The wrapper exposes `grainEventRing`, `readRuntimeDiagnostics()`, `readControlAudit()`, `setEmitInterpModeMessages()`, `setForceNoSpawn()`, `setEnableRuntimeSnapshotWrites()`, `setAdaptiveQuality()` (`src/audio/granulator.ts:313-503`).
- `setParam()` deduplicates by checking `this.#controlCache[index] === next` before writing (`src/audio/granulator.ts:415`).
- `setParams()` batches writes and only bumps the sequence counter if something changed (`src/audio/granulator.ts:425-445`).
- `triggerNoteOn()` posts `{ type: 'noteOn', pitch, velocity, channel }` to the worklet (`src/audio/granulator.ts:475-478`).

---

### Granulator worklet tests (`granulator.test.ts`)

- 12 test cases exist covering silence-before-load, silence-before-enable, non-silent output, +24 st bounded with sinc+AA, reverse playback, all five envelope LUTs, loop/cloud/classic modes, position jitter no-NaN, voice stealing bounded, shared control reads, shared grain ring, SAB source handoff, high-quality alias energy bounds, grain-boundary click energy, level stability across voice counts, deterministic fixed-seed output, runtime snapshots without message traffic, SAB-mode parameter lookup count of zero, clear() silences (`src/audio/worklets/granulator.test.ts:274-823`).

---

### App.svelte — granulator/midi/feedback integration

- `ensureGranulatorPipeline()` creates `Granulator` and `FeedbackDelay`, connects `g.output → delay.input`, attaches delay to engine master, instantiates `MidiRouter(g)`, and opens Web MIDI (`src/App.svelte:1816-1868`).
- `loadClipIntoGranulator(file)` fetches the file array buffer and calls `granulator.loadFromArrayBuffer()` (`src/App.svelte:1874-1883`).
- `tickGranulatorModulation()` runs every rAF: applies global LFO assignments to raw params and pushes modulated values into the granulator's shared control snapshot via `pushGranulatorParams()` (`src/App.svelte:2134-2143`).
- `applyResolvedProgramState()` applies program values, then routes audio state (granulator + feedbackDelay), then applies shared feedback from the resolved state (`src/App.svelte:1067-1092`).
- Granulator card + feedback delay card are mounted in the Audio tab, above the legacy rack (which is unmounted per C1/C2/C3) (`src/App.svelte:2636-2657`).
- QA bridge exposes `setGranulatorParam`, `setGranulatorEnabled`, `setGranulatorDiagnostics`, `getGranulatorRuntimeDiagnostics`, `getGranulatorControlAudit`, `setFeedbackDelayParam`, `getAudioContext`, `getMasterPeak`, `isGrainDecoded`, `ensureGrainAudioLoaded`, `readCenterPixel`, `readGrainBufferFrame`, `measureGranulatorLatencyProxy`, `fireGranulatorLatencyProbe` (`src/App.svelte:1402-1458`).

---

### GranulatorCard.svelte

- `GranulatorCard.svelte` receives `granulator`, `midiRouter`, `enabled`, `envelope`, `mode`, `quality`, `adaptiveQuality`, `runtimeSnapshot`, `values`, `lfoBank`, `lfoAssignments` and callbacks as props — no internal `values` state (`src/ui/GranulatorCard.svelte:19-59`).
- The card renders envelope/mode/quality pickers, diagnostics panel, and a grid of sliders with LFO `<select>` and MIDI-learn button per row (`src/ui/GranulatorCard.svelte:157-329`).
- SLIDER_DISPLAY table includes `position`, `positionJitter`, `pitch`, `pitchJitter`, `duration`, `durationJitter`, `density`, `distribution`, `panSpread`, `ySpread`, `reverseProbability`, `voiceCount`, `gain`, `mix`, `fmAmount`, `fmFreq`, `envAttack`, `envDecay`, `envSustain`, `envRelease` (`src/ui/GranulatorCard.svelte:74-95`).

---

### Granulator port spec (`references/granulator-port-spec.md`)

- Spec §2: Balanced interpolator default is 8-point windowed sinc (Kaiser β=8.6, 256 phases × 8 taps), fallback is 4-point Hermite, linear interpolation forbidden (`references/granulator-port-spec.md:36-47`).
- Spec §4: Three-mode taxonomy (classic/loop/cloud); MIDI-triggered mode is orthogonal ("note-on opens a grain stream") (`references/granulator-port-spec.md:70-88`).
- Spec §15 step 3: "Swap linear → 8-tap windowed sinc. Listening test #1" (`references/granulator-port-spec.md:255`).
- Spec §15 step 4: "Add envelopes (all 5), modes (all 3), full parameter list. Listening test #2" (`references/granulator-port-spec.md:256`).
- Spec §15 step 2 skeleton includes "temporary linear interpolation if needed" for architecture validation only (`references/granulator-port-spec.md:254`).

---

### Operator registry validation e2e spec

- `qa/e2e/operator-registry-validation.spec.ts` asserts that every registered operator's video stage compiles in-browser via the QA bridge `validateOperatorCompilation()` method. Asserts no failures (`qa/e2e/operator-registry-validation.spec.ts:4-18`).

---

## Contradictions

1. **Channel op QA case IDs vs family name**. `channel.ts` gives `r`, `g`, `b`, `a` the QA case IDs `['audit-modulateDisplace-osc-sweep', 'audit-modulateDisplace-video-cross-source']` with `qaCoverage: 'shared'` (`src/ops/channel.ts:24-26`), but `operators.ts` lists those ops under `family: 'Finish'` with intents `['matte', 'channel routing']` (`src/core/operators.ts:286-305`). The QA case names suggest they are tested under a modulateDisplace scenario, which is a `Blend/Composite` operator — the referenced QA case files may not test the channel isolate behavior specifically.

2. **Granulator spec default mode vs implementation**. `references/granulator-port-spec.md` §4 states the default mode is sustained MIDI, but the implementation note says the code defaults to triggered (short-trigger) mode, with the sustained path surviving only as a fallback for mock sinks (`references/granulator-port-spec.md:86-88`). The spec labels this a "known discrepancy" requiring resolution before §13 sign-off.

3. **GranulatorCard slider metadata source**. `src/ui/GranulatorCard.svelte:74-95` defines `SLIDER_DISPLAY` with fields `fmAmount`, `fmFreq`, `envAttack`, `envDecay`, `envSustain`, `envRelease` — 20 total sliders. `src/audio/granulator.ts:62-86` defines `CONTROL_ORDER` with 23 entries (these plus `position`, `pitch`, `duration`, etc.) and `CONTROL_DEFAULTS` with the same 23 keys (`src/audio/granulator.ts:93-117`). But `src/audio/granulator-params.ts` (referenced as the source of `GRANULATOR_SLIDER_ORDER`) is not in the source files provided — the actual slider discovery in `GranulatorCard.svelte` goes through `GRANULATOR_SLIDER_ORDER` which is imported from `granulator-params.ts`, not directly from the 23-entry `CONTROL_ORDER`. If `GRANULATOR_SLIDER_ORDER` is only a subset (13 slider params, excluding `fmAmount` etc.), then the card attempts to display controls for 20 sliders via `SLIDER_DISPLAY` even though the worklet and wrapper use a larger control set — this is a speculative mismatch without seeing `granulator-params.ts` content.

4. **No contradictions found** between the provided source files and the reference documents (`memory.md`, `todo.md`) specifically regarding the working-tree changes and axis/selector follow-ups — the alias-family audit metadata (`src/ops/scrollX.ts:43-48`, `src/ops/scrollY.ts:39-44`, `src/ops/repeat.ts:60-65`, `src/ops/repeatX.ts:39-44`, `src/ops/repeatY.ts:39-44`, `src/ops/channel.ts:21-27`), the modulation helper layer (`src/ops/shared.ts`), the granulator quality selector (`src/audio/granulator.ts:455-458`, `public/worklets/granulator.js:1086-1097`), and the operator registry validation spec (`qa/e2e/operator-registry-validation.spec.ts`) all appear to be implemented as described in the reference documents. The granulator port spec step sequencing (linear interpolation in skeleton, then sinc upgrade) is consistent with the worklet's current implementation having sinc but the spec forbidding linear in shipped builds.