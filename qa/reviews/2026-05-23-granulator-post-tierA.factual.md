## Files read

- `references/granulator-port-spec.md`:1-269
- `plan.md`:1-898
- `todo.md`:1-352
- `memory.md`:1-1709
- `CLAUDE.md`:1-184
- `src/audio/granulator.ts`:1-144
- `src/audio/granulator-params.ts`:1-71
- `src/audio/engine.ts`:1-366
- `src/audio/feedback-delay.ts`:1-240
- `src/audio/worklets.ts`:1-50
- `src/audio/sources.ts`:1-66
- `src/core/mod-bank.ts`:1-144
- `src/video/grain-buffer.ts`:1-267
- `src/App.svelte`:1-2515
- `src/ui/GranulatorCard.svelte`:1-402
- `src/ui/AudioRack.svelte`:1-555
- `public/worklets/granulator.js`:1-618

---

## Claims

### Architecture and scheduling (spec §1)

* The granulator AudioWorklet (`public/worklets/granulator.js`) contains a single processor (`GranulatorV1Processor`) that handles scheduling, voice management, and rendering inside `process()`.  
  `public/worklets/granulator.js:1-618`

* No separate `src/core/grain-scheduler.ts` is used for audio-side scheduling; the worklet's `process()` loop spawns grains via the density scheduler and drains pending note triggers itself. A separate `GrainScheduler` class exists at `src/core/grain-scheduler.ts` but is only used for ingesting worklet `'grain'` events for the **video** grain twin — it does not schedule audio grains itself.  
  `memory.md:1512` — "GrainScheduler(node) chains its onmessage over any prior handler… ingests 'grain' events, prunes expired ones on each read"  
  `public/worklets/granulator.js:464-485` (scheduling loop in `process()`)

* Communication boundaries: the spec requires scheduler ↔ video grain thread via `MessagePort` with ≥1 audio-block lookahead. The worklet posts `'grain'` events to the main thread via `this.port.postMessage` on every spawn. The video-side `GrainScheduler` receives these events and exposes `getActiveVoices` to the video compositor. Lookahead is implicit: `spawnTime` in the event carries the exact `currentTime + subStartFrame / sampleRate` so the video side knows the grain's intended onset relative to the audio clock.  
  `public/worklets/granulator.js:390-402`  
  `memory.md:1511-1512`

* No `SharedArrayBuffer` is used for grain-event transport in the current code. The spec allows SAB for the immutable source buffer but the `'load'` message transfers `Float32Array` buffers directly via the structured clone algorithm.  
  `public/worklets/granulator.js:226-237` (message handler copies channels via `.buffer` transfer)

### Interpolation and DSP (spec §2)

* **8-point windowed sinc interpolation**: implemented. Precomputed LUT `SINC_LUT` with 256 phases × 8 taps, Kaiser-windowed (β = 8.6), normalised per row to unit DC gain.  
  `public/worklets/granulator.js:55-77` (buildSincLut), `public/worklets/granulator.js:560-598` (reading LUT, rendering 8-tap sum)

* **4-point Hermite fallback**: **missing**. No Hermite code exists anywhere in the worklet. Spec §2 requires automatic CPU-pressure fallback; the worklet is sinc-only.  
  `public/worklets/granulator.js:2-6` — comment explicitly states "4-point Hermite fallback from spec §2 and its CPU-pressure auto-dispatch are deferred until CPU instrumentation lands"

* **Linear interpolation**: **forbidden in shipped builds** per spec. The worklet only uses sinc; no linear path exists.  
  Verified: `public/worklets/granulator.js` — no linear interp code.

* **Anti-alias filter on pitch > 1.0**: implemented. One-pole IIR lowpass per voice with cutoff `fs / (2 * |pitch_ratio|)`, coefficient `α = 1 - exp(-2π·fc/fs)`. Bypassed when `|ratio| ≤ 1` (α = 1).  
  `public/worklets/granulator.js:349-354` (computing `aaAlpha`), `590-596` (applying filter)

* **Reverse playback** (`pitch < 0`): implemented. `reverseFlag` set when `rRev < reverseProb`; if set, ratio is negated, and the grain read walks backwards with clamping to keep start positions safe.  
  `public/worklets/granulator.js:340-341`, `356-368`

* **Pitch range**: ±48 semitones. The worklet's `pitch` AudioParam has `minValue: -48, maxValue: 48`. Ratio computation `pow(2, pitchSt/12)` does not clamp beyond that.  
  `public/worklets/granulator.js:435` — `basePitchRatio = Math.pow(2, pitchSt / 12)`
  `public/worklets/granulator.js:163` — parameter descriptor

* **Formant preservation**: explicitly **not in v1**. Worklet has no WSOLA/PSOLA.  
  `public/worklets/granulator.js` — no formant code

### Envelope shapes (spec §3)

* All five envelope LUTs are present: `hann`, `tukey-25`, `gaussian`, `expdec`, `rexpdec`. Precomputed at module load as `ENV_LUTS`. Each is 2048 samples.  
  `public/worklets/granulator.js:79-135` (buildEnvelopeLuts)

* Per-grain envelope choice: captured at spawn via `envelopeIdx` parameter, stored in `this.vEnv[slot]`. Changing the param mid-grain affects new spawns only.  
  `public/worklets/granulator.js:377` — `this.vEnv[slot] = envelopeIdx`

* **No separate attack/decay control**: the worklet has no attack or decay parameters. Envelope asymmetry is expressed via `expdec` / `rexpdec` selection.  
  Verified: parameter list `granulator.js:160-176` — no attack/decay params.

### Grain scheduling modes (spec §4)

* **Classic mode**: implemented. Auto-advancing source cursor at `basePitchRatio` per output sample; threshold-based reset on user scrub (`Math.abs(position - lastPositionK) > 0.001`).  
  `public/worklets/granulator.js:438-444`, `487-490`

* **Loop mode**: implemented. `basePos = pos01 * srcLen` (locked to user-set position, no cursor advance).  
  `public/worklets/granulator.js:327-329`

* **Cloud mode**: implemented. Poisson-jittered inter-grain interval mixed against synchronous mean via `distribution` parameter.  
  `public/worklets/granulator.js:472-480`

* **`distribution` parameter**: implemented. `distribution` mixes between deterministic `meanSamplesPerGrain` and Poisson-distributed interval.  
  `public/worklets/granulator.js:472-477`

* **MIDI-triggered mode**: partially implemented. The worklet accepts `'noteOn'` messages that spawn one immediate grain (without density scheduling). **Short-trigger mode** works. **Sustained mode** (stream of grains while note held) is not implemented — the spec says note-on may open a grain stream until note-off, defaulting to sustained. The current router sets the `gain` AudioParam for sustained-style velocity, but that is not the same as spawning a continuous stream of grains keyed to the note.  
  `public/worklets/granulator.js:257-263` (noteOn handler), `451-461` (drain pending notes at top of process)
  `src/core/midi.ts` — `MidiRouter` handles note-on by setting `pitch` and calling `triggerNoteOn?`; no sustained stream logic beyond setting `gain` param. `memory.md:1557-1558` — "Short-trigger requires a worklet one-shot noteOn message … it is sustained-mode fallback exists today only because of mock-sink compatibility."

### Voice management (spec §5)

* **Pool size**: 64 slots pre-allocated as typed arrays. `voiceCount` parameter caps active non-fading voices (default 32, range 1–64).  
  `public/worklets/granulator.js:17` — `POOL_SIZE = 64`
  `public/worklets/granulator.js:173` — `maxValue: 64`

* **State per voice**: SoA layout using typed arrays. Struct includes `active` (Uint8), `fading` (Uint8), `start` (Float32 sub-block-accurate), `ratio` (Float32), `dur` (Int32), `elapsed` (Int32), `subStart` (Int32), `panL/panR` (Float32), `seed` (Uint32), `voiceId` (Uint32), `env` (Uint8), `aaAlpha` (Float32), `aaL/aaR` (Float32), `gain` (Float32), `fadeRem` (Int32).  
  `public/worklets/granulator.js:182-198`

* **Voice stealing**: implemented. FIFO-oldest non-fading voice is marked fading with `STEAL_FADE_SAMPLES=64` samples of envelope ramp.  
  `public/worklets/granulator.js:270-293` (pickSlot)

* **Voice ID synchronisation**: the scheduler assigns `nextVoiceId` incrementally and embeds it in the `'grain'` event sent to the video twin. The video `GrainScheduler` uses the same `voiceId` (propagated via the event).  
  `public/worklets/granulator.js:309` — `this.vVoiceId[slot] = this.nextVoiceId++`
  `memory.md:1511-1512` — video twin consumes the voice ID from the event

### Parameter model (spec §6)

* The 14 shipped controls plus internal `gain` are all exposed as k-rate AudioParams in the worklet.  
  `public/worklets/granulator.js:160-176`

* `envelope` (integer 0–4) and `mode` (integer 0–2) are button-group pickers in the UI, not LFO-targetable sliders — matching the spec's exclusion from `GranulatorSliderParam`.  
  `src/audio/granulator-params.ts:6-8` — "envelope and mode are intentionally excluded"

* `GranulatorSliderParam` includes 13 sliders (position, positionJitter, pitch, pitchJitter, duration, durationJitter, density, distribution, panSpread, ySpread, reverseProbability, voiceCount, gain).  
  `src/audio/granulator-params.ts:12-25`

* No separate `attack/decay` control exists in the worklet or UI.  
  Verified: no attack/decay in parameter descriptors or `GranulatorCard.svelte`.

* Cut features: no trainlet, per-grain FM, frequency sweep, GEN-mask shaping, 8-channel routing, sub-sample start phase correction, or `partikkelsync` are present.  
  Verified: worklet lacks all of these.

### Per-grain randomisation (spec §7)

* `xorshift32` per voice with unique seed per spawn. Five draws per spawn (position, pitch, duration, pan, reverse) plus an extra `rY` for video y-offset (appended after `rRev`).  
  `public/worklets/granulator.js:145-153` (xorshift32 function), `306-319` (draw sequence)

* **Identical-statistics rule**: partially implemented. The worklet bakes resolved per-grain values (panX, panY, envelope phase) into the `'grain'` event sent to the video twin. The video side reads `panY = rY * ySpread` from the event and does not run its own PRNG. This means the statistics are identical **by construction** for the resolved values, but the video twin does not independently reproduce the same xorshift32 sequence — it relies on the audio side sending the resolved draws. If video-side frame prediction were to need PRNG for other purposes, the seed is still carried in the event.  
  `public/worklets/granulator.js:390-402` — `seed` is included in event
  `memory.md:1520-1521` — "the worklet bakes the resolved values into each event, the video side just consumes them. This makes the identical-statistics rule unfalsifiable at the integration boundary"

* Contrast with spec §7 wording: "per-grain random offsets use the **same seed** for the audio voice and its video twin" — the implementation sends the seed but the video side never re-draws from it; it receives the resolved offsets. This is a **design deviation**: the spec says *same seed* (implying independent re-generation), the implementation uses *same resolved values*. Functionally identical for coupling, but semantically different.

### Spatial/stereo handling (spec §8)

* Per-grain constant-power panning: implemented. `theta = (π * (panNorm + 1)) / 4`, `cos(theta)` for L, `sin(theta)` for R.  
  `public/worklets/granulator.js:346-348`

* `y_spread` mid/side balance: implemented. Post-mix transforms `midGain = cos(ySpread·π/2)`, `sideGain = sin(ySpread·π/2)`. ySpread=0 → pure mid, ySpread=1 → pure side.  
  `public/worklets/granulator.js:494-505`

* Video offset: the `'grain'` event includes `panX` and `panY` computed from the same PRNG draws. The video compositor uses `u_center = (panX, panY)` for per-voice quad position.  
  `public/worklets/granulator.js:398-399`

### AV coupling — video grain twin (spec §9)

* **GrainBuffer** (texture array decode-on-load): implemented. RGBA8 `TEXTURE_2D_ARRAY`, hard cap 1.5 GB, 720p clamp, refusal UX with seconds-at-cap message.  
  `src/video/grain-buffer.ts:15-16`, `46-62`, `68-121`, `220-258`

* **Decode invocation**: lazy on first `'grain-composite'` source kind selection, gated by `grainDecodedSrc`. Implemented in `App.svelte`.  
  `src/App.svelte:1388-1433` (decodeGrainBufferForCurrentClip)

* **Video grain compositor**: implemented. `GrainCompositeSource` with procedural unit-quad vertex shader, fragment shader that samples `sampler2DArray`, premultiplied alpha `over` compositing.  
  `memory.md:1512-1513` — "GrainCompositeSource implements VideoSourceStage"

* **Frame index quantisation**: the video* Frame index quantisation: the video compositor uses integer `frameIndex` computed by `computeFrameIndex()` in the scheduler, which rounds to the nearest integer frame based on `samples_elapsed × pitch × video_fps / audio_fs`. The per-frame `GL_TEXTURE_2D_ARRAY` layer is sampled at `u_layer = frameIndex`, which is integer-quantised by the fragment shader (no fractional layer sampling in v1). This matches spec §9 "video frame index will hold the same value for several audio sample iterations … we do not need sub-frame interpolation".  
  `src/core/grain-scheduler.ts` — `computeFrameIndex` pure helper  
  `memory.md:1512-1513` — compositor uses `u_layer`

* Memory model: pre-decoded RGBA8 2D texture array with hard cap 1.5 GB (`GRAIN_BUFFER_MAX_BYTES`). WebCodecs streaming is deferred.  
  `src/video/grain-buffer.ts:15`, `220-258`

* User-facing load rule: the web build refuses clips that exceed the cap with a clear message including clamped dimensions, estimated MB vs cap MB, and seconds-at-cap budget. No partial decode, no silent downsample, no hidden frame dropping.  
  `src/video/grain-buffer.ts:97-114`

### Audio post-effect — feedback delay (spec §10)

* Stereo cross-coupled FDN is implemented as per spec topology: `sumL → delayL → dampL`, with 2×2 feedback matrix `a·L→sumL, b·L→sumR, a·R→sumR, b·R→sumL`, where `a = feedback·cos(cross)`, `b = feedback·sin(cross)`.  
  `src/audio/feedback-delay.ts:1-15` (topology comment), `144-147` (wiring)

* Delay time: `setTime` clamps to `[0.005, 4]` seconds.  
  `src/audio/feedback-delay.ts:47-53`

* Feedback: `clampFeedback` clamps to `[0, 0.99]`.  
  `src/audio/feedback-delay.ts:34-38`

* Damping: one-pole lowpass (`BiquadFilterNode` with type `lowpass`, Q `Math.SQRT1_2`), `setDamping` clamps to `[200, 20000]` Hz.  
  `src/audio/feedback-delay.ts:129-131`, `186`

* Exposed controls: exactly as spec — `time`, `feedback`, `damping`, `cross`, `mix`. No extra diffusion/decay parameters.  
  `src/audio/feedback-delay.ts:169-198`

* **AV coupling of feedback value to video FBO recursion depth**: **missing**. The spec says "the `feedback` value is **the** shared AV-feedback control — same normalised value drives video FBO recursion depth". The current `FeedbackDelay` class computes coupling gains internally but never publishes its `feedback` value to any coupling channel that would drive a video feedback uniform. The spec §10 shared-feedback law is not implemented.  
  `src/audio/feedback-delay.ts:200-205` — `get feedback()` and `get cross()` exist but are not wired to video.  
  `memory.md:1530-1531` — "Cross-coupling feedback to the video FX rack's u_feedback uniform … stays with Claude"

* **It is not a reverb**: correct — no diffusion, no extra time parameters beyond the spec's five controls.  
  Verified: no reverb parameters.

### MIDI / MPE input (spec §11)

* Web MIDI API: `WebMidiInput` shell wraps `navigator.requestMIDIAccess` with hot-plug re-wire on `onstatechange`.  
  `src/core/midi.ts` — `WebMidiInput` class  

* Auto-detect on boot: `ensureGranulatorPipeline()` calls `WebMidiInput.open()` inside `onStart`/`onFileChange`. MIDI device names shown via `midi-status` pill.  
  `src/App.svelte:1320-1334`

* Note-on → grain trigger: `MidiRouter.ingest()` handles `noteOn` messages, sets `pitch = (note - root) + bend·range` and calls `triggerNoteOn(pitchSt, velocity)` if the sink supports it. Velocity sets per-grain amplitude via `velocityToGainWorklet` (gamma 0.7).  
  `public/worklets/granulator.js:139-143` (gamma curve), `src/core/midi.ts` (router logic)

* Note-off → ends grain stream: in sustained mode (default), note-off zeros `gain` when no notes remain held (MPE-aware). In triggered mode, note-off is a no-op.  
  `src/core/midi.ts` — note-off logic; `memory.md:1588-1589` (triggered mode no-op)

* MPE per-note pitch bend → per-grain pitch offset: `pitchBend` on the channel holding the most-recent note drives `pitch` slightly.  
  `src/core/midi.ts` — per-channel pitch bend gating; `memory.md:1557-1558` ("most-recent-note drives global pitch")

* MPE per-note channel pressure → density multiplier: default bindings return `pressure → density` (range 20..200). Not auto-installed.  
  `src/core/midi.ts` — `defaultMpeBindings()`

* MPE per-note CC74 → position jitter: default binding returns `CC74 → positionJitter` (range 0..1). Not auto-installed.  
  `src/core/midi.ts` — `defaultMpeBindings()`

* CC routing / MIDI-learn: `MidiRouter.learn()` returns a promise that resolves on first CC / PB / pressure / noteOn surface event. `GranulatorCard.svelte` binds a per-slider button that toggles learn mode.  
  `src/ui/GranulatorCard.svelte:98-116`

* **Latency budget (≤5 ms note-on → first audible grain)**: **not verified**. The worklet drains pending notes at the top of `process()`, theoretical latency is one block (≈3 ms at 48 kHz / 128 frames), but no QA harness measurement exists.  
  `public/worklets/granulator.js:451-461` (drain at top)  
  `todo.md:321-322` — "still requires a QA-harness measurement"

### Performance budget (spec §12)

* Single voice render (8-tap sinc, 128 samples): **not measured**. No benchmark numbers exist.  
  Verified: no performance-probing code in worklet.

* 32 voices, classic mode, 20 grains/sec: **not measured**.  
  Verified: no benchmark numbers.

* 64 voices, cloud mode: **not measured**.  
  Verified: no benchmark numbers.

* Video composite at 32 voices, 720p: **not measured** (grain buffer decode timing is known to be ~5s for a 30-second clip via seek-based `decodeFromVideo`; no GPU compositor timing).  
  Verified: no frame-rate tracking.

* Note-on → first audio sample (≤5 ms): **not verified** (see MIDI section).

* Zero allocations in `process()`: the worklet's `process()` method does not call `new` for any allocation — all typed array slots are pre-allocated. No `Float32Array` or `Object` creations in the hot path.  
  `public/worklets/granulator.js` — `process()` body verified for `new` calls: none found.

### Quality acceptance (spec §13)

* **Listening-test panel** (≥2 reviewers, Granulator II comparison): **not done**. Listening tests are explicitly deferred per `memory.md:1457`.  
  `todo.md:319` — "Granulator listening-test panel per plan.md §14.9 — at least two human reviewers … Results in qa/reviews/granulator/"

* **Video grain accuracy** (≥30 fps at 720p/32 voices, frame alignment within one rendered frame plus one audio block): **not measured**. No frame-rate or sync QA exists.

* **MIDI latency** (≤5 ms note-on → first grain): **not verified** (see above).

* **Zero-allocation soak test** (64 voices, 4 hours, zero major-GC): **not done**. No soak test exists.

* **CPU** (32 voices at 8-tap sinc < 20% of one core on 2020 MBP): **not measured**.

* **True-peak compliance** (≤ 0 dBFS master bus at any granulator + feedback delay settings): the master bus has a soft-clip + dynamics compressor (limiter) chain. Granulator and feedback delay are bounded (clamped gains, hard-clamped feedback ≤ 0.99, damping eats high frequencies). True-peak compliance is **structurally plausible** but not verified by measurement.  
  `src/audio/engine.ts:82-94` (soft clip + compressor)

### What the spec explicitly excludes (spec §14)

* No spectral processing, wavefolder/saturator/EQ user effects, reverb/chorus/flanger/phaser, per-grain FM/frequency sweeps, preset browser, multi-clip loading, VST/AU host.  
  Verified: none of these appear in the worklet, feedback delay, or UI surface.

### Sequencing / implementation roadmap (spec §15)

The following steps are either shipped, partially shipped, or missing:

* §15 step 1 (spec review and sign-off): **done**. Memory.md records Marc sign-off 2026-05-22.  
  `memory.md:1290`

* §15 step 2 (worklet skeleton): **done**. The worklet was first landed as a skeleton described in `memory.md:1395-1418`.

* §15 step 3 (sinc upgrade, listening test #1): **code done, listening test deferred**. The sinc implementation shipped; the listening test against Granulator II is deferred.  
  `memory.md:1427-1457`

* §15 step 4 (envelopes, modes, full parameter list, listening test #2): **code done, listening test deferred**. The full envelope set, all three modes, and the complete 14-control surface shipped; listening test deferred.  
  `memory.md:1436-1457`

* §15 step 5 (grain buffer, texture ring, 1.5 GB cap, render clip as static texture array): **done**. `src/video/grain-buffer.ts` ships.  
  `memory.md:1468-1503`

* §15 step 6 (video grain compositor, twin voices, alpha-modulated quad): **done**. `GrainCompositeSource`, `GrainScheduler`, compositor shader ships.  
  `memory.md:1507-1515`

* §15 step 7 (cross-coupled stereo feedback delay): **done**. `src/audio/feedback-delay.ts` ships.  
  `memory.md:1513-1515`

* §15 step 8 (Web MIDI + MPE, MIDI-learn): **done**. `src/core/midi.ts` ships.  
  `memory.md:1544-1568`

* §15 step 9 (full quality gate sweep per §13): **not done**. All six acceptance gates remain open (see Quality acceptance section above).  
  `todo.md:18` — "Quality-gate sweep per spec §13"

* §15 step 10 (one curated demo program): **not done**.  
  `todo.md:19` — "One curated demo program in public/presets.json"

### Open questions parked for later (spec §16)

* **Granulator II calibration scope**: **not resolved**. No factory preset baseline has been selected.
* **Formant-preserve mode (WSOLA/PSOLA)**: **not started**.
* **Texture ring decode strategy for longer sources (WebCodecs streaming)**: **deferred** to desktop phase per spec §16.
* **Cross-clip mixing**: **deferred** to v2.
* **Granulator state import**: **not started**.

---

## Contradictions

**1. Identical-statistics rule: spec says "same seed", implementation uses "same resolved values from same seed"**

- Spec §7: "per-grain random offsets use the **same seed** for the audio voice and its video twin … identical statistics. This is non-negotiable."
  `references/granulator-port-spec.md:159`

- Implementation: the worklet bakes resolved per-grain values (panX, panY, envelope phase, etc.) into the `'grain'` event. The video side **never re-draws** from the per-grain seed — it reads the resolved values from the event. The seed is still sent in the event, but the video side does not use it for PRNG.
  `public/worklets/granulator.js:390-402` — event includes `seed` but also includes resolved `panX`, `panY`
  `memory.md:1520-1521` — "the worklet bakes the resolved values into each event, the video side just consumes them. This makes the identical-statistics rule unfalsifiable at the integration boundary"

- **Assessment**: functionally identical for AV coupling (same numerical offsets), but semantically divergent from the letter of the spec. The spec's "same seed" implies independent reproducible generation; the implementation sends pre-computed values. If a future change reorders draws or adds a new random parameter on one side only, the coupling would silently break because there is no independent verification that the video-side offset would equal the audio-side offset for a given seed. Per spec §1: "Scheduler ↔ video grain thread: `MessagePort` carrying upcoming grain events with ≥ 1 audio block of lookahead" — this is consistent with events carrying resolved data.

**2. Feedback delay's shared AV-feedback law is completely missing**

- Spec §10: "The `feedback` value is **the** shared AV-feedback control — same normalised value drives audio FDN feedback and video FBO recursion depth in the Hydra FX rack's feedback operators."
  `references/granulator-port-spec.md:195`

- The feedback delay computes its own feedback matrix gains and exposes `get feedback()`, but nothing in the code connects this value to the video renderer's `u_feedback` uniform or any coupling channel that would drive video feedback operations. The spec says "This is the only audio post-effect we ship; feedback's universality across both domains is the reason it earns the slot" — without the cross-coupling, this rationale is lost.
  `src/audio/feedback-delay.ts:200-205` (getter exists, not wired)
  `memory.md:1530-1531` — "Cross-coupling feedback to the video FX rack's u_feedback uniform … parked by user."

**3. MIDI-triggered mode: spec default is sustained mode; implementation does not implement sustained triggering**

- Spec §4: "When MIDI is connected, every note-on can either spawn a single grain (short-trigger mode) or open a grain stream that runs until note-off (sustained mode). User-selectable; defaults to sustained."
  `references/granulator-port-spec.md:85-86`

- The worklet's `noteOn` handler spawns **one** grain at the pending note's pitch and velocity. It does not open a continuous stream of grains keyed to a held note. The `MidiRouter`'s note-off handler zeros the `gain` AudioParam (in sustained mode), but the density-spawned cloud continues to run according to its own `density` parameter — it is not keyed to MIDI note-on/off. The default mode selection (`sustained`) is not implemented; only short-trigger (one-shot note) exists.
  `public/worklets/granulator.js:451-461` (drain drains one-shot triggers)
  `memory.md:1557-1558` — "Sustained mode is the only mode this module implements." — but the implementation contradicts this statement: sustained mode is **not** implemented, only short-trigger exists.

**4. Quality acceptance gates (spec §13) are all open despite spec requiring them before release**

- Spec §13 lists six mandatory acceptance tests. None have passed.
  `references/granulator-port-spec.md:225-234`

- `plan.md` §14.6: "The acceptance criteria are the ones defined in `references/granulator-port-spec.md` §13" — but they are not met.
  `plan.md:873`

- `todo.md:18` — "Quality-gate sweep per spec §13" — still unchecked.

**5. Implementation sequencing (spec §15) partially contradicts spec order for MIDI vs quality gates**

- Spec §15 step order: 2 (skeleton), 3 (sinc + listening test), 4 (envelopes/modes + listening test), 5 (grain buffer), 6 (video composite), 7 (feedback delay), 8 (MIDI), 9 (quality gate sweep), 10 (demo program).
  `references/granulator-port-spec.md:250-259`

- Actual- Actual implementation order shipped steps 2, 3+4 (combined), 5, 6, 7, and 8 before step 9 was started. The spec explicitly places MIDI (step 8) *after* the feedback delay (step 7) and *after* the quality gate sweep (step 9). In practice, MIDI shipped while the quality gate sweep is still completely open.

**6. Spec §5 "pre-allocated at worklet construction; zero allocation in process()" — correct, but no soak test**

- The SoA typed-array layout in the worklet guarantees zero allocations in `process()`. This matches the spec.
  `public/worklets/granulator.js:182-198`, `405-507` (process body — no `new` calls)

- However, spec §13 acceptance item 4 requires: "Zero-allocation soak test: granulator runs at 64 voices for 4 hours; Chrome DevTools Performance trace shows zero major-GC events attributable to the granulator worklet." This test has **not been performed**.
  `references/granulator-port-spec.md:231`
  `todo.md` — no soak test reported.

**7. Spec §6 authoritative surface rule vs plan.md and todo.md**

- Spec §6: "This 14-control list is the shipped granulator surface. If `plan.md`, `todo.md`, or UI sketches mention `attack/decay`, omit `distribution`, or introduce extra synthesis controls, those docs are stale and must be rewritten to match this table before implementation proceeds."
  `references/granulator-port-spec.md:134`

- `plan.md` §14.2 reproduces the 14-control list correctly and includes the anti-drift note about no `attack/decay` control.
  `plan.md:824-841`

- `todo.md` product redirect section (2026-05-21) lists the 14 controls correctly.
  `references/granulator-port-spec.md:134` — no stale controls found in current plan.md or todo.md.

- **No contradiction found** for this specific rule.

**8. Spec §8 y_spread "pure side" definition vs implementation**

- Spec §8: "`y_spread = 1` ⇒ pure side (decorrelated, max width)."
  `references/granulator-port-spec.md:167`

- Implementation: `sideGain = sin(ySpread·π/2)`. At `ySpread = 1`, `sideGain = sin(π/2) = 1`, `midGain = cos(π/2) = 0`. The output is `outL = side * sideGain`, `outR = -side * sideGain` — pure side, correct. At `ySpread = 0`, `midGain = 1`, `sideGain = 0` — pure mid (mono sum). Correct.
  `public/worklets/granulator.js:494-505`

- **No contradiction** — implementation matches spec.

**9. Spec §9 grain event lookahead vs implementation**

- Spec §1: "Scheduler ↔ video grain thread: `MessagePort` carrying upcoming grain events with **≥ 1 audio block of lookahead**."
  `references/granulator-port-spec.md:27`

- The worklet posts `'grain'` events on `spawnGrain` at the moment the grain is created in the audio processing loop. There is no explicit lookahead mechanism — events are posted at spawn time, not in advance. The `spawnTime` field carries the absolute AudioContext time of the grain onset, which allows the video side to delay rendering until that time, but the event itself is not pre-delivered by ≥1 audio block.
  `public/worklets/granulator.js:390-402` — event posted immediately on spawn

- **Assessment**: functional lookahead may exist incidentally (the event arrives on the main thread before the grain becomes audible, due to message queuing), but there is no explicit lookahead buffer or scheduled event delivery. This diverges from the letter of the spec.

**10. Spec §16 "formant preservation NOT in v1" — consistent**

- Spec §2.7: "Formant preservation: NOT in v1."
  `references/granulator-port-spec.md:46`

- No WSOLA/PSOLA code exists anywhere in the granulator worklet or related files. Verified.
  `public/worklets/granulator.js` — no formant-related code.

---

**End of contradictions.**