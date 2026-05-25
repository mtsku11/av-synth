# granulator-port-spec.md

The synthesis of four external references into a concrete engineering spec for av-synth's granulation engine. Read this before writing any granulator code. This document **supersedes** the placeholder `mpe-granulator-ii-spec.md` referenced in `plan.md` §14.14 — that file is no longer expected; this is its replacement.

Sources distilled here (full citations in `references/README.md`):
- **B** = Bencina, *Implementing Real-Time Granular Synthesis* (Audio Anecdotes III, 2001) — architecture
- **Br** = Brandtsegg et al., *Particle synthesis — a unified model* (LAC 2011) + the `partikkel` opcode source — DSP taxonomy
- **C** = Carlson & Wang, *Borderlands: An Audiovisual Interface for Granular Synthesis* (NIME 2012) + the Borderlands C++ source — instrument-feel and AV coupling
- **H** = Robert Henke's Granulator II/III (closed; calibration by listening only) — final taste/quality reference

The av-synth granulator must satisfy the spec below **and** sound at least as good as Granulator II on the same source material. If those two constraints ever conflict, the listening test wins.

---

## 1. Architectural model (from B)

Three layers, exactly as Bencina describes, mapped to the av-synth runtime:

| Layer | Bencina role | av-synth implementation |
|---|---|---|
| Scheduling | Generates grain start events with timing, randomisation, parameter envelopes. Lookahead. | `src/core/grain-scheduler.ts` — runs inside the granulator AudioWorklet, plus a thin main-thread façade for UI/MIDI events. |
| Voice management | Fixed-size grain pool, allocation, stealing. | Inside `src/audio/worklets/granulator.js` — a pre-allocated array of voice slots, no allocation in `process()`. |
| Rendering | Per-block sample synthesis from the active voice array. | The same worklet — walks active voices, accumulates into output buffer. |

**Communication boundaries (concrete):**
- UI ↔ scheduler: `MessagePort` — only parameter changes and one-shot events (e.g. MIDI note-on). No per-block traffic.
- Scheduler ↔ video grain thread: `MessagePort` carrying upcoming grain events with **≥ 1 audio block of lookahead** (B §4 latency budget). The video thread enqueues voices to its texture-ring compositor on the same `voice_id` the audio side will use, so audio and video grains never desync.
  - **Implementation note (2026-05-23):** the current worklet posts `'grain'` events at the moment of spawn rather than pre-scheduling one block ahead. Each event carries the absolute `spawnTime` (in `AudioContext` seconds), and the video twin delays compositing until that timestamp — so functional lookahead is achieved via message-queue latency plus per-event timestamping, not via an explicit pre-schedule. This satisfies the "audio and video grains never desync" guarantee but does not satisfy the literal "≥ 1 audio block of lookahead" wording. If a future change tightens the latency budget, switch to genuine pre-schedule.
- Default v1 grain-event transport is `MessagePort`, but isolated builds may switch the audio-thread → video-thread grain-event path onto a fixed `SharedArrayBuffer` ring if the zero-allocation gate demands it. That trade is now justified: the ring removes per-grain structured-clone churn from `process()` while keeping the same event payload contract for the video twin. Non-isolated sessions still fall back to `MessagePort`.
- `SharedArrayBuffer` is still allowed for the decoded **audio sample buffer** if implementation needs zero-copy random access on the audio thread. The "no SAB" rule applies only to grain-event transport, not to immutable source data.

**Lookahead value:** one audio block (typically 128 samples = ~2.7 ms at 48 kHz) minimum, two blocks acceptable if implementation needs extra safety on the video side. The hard requirement is not "exactly one block"; it is "small enough to stay inside the audible note-on budget while keeping video grain state stable."

## 2. Grain DSP — pitch shifting & interpolation (where we explicitly exceed every reference)

All four references compromise on interpolation quality. Borderlands uses **linear** interpolation. Partikkel uses **linear** (`lrp`). Bencina recommends linear as the AudioWorklet baseline. Carlson does the same. **av-synth ships better than this** because it's the single most audible quality differentiator.

Spec:

1. **Default interpolator: 8-point windowed sinc** (Kaiser-windowed, β = 8.6 ≈ -100 dB stopband). Precomputed table of polyphase coefficients indexed by fractional position quantised to 1/256 (i.e. 256 phases × 8 taps = 2048 floats, ~8 KB). Per-sample cost: 8 multiply-adds.
2. **Fallback interpolator: 4-point Hermite** for high-density grain clouds where CPU pressure forces a downgrade. The granulator runtime picks Hermite automatically when `live voice count × pitch sum × interpolation cost` exceeds an empirically determined CPU budget. The user does not see this switch unless they open a diagnostic panel.
3. **Linear interpolation is forbidden** in shipped builds (this is a hard rule — Borderlands and partikkel both compromise here and it's what costs them perceptual quality at +12 semitones and above).
4. **Anti-alias filter when `pitch > 1.0`**: a one-pole IIR lowpass at `fs / (2 · pitch)` applied to the source read inside the grain voice. Cheap and removes the metallic whine that an un-filtered upward shift produces.
5. **Reverse playback** (`pitch < 0`): valid; index walks backwards through the source buffer; envelope unchanged. Borderlands supports this and it's musically essential.
6. **Pitch range**: ±48 semitones (4 octaves either way). Beyond that, behaviour degrades into "extreme stretch" territory and we don't fight it — but we don't actively prevent it either.
7. **Formant preservation**: NOT in v1. A WSOLA / PSOLA mode for vocal-class material is a stretch goal documented in §13. The default (natural pitch shift) is musically fine for the targeted use cases (loaded video audio is typically not pristine vocal solo).

## 3. Envelope shapes — the ship list

Combining the lists from Borderlands' `Window.cpp` (HANNING, TRIANGLE, EXPDEC, REXPDEC, SINC), Bencina's recommendations (Hann, Gaussian, Tukey, Trapezoidal), and partikkel's table-driven ADSR:

**v1 ship list (precomputed lookup tables, length 2048 each, linearly interpolated at read time):**

| Window | Formula | Use |
|---|---|---|
| `hann` | `0.5 * (1 - cos(2πn/N))` | Default. General-purpose, click-free. |
| `tukey-25` | flat top with 25% Hann fade in/out | Preserves spectral content of longer grains; good for held material. |
| `gaussian` | `exp(-((n-N/2)/(0.4N))²)` | Smoothest crossfades for high-overlap clouds. |
| `expdec` | `exp(-n/(N/4))` with 48-sample tail | Percussive grains; "plucked" feel. |
| `rexpdec` | time-reversed `expdec` | Backwards swell; "reverse-hit" feel. |

Sinc-shaped envelope (from Borderlands' SINC option) is **dropped** — it introduces side-lobes the user perceives as ring-modulated artefact, not feature.

**Why precomputed tables not on-the-fly math**: amortises the cost across grain voices, removes `exp` / `cos` from the hot path, makes the renderer fully branchless per envelope choice.

**Per-grain envelope choice**: the granulator UI exposes the envelope shape as a single selector, applied to all grains in a cluster. Per-grain envelope variation is partikkel territory and is cut from v1 (see §10).

**Attack/decay note**: there is **no separate attack/decay control in v1**. Envelope asymmetry is expressed by choosing `expdec` or `rexpdec`; if later listening tests prove that a continuous asymmetry control is musically essential, that is a spec amendment, not an implicit add-on.

## 4. Grain scheduling — modes (lifting Granulator III's three-mode taxonomy)

Henke's Granulator III ships three grain modes — `Classic`, `Loop`, `Cloud`. We adopt the same taxonomy because it maps cleanly to the underlying scheduler behaviour and is already familiar to most users:

| Mode | Scheduler behaviour | Source position behaviour | Typical use |
|---|---|---|---|
| **classic** | Synchronous, fixed density (grains/sec). | `position` advances at `source-rate × pitch`. | Time-stretch / pitch-shift the loaded clip while preserving its temporal evolution. |
| **loop** | Synchronous. | `position` is locked (manual scrub via MIDI / UI / LFO). | Held-pitch playback at one moment of the source; the "freeze" mode. |
| **cloud** | Asynchronous (Poisson-jittered). | `position` either locked or LFO-modulated; per-grain position jitter spreads grains around it. | Borderlands-style textures, ambient clouds, async density modulation. |

**Implementation note**: these are not three engines — they're three sets of defaults on the same scheduler. Switching modes only changes the scheduler's density-jitter and position-lock behaviour; the voice pool and renderer don't care.

**Sync source**: `AudioContext.currentTime` is the master, per B §2.1. Grain start times are quantised to sample positions (sample-accurate scheduling, B §2.1). Sub-block scheduling is supported: a grain whose start time falls mid-block is rendered from its exact sample offset, not the next block boundary.

**`distribution` parameter** (lifted from partikkel): in cloud mode, `distribution` controls the variance of the Poisson jitter applied to inter-grain intervals. `0` = synchronous (degenerate cloud → classic-like), `1` = maximum jitter (fully Poisson).

**MIDI-triggered mode**: orthogonal to `classic`/`loop`/`cloud`. When MIDI is connected, every note-on can either spawn a single grain (short-trigger mode) or open a grain stream that runs until note-off (sustained mode). User-selectable; defaults to sustained.

> **Implementation note (2026-05-23):** the spec-stated default is sustained, but the current implementation defaults to **triggered (short-trigger)** mode — `MidiRouter` calls `sink.triggerNoteOn?(pitchSt, velocity)` when the sink supports it, and a worklet `noteOn` message spawns one immediate grain at the held pitch with velocity-baked per-grain gain. Sustained mode survives only as a fallback for mock sinks (e.g. `RecordingSink` in tests) that do not implement `triggerNoteOn`. See `memory.md` 2026-05-22 entry "Triggered mode does NOT touch the `gain` AudioParam." The default-mode polarity vs spec is a known discrepancy parked pending UI-level mode-select work; flip the spec or flip the default before §13 sign-off.

## 5. Voice management

**Pool size**: 32 voices default, 64 max (configurable). Pre-allocated at worklet construction; zero allocation in `process()`. This is a hard rule (`plan.md` §14.5 / §14.14).

**State per voice** (struct of typed array slots, NOT objects):
- `active: Uint8Array`
- `start_sample: Int32Array` (sub-block-accurate start)
- `position_samples: Float32Array` (fractional source read position)
- `pitch: Float32Array`
- `duration_samples: Int32Array`
- `samples_elapsed: Int32Array`
- `envelope_idx: Uint8Array` (which envelope LUT to read)
- `pan_l: Float32Array`, `pan_r: Float32Array`
- `jitter_seed: Uint32Array` (xorshift state)
- `voice_id: Uint32Array` (shared with video twin)

This SoA layout is **not** how Borderlands or partikkel does it (both use object pools / linked lists), but it's the right shape for a tight AudioWorklet hot loop — V8 / JSC keep typed arrays in TLAB and access is branchless.

**Voice stealing**: when all 32 are active and a new grain arrives, steal the voice with the **oldest start_time** (FIFO). Apply a 64-sample fade-out on the stolen voice's envelope to avoid the click. This is more aggressive than Borderlands (which queues / drops the trigger via `awaitingPlay`) but more musical than partikkel (which kills oldest without fade). The fade-out length matches the smallest grain we allow, so it's never longer than the grain it cuts off.

**Voice ID synchronisation**: the audio voice and its video twin share a `voice_id`. The scheduler hands the same ID to both pools on grain trigger. This is the canonical anti-desync rule — never trust separate counters.

## 6. Parameter model — what we ship vs cut

Distilled from partikkel's 33 parameters down to a UI surface a user can hold in their head. Anything not on this list is **cut**.

### Shipped controls (the user UI surface)

| Control | Range | Default | Maps to |
|---|---|---|---|
| `position` | 0.0 – 1.0 of source length | 0.5 | sample read offset (audio) + frame read offset (video) |
| `position_jitter` | 0 – 1 (normalised window around position) | 0 | uniform random ± offset per grain |
| `pitch` | -48 to +48 semitones | 0 | resample ratio `2^(pitch/12)` |
| `pitch_jitter` | 0 – 24 semitones | 0 | uniform random ± per grain |
| `duration` | 5 – 2000 ms | 80 ms | grain window length |
| `duration_jitter` | 0 – 1 | 0 | uniform random ± per grain |
| `density` | 0.1 – 200 grains/sec | 20 | grain spawn rate (classic/loop); mean rate (cloud) |
| `distribution` | 0 – 1 | 0 | Poisson jitter on inter-grain interval (cloud mode) |
| `envelope` | one of `hann` / `tukey-25` / `gaussian` / `expdec` / `rexpdec` | `hann` | per-grain envelope LUT |
| `pan_spread` | 0 – 1 | 0 | per-grain random stereo pan width |
| `y_spread` | 0 – 1 | 0 | per-grain random video y-offset width (audio: mid/side ratio) |
| `reverse_probability` | 0 – 1 | 0 | per-grain probability of `pitch < 0` |
| `voice_count` | 1 – 64 | 32 | max concurrent voices |
| `mode` | `classic` / `loop` / `cloud` | `classic` | scheduler behaviour preset |

That's **14 controls**. Granulator II ships with ~15. Borderlands with ~10. Partikkel exposes 33 (most are GEN tables that no end user touches). This is the right number.

**Authoritative surface rule**: this 14-control list is the shipped granulator surface. If `plan.md`, `todo.md`, or UI sketches mention `attack/decay`, omit `distribution`, or introduce extra synthesis controls, those docs are stale and must be rewritten to match this table before implementation proceeds.

### Cut from partikkel (and not coming back unless usage data demands it)

- **Trainlet / DSF synthesis** (partikkel waveform slot 5): adds bell/metallic timbres synthesised from a discrete-summation formula. Beautiful for academic exploration, miscellaneous for a video-coupled granulator. Cut.
- **Per-grain FM modulation** (partikkel `fm`, `fm_indices`, `fm_env`): audio-rate FM applied inside each grain. Strong effect but breaks the granulator UX model (it's a synth-within-a-synth). Cut.
- **Multiple wavetable sources cross-faded** (partikkel `waveform1..4` + `waveamps`): not useful when our source is always one loaded video.
- **Frequency sweep per grain** (partikkel `wavfreq_startmuls`, `wavfreq_endmuls`, `freqsweepshape`): glissando-within-grain. Niche; can be approximated by per-grain pitch jitter at high density. Cut.
- **GEN table masks for per-grain parameter shaping** (partikkel's `gainmasks`, `channelmasks`, etc.): the most theoretically powerful feature of the unified model but requires UI for editing arbitrary distributions per parameter. Replace with uniform random jitter on each parameter. Add masks later only if a concrete need emerges.
- **8-channel routing**: out of scope — av-synth is stereo. Stereo + optional headphone-binaural may be added later as a separate mix bus.
- **Sub-sample grain start phase correction**: keep grain starts quantised to sample boundaries. The 4-byte alignment cost is < 0.01 ms at 48 kHz, well below perceptual threshold.
- **`partikkelsync` / `get` / `set` companion opcodes**: external sync mechanism, irrelevant in a single-app web context.

### Cut from Borderlands (and why)

- **Cloud orientation and SoundRect rotation**: Borderlands lets users rotate the audio rectangles 90°. We have one source (the loaded video). No orientation choice.
- **Multi-quad polyphonic mixing** (Carlson §3.2.2 — a grain voice that spans multiple overlapping audio rectangles weight-mixes them by spatial position): elegant, but it's an out-of-scope generalisation for v1 (only one video loaded). **Worth revisiting in v2** when multi-clip loading lands — the natural extension is two overlapping video clips with a grain voice that crossfades between them based on position. Track in the v2 backlog.
- **Pitch LFO inside the cluster** (Borderlands' `pitchLFOAmount`, `pitchLFOFreq`): redundant with the global LFO bank already in av-synth (`src/core/mod-bank.ts`). Use the global LFOs.

## 7. Per-grain randomisation

Mechanism: each voice gets an `xorshift32` PRNG with a unique seed (incremented per spawn from a master seed). Uniform random ± of the relevant `_jitter` parameter is applied to: position, pitch, duration, pan, x/y offset, reverse flag.

**Why xorshift not `Math.random()`**: deterministic per-voice (for repeatable QA), branch-free, no allocations. State fits in a 4-byte slot in the voice's typed-array struct.

**The identical-statistics rule (the AV coupling claim)**: per-grain random offsets use the **same seed** for the audio voice and its video twin. So a "scattered" cloud sounds scattered across the stereo field *and* looks scattered across the canvas, with identical statistics. This is non-negotiable — it is the perceptual heart of the AV coupling claim and any implementation that quietly weakens it (e.g. by seeding the two pools independently) regresses the product.

## 8. Spatial / stereo handling

**Audio**: per-grain pan in [-1, +1]; randomised uniformly within `±pan_spread`. Constant-power panning law: `L = cos(θ)`, `R = sin(θ)` where `θ = π(pan + 1)/4`. Centre = -3 dB per channel.

**Video**: per-grain (x, y) canvas offset, randomised uniformly within `±pan_spread` horizontal and `±y_spread` vertical. Offsets in normalised canvas units [-1, +1] from centre. Same seed as the audio pan random (identical-statistics rule, §7).

**`y_spread` on the audio side** (since audio is stereo, not 3D): repurposed as mid/side balance. `y_spread = 0` ⇒ pure mid (mono-summed grain), `y_spread = 1` ⇒ pure side (decorrelated, max width). Documented as a deliberate design choice in the granulator UI tooltip.

## 9. AV coupling — the video grain twin (extending Carlson's spatial model)

Borderlands maps each grain voice to a small visible circle that pulses red on trigger over a 2D field of audio-file rectangles. av-synth's twist: the field is **a video clip's frame texture ring**, not a flat audio-file landscape. The video twin renders for each active voice:

- A textured quad at the voice's (x_offset, y_offset) canvas position.
- Sampling the source texture array slice at `frame_index = round(position + samples_elapsed × pitch × video_fps / audio_fs)`.
- Alpha-modulated by the **identical envelope LUT** the audio side is using, indexed by `samples_elapsed / duration_samples`.
- Composited into the grain-engine output FBO via additive or `over` blend (configurable; default `over`).
- The grain composite FBO is then the input to the existing Hydra-style FX rack (`plan.md` §1–§7).

**Memory model**: pre-decoded RGBA8 2D texture array, hard cap 1.5 GB (per `plan.md` §14.3, Strategy A). WebCodecs streaming for longer sources is deferred to the desktop phase.

**User-facing load rule**: the web build only accepts clips that fit under the texture-ring cap after clamp-to-720p sizing. At 720p/30 fps this is roughly "short-form footage only" — on the order of low tens of seconds, not minutes. If the estimate exceeds the cap, load is refused with a clear message instead of degrading into partial decode or hidden frame dropping.

**Per-frame quantisation of `frame_index`**: video runs at ~30/60 fps while audio runs at 48 kHz, so the video frame index will hold the same value for several audio sample iterations. This is correct behaviour — the visual grain is the temporal-display equivalent of the audio grain's spectral content. We do not need sub-frame interpolation in v1 (and it would require an extra blend pass per voice that we can't afford for 32 voices at 30 fps).

**Why this is novel**: the cross-quad mixing trick from Carlson (one grain voice samples two overlapping audio rectangles) becomes, in our model, "one grain voice samples one video frame at one position." A future v2 with two loaded clips reactivates the cross-quad trick as a crossfade between two video sources. The architecture is ready for it.

## 10. Audio post-effect — the feedback delay (the only one)

After the granulator, before the master limiter, sits a single stereo feedback delay (`plan.md` §14.8). Spec recap with implementation detail:

- Stereo cross-coupled FDN: `L_out = a·L_dly + b·R_dly + dry_L`, `R_out = b·L_dly + a·R_dly + dry_R` where `a = feedback × cos(θ)`, `b = feedback × sin(θ)`, `θ` configurable (0 = pure feedback, π/4 = pure ping-pong, π/2 = swap).
- Delay time: 5 ms – 4 s, BPM-syncable.
- Feedback: 0 – 0.99 (hard ceiling under unity).
- Damping: one-pole lowpass in the feedback path, 200 Hz – 20 kHz cutoff.
- The `feedback` value is **the** shared AV-feedback control — same normalised value drives video FBO recursion depth in the Hydra FX rack's feedback operators. This is the only audio post-effect we ship; feedback's universality across both domains is the reason it earns the slot.

Stylistic decision: this is **not** a reverb. Don't accidentally make it one by exposing too many time/diffusion parameters. The exposed controls are: `time`, `feedback`, `damping`, `cross` (the θ above), `mix`. That's it.

## 11. MIDI / MPE input

Per `plan.md` §14.7, recapped here in implementation terms:

- Web MIDI API. Auto-detect on app boot; surface a "MIDI: <device name>" indicator in the granulator UI.
- **Note-on** → grain trigger. Note pitch sets the `pitch` parameter (relative to root, default A2 = MIDI 45). Velocity sets per-grain amplitude (gamma-corrected: `amp = (velocity/127)^0.7`).
- **Note-off** → ends grain stream if in sustained mode; ignored in short-trigger mode.
- **MPE**: per-note pitch bend → per-grain pitch microtonal offset. Per-note channel pressure → per-grain density multiplier (more pressure, denser cloud). Per-note CC74 (timbre) → per-grain position jitter (more timbre, more scatter). These three defaults match Henke's Granulator III mappings; we don't claim originality, we adopt the convention.
- **CC routing**: every shipped granulator control supports MIDI-learn. Right-click control → "Learn MIDI" → wiggle the controller → bound. Unbind via the same menu.
- **Latency budget**: note-on event → first audible grain sample ≤ 5 ms. Measured by the QA harness (see §13).

## 12. Performance budget

| Operation | Target | Notes |
|---|---|---|
| Single voice render (8-tap sinc, 128 samples) | ≤ 30 µs | One pass: 8 mul-adds × 128 samples + envelope read + accumulate. On a 2020 MBP. |
| 32 voices, classic mode, 20 grains/sec | ≤ 1 ms total per block | Well under the 2.67 ms block budget. |
| 64 voices, cloud mode, 100 grains/sec | ≤ 2 ms total per block | Hermite fallback may kick in. |
| Video composite at 32 voices, 720p | ≥ 30 fps | One draw call per voice, alpha-modulated quad. |
| Note-on → first audio sample | ≤ 5 ms | MIDI input + scheduler + worklet block. |
| Worklet `process()` allocations | 0 | Verified by soak test (see §13). |

Numbers are targets, not measured. The first implementation pass should benchmark against these and we update this table with reality.

## 13. Quality acceptance (cross-reference with plan.md §14.9 and §14.10)

The granulator does not ship until **all** of the following pass:

1. **Listening-test panel** (`plan.md` §14.9): ≥ 2 reviewers compare av-synth granulator vs Granulator II on identical source material (the committed `qa/fixtures/granulator-source-stereo-48k.wav`). av-synth must be rated *equivalent or better* on (a) artefact-freeness, (b) musicality at ±12 / ±24 semitones, (c) cloud density stability at 100+ grains/sec, (d) parameter feel. Results logged as a Markdown review in `qa/reviews/granulator/`.
2. **Video grain accuracy** (`plan.md` §14.10): frame-accurate scrubbing; ≥30 fps at 720p with 32 voices; video grain onset and envelope phase stay aligned with the audio side to within one rendered frame plus one audio block. Do not phrase this as a 3 ms visual requirement — the browser cannot present pixels on that timescale.
3. **MIDI latency**: note-on → first audible grain measured ≤ 5 ms in the audio path. Browser-visible video response is judged separately under the video-grain accuracy gate, not by the same 5 ms threshold.
4. **Zero-allocation soak test**: granulator runs at 64 voices for 4 hours; Chrome DevTools Performance trace shows zero major-GC events attributable to the granulator worklet.
5. **CPU**: 32 voices at 8-tap sinc holds under 20% of one core on the reference machine (2020 MBP).
6. **True-peak compliance**: at any combination of granulator + feedback delay settings, the master bus measures ≤ 0 dBFS true-peak. The brick-wall limiter is the safety net, not the design.

Failure of any one of these is a release block.

## 14. What this spec explicitly excludes

- Spectral processing (FFT freeze, spectral morph). Granulation at long grain durations covers the same musical territory; no separate spectral engine.
- Wavefolders, saturators, EQs as user-facing effects. Master bus has a limiter; that's it.
- Reverb, chorus, flanger, phaser as separate effects. The feedback delay covers the AV-coupled use case; the granulator's own jitter + LFO modulation cover chorus-like spread.
- Per-grain envelope segmentation, per-grain frequency sweeps, per-grain FM. See §6 cut list.
- A "browse / preset" UI surface within the granulator. Use the existing `public/presets.json` mechanism — granulator state is just more parameters in a program snapshot.
- Multi-clip loading (deferred to v2). The architecture leaves room — see §9 cross-quad note.
- Native plugin host (VST/AU). Out of product scope.

## 15. Sequencing / implementation roadmap

Suggested order; not load-bearing:

1. `references/granulator-port-spec.md` (this file) reviewed and signed off by Marc. The spec is the contract.
2. `src/audio/worklets/granulator.js` skeleton — pool, scheduler integration, hann envelope only, temporary linear interpolation if needed. Goal: hear *some* granulation of the loaded clip's audio. This step is architecture validation only and is **not** eligible for release QA or "done" status.
3. Swap linear → 8-tap windowed sinc. Listening test #1 against Granulator II on a single held tone. Tune until parity.
4. Add envelopes (all 5), modes (all 3), full parameter list. Listening test #2 with the curated source.
5. `src/video/grain-buffer.ts` — texture ring decode-on-load. Hard cap at 1.5 GB. Render the loaded clip as a static texture array first to verify the upload path.
6. Video grain compositor pass — twin voices alpha-modulated by the same envelope LUT as the audio side. Visual smoke test: a single grain voice should appear as a fading quad at the right canvas position with the right envelope shape.
7. Cross-coupled stereo feedback delay. Verify the shared-feedback law against the existing Hydra FX feedback operators.
8. `src/core/midi.ts` — Web MIDI input + MPE. MIDI-learn UI on each control.
9. Full quality gate sweep per §13.
10. One curated demo program in `public/presets.json` exercising end-to-end (granulator + video twin + feedback delay + FX rack).

## 16. Open questions parked for later

These are real, just not blocking v1:

- **Granulator II calibration scope**: which Granulator II preset(s) constitute the listening-test baseline? Default factory probably; defer until §15 step 3.
- **Formant-preserve mode** (WSOLA / PSOLA): when does vocal-class material make it worth the implementation cost? Park.
- **Texture ring decode strategy for longer sources** (WebCodecs streaming): scheduled for the Electron + WebGPU desktop phase per `plan.md` §13.
- **Cross-clip mixing**: when v2 supports two simultaneous video sources, the Carlson §3.2.2 mixing trick reactivates. Park.
- **Granulator state import**: can we read a Granulator II preset (`.adv` Ableton device preset) and translate its parameter set into ours? Probably yes for the obvious controls (position, pitch, duration, density); skip jitter mappings that don't map 1:1. Park; not load-bearing.
