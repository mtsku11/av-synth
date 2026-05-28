# plan.md — Hydra API ↔ audio-domain mapping

This file is the mathematical spec for every operator in av-synth. For each Hydra primitive it defines:

1. **Hydra signature** — name, parameters, defaults, brief semantics.
2. **Video math** — what the GLSL does, in one line.
3. **Audio analogue** — the audio-domain operator that performs the *same operation on the same kind of mathematical object*, with parameters mapped through a fixed relationship.
4. **Coupling spec** — the shared control input (`c ∈ [0, 1]` unless stated) and how it maps to both domains.
5. **Status** — `present` (in the 999-line HTML prototype), `partial`, or `todo`.

The guiding principle: **Hydra is a 2D field calculus.** Sources are scalar/vector fields over `(x, y, t)`. Geometry ops act on the UV chart. Color ops act on the codomain. Blend ops combine fields. `modulate` is the substitution of one field into another's domain — i.e. function composition. Audio is the same calculus restricted to 1D over `t`. The mapping is therefore not metaphor, it is dimensional reduction.

The single base relationship that ties spatial frequency to temporal frequency throughout this document is:

> **`f_audio (Hz) = baseFreq · f_spatial (cycles per screen-width)`**

where `baseFreq` is a global musical anchor (default 110 Hz = A2, exposed in transport). Hydra's `osc(60)` therefore sounds at `60 × 110 / 60 = 110 Hz` if we treat 60 cycles-per-screen as the unit, or — more usefully — `osc(60)` maps to **60 Hz** directly if we set `baseFreq = 1 Hz/cps`. The unit choice is a transport-level decision exposed in `core/clock.ts`. Default: `osc(N)` → `N Hz` (intuitive, matches user intent).

Time is the second axis:

> **`t_audio = t_video`** — both renderers use the same `currentTime` clock. The audio context's `currentTime` is the master; the video loop reads it.

---

## 0a. Product redirect (2026-05-21) — granulator-first instrument

The product direction has been narrowed. av-synth is now a **dual-domain granulation instrument with an HD video FX rack**, not a one-to-one Hydra mirror.

- The **core engine** is a shared-playhead granulator that scrubs a loaded video clip's **audio buffer** and its **frame texture ring** in lockstep. One grain event triggers an audio grain and a video grain with the same position, pitch, duration, envelope, and jitter. Spec lives in §14.
- The **audio user-facing surface collapses** to: granulator + feedback delay + master limiter. Nothing else. The granulator must be *really good* — M4L MPE Granulator II is the quality benchmark.
- The **video user-facing surface stays Hydra-shaped**: §1–§7 (sources, geometry, color, blend, modulate, output, sequence) remain valid as the **post-granulation FX rack** that runs after the video grain engine. They are no longer paired with audio analogues.
- The **"every Hydra op has an audio twin"** principle from the original framing is **retired**. §1–§5 audio-analogue tables are kept in this document as *design rationale and modulation law reference*, not as a build target. Only the granulator and feedback delay are shipped audio operators.
- The **global LFO bank** and **MIDI input** are the AV coupling fabric. Slow modulation runs through LFOs; per-grain triggers run through MIDI. Both drive both domains.
- **WebGPU + Electron desktop phase (§13)** is unchanged. The video grain engine is feasible on WebGL2 for the web build; WebGPU's compute shaders only become essential when the FX rack reaches TouchDesigner-class effects.

**What changes elsewhere in this doc:**
- §8 (audio input FFT) is demoted to "analyser tap for video reactivity," not a primary audio operator surface.
- §10.4 / §10.5 / §10.7 (release tracks) need re-staging around granulator delivery and quality, not Hydra-op completion. The §10.5 audio rack (`grain cloud`, `fold plus`, `freeze smear`, `self mod bus`, `tone focus`, `space duck`, `window replay`) is superseded by §14: the rack collapses to a single granulator engine + feedback delay.
- §12.4 (`grain` as a planned op) is **promoted and superseded** by §14. It is no longer a future operator; it is the engine.
- §12.1 / §12.2 / §12.3 / §12.5 (`blur`, `flux`, `selfMod`, `foldPlus`) are **dropped from the shipped audio surface**. `flux` survives as a video-derived modulation feature (still useful as an LFO source).

**What does not change:**
- The video operator spec (§1–§7) and its math.
- The coupling-layer architecture in `src/core/coupling.ts` — it still normalises params; it just maps fewer audio targets now.
- The QA stack (§10.5 / §10.6) — gates still apply, but the operator-family audit gate now applies to the video operator set only, with a parallel granulator-specific quality gate defined in §14.9.
- The desktop phase (§13).

---

## 0. Globals

| Token | Hydra | Audio analogue | Coupling |
|---|---|---|---|
| `time` | seconds since start | `AudioContext.currentTime` | Identity; audio is the clock. |
| `bpm` | beats per minute | transport BPM | Identity. Drives sequencer + `.fast(n)` modifier. |
| `speed` | global time multiplier | master clock rate | Identity. Multiplies every operator's internal phase accumulator equally. |
| `width / height` | canvas pixels | sample rate / channel count | Not coupled — frame-rate-independent design. |
| `mouse` | normalised pointer | last-touched controller | Identity if a controller is bound. |

Status: `todo` (none of this exists in the prototype except an implicit time accumulator).

---

## 1. Sources

Sources generate fields without input. In audio terms: oscillators / noise generators / synthesis primitives.

### 1.1 `osc(frequency=60, sync=0.1, offset=0)`

- **Video**: `colour = 0.5 + 0.5 · sin(x · 2π · freq + t · sync + channelOffset)` with R/G/B given phase offsets of `0, offset, 2·offset`.
- **Audio analogue**: **three detuned sinusoidal oscillators** summed in mono (or split L/M/R) at frequencies `f, f·(1+δ), f·(1+2δ)` where `δ = offset · maxDetune` (default `maxDetune = 0.005`, ~5 ¢ per channel).
- **Coupling**:
  - `frequency` → `f (Hz)` directly (default map `1 cps = 1 Hz`, configurable).
  - `sync` → temporal drift in cps → audio frequency drift: `f(t) = f₀ · (1 + sync · t / T_drift)` (slow LFO on pitch, T_drift = 60 s).
  - `offset` → R/G/B phase offset (radians) ↔ stereo decorrelation / chorus detune.
- **Status**: `todo` (video only). The audio side replaces the prototype's video-source-only path.

### 1.2 `noise(scale=10, offset=0.1)`

- **Video**: 2D simplex noise sampled at `(x · scale, y · scale, t · offset)`.
- **Audio analogue**: **band-limited Perlin/simplex noise**, evaluated 1D at sample rate, with `scale` controlling the *temporal* frequency of the noise process (1D noise has no spatial axis to scale — but it has a characteristic frequency).
- **Coupling**:
  - `scale` → in video this sets cycles-per-screen of the noise. In audio it sets the noise's characteristic frequency in Hz. Same `f = baseFreq · scale` law as `osc`. **Result**: zooming the visual noise grain = sweeping the audio noise's cutoff equivalent. This is mathematically the same operation: a frequency scale.
  - `offset` → in video, animation rate of the noise. In audio, the *evolution* rate of the noise generator's internal seed (low-frequency wandering). Mapped at `1:1` to a low-frequency modulation of the noise's spectral centre.
- **Status**: `todo`.

### 1.3 `voronoi(scale=5, speed=0.3, blending=0.3)`

- **Video**: distance to the nearest Voronoi cell centre; cells animate by `speed`; `blending` smooths cell boundaries.
- **Audio analogue**: **granular cloud**. Each Voronoi cell ↔ one grain.
  - `scale` (cells per screen) → grain density (grains/second). `density = baseFreq · scale`.
  - `speed` → grain envelope frequency (how fast each grain's amplitude evolves) and per-grain pitch jitter.
  - `blending` → grain envelope smoothness (Tukey window α from `0` = rect to `1` = full Hann).
- **Status**: `todo`.

### 1.4 `shape(sides=3, radius=0.3, smoothing=0.01)`

- **Video**: signed-distance polygon centred on the canvas.
- **Audio analogue**: **additive synth with a bandlimited polygonal waveform**. A polygon with `n` sides traced parametrically yields a periodic 1D signal whose Fourier series is dominated by harmonics `1, n+1, 2n+1, …` (this is Bromwich's polygon-Fourier result).
  - `sides` → harmonic spacing. `n = sides` → harmonic indices `k · sides + 1`.
  - `radius` → fundamental amplitude (level).
  - `smoothing` → lowpass cutoff that rolls off the high harmonics (smaller polygon corners ↔ less high content). Specifically `cutoff = baseFreq / smoothing`.
- **Status**: `todo`.

### 1.5 `gradient(speed=0)`

- **Video**: hue-cycling colour gradient across the canvas, animated by `speed`.
- **Audio analogue**: **spectral pan / filter sweep**. A gradient is a monotonic mapping over space; in audio the equivalent is a swept-resonance bandpass moving across the spectrum.
  - `speed` → sweep rate in Hz. `lfo = baseFreq · speed`. The bandpass centre frequency `f_c(t) = f_low · (f_high/f_low)^((sin(2π · lfo · t)+1)/2)` (log sweep).
- **Status**: `todo`.

### 1.6 `solid(r=0, g=0, b=0, a=1)`

- **Video**: constant colour.
- **Audio analogue**: **DC offset / steady tone**. Three sinusoids on R/G/B mapped to a fixed triad: R = `f₀`, G = `f₀ · 3/2`, B = `f₀ · 2` (fifth + octave), amplitudes equal to channel values, master gain = `a`.
- **Coupling**: each channel value `∈ [0,1]` → linear amplitude. `a` → master amplitude.
- **Status**: `todo`.

### 1.7 `src(o0..o3)`

- **Video**: read back from a render buffer. Enables feedback graphs.
- **Audio analogue**: **bus return / feedback send**. The four output buffers `o0..o3` mirror four audio buses; `src(oN)` in either domain takes the previous frame/block of bus N as a source.
- **Status**: `partial` (the prototype has a single feedback texture via `u_feedback`).

### 1.8 External sources — `s0..s3`, `initCam`, `initImage`, `initVideo`, `initScreen`

| Hydra | Audio analogue |
|---|---|
| `initCam(idx)` | `getUserMedia({audio: true})` mic input on the same MediaStream |
| `initVideo(url)` | `MediaElementAudioSourceNode` from the same `<video>` element |
| `initImage(url)` | static buffer (image-as-1D-row scanned at audio rate ↔ scanned-image audio synthesis, e.g. Coagula) |
| `initScreen()` | system audio capture (where browser permits) |

- **Status**: `partial` (prototype handles file-video for both audio and video, but only one source).

---

## 2. Geometry

Geometry ops act on the input field's domain (UVs). Audio analogue: they act on the input signal's *time index* — that is, on phase, delay, or time-scale.

### 2.1 `rotate(angle=10, speed=0)`

- **Video**: `uv → R(θ + t·speed) · uv` around centre.
- **Audio analogue**: **mid/side stereo rotation** (a 2×2 rotation matrix on `[L; R]`). Alternatively, **Hilbert-pair phase rotation** of an analytic signal (true single-sideband rotation of the spectrum).
  - `angle` → rotation angle in radians, applied identically to UV and to M/S vector.
  - `speed` → LFO rate on that angle.
- **Status**: `partial` (video only in prototype).

### 2.2 `scale(amount=1.5, xMult=1, yMult=1, offsetX=0.5, offsetY=0.5)`

- **Video**: `uv → (uv - offset) / (amount · [xMult, yMult]) + offset`.
- **Audio analogue**: **pitch / time scaling**. Scaling time by `1/k` scales periodic frequency content by `k` — exactly Hydra's video scaling reciprocity. Implementation: **resampler** (varispeed) on the source signal, ratio `= amount`. Asymmetric `xMult / yMult` → independent L/R pitch ratios (stereo detune).
  - `offsetX/Y` → delay-line offset for the scale-around-point.
- **Status**: `partial`.

### 2.3 `pixelate(pixelX=20, pixelY=20)`

- **Video**: quantise UVs to a grid → spatial downsampling.
- **Audio analogue**: **windowed resampling / held recent-time slices** on the shipped product path. Coarser image blocks read more convincingly as progressively longer held windows and slower recent-time replay than as naked sample-hold decimation once the effect is stacked with modulation, feedback, and finish passes.
  - `pixelX` → L-channel window size / replay coarseness; `pixelY` → R-channel window size / replay coarseness.
- **Status**: `present` (2026-05-21 product remap). The earlier decimation formulation remains a mathematically valid reference, but the live audio path now uses a dedicated windowed-resampling worklet because it yields a stronger block/hold abstraction in practice.

### 2.4 `repeat(repeatX=3, repeatY=3, offsetX=0, offsetY=0)`

- **Video**: `uv → fract(uv · [repeatX, repeatY] + offset)`.
- **Audio analogue**: **recent-time grain slicing / windowed resampling** on the shipped product path. Repeated image tiles read more convincingly as looping short recent-time slices than as a resonator when stacked with other effects. `repeatX/Y` shorten the capture window and raise reseed density; `offsetX/Y` bias slice position and stereo skew.
- **Status**: `present` (2026-05-21 product remap). The earlier comb-filter formulation remains a mathematically valid reference, but the live audio path now uses deterministic grain slicing because it yields stronger abstract repetition in practice.

### 2.5 `repeatX(reps=3, offset=0)` / `repeatY(reps=3, offset=0)`

- **Video**: 1-axis tile.
- **Audio analogue**: **axis-biased grain stutter / freeze**. `repeatX` emphasises a left-weighted recent-time slice texture; `repeatY` emphasises a right-weighted freeze/stutter texture. This preserves the directional feel of one-axis repetition without relying on thin comb coloration.
- **Status**: `present` (2026-05-21 product remap). The earlier feedforward/feedback-comb interpretation is superseded in the release-track audio surface by the stronger axis-biased grain textures.

### 2.6 `kaleid(nSides=4)`

- **Video**: polar fold — `mod(angle, 2π/n)` then mirror.
- **Audio analogue**: **wavefolder with n-fold symmetry**. A wavefolder maps `x → triangle_n(x)` where `triangle_n` reaches `n` peaks per input cycle; equivalently, hard-fold of the input around `n` thresholds.
  - `nSides` → number of folds per input cycle. Generates the same n-th-order harmonic structure that the visual `n`-fold rotational symmetry exhibits in 2D Fourier space.
- **Status**: `partial` (prototype has video `kaleid` + an audio waveshaper called "fold" — they need to be coupled mathematically rather than aesthetically).

### 2.7 `scrollX(amount=0.5, speed=0)` / `scrollY(amount=0.5, speed=0)`

- **Video**: translate UVs.
- **Audio analogue**: **phase-offset smear / stereo motion** rather than accidental pitch drift. A horizontal image translation is a spatial phase shift, so `scrollX` now uses a fixed fractional-delay branch whose offset depth follows `amount`; `speed` moves that offset layer laterally in stereo instead of modulating the delay time. `scrollY` remains the cleaner stereo-position / auto-pan side of the pair.
  - `amount` → fixed slip amount / pan position.
  - `speed` → tap-balance motion or auto-pan rate, not "secret pitch."
- **Status**: `present` (2026-05-20 refinement, updated same day). The original `scrollX` delay-time scrub was mathematically defensible but read too much like unintended vibrato in product use. The first correction moved to fixed taps; the current implementation tightens that further into a fixed phase-offset branch with stereo motion, so the effect reads as horizontal displacement rather than pitch wobble. `scrollY` remains stereo pan. `audit-scrollX-osc-sweep.json` stays manual on exported audio, but its expected listening target is now phase smear / motion rather than vibrato.

---

## 3. Color

Color ops act on the codomain — values, not coordinates. Audio analogue: they act on **amplitude** or on **spectral envelope** rather than on time.

### 3.1 `posterize(bins=3, gamma=0.6)`

- **Video**: `colour → floor(colour^gamma · bins) / bins`.
- **Audio analogue**: **bitcrush (amplitude quantisation)** with pre-emphasis `gamma`. Sample value `s → floor(sign(s) · |s|^gamma · 2^bits) / 2^bits`.
  - `bins` → `2^bits`. `bits = log₂(bins)`.
  - `gamma` → companding curve (pre-quantisation nonlinearity).
- **Status**: `present` (the prototype's `crush` is exactly this; called `u_crush`, but mapped only to a waveshaper bitcrush curve — the `gamma` parameter is currently absent and should be added).

### 3.2 `shift(r=0.5, g=0, b=0, a=0)`

- **Video**: hue shift per channel (additive).
- **Audio analogue**: **per-band single-sideband (SSB) frequency shift**. Split signal into low/mid/high bands, apply Bode-style frequency shift to each by `r/g/b` Hz. `a` → wet/dry of the shifted vs original.
- **Status**: Audio side is `todo`. The video side here describes the **full Hydra `shift`** (hue rotation per channel). The prototype's RGB *spatial-offset* effect (chromatic aberration) has been split off into a separate operator, `chromaShift` — see §3.14. Both ops will coexist in the public surface.

### 3.3 `invert(amount=1)`

- **Video**: `colour → mix(colour, 1 - colour, amount)`.
- **Audio analogue**: **phase invert with crossfade**. `s → mix(s, -s, amount)`. Indistinguishable on a single channel but produces nulling on summed channels — the audio version of the inverted-spectrum visual effect appears in M/S mixes.
- **Status**: `present` (2026-05-18). Identity at `amount = 0`, full invert at `amount = 1`. Sits in `DEFAULT_CHAIN`. Audited via `audit-invert-video-sweep.json` (manual-only — single-channel invert is inaudible and meanLuma deltas depend on fixture sign).

### 3.4 `contrast(amount=1.6)`

- **Video**: `colour → (colour - 0.5) · amount + 0.5`.
- **Audio analogue**: **upward expansion / soft-clip drive**. `s → tanh(s · amount) / tanh(amount)` keeps unity peak gain while steepening the transfer curve. Strictly: same affine-around-zero transform `s → s · amount`, then tanh saturate so it doesn't exceed [−1, 1]. (The `−0.5` shift in video reflects mid-grey; in audio mid is already 0.)
- **Status**: `todo`.

### 3.5 `brightness(amount=0.4)`

- **Video**: `colour → colour + amount`.
- **Audio analogue**: **gain offset**. `s → s · 10^(amount · 20/20)` if interpreted as dB, or `s → s + amount` if interpreted as DC. Default: gain in dB, `amount = 0` → 0 dB, `amount = 1` → +20 dB. DC offset is a separate operator (`bias`) — added in `todo`.
- **Status**: `todo`.

### 3.6 `luma(threshold=0.5, tolerance=0.1)`

- **Video**: soft luma key — pixels below `threshold` go transparent over `tolerance` width.
- **Audio analogue**: **noise gate with soft knee**. `gain = smoothstep(threshold - tolerance, threshold + tolerance, |s|)`.
  - `threshold` → gate threshold in linear amplitude (or dBFS depending on UI).
  - `tolerance` → knee width.
- **Status**: `present` (2026-05-18). Ships as `luma(threshold, tolerance, amount)` — a third wet/dry `amount` mix param is added so the op can sit in `DEFAULT_CHAIN` with identity at `amount = 0`. Hydra signature deviation documented in `memory.md` 2026-05-18 entry. The video shader premultiplies rgb by the key so meanLuma actually drops when engaged. Audited via `audit-luma-video-sweep.json` with hard gates on `meanLuma` and exported-WAV `meanVolumeDb`.

### 3.7 `thresh(threshold=0.5, tolerance=0.04)`

- **Video**: hard threshold to b/w.
- **Audio analogue**: **Schmitt-trigger / 1-bit comparator** — `s → sign(s − threshold)` with hysteresis `= tolerance`. Generates square-wave from a sinusoid; harmonic-rich.
- **Status**: `present` (2026-05-18). Ships as `thresh(threshold, tolerance, amount)` — a third wet/dry `amount` mix param is added so the op can sit in `DEFAULT_CHAIN` with identity at `amount = 0`. Hydra signature deviation documented in `memory.md` 2026-05-18 entry. Audio is a stateless waveshaper comparator; true Schmitt hysteresis is deferred to the M3 worklet pass. Audited via `audit-thresh-osc-sweep.json` with hard gates on `spatialStd` and exported-WAV `spectralCentroidHz`.

### 3.8 `color(r=1, g=1, b=1, a=1)`

- **Video**: per-channel multiplier (gain).
- **Audio analogue**: **3-band EQ**. R/G/B map to low/mid/high band gains (linear or dB). `a` → master gain.
- **Coupling**: this is the most explicit "RGB-as-3-band" coupling in the system. Bands are split at fixed crossovers (default: 300 Hz, 3 kHz). Documented in `coupling.ts`.
- **Status**: `todo`.

### 3.9 `saturate(amount=2)`

- **Video**: HSV saturation multiplier.
- **Audio analogue**: **harmonic soft-saturator** (asymmetric waveshaper). `drive = amount`; the curve is `f(x) = tanh(x) + 0.15·(1 − tanh(x)²)·x`, an asymmetric soft-clip combining symmetric tanh (odd harmonics, the main saturator character) with a small even-harmonic tilt (tube-like). At `amount = 0` the pre-gain mutes the signal — matches `grayscale` on video. At `amount = 1` the drive sits in the near-linear region of the curve so it's audibly clean — matches `identity` on video. As `amount` grows past 1 the curve nonlinearity engages progressively and the perceived loudness rises with the new harmonic content — matches `oversaturated / vivid` on video.
- **Why this differs from `contrast`**: `contrast` is a normalised unity-peak tanh (`tanh(s · amount) / tanh(amount)`) — dynamics-oriented, no level change as you push it. `saturate` is the **un-normalised** soft-clip with even-harmonic tilt — timbre-oriented, level *does* rise as you drive it, and even-harmonic content gives it the warmer "tube" colour that's the audio analogue of vivid colour reading more intensely. Keeping the two operators on different axes (dynamics vs timbre) is the disambiguation; both are tanh-based but solve different problems.
- **Status**: `present` (2026-05-19). Reassignment from the previous M/S stereo-width implementation (2026-05-16 → 2026-05-19) — see `memory.md` 2026-05-19 entry for the design rationale. Audited via `audit-saturate-video-sweep.json`; QA manualChecks were updated to listen for harmonic richness rather than stereo widening.

### 3.10 `hue(amount=0.4)`

- **Video**: HSV hue rotation by `amount · 2π`.
- **Audio analogue**: **constant-interval pitch shift** (preserves harmonic structure, rotates the entire spectrum on a log axis). `pitchRatio = 2^amount` (one octave per unit, slider unit `oct`). Alternative for cheap version: all-pass phase rotation (Hilbert transform with frequency-independent phase shift `amount · 2π`).
- **Status**: `present` (2026-05-18). Identity at `amount = 0` (the Hydra invocation default `0.4` will be applied by the M4 live-code adapter; our chain default is `0` so the op sits in `DEFAULT_CHAIN` neutrally). Video uses a hue-rotation matrix; audio reuses the `pitch-shifter` worklet introduced for `scale`. Pitch range clamped to ±1 octave. Audited via `audit-hue-solid-sweep.json` — hard gates are **live-only** (`meanR↓ ≥ 0.2` and `meanG↑ ≥ 0.2` between the 0 and 1/3 holds). The exported-audio side is **manual review only** (downgraded 2026-05-18 same day as initial ship): the solid source measures at the digital noise floor on the exported WAV (~-173 dB), so `zeroCrossingRate` and similar exported-audio metrics are quantisation-noise-driven rather than pitch-driven — the gate sign-flipped between two consecutive runs at identical settings. Same `solid-fixture noise-floor` precedent as `colorama` / `modulate` / `scrollX`; see `memory.md` 2026-05-18 rule entry.

### 3.11 `colorama(amount=0.005)`

- **Video**: chaotic per-pixel hue swap; visually a colour scramble that breathes over time. Each pixel's rotation is `amount · ((xPixel - 0.5) + (xGlobal - 0.5)) · 2π`, where `xPixel` is a logistic-map iteration seeded by a UV hash (spatial decorrelation, static for a pixel) and `xGlobal` is a logistic-map iteration seeded by `0.37` and stepped `floor(ctx.time · 5) + 1` times — the same scalar the audio carrier uses, so the temporal motion is shared. `amount = 0` is identity per pixel, so the op sits in `DEFAULT_CHAIN` neutrally.
- **Audio analogue**: **chaotic ring-modulation locked to the visual chaos**. Carrier is an `OscillatorNode` whose frequency is recomputed at each k-rate poll as `50 + xGlobal · 300` Hz, where `xGlobal` is the identical scalar the shader's loop produces from `ctx.time`. No free-running audio state — both domains derive their chaos from the same time-driven logistic sequence, which is the AV-coupling guarantee. Wet/dry mix is implemented by feeding `(1 - amount)` as the DC value of a `GainNode` whose `gain` AudioParam additionally receives `carrier × amount` — `amount = 0` is pure passthrough, `amount = 1` is pure ring-mod. Memory.md §11 resolves the map choice as **logistic** (predictable bifurcation, single-state, no worklet needed). Hydra's invocation default `0.005` is left to the M4 live-code adapter.
- **Status**: `present` (2026-05-18). Audited via `audit-colorama-solid-sweep.json` (hard live `spatialStd` gate ≥ +0.10 on the solid R=1 fixture — the GLSL is fully deterministic per-pixel from the UV hash so the visual scramble is rock-solid). The exported-audio side is **manual review only** because the solid source's exported-WAV spectral baseline jumps significantly across fresh browser sessions (observed centroid baseline 162 Hz → 287 Hz between runs); precedent is `audit-modulate-osc-sweep` and `audit-scrollX-osc-sweep` which also keep their exported-audio sides manual.

### 3.12 `sum(scale=[1,1,1,1])`

- **Video**: scalar `dot(rgba, scale)`.
- **Audio analogue**: **weighted recombination of the AV-matched analysis channels**. In the shipped product mapping, the same four weights recombine low / mid / high / envelope-contour branches rather than raw stereo channels, so `sum` reads like a true partner to `.r .g .b .a` instead of a generic mono button.
- **Status**: `present` (2026-05-21). Shipped as a product-facing weighted collapse operator with an added wet/dry `amount` parameter so the node can enter the public serial surface neutrally. On video it mixes the source toward a weighted grayscale/alpha sum of `rgba`; on audio it mixes toward a weighted recombination of the low/mid/high/envelope analysis branches. This is a deliberate product-signature deviation from raw Hydra syntax, for the same reason `luma` and `hue` carry neutral defaults in the shipped chain model.

### 3.13 Channel accessors `.r .g .b .a`

- **Video**: pick one channel as luminance.
- **Audio analogue**: **band-split + pick**. Pull one band from the 3-band split and route it forward.
- **Status**: `present` (2026-05-20). Implemented as paramless product-facing isolate operators rather than only as syntax sugar in a future live-code layer: `.r` maps to red-channel / low-band isolate, `.g` to green-channel / mid-band isolate, `.b` to blue-channel / high-band isolate, and `.a` to alpha-or-luma matte / envelope-contour isolate. On video they output grayscale-plus-alpha matte branches suitable for downstream `mask` / `layer`; on audio they expose the corresponding band/envelope slice.

### 3.14 `chromaShift(amount=0)` — av-synth original (not in Hydra)

- **Video**: RGB *spatial* offset (chromatic aberration). R and B channels are sampled at small UV offsets from G, producing the red/cyan fringing seen on cheap lens edges. `amount` in `[0, 0.08]` is the UV-fraction magnitude of the per-channel offset.
- **Audio analogue**: **Haas-style stereo decorrelation** (L-channel micro-delay). L is delayed by `amount · 0.25` seconds (up to 20 ms at `amount = 0.08`); R passes through. This is the temporal analogue of the visual operator's spatial signature: in the video domain you offset colour channels through *space*, in the audio domain you offset stereo channels through *time*. The shared mathematical structure is "delay one of N parallel channels relative to the others", which produces decorrelation in whichever dimension that channel-set spans (R vs G/B in 2D image space ↔ L vs R in 1D time). Below the Haas fusion threshold (~30 ms) the brain still localises to the earlier channel but the timbre/image widens — matching how chromatic aberration widens the perceived edge of an object without breaking object identity.
- **Why this is canonical, not the §3.2 SSB spec**: an earlier draft of plan.md speculated about an SSB per-band frequency shift for the aberration-style effect. We tried that mapping and rejected it: SSB shift collapses the harmonic structure of the source (every partial moves by the same Hz, destroying the natural geometric ratios between partials) and is audibly violent at any setting beyond a few Hz. The Haas decorrelation matches the *spatial-separation* semantics of the visual effect (R/G/B in different positions ↔ L/R at different times) without destroying the source, and at the amount-range we ship (≤ 20 ms) it sits below the fusion threshold. The fact that the visual side is *spatial decorrelation between channel groups* is the structural fact; SSB shift answers a different question (per-band Hz translation), which would only be right if the video were actually doing hue rotation, which §3.2 covers separately.
- **Status**: `present` (2026-05-18, mapping ratified 2026-05-19). Audited via `audit-chromaShift-video-sweep.json`. Identity at `amount = 0` (delay → 0, sits in `DEFAULT_CHAIN` neutrally). Possible future upgrade: replace the static delay with a slow LFO-modulated delay for a wide-chorus character; that variation is recorded in `memory.md` as an open follow-up.

---

## 4. Blend

Blend ops combine two fields. Audio analogue: signal arithmetic on two signals.

| Op | Video | Audio analogue | Coupling |
|---|---|---|---|
| `add(t, a=1)` | `c₁ + a · c₂` | `s₁ + a · s₂` (mixer) | Identity. |
| `sub(t, a=1)` | `c₁ - a · c₂` | `s₁ - a · s₂` (polarity-inverted mix) | Identity. |
| `mult(t, a=1)` | `c₁ · mix(1, c₂, a)` | `s₁ · mix(1, s₂, a)` — when `a=1`, **ring modulation**; when `a=0`, dry. | Identity. |
| `diff(t)` | `\|c₁ - c₂\|` | `\|s₁ - s₂\|` (full-wave rectified difference) | Identity. |
| `blend(t, a=0.5)` | `mix(c₁, c₂, a)` | **equal-power crossfade** between two sources: `cos(a·π/2)·s₁ + sin(a·π/2)·s₂`. | The non-linear crossfade is necessary in audio (linear sums to −3 dB at midpoint); declared deviation. |
| `layer(t)` | alpha composite over | **ducking / sidechain**: `s_out = s₁ · (1 - env(s₂)) + s₂`. Alpha ↔ envelope follower of the layered signal. | Document in `coupling.ts`. |
| `mask(t)` | `c₁ · luma(c₂)` | `s₁ · env(s₂)` — amplitude envelope of `s₂` modulates `s₁`. | This is the audio version of luma-key masking. |

Status for all: `todo`.

---

## 5. Modulate — function composition

This is Hydra's most important family because it expresses **function composition in the domain**: the value of one field becomes a *displacement* in another field's coordinates. In audio terms this is **frequency modulation, phase modulation, time-warp modulation** — and *every* modulator in audio synthesis is a special case of this idea.

The general form, in both domains:

> `output(p) = base(p + k · mod(p))` — where `p` is a coordinate (UV in video, time in audio), `k` is the modulation index, and `mod` is the modulating field.

### 5.1 `modulate(tex, amount=0.1)`

- **Video**: `uv → uv + amount · tex(uv).rg`. UV displacement by the modulator texture's red/green channels.
- **Audio analogue**: **phase modulation (PM)**, which is the FM-synthesis algorithm. Reading from a delay line whose position is offset by another signal:
  `y(t) = base(t + amount · mod(t))`. When `base` is a sinusoid and `mod` is a sinusoid this is classical FM/PM with modulation index `β = amount · ω_mod`.
- **Coupling**: same `amount` parameter, same `mod` source, both domains. If the modulator is `noise(scale)` in video and audio, the visual UV jitter and the audio phase jitter share their characteristic frequency.
- **Status**: `present` (prototype implements video `modulate` with a sin/cos offset; the audio chain has a delay-time LFO that *resembles* this but isn't wired to the same source. Needs to be properly coupled.)

### 5.2 `modulateRotate(tex, multiple=1, offset=0)`

- **Video**: rotate UVs by `multiple · tex.r + offset`.
- **Audio analogue**: **phase modulation in the M/S domain**. Rotate the M/S vector by `multiple · mod(t) + offset`.
- **Status**: `present` (2026-05-20 first shipped slice uses the previous frame as the video modulator and a signal-driven stereo rotation AudioWorklet on the audio side. That is enough to carry self-referential Hydra-style looks such as the Marianne port while the larger external-modulator family remains open.)

### 5.3 `modulateScale(tex, multiple=1, offset=1)`

- **Video**: scale UVs by `multiple · tex.r + offset`.
- **Audio analogue**: **modulated time-scale = pitch modulation** = **vibrato** in the small-amount limit. Drive a varispeed resampler from `mod`.
- **Status**: `present` (2026-05-20 product slice uses previous-frame red as the video modulator and the live audio signal as the self-modulator inside a dedicated pitch-shift worklet. This keeps the operator useful in the simplified serial UI without requiring explicit secondary-modulator routing.)

### 5.4 `modulatePixelate(tex, multiple=10, offset=3)`

- **Video**: pixelation amount driven by `tex`.
- **Audio analogue**: **modulated windowed resampling / held recent-time replay** — the replay window varies with the modulator instead of literal sample-rate reduction. This keeps the audio side in the same product vocabulary as `pixelate` while preserving Hydra's "pixelation amount driven by `tex`" law.
- **Status**: `present` (2026-05-21 remap). The shipped slice still uses previous-frame luma/red on video and live-signal amplitude on audio, but the audio side now drives a buffered held-window replay process around a base `offset` resolution instead of the older held-sample decimator.

### 5.5 `modulateRepeat(tex, repeatX=3, repeatY=3, offsetX=0.5, offsetY=0.5)`

- **Video**: repeat counts driven by `tex`.
- **Audio analogue**: **modulated comb-tap count** — number of taps varies. Cheap implementation: modulated single-tap delay = **chorus / flanger** (when `repeat` ≈ 1) or **tape-stop** (when `repeat → 0`).
- **Status**: `present` (2026-05-20 product slice uses previous-frame RGB as the repeat-count modulator on video and a live-signal-driven bpm-locked self-comb on audio. It is intentionally unary/self-modulated in the public UI.)

### 5.6 `modulateScrollX(tex, scrollX=0.5, speed=0)` / `modulateScrollY`

- **Video**: pan driven by `tex`.
- **Audio analogue**: **modulated pan / modulated delay tap** — auto-pan whose position is set by the modulator.
- **Status**: `present` (2026-05-20 product slice: `modulateScrollX` uses previous-frame red / live-signal amplitude to drive a moving phase-offset layer; `modulateScrollY` uses previous-frame green / the live signal to drive stereo position. Both retain the signed `speed` drift term.)

### 5.7 `modulateKaleid(tex, nSides=4)`

- **Video**: kaleid amount driven by `tex`.
- **Audio analogue**: **wavefolder drive modulation** — fold count or fold gain modulated by `mod`. This produces dynamically evolving harmonic content keyed to the modulator.
- **Status**: `present` (2026-05-20 product slice uses previous-frame red and live-signal amplitude to move between identity and the requested side/fold count. The public surface exposes `nSides` only, matching Hydra’s shape while keeping the simplified UI lean.)

### 5.8 `modulateHue(tex, amount=1)`

- **Video**: hue rotation driven by `tex`.
- **Audio analogue**: **modulated SSB shift** — frequency-shift amount varies with `mod`. Creates barber-pole / Shepard-tone-like glissandi when the modulator is a ramp.
- **Status**: `present` (2026-05-20 product slice keeps the video semantics literal and uses a self-modulated octave-ratio shifter on audio rather than a true SSB path. That is the current product compromise: coherent motion and musical behavior now, exact spectral-shift parity later if needed.)

### 5.9 Future routed `modulate*` family over explicit secondary inputs

- **Product stance**: the shipped `modulate*` family is intentionally unary/self-referential in the public patch surface, but the graph/runtime is already capable of true secondary-input routing and should eventually expose explicit routed `modulate*` variants through the narrow routing UI and built-in programs.
- **Scope**: start with routed versions of Hydra’s core family — `modulate`, `modulateRotate`, `modulateScale`, `modulatePixelate`, `modulateRepeat`, `modulateScrollX/Y`, `modulateKaleid`, `modulateHue` — and allow one app-specific displacement-first variant such as `modulateDisplace` if it better serves the product than strict Hydra parity.
- **Important rule**: the second input is not limited to geometric textures. Routed modulators may be previous-frame buses, `src(oN)` returns, luma/matte branches, channel isolates, color fields, or other finish/control branches whenever those produce a stronger abstract result than geometry-only warping.
- **Status**: `partial` (2026-05-21 routed-program slice). `modulateDisplace` opened the routed track, and explicit two-input companions `modulateRouted`, `modulateRotateRouted`, `modulateScaleRouted`, `modulatePixelateRouted`, `modulateRepeatRouted`, `modulateHueRouted`, and `modulateScrollYRouted` now ship for program/advanced-use cases with real secondary branches on both video and audio. The original `modulate`, `modulateRotate`, `modulateScale`, `modulatePixelate`, `modulateRepeat`, `modulateHue`, and `modulateScrollY` remain intentionally unary/self-modulated in the default product surface so existing QA and simple patch use do not silently change semantics.
- **Program QA policy**: tighten metric assertions only for Hydra-port programs that survive the product pass as stable authored looks. `Pixelscape`, `Acid Bus Seat`, and `Glitchy Slit Scan` now qualify because their routed-scale / routed-pixelate rebuilds produce repeatable motion deltas over the shipped fixture, while the remaining ports can stay smoke-only until they need stricter protection.

---

## 6. Output & buses

| Hydra | Audio analogue |
|---|---|
| `.out(o0)` | route the chain's output to audio bus 0 (4 buses total: `o0..o3`, master-summed by default). |
| `render(o0..o3)` | display/route all four buses simultaneously (audio: monitor all four sub-mixes). |

Status: `present` (2026-05-19: explicit `o0..o3` sink routing is live in the graph/runtime, audio master-sums all active bus sinks, `src(oN)` resolves against real per-bus history in both domains, the UI can select the monitor bus, and the shell exposes a compact `render(o0..o3)` quad monitor).

---

## 7. Array / sequence modifiers

Hydra accepts arrays anywhere a number is expected; arrays sequence over time. The same modifier set must apply to audio parameter automation.

| Modifier | Hydra | Audio analogue | Coupling |
|---|---|---|---|
| `.fast(n)` | sequence at `n × bpm` | step-sequence at same rate | Identity. Drives both. |
| `.smooth(n)` | linear interp between values, smoothing time | parameter glide / portamento time | Identity (`n` seconds in both). |
| `.ease('easeInOut')` | named easing | same easing on automation | Identity. |
| `.offset(n)` | phase-offset in sequence | pattern phase-offset | Identity (`n ∈ [0, 1]`). |
| `.invert()` | reverse-iterate the array | reverse pattern | Identity. |

Status: `todo` for the universal/public surface. 2026-05-20 update: the built-in program layer now ships a narrow subset instead — stepped `sequence` motion with `.fast` / `.smooth` / `.ease` / `.offset` / `.invert` semantics plus time LFOs — so curated Hydra-inspired looks can preserve their signature motion without exposing full per-slider automation in the main patch UI.

---

## 8. Audio input — `a.fft[i]`, `a.setBins`, `a.setSmooth`, `a.setCutoff`, `a.setScale`

Hydra's audio-input subsystem feeds FFT bins into video as numeric values. We need it bidirectional:

- **Audio → video**: `a.fft[i]` is a bin magnitude; usable as a parameter input to any video operator.
- **Video → audio**: dual API `v.luma`, `v.flux`, `v.edge` exposes per-frame video features (mean luminance, frame-to-frame difference, edge density) as parameter inputs to any audio operator.

Both directions share the same smoothing/cutoff/scale conventions.

Status: `todo` for the public/general Hydra surface. The app now does have both primitives internally: `src/audio/engine.ts` owns an `AnalyserNode`, `src/App.svelte` samples `v.luma` / `v.flux` / `v.edge`, and built-in programs can already bind raw FFT bins or video features to parameter automation. What remains undone is the general user-facing `a.fft[i]` / `a.setBins` / `a.setSmooth` / `a.setCutoff` / `a.setScale` API rather than the absence of runtime signal plumbing.

---

## 9. Operators implemented in the prototype but not in Hydra

For honesty: the prototype has `feedback` as a top-level parameter (frame-blend with the previous output). In Hydra this is achieved by `src(o0)` + `.blend()`. Reconcile:

- The modular renderer now supports `src(oN)` cleanly, so feedback/self-mod patterns can be expressed through real bus returns rather than only through the dedicated shorthand op.
- Audio-side feedback (prototype's long delay's feedback gain) is then literally the same parameter as visual feedback, both routing into a `mix(current, previous, fb)` op.

---

## 10. Summary status table

| Family | Total ops | `present` | `partial` | `todo` |
|---|---:|---:|---:|---:|
| Sources | 8 | 1 | 2 | 5 |
| Geometry | 7 | 0 | 3 | 4 |
| Color | 13 | 10 | 0 | 3 |
| Blend | 7 | 7 | 0 | 0 |
| Modulate | 8 | 0 | 1 | 7 |
| Output/buses | 2 | 2 | 0 | 0 |
| Array modifiers | 5 | 0 | 0 | 5 |
| Audio I/O | 5 | 0 | 0 | 5 |
| **Total** | **55** | **20** | **6** | **29** |

A meaningful slice of the Hydra surface area is wired up now. The current code evaluates implemented source/operator params through `src/core/coupling.ts`, shares `AudioContext` time across domains when audio is live, bypasses neutral operators in the default chain, now ships the full release-track Hydra Color surface (`posterize`, `brightness`, `contrast`, `color`, `saturate`, `invert`, `luma`, `thresh`, `hue`, `colorama`, `sum`, plus `.r .g .b .a`), upgrades `scale` / `pixelate` / `modulate` to AudioWorklet-backed DSP, executes the full Blend family as true dual-input graph nodes rather than as a primary-wire approximation, and supports real `src(oN)` bus returns plus a compact `render(o0..o3)` monitor. The work ahead is no longer primarily "finish more Hydra." The active release-shaping priority is a quality sprint: make the video finish feel closer to TouchDesigner-style post work, make the audio effects musically convincing when stacked, and keep the public surface legible as a curated operator instrument rather than a half-exposed graph IDE. Staging/private deploy remains useful for evaluation, but public v1 should wait for the video look engine, audio DSP palette, and product-surface cleanup described below, or for an explicit written decision to narrow that scope.

### 10.4 Product correction plan: video-first pivot

The intended shipped product is:

- uploaded video is the primary image signal
- the audio attached to that video is the primary audio signal
- Hydra-inspired operators manipulate the video field itself
- audio effects are coupled to those same operator controls
- video-derived features such as luminance, motion, and edge density can drive later coupling/program logic

The intended shipped product is **not**:

- a general procedural visual synth with video as one source among many
- a product whose main UX opens on generated visuals instead of footage
- a fixed giant chain whose presets are merely parameter snapshots with no program-level semantics

Concrete correction steps before deploy:

1. **UI/product reset**: make video the default path in `src/App.svelte`, demote procedural sources from the main UX, and rewrite product-facing copy/docs accordingly.
2. **Program model reset**: treat presets as named video effect programs built around uploaded footage, not just snapshots over the always-on chain.
3. **Video-derived feature pass**: implement the first `v.luma`, `v.flux`, and `v.edge` extraction path so future coupling can respond to actual video content, not only to user knob motion.
4. **Composition architecture**: land Blend-family convergence and a real multi-input graph path so Hydra-style video manipulations can be built from the uploaded signal itself rather than approximated with procedural sources.
5. **QA reset**: make video-input cases the primary smoke/audit path and treat procedural-source cases as secondary/internal coverage.

Current implementation status for step 1: the shell no longer boots into a visible procedural generator path. `src/App.svelte` now cold-boots on the internal placeholder, leads the user toward loading footage, and surfaces the loaded clip as the primary source action. Procedural generators remain in-repo for QA/internal work, but the public exploratory toggle has now been removed again as part of the simplification pass. This is still a product-facing reset rather than a full architecture completion; the deeper items in steps 3-5 remain open.

Current implementation status for step 2: the shipped `public/presets.json` bank is now metadata-backed and the UI presents it as **video effect programs** rather than raw preset buttons. Each entry carries video/audio intent plus operator focus, and selecting one from `src/App.svelte` reads as applying a named treatment to uploaded footage. The architecture has also widened beyond flat snapshots: built-in programs may now specify explicit chain order with repeated operator instances, internal bus/merge routing, and narrow time/FFT/video automation. The public patch UI is still intentionally serial; the richer graph remains an internal program/runtime capability rather than the default editing surface.

Current implementation status for step 3: the first shipped video-derived feature path is now live. `src/App.svelte` samples low-rate `v.luma`, `v.flux`, and `v.edge` signals from the loaded clip itself and injects them into the shared `CouplingContext` so both audio and video domains can read the same feature state. The first pass is intentionally runtime signal plumbing plus observability, not the final per-param automation system: the feature values are now real and QA-backed, but the public shell no longer shows the raw monitor chips because the product simplification pass favored a cleaner surface over standalone diagnostics.

Current implementation status for the patch surface: the runtime still supports the richer graph/bus model internally, but the shipped right-hand panel in `src/App.svelte` now behaves much closer to the intended public product. The old separate `Controls` panel is gone, the user still starts with an empty chain, and the add-effect surface in `src/ui/Patch.svelte` has been tightened again from the earlier searchable browser into compact family dropdowns. Unary operators are still grouped by intent (`Motion`, `Color`, `Texture`, `Feedback`, `Blend/Composite`, `Finish`, `Audio Character`), but the public composition gesture is now smaller and simpler: choose a family, add one node, tune it, then reorder it. Core controls still live inline on node cards while secondary sliders sit behind an advanced disclosure. The graph runtime remains in-repo because Blend-family convergence, `src(oN)` returns, and QA/program infrastructure still depend on it, but those advanced routing concepts are now internal/advanced rather than the primary UX. The first split-surface slice is now live as well: `src/App.svelte` exposes `Video` / `Audio` workspace tabs, the current chain editor remains under `Video`, and `src/ui/AudioRack.svelte` now exists as the shell that will collapse to the granulator-first audio surface described in §14 rather than continuing as a many-engine product. The first shared public modulation slice is live too: `src/ui/LfoBank.svelte` exposes six global LFOs with waveform/rate/depth, and both the video-node and audio control rows can bind params to `mod off / lfo 1..6` without growing bespoke automation UI.

Current product-direction recommendation for the patch surface: keep iterating on the serial video model rather than reopening the graph editor, but stop making that same surface responsible for all audio design. The next public-surface gains should come from stronger family descriptions, better preset/program discovery, and a clean split between `Video` and `Audio`. The first composition slice is now live: the public patch surface still reads as a serial chain, but it also exposes a narrow routing/bus UI for composite nodes and explicit primary/secondary input picks where an operator truly needs them. Monitor-bus selection and quad-preview toggling have now been promoted into the top shell itself, replacing the more renderer-technical finish controls as the only always-visible stage controls. That keeps `layer`, `mask`, and other two-input nodes usable without reopening the old free-form graph editor or cluttering the panel with extra global cards. The public shell also no longer exposes transport controls or renderer-look controls as primary top-level surfaces; uploads/programs remain the main on-ramp while transport and look-engine ownership stay internal for runtime, programs, and QA. Richer routing should still stay in built-in programs and the internal runtime unless a later explicit advanced mode proves necessary; the audio side should now collapse toward one excellent granulator plus feedback delay rather than continue accreting separate engine families.

Current product-direction recommendation for scope: do not continue porting Hydra operators indiscriminately. The remaining high-value Hydra-style additions on the video side are the ones that deepen composition and abstraction in a video-effects product: stronger `layer`/`mask` workflows, channel routing/swizzles, and better keyed `luma`/matte utilities. The first useful slice of that set is now shipped: `layer` / `mask` have threshold/tolerance/invert matte shaping, `luma` can key bright-or-dark regions against alpha-or-luma, `.r .g .b .a` can be used as product-surface swizzle/matte isolates, and `sum` now exists as the matching weighted channel-collapse finish op. The finish-forward looks (`Finish / Halo Key`, `Finish / RGB Spill`, `Finish / Shadow Matte`) remain available in the internal program bank and QA paths, but they are no longer part of the visible preset strip because the public surface is being narrowed toward the stronger routed-port looks. Lower-value parity work such as every small syntax feature, universal live-code import, or reopening the public graph editor should remain behind the release-track quality work unless a concrete product requirement changes that ordering. On the audio side, the new priority is not more Hydra-style one-to-one mappings but a dedicated rack of serious synthesis/effect families.

Current implementation status for video quality: the app is already GPU-backed through WebGL2/FBOs, and the operator chain plus bloom/history/presentation passes run as shader passes inside `src/video/renderer.ts`. The weakness is effect vocabulary and authored looks, not lack of GPU use. The presentation stack is already strong enough to act as support: bloom pyramid, threshold/pre-black, look-driven bloom/halation tint, public `performance` / `standard` / `cinema` quality selection, embedded/imported LUTs, procedural lens dirt, and renderer-side post presets are all in place. That surface should now stay mostly stable while the release track moves toward stateful video systems. The first three slices of that pivot are now live: `VideoRenderer` owns a bounded 8-frame temporal-history ring (`TEXTURE_2D_ARRAY`) for `timeDisplace`, it derives a reusable structure-analysis texture from the raw clip each frame (`luma`, `edge`, `flux`, contour emphasis) for structure-aware looks, and it now also derives a reusable half-resolution motion field from consecutive raw frames for the new `flow` operator and motion-aware presets. One important implementation correction is now explicit: structure-led looks still stay source-anchored at the renderer-analysis layer, but the `structure` operator itself re-analyzes its current stage input so upstream warps do not misregister the contour mask. Stay on the current WebGL2/FBO renderer for this sprint. Revisit `three.js` `EffectComposer` only if the current renderer becomes awkward to extend; keep WebGPU experimental/future because it is a larger architecture migration, not a polish shortcut.

Current implementation status for flagship programs: the older `tunnel`, `bloom`, and `kaleido` looks are still valid audit-backed references, but they are no longer the full aesthetic target. The public Presets tab is now explicitly allowlisted to a 12-program authored bank, not a small scatter of demo looks and not a catch-all dump of every reference patch in `public/presets.json`: the temporal trio (`Temporal Bloom Ghost`, `Slit-Scan Echo`, `Luma Time Smear`), the structure-aware pair (`Edge Feedback`, `Contour Bloom`), the first motion-aware pair (`Datamosh Smear`, `Flow Melt`), and the newer cross-family looks (`Motion Bloom Ghost`, `Kaleido Feedback Tunnel`, `Freeze Feedback`, `Granular Video Cloud`, plus `Grain Field` as the granulator-first anchor patch). Older ports and internal reference looks remain in the bank for QA/program reuse, but they no longer expand the public shell accidentally. The Presets tab also owns a small per-program macro layer, with curated fan-out into video, clock, granulator, and shared-delay values, so users can stay inside an authored look longer before dropping into raw node editing. Important renderer-state note remains unchanged: program activation owns look/quality/LUT/post-preset selection, so QA does not depend on whichever shell finish the previous user happened to leave selected. Exported-audio sides for program cases remain MANUAL REVIEW ONLY because program-level audio gates are not yet hardened enough to trust as release blockers.

### 10.5 Quality sprint: professional video and audio effects

The current product concern is aesthetic quality, not missing low-level plumbing. The video path already uses GPU-backed WebGL2 shader passes; the audio path already has Web Audio plus AudioWorklets. The sprint should therefore spend implementation budget on deeper effect design and better defaults rather than another broad API-surface pass.

Video goals:

- stateful temporal/motion/structure systems that make the loaded clip feel alive, not just more single-frame filters
- reusable frame-history, motion-field, and analysis-mask infrastructure inside the existing WebGL2 renderer
- a strong authored preset bank where a small number of flagship looks are better than many mediocre ports
- the current presentation stack used as polish around those systems, not as the main source of visual sophistication
- performance/standard/cinema quality tiers so expensive effects are opt-in on slower machines
- keep WebGL2/FBOs as the primary implementation path until they become structurally limiting

Audio goals:

- a dedicated `Audio` tab that presents **one** flagship granulator engine, not a menu of separate public DSP families
- one shared stereo feedback delay after the granulator, because feedback is the one post-effect with a strong and obvious AV law
- six shared global LFOs as the first public modulation language across both domains
- MIDI and MPE as first-class play input, not a stretch feature
- explicit modulation routing from video-derived sources into granulator parameters rather than more hidden per-video-op audio analogues
- focused worklet tests for interpolation quality, zero-allocation behavior, gain bounds, NaN/denormal avoidance, and note-on latency
- a quality bar defined by listening parity and timing/performance gates, not by how many separate audio engines exist

Current implementation status for that audio direction: the repo is in transition, not finished. The shell already has an `Audio` tab and a shared six-LFO bank, but the older multi-engine rack work still exists in code and docs as superseded context. The active direction is now narrower: collapse the public audio surface to the granulator + feedback delay described in §14, keep older worklets only as internal building blocks where useful, and stop treating the presence of multiple audio engine cards as progress toward release. The public uploaded-video path also no longer feeds the patch graph's legacy operator-audio stages through `AudioEngine`; for release-track use it now routes clip audio directly plus the parallel granulator/feedback branch, which keeps the public chain honest and avoids contaminating granulator QA with hidden operator worklets.
The granulator's k-rate control surface also no longer relies on the worklet `AudioParam` lane. `src/audio/granulator.ts` now writes controls into a preallocated shared snapshot, `public/worklets/granulator.js` caches that snapshot per block, and non-isolated sessions fall back to explicit control messages. That change is specifically in service of §13 gate #4.

Coupling policy for this sprint:

- do not force every video operator to remain a public audio effect if the result is musically weak or confusing
- keep the Hydra operator math on the **video** side, but treat most legacy audio analogues as historical rationale rather than release work
- use the shared six-LFO bank, MIDI, and selected video-derived features as the coupling fabric
- prefer one deep engine with strong modulation over many shallow public engines
- document deliberate deviations explicitly so the product remains honest about when it is doing dimensional reduction, when it is exposing a modulation source, and when it is presenting a productized perceptual analogue

Release policy:

- This quality sprint outranks remaining Hydra Color parity unless a concrete release requirement says otherwise.
- `sum` and `.r .g .b .a` remain useful but should not distract from the app feeling amateur in its core demo path.
- The split `Video`/`Audio` product surface is now part of the release-track cleanup, not a post-v1 nicety, because the current mixed model makes the audio story harder to understand.
- Additional post/presentation-stack expansion is now explicitly late/optional. New finish presets, extra bloom/halation variants, and similar polish-only work should stay behind renderer-system work, flagship-program authoring, and release-gate sign-off unless a concrete launch bug promotes them.
- Staging deploy can be used to evaluate these effects on real machines; public v1 should wait for quality sign-off or a written scope reduction.

### 10.4.9 Public audio surface finalised (2026-05-25)

The granulator-first audio direction has been documented since the §0a redirect, but per-operator audio twins (the legacy `AudioStage` interface implemented by every video op + its worklet) still existed in code, even if no longer mounted publicly. They are now permanently gone.

What was removed:

- `AudioStage` interface and `OperatorDef.createAudioStage`. Every `OperatorInstance` is now `{ id, def, videoStage, params, lfoAssignments }` — no audio side.
- `OperatorCoupling.kind` and `ParamCoupling.toAudio`. `evaluateAudioParams` deleted; `evaluateVideoParams` is now a trivial 6-line apply over each `toVideo` mapping.
- `SourceDef.createAudioStage` and `SourceInstance.audioStage`. Procedural sources (osc, noise, voronoi, shape, gradient, solid) are now video-only generators.
- The legacy AudioRack entirely — `src/core/audio-rack.ts`, `src/ui/AudioRack.svelte`, `src/core/audio-rack.test.ts` deleted. The rack was unmounted from the public shell in C1/C2/C3 but the 600+ lines of scaffolding lingered.
- 24 video-op worklets (`feedback-freeze.js`, the entire `modulate-*.js` family, `phase-modulator.js`, `phase-offset.js`, `pitch-shifter.js`, `pixelate-*.js`, `self-modulator.js`, `granular.js`, `fold-processor.js`). `public/worklets/` now contains only `granulator.js`. Worklet tests pruned to match.
- `AudioEngine.setPlan` / `setAudioRack` / bus-return delay infrastructure / per-instance audio param polling. Engine is now ~210 lines; the only public surface is master gain + soft-clip + limiter + meter + `setSource(silent|video-element)` + `attachAuxiliarySource(node)`.

What is kept and is now the entire public audio surface:

- `Granulator` (`src/audio/granulator.ts`) — the benchmark-grade dual-domain audio engine.
- `FeedbackDelay` (`src/audio/feedback-delay.ts`) — the one shared stereo post-effect.
- Master gain → soft-clip → limiter → analyser → destination, with a pre-limit tap for `MasterMeter`.
- `VideoElementAudioSource` for routing the loaded clip's audio track through the master bus, and `SilentSource` for the cold-boot state.

Effect on the rest of the product:

- `MasterMeter`, `GranulatorCard`, `FeedbackDelayCard`, and `LfoBank` are unaffected.
- Six-LFO modulation still applies to video params and to granulator params via the existing `applyGlobalLfoAssignments` path. The mod bank lives on; only the per-operator audio side it used to drive is gone.
- The release-policy assumption that "video ops have audio analogues" is now formally false, in code and not just in docs. Any future reintroduction of audio-side operators must come with an explicit scope expansion in `plan.md`; the simpler path is to keep extending the granulator and the feedback delay.

### 10.5.0 Authored vector fields and the history-copy fix (2026-05-25)

First operator that ships an *authored* velocity field rather than a measured one. Closes the most concrete part of the visual-quality gap raised when comparing the public chain against the marcscully.com hero (which itself turned out to be a CPU 2D-canvas point-vortex particle system, not a GPU shader).

- **`vortex`** — Biot-Savart sum-of-point-vortices displacement op, registered under the Feedback family. 32 deterministic vortices live in operator-local TS state and are advected per-frame on CPU (~1K ops/frame, free), then uploaded as a `vec4[64]` uniform; the fragment shader sums the same kernel per pixel and samples `u_tex` at the displaced UV. Toroidal wrap on both the vortex advection and the per-pixel displacement so swirls couple smoothly across edges. Four product-visible params: `mix`, `strength`, `drift`, `softness`. Audio side is a pass-through — this is video-only.
- **`history.frag` is now an identity copy.** The earlier polish-blur + peak-decay terms were proportional to `u_feedback_amount` and darkened `#prevFrame` every frame, which collapsed any trail-shaped op (`mix(current, prev, fb)` and friends) toward black. With this corrected, `feedback` finally produces the trails its semantics imply, the new `vortex` preset can rely on persistence, and the `structure` / `timeDisplace` ops that sample `u_prev_frame` get an accurate history. Renderer guard tightened to match (dead uniform lookups removed; the helper that computes `feedbackAmount` still feeds the presentation/bloom path, which is correct).
- **`Vortex Field` preset** added under the public allowlist (now 13 programs, previously 12). Demonstrates the op against a video with feedback at 0.86, tight swirls, and a light HSL-feel palette boost. Macros: `swirl`, `persistence`, `palette`.

Quality-sprint relevance: this is the first concrete piece of the §10.5 "stronger authored looks" goal that does *not* depend on the underlying motion estimator. `flow` and any future routed `modulate*` consumer remain ceiling-bound by `motion-analysis.frag`; `vortex` is independent of that ceiling because its field is authored, not measured. Expect more authored-field ops (curl noise, swept saddle, multi-scale vortex packets) before the motion estimator is rebuilt — the latter is real work, the former is fast and visually impactful.

### 10.5.0a Three authored-field follow-ups (2026-05-25)

Direct continuation of §10.5.0. The vortex op was the first of an intended set; the remaining three landed in the same day's pass and the public allowlist grew from 13 to 16 programs. Each is a distinct *class* of authored velocity field — not a re-skin of the same idea — so the Feedback family now covers swirl, fluid turbulence, multi-scale packet, and directional sweep with the same coupling-layer shape:

- **`curlNoise`** — divergence-free curl of a two-octave analytic value-noise potential, fully GPU (no per-frame CPU advection), with an optional second `curl()` evaluation at a once-warped position for a fluid-style self-advection feel. Params: `mix`, `strength`, `scale`, `speed`, `warp`. The chosen contribution here is "turbulent but mass-conserving" — matter cannot pile up or thin out, only swirl.
- **`vortexPacket`** — same 2D Biot-Savart kernel as `vortex` but with two CPU-advected bands: 6 macro vortices (large softness, slow drift, high strength) layered with 48 micro vortices (small softness, fast drift, low strength), each band advecting under its own softness so they don't collapse into the same scale. Shader blends the two via `macroBalance`. Params: `mix`, `strength`, `drift`, `macroBalance`, `macroSoftness`, `microSoftness`. The chosen contribution here is "structured noise" — separable macro composition and micro texture.
- **`saddleField`** — 14 oriented 2D saddles, each `vec4(px, py, cosθ, sinθ)` with strength uniform. Per-saddle local velocity `(u, -anisotropy * v)` — stretch along axis, compress across — under a Gaussian envelope. CPU advances each saddle's angle slowly per frame (deterministic per-saddle rotation rate), sweeping the whole field through itself. Params: `mix`, `strength`, `softness`, `anisotropy`, `drift`. The chosen contribution here is "directional flow without rotation" — anisotropic streaks, which is qualitatively distinct from every other op in the Feedback family.
- **Showcase presets `curlTurbulence`, `vortexPacketStorm`, `saddleSweep`** added to `public/presets.json` and the public allowlist in `src/App.svelte` (now 16 entries, previously 13). All three use the outer shape `feedback → <field-op> → saturate → contrast → chromaShift` so the new op is the dominant character, three macros per preset.
- **Verification.** `npm run check` 370 files / 0 errors / 0 warnings; `npm run test:run` 182/182; `npm run build` 329 kB (was 316 kB after the audio strip; +13 kB for the three new shaders + ops + presets). Live Playwright verification on each preset against `qa/fixtures/ci-smoke.mp4` — all three render their intended character without GL warnings.

Quality-sprint relevance: closes the authored-field arc explicitly named in §10.5.0. The motion-estimator ceiling (`motion-analysis.frag`) is still the bottleneck for `flow` and routed `modulate*` consumers, but the Feedback family no longer needs a stronger estimator to feel like an instrument.

### 10.5.0b Operator characterisation sweep (2026-05-26)

QA infrastructure that closes the "I turn up the knob and nothing happens" class of bug at the gate rather than relying on a user playing with the app. For every registered unary video operator, the sweep sets up a single-op chain on a paused video frame, walks each parameter min→max in 5 steps, and captures a 16×16 grid of per-channel mean / variance / brightness-weighted centre-of-mass at each step. Per-op JSON is written to `qa/results/op-sweeps/` and compared against `qa/baselines/op-sweeps/`; bless mode (`BLESS=1`) copies results → baselines.

- **Instrumentation.** `VideoRenderer.readFrameStats(grid)` next to the existing `readPixelAt` — same `#prevFrame` FBO trick, returns mean/variance/CoM. QA bridge gains `setChain`, `listRegisteredOps`, `readFrameStats`. The bridge drives sweeps off the operator registry rather than hard-coded lists, so any new op is automatically covered the next time the spec runs.
- **Spec.** `qa/e2e/op-characterisation.spec.ts`. Single `test()` that walks every op. Fresh chain per param so internal CPU state starts at frame 0 each time; if the op has a `mix` param it's pinned at max while other params sweep so non-mix params are observable. Min-to-max delta must exceed `5e-4` (dead-param assertion); time-dependent ops get a 5× looser tolerance on baseline drift because their output legitimately depends on `ctx.time`.
- **Baselines.** Checked in under `qa/baselines/op-sweeps/`, 40 ops covered, one JSON per op. Drift surfaces in PRs.
- **Scripts.** `npm run qa:opSweep` (compare), `npm run qa:opSweep:bless` (write baselines). Steady-state runtime ~2.5 min.
- **First bless run caught a real bug.** `src/video/shaders/selfMod.frag` was missing `#version 300 es`, so its uniforms read garbage. Not in `DEFAULT_CHAIN` and no preset used it, so the bug was latent — exactly the failure mode the sweep was built to surface. Fixed in the same pass.

Quality-sprint relevance: this is the regression gate behind every future authored-field op and behind any shader refactor in `src/video/shaders/`. Without it, the next "the param doesn't do anything" report comes from a user. With it, the assertion fires the moment a baseline drifts beyond tolerance or a parameter goes flat.

Open follow-ups (not blocking the gate's usefulness, just deferred):

- CI workflow alongside `granulator-soak.yml`, path-filtered on `src/ops/**` / `src/video/shaders/**` / `src/core/operators.ts` / `src/core/coupling.ts`. Steady-state ~2.5 min fits CI.
- Binary blend coverage via a second pass with a procedural second-input source, its own baseline directory. Held until the unary baselines have proved stable over a few real PRs.

### 10.5.1 Feedback-family triage (2026-05-25)

Live-app inspection of the first four Feedback-family ops surfaced a mix of one UI-meta bug, one shader balance issue, one design-by-spec misunderstanding, and two architectural ceilings. Recording the boundary explicitly so future work does not relitigate it:

- **structure**: the operator was working as coded, but its UI was missing `threshold` / `softness` (so the mask edge could not be moved) and the glow path dominated at high settings. Shipped 2026-05-25 — expanded `OPERATOR_UI_META.structure.coreParams`, rebalanced the glow contribution in `src/video/shaders/structure.frag`, and dropped the default `glow` from 0.25 to 0.18.
- **feedback.delayTime**: not a bug. The audio worklet (`feedback-freeze`) reads it; the video shader does not, by spec — the param hint in `src/ops/feedback.ts` already declares it as audio-only / video-uncoupled. The real gap is UI clarity: a video-tab user has no way to know it is audio-only. Open follow-up: introduce an "audio-only" marker on coreParams meta so the UI can label these honestly. Until then, the param stays in `paramOrder` because it drives real audio behaviour.
- **timeDisplace**: the temporal-history ring is fed from the conditioned monitor final (`#prevFrame`), not from the raw source. With timeDisplace as the only op in the chain, the buffer it samples becomes its own past output, so `depth/scan/smear` produce subtle / invisible changes and the visible effect collapses to `mix` × `trailFade` darkening. The renderer-resource layer for temporal history was always intended as a shared system (§10.5 video goals: "stateful temporal/motion/structure systems"); the design decision still to be made is whether timeDisplace should sample a second source-anchored history ring (preferred for the stated semantics) or be honestly relabelled as "post-chain time smear". Either change is architectural, not parameter-tuning, and is deferred until that scoped decision is taken.
- **flow**: the operator is doing its job; the underlying motion-analysis shader (`src/video/shaders/motion-analysis.frag`) is the ceiling. 8-direction block matching with a 1.75-pixel search radius cannot represent the motion present in real footage, so the field arrives quantised and noisy and `u_gate` further filters it to sparse glitches. The same ceiling applies downstream to the future routed `modulate*` family if it consumes the motion texture. Real fix is a multi-scale / larger-radius estimator, scoped as part of stateful-systems quality work rather than the surgical pass.

This subsection exists so the quality sprint does not silently double-count "shipped a feedback-family op" as "shipped a complete feedback-family experience". The deferred items above stay open against §10.5 and the corresponding release blockers in `todo.md` until they ship at release quality.

### 10.5.2 Per-op ownedState FBO + dataMosh operator (2026-05-26)

The "datamosh" look in `flow` (`smear`/`memory`/`glitch` branch) was a motion-vector smear, not the held-keyframe-with-drift signature most users mean by datamosh. Investigation confirmed two things worth recording so we don't reopen them: (a) Datamosher-Pro is bitstream-level AVI surgery (I-/P-frame byte toggling) and is not portable to a browser shader pipeline at all — the `<video>` element only exposes decoded RGB; (b) Akascape's realtime-datamosh Shadertoy is the only pixel-domain reference in the family, but its sparse-refresh accumulator is a visually different (weaker) look and would not have solved the underlying complaint.

The real datamosh signature — frozen content sliding along motion vectors as predictions get mis-applied — needs a self-feedback buffer that holds indefinitely. The shared `temporalHistory` ring is the wrong primitive (capacity-8, frame-granular, shared across all ops) so this pass added a new opt-in:

- **Per-op ownedState FBO infrastructure.** New `OperatorDef.ownedState?: { uniform }` declaration; renderer allocates a per-instance ping-pong (two textures + one rebound FBO) in `#syncNodeTargets`, binds previous state to TEXTURE6, runs the op into ownedState[next], blits to chain target so downstream ops see it, swaps. Lifecycle is symmetric with `#nodeTargets` (allocate on plan-step add, dispose on remove, reset on canvas resize). Single-attachment model (op's output IS its state) chosen over MRT for simplicity; promote if a future op genuinely needs state-distinct-from-output.
- **`dataMosh` op.** Six params: `mix`, `hold`, `drift`, `release`, `decay`, `chunk`. Registered in the Feedback family. The held image drifts each frame by motion-field vectors, slowly degrades toward grey, and releases to live above a motion-magnitude threshold. `flow` is left untouched — its smear/memory mode stays valid as a separate motion-blur look, and the existing `Datamosh Smear` flagship preset still uses it. A second preset that wires the new `dataMosh` op is an open follow-up.

Scope discipline: this is the first new architectural primitive (per-op self-feedback) since the temporal-history ring. It is opt-in and orthogonal to the existing shared resources, so no existing op is affected. The "Build new architectural primitive" decision was taken explicitly because the alternative paths (port Akascape, or improve `flow` smear in place) would not have produced the look the complaint was about — recorded in `memory.md` 2026-05-26 entry alongside the rejected alternatives so we don't re-evaluate them.

### 10.6 Role of procedural sources after the pivot

The pivot demotes procedural sources from the public product surface but does **not** delete them. Their post-pivot roles, ranked by load-bearing weight, are:

1. **QA fixtures** (load-bearing). `osc`, `noise`, `voronoi`, `shape`, `gradient`, and `solid` back ~30 of the 45 committed audit cases. They are the only fixtures that are bit-exact deterministic across runs and machines, so they remain the only reliable substrate for hard-gated operator audit assertions on the geometry, modulate, and color families. Keep all six sources and their QA cases. Status: keep as internal infrastructure.
2. **Operator development substrate** (load-bearing). Adding a new operator (e.g. `sum`, channel accessors, or a later `modulate*` variant) needs a known-input substrate to reason about correctness before turning the operator loose on real video. The procedural sources still serve this role, but they no longer need a public-facing toggle in the shipped shell. Keep the runtime/QA path, not the main-surface UI. Status: keep as internal infrastructure.
3. **Educational/demo surface** (deferred). Procedural sources could re-emerge in a future advanced-mode UI for users who want to learn the AV-coupling laws without uploaded footage in the way. Not a near-term priority and not a release blocker. Status: parked, not on the roadmap until after public release.
4. **First-class product surface** (dropped). Procedural sources will not return to the primary UX, cold-boot path, or release copy. They will not gate or shape roadmap priority. The `solid` RGB → triad mapping question parked under §11.1 stays parked because it only matters once that surface is re-elevated, which is no longer planned.

Effect on the roadmap:

- `s0..s3`, `initCam`, `initImage`, `initScreen` (plan §1.8) remain legitimate **video** input alternatives to uploaded files, but they are no longer treated as public-v1 blockers by default. They are advanced/post-v1 unless the launch target changes.
- `src(oN)` is complete enough for the current release track; any remaining work around buses is polish, not a blocker.
- The live-code editor remains strategically valid because it targets the same graph, but it is now an advanced authoring surface rather than a prerequisite for staging or public v1.

### 10.7 Release tracks after the pivot

The repo now has three explicit release tracks:

1. **Quality sprint** — the current implementation target. Goal: make the core uploaded-video path feel like a real audiovisual instrument in both domains. Required: the existing WebGL2 renderer deepened with temporal/motion/structure systems and flagship presets, the granulator-first audio surface completed around **granulator + feedback delay + limiter**, disciplined gain staging, focused QA, and human sign-off.
2. **Staging RC** — private evaluation target. Goal: deploy the best current quality-sprint slice to a private/staging URL for real browser, device, visual, and listening validation. Required: QA/audit green on the implemented surface, final human audible/visual sign-off on the documented manual cases, a deploy workflow/runbook, and a post-deploy smoke pass against the staging URL.
3. **Public v1** — the first broadly shareable release. Goal: ship the current video-first product honestly, without implying unfinished Hydra parity. Required beyond staging: quality-sprint scope complete or explicitly narrowed, issues discovered during staging absorbed, and public positioning anchored to "video-first AV effects" rather than "general AV synth." Remaining public-surface Color work (`sum`, `.r .g .b .a`) should be implemented only if it is still a real launch requirement after quality sign-off.

What is intentionally **not** a blocker for the current release track unless the user explicitly changes product scope:

- the CodeMirror/Hydra live-code surface from `M4`
- alternate external-input authoring surfaces such as `s0..s3`, `initCam`, and `initScreen`
- broader Hydra parity, including Color parity, unless a concrete launch requirement promotes it again
- indiscriminate Hydra operator-count growth without a clear product role

---

## 10.5 QA stack (active)

Professional QA for this project splits into five layers:

1. **Playwright** for live app/runtime behavior: boot, source load, transport, controls, console/runtime errors.
2. **`mcp-music-analysis`** for audio behavior: onset timing, beat/tempo checks, MFCC and spectral movement, and comparison across operator sweeps.
3. **`ffmpeg-quality-metrics`** as the authoritative full-reference visual metrics backend: PSNR / SSIM immediately, plus VMAF whenever the configured `ffmpeg` build exposes `libvmaf`.
4. **`video-quality-mcp`** for metadata, GOP/frame structure, artifact summaries, and secondary visual context around reference-vs-current render comparisons.
5. **`ffmpeg-mcp`** (or equivalent FFmpeg MCP) as the structured preprocessing/helper layer for probing, trimming, thumbnails, and future audio extraction from rendered captures.
6. **Manual audible/visual review** for the operator-family cases that still intentionally stay outside hard metric gates.

The repo-facing build step for this stack is:

- a manifest-driven Playwright harness under `qa/` for live smoke/regression
- a stable artifact layout under `qa/results/`
- MCP config templates/documentation so humans or future CI jobs can hand artifacts to the analyzers

Current limitation: the QA harness now exports authoritative rendered `.webm` captures from the app itself, extracts `.wav`, probes both media files, writes `analysis.json` summaries, persists live checkpoint metrics from Playwright, evaluates exported-WAV segment assertions across every implemented family, has committed `qa/references/` baselines, and routes analyzer calls through repo-local wrappers for `mcp-music-analysis`, `ffmpeg-quality-metrics`, and `video-quality-mcp`. On this machine the default Homebrew `ffmpeg` does not expose `libvmaf`, so the authoritative wrapper currently hardens PSNR / SSIM immediately while leaving VMAF unavailable until `AV_SYNTH_FFMPEG_QUALITY_METRICS_FFMPEG_PATH` points at a compatible build. `mcp-video-analyzer` remains in-repo as a reference wrapper only, not part of the active stack. The remaining QA gap before deploy is final human audible sign-off on the explicitly manual cases.

---

## 10.6 Pre-deploy operator-family audit gate

Before `M6 — Deploy`, the repo needs a deliberate AV audit across every **implemented** operator family. Current smoke coverage proves the harness works; it does **not** prove that every operator is professionally shippable in both domains.

### Scope

The audit gate applies to the currently implemented runtime surface:

- **Sources**: `osc`, `noise`, `voronoi`, `shape`, `gradient`, `solid`, committed `video` fixture
- **Feedback / composition**: `feedback`, `modulate`
- **Geometry / spatial transforms**: `scale`, `rotate`, `scrollX`, `scrollY`, `repeat`, `repeatX`, `repeatY`, `pixelate`, `kaleid`
- **Color / tonal transforms**: `brightness`, `contrast`, `color`, `saturate`, `posterize`, `chromaShift`

Unimplemented Hydra families stay out of the gate until they exist in code.

### Required case coverage

Each implemented operator must have at least one dedicated manifest-driven QA case, and higher-risk operators should have more than one:

- **Baseline case**: neutral/default operator values on a stable source
- **Sweep case**: low / mid / high settings for the operator under test
- **Edge case**: the highest-risk or most failure-prone regime for that operator
- **Cross-source spot check**: at minimum, one procedural source and one video source for each family

The audit matrix now spans every implemented family: `qa/cases/audit-source-*`, `qa/cases/audit-feedback-*`, `qa/cases/audit-modulate-*`, `qa/cases/audit-scale-*`, `qa/cases/audit-pixelate-*`, `qa/cases/audit-kaleid-*`, `qa/cases/audit-rotate-*`, `qa/cases/audit-scrollX-*`, `qa/cases/audit-scrollY-*`, `qa/cases/audit-repeat-*`, `qa/cases/audit-repeatX-*`, `qa/cases/audit-repeatY-*`, plus the color-family cases `audit-brightness-video-sweep`, `audit-contrast-osc-sweep`, `audit-color-solid-band-sweep`, `audit-saturate-video-sweep`, `audit-posterize-video-sweep`, and `audit-chromaShift-video-sweep`. The hardened automated assertions now span both domains: live Playwright checkpoint metrics gate the stable visual deltas, and exported-WAV segment assertions gate the stable audio side, with explicit manual-review exceptions recorded where the current fixture/metric pair is not stable enough to trust as a release gate. Current manual exceptions are:

- `audit-feedback-video-cross-source` on the decoded-video visual side
- `audit-modulate-osc-sweep` on the exported-audio timbre side
- `audit-kaleid-osc-sweep`, `audit-pixelate-osc-sweep`, and `audit-pixelate-video-cross-source` on the visual side
- `audit-scrollY-osc-sweep` and `audit-repeatY-osc-sweep` on the visual side
- `audit-scrollX-osc-sweep` on the exported-audio side
- `audit-source-noise-sweep`, `audit-source-shape-sweep`, and `audit-source-gradient-sweep` on the audio-judgment side
- `audit-color-solid-band-sweep`, `audit-saturate-video-sweep`, `audit-posterize-video-sweep`, and `audit-chromaShift-video-sweep` as intentionally more manual-heavy audio reviews

### Automated checks per case

Every audit case must:

- boot, load source, start transport, and export `.webm` / `.wav` successfully
- produce zero unexpected console/runtime errors
- write `analysis.json` with media probe data and analyzer outputs where configured
- include screenshots and an exported capture for later review

Video checks:

- expected visible response at low / mid / high values
- no blank frames, NaNs, severe banding, obvious tearing, or accidental freeze
- `ffmpeg-quality-metrics` comparison against the committed reference capture in `qa/references/` for authoritative PSNR / SSIM / VMAF when available
- `video-quality-mcp` comparison against the committed reference capture in `qa/references/` for metadata / GOP / artifact summaries

Audio checks:

- non-silent output unless silence is the intended behavior
- no accidental clipping, DC-like failure, or obvious broken channel routing
- expected movement in loudness / spectral envelope / pitch / stereo image according to the coupling law
- `mcp-music-analysis` output captured where the local audit machine has the server installed/configured

### Manual review per family

Metrics are necessary but insufficient. Each family also needs a short human review pass against exported captures:

- Does the audio feel correctly coupled to the visual change?
- Does the operator remain usable through the full intended range?
- Are there professional-use problems that metrics miss: harshness, pumping, brittle transients, ugly quantisation, distracting artifacts, or unstable feel?

### Fix loop discipline

For every family:

1. Add or refine the QA cases.
2. Run `qa:audit:ci` plus any locally available analyzer servers.
3. Review exported captures and summaries.
4. Fix defects in the operator implementation or coupling law.
5. Re-run until the family is green.

Operational note: the Playwright suite is now split into family-grouped spec files under `qa/e2e/`. Local runs default to modest file-level parallelism for faster iteration, while CI stays single-worker and the analyzer/reference tooling no longer assumes `smoke-*` output directories.

### Deploy gate

Public/professional `M6 — Deploy` stays blocked until all of the following are true:

- every implemented operator has explicit audit coverage in `qa/cases/`
- reference captures exist for stable audited cases
- analyzer summaries are populated for the audit environment
- manual review notes are complete for every implemented family
- all discovered AV-coupling, quality, or stability defects are fixed or consciously deferred in writing
- final human audible sign-off is complete for the explicit manual cases in `qa/reviews/`
- the video-first correction pass is complete: video is the default product path, procedural sources are demoted from the public UX, and the product/docs no longer present the app as a procedural synth first
- the quality sprint is complete or consciously narrowed in writing: TouchDesigner-inspired bloom/look/feedback polish, benchmark-grade granulation, the public feedback-delay surface, and gain-staging/wet-dry discipline
- final human visual/audible sign-off says the target demo path no longer feels amateur
- remaining public-v1 Color work (`sum`) is either implemented or explicitly deferred as Hydra-parity work that is not required for public v1
- video-derived feature extraction is present in the shipped path (`v.luma`, `v.flux`, `v.edge` or a consciously narrowed equivalent)
- staging/private deploy feedback has been absorbed: any issues found there are fixed or consciously deferred in writing

### Release checklist

For a fresh session handoff, the completion sequence is now:

1. Treat the video-first correction pass from §10.4 as complete enough for staging; do not reopen it as a vague blocker.
2. Run the quality sprint in two visible slices: video look-engine tuning first, then the remaining granulator-first audio work and gain staging.
3. For video, implement bloom pyramid/LUT-look/authored feedback-displacement presets/quality tiers before adding more abstract operators.
4. For audio, complete the remaining public `feedback delay` surface, keep the granulator benchmark-grade under QA, and finish the real listening/latency/manual sign-off gates before treating the current sound as release-ready.
5. Finish the remaining manual audible and visual sign-off cases listed in `qa/reviews/`; update review docs for the new flagship effects.
6. If that pass finds issues, fix them and rerun the narrowest relevant QA/audit path.
7. Use Cloudflare Pages as the default staging host unless the user explicitly chooses another target, and deploy through the repo workflow/runbook.
8. Run a post-deploy Playwright smoke pass against the staging URL and use that environment for real-world device/listening validation. Do not describe it as the professional/public release.
9. Before public v1, decide whether `sum` is a launch requirement or deferred Hydra-parity work; do not let it outrank unresolved quality concerns.
10. Keep live-code and alternate external inputs off the public-v1 blocker list unless product scope changes.
11. Deploy the public build, record the canonical public URL in the repo docs, and run a post-deploy Playwright smoke pass against that URL.
12. Only then mark the project complete.

---

## 11. Open mathematical questions (parked)

- **Spatial-frequency unit for sources**. Default chosen: `osc(N)` → `N Hz`. Alternative: `N cycles per screen-width × baseFreq`. Decision in `memory.md`.
- **3-band crossover frequencies for `color()`**. Landed as `COLOR_BAND_CROSSOVERS_HZ = { lowMid: 300, midHigh: 3000 }` in `src/core/coupling.ts`; future question is whether presets should override it.
- ~~**`hue` pitch-shift law**. `2^amount` (octaves) vs `1200 · amount` cents — choose unit-of-presentation in UI without changing the math.~~ Resolved 2026-05-18: octaves, slider unit `oct`, range `[-1, 1]`. See `memory.md`.
- **`scrollX` vs `scrollY` audio asymmetry**. Treating X as time-domain delay and Y as stereo pan is a design choice — alternative is the opposite. Decision in `memory.md`.
- ~~**`colorama` chaotic-map choice**. Hénon, logistic, or per-bin scramble.~~ Resolved 2026-05-18: **logistic** map, single state, no worklet — predictable bifurcation, cheap, and shared between the video shader and the audio ring-mod carrier. See `memory.md`.
- **`solid` RGB → triad mapping**. R=1, G=3/2, B=2 is one option; major triad (1, 5/4, 3/2) and tritone (1, √2, 2) are alternatives. UI-selectable.

---

## 12. Planned av-synth originals (future ops outside Hydra)

These operators are not part of Hydra. They are planned av-synth additions identified from design review of which synthesis techniques are still uncoupled in the current matrix. The 2026-05-20 quality review changes their priority: `selfMod`/FM and the audio-quality work are now part of the active quality sprint, not distant post-Color backlog. `blur` and `flux` remain useful product effects, but public release should prioritise the flagship video look engine plus granular/FM/wavefolding audio before broadening Hydra parity.

### 12.1 `blur(amount=0)` — coupled lowpass filter

- **Video**: spatial blur of the input field. Symmetric 2D Gaussian (or box-kernel approximation) with kernel radius `amount · K_MAX` pixels, where `K_MAX` is a renderer-side cap (suggested 32 px at 1280×720). `amount = 0` is identity.
- **Audio analogue**: **single-band sweepable lowpass filter** (Biquad LP, Q ≈ 0.707 / Butterworth). Cutoff curve: `f_c = sampleRate/2 · (1 - amount)^4` so the response is gentle near `amount = 0` and tightens aggressively as `amount → 1`. `amount = 0` is identity (cutoff at Nyquist); `amount = 1` is fully closed (cutoff → 0 Hz, signal vanishes).
- **Coupling**: spatial-frequency cutoff in cycles/pixel ↔ temporal-frequency cutoff in Hz via the same `baseFreq` law that governs sources (see `memory.md` 2026-05-16 `osc(N)` decision). High spatial frequencies (sharp edges) and high temporal frequencies (treble) are removed together; soft blur = warm sound. Distinct from `noise(scale)` which uses a lowpass internally to shape a noise source — `blur` is a chainable filter that processes whatever upstream produced.
- **Status**: `future`. Open question: 2D-separable Gaussian vs. radial mipmap LOD — the mipmap approach is much cheaper at high blur and would let the kernel grow effectively unbounded, but the spectral roll-off is steeper than Gaussian and may not couple as cleanly to a Butterworth audio LP. Decide before implementation.

### 12.2 `flux(amount=0, attack=0.05, release=0.5)` — coupled envelope follower

- **Video-derived input**: `v.flux` — the per-frame temporal-change scalar already exposed by `CouplingContext` (see `src/App.svelte` video-features pass, M5.7 2026-05-18).
- **Video**: optional brightening tied to motion (`colour → colour · (1 + amount · v.flux)`) so on-screen motion visibly self-emphasises. Identity at `amount = 0`. Acceptable to ship without any video-side transform if it competes too hard with `feedback` / `modulate` for the same visual real estate; the audio-side coupling is the whole point.
- **Audio analogue**: **envelope follower / motion-driven VCA**. Internal one-pole follower tracks `v.flux` with separate `attack` and `release` time constants (in seconds, mapped to one-pole α via `α = 1 - exp(-1/(rate · τ))`). Output gain = `1 + amount · (envelope - mean(envelope))`, clamped non-negative. `amount = 0` is identity; positive `amount` raises gain during motion, negative `amount` ducks it. Default `attack = 50 ms`, `release = 500 ms` mirror typical compressor sidechain feel.
- **Coupling**: this is **reverse-direction coupling** (video → audio) — the first operator in the spec that lets a feature extracted from the loaded video drive the audio signal. Both domains read the same scalar `v.flux` at the same `ctx.time`; latency budget is one video frame (≈16 ms at 60 fps) since `v.flux` is computed in the renderer's per-frame pass.
- **Status**: `future`. Open question: whether `flux` should be an *audio effect* (gain/filter applied in-line, as specced here) or an *automation source* (a CV-style modulator that other ops subscribe to via a routing matrix). The in-line variant fits the current graph model and ships easier; the CV variant is more flexible but requires graph-level changes (parameter automation sources beyond `clock.rate`). Default to in-line for v1.

### 12.3 `selfMod(amount=0)` — coupled feedback FM / self-modulation

- **Video**: UV displacement of the input texture by `amount · src(o0)` — uses the previous output frame as the modulator. Identical to `modulate(src(o0), amount)` once `src(oN)` and the bus architecture (§6) land, but exposed as a single named op for ergonomics. `amount = 0` is identity.
- **Audio analogue**: **feedback phase-modulation / FM** — the modulator signal is the previous audio block (or a one-block-delayed copy of the operator's own output). `y(n) = x(n + amount · y(n - blockSize))` via a dedicated AudioWorklet. The musically useful surface should expose carrier/mod ratio, modulation index, feedback, envelope smoothing, optional sideband filter, and wet/dry. The classic Yamaha DX7 operator-6-feedback topology is the reference, but the product target is controlled musical movement over uploaded audio rather than raw noisy chaos. Clamp feedback/index ranges to prevent runaway FM.
- **Coupling**: same `amount` controls both. The fundamental latency in both domains is one tick of self-reference (one frame on video ≈ 16 ms, one audio block ≈ 3 ms at 128-frame / 48 kHz). The asymmetry between those latencies is the same as the bidirectional-coupling tension already noted in `memory.md` (16 ms vs 3 ms); `selfMod`'s tight inner loop will surface it more audibly than other ops.
- **Status**: `present` (2026-05-20 first slice). The app now ships a dedicated `selfMod` operator with a previous-frame self-displacement shader on video and a `self-modulator` AudioWorklet on audio. Exposed params are `amount`, `ratio`, `index`, `feedback`, `smoothing`, `tone`, and `mix`. Internally the audio path is a bounded feedback phase-warper whose carrier runs at `ctx.rate * ratio`; `feedback` and `smoothing` shape the self-mod loop, `tone` is the post-sideband lowpass, and `mix` is wet/dry. This clears the "real FM/self-mod path exists" bar for the sprint, while leaving open a later graph-level modulator-routing pass if product testing wants stricter `src(oN)`-style signal FM instead of the current internal topology.

### 12.4 `grain(...)` — granular processing over uploaded audio

- **Video**: grain parameters must have a visible counterpart in the look engine. The current implementation uses a held-sample tile field: `size` controls grain footprint, `density` controls reseed cadence and coverage, `position` biases the held-sample orbit, `spray` adds per-grain sample jitter, `reverse` mirrors grain direction, `shape` sharpens or softens the grain mask, and `spread` separates channel-held samples. A future renderer ABI pass may still widen this into true temporal video granulation via history textures, but pass-through is no longer acceptable.
- **Audio analogue**: real granular synthesis over the uploaded audio buffer, implemented in an AudioWorklet or equivalent sample-accurate path. Required parameters: grain size, density, spray/jitter, playback position, pitch, reverse probability, envelope shape, stereo spread, and wet/dry. This replaces the current `voronoi` source's noise/VCA placeholder as the project's serious granular path.
- **Coupling**: grain density and pitch should respect the existing `baseFreq`/clock conventions where musically useful, but the dominant product behavior is "make the uploaded audio textural and controllable," not "prove a Hydra source analogy."
- **Status**: `present` (2026-05-20 first slice landed; same-day coupling and architecture decision completed). The app now has a real `grain` operator on the main chain backed by `public/worklets/granular.js`, and it is fully coupled across both domains: audio uses a deterministic rolling-history granulator, while video uses a spatial held-sample grain field driven by the same controls. It already exposes `mix`, `size`, `density`, `position`, `spray`, `pitch`, `reverse`, `shape`, and `spread`. The current release track intentionally keeps that rolling-history architecture: the uploaded-media path is still `MediaElementAudioSource`-driven, so arbitrary whole-file grain addressing would require a larger decoded-audio ownership and transport-sync pass. Revisit that only if product testing specifically demands clip-locked scrubbing rather than textural live granulation.

### 12.5 `foldPlus(...)` / wavefolder upgrade — musical nonlinear timbre

- **Video**: keep `kaleid`'s visual polar symmetry, but consider a separate or expanded operator if the audio surface needs more controls than `nSides` can honestly represent. Possible visual counterparts: fold count, symmetry/asymmetry, bias, and post-filter warmth can map to polar segment count, center offset, color bias, and luma smoothing.
- **Audio analogue**: upgrade from the current static `WaveShaperNode` fold curve into a serious wavefolding processor. Required parameters: drive, fold amount/count, symmetry, bias, oversampling mode, DC blocker, post lowpass, output trim, and wet/dry. Add level compensation so stacked nonlinear effects do not simply become louder, harsher broadband noise.
- **Coupling**: fold count remains the mathematical bridge to `kaleid`, but drive/symmetry/bias are product controls needed to make the effect musical.
- **Status**: `present` (2026-05-20 first upgrade slice). `kaleid` is no longer a one-slider shaper: the audio side now runs through a dedicated `fold-processor` AudioWorklet with fixed internal 4x oversampling, DC blocking, post lowpass tone control, output trim, and equal-power wet/dry, while the video side gained matching `drive`, `symmetry`, `bias`, `tone`, `output`, and `mix` controls around the existing polar fold. This clears the "serious wavefolding path exists" bar for the release sprint while leaving open a later decision on whether an eventual `foldPlus` operator should split off from `kaleid` for even less constrained coupling.

### 12.6 Shared gain-staging and nonlinear-effect discipline

- **Problem**: stacked audio effects currently become noisy or boring because many processors are serial, broadband, and level-insensitive. A final limiter prevents clipping but does not make nonlinear chains musical.
- **Required design rule**: nonlinear effects should own input trim where needed, level compensation, output trim, wet/dry, and post-filtering. Add an internal master soft-clip/saturation stage before the final limiter if listening tests show the limiter alone is too abrupt.
- **Testing**: every new AudioWorklet should have small worklet-level tests for identity/default behavior, gain bounds, NaN/denormal avoidance, and at least one spectral sanity check. Use the existing pitch-shifter worklet test pattern.
- **Status**: `present` (2026-05-20 first release-track pass). The master bus now soft-clips before the limiter, `kaleid` owns compensation/trim/tone/wet-dry, and `saturate`, `selfMod`, and `grain` each gained internal post-filter or compensation discipline instead of relying entirely on the master limiter. Remaining work is audible product tuning and any additional compensation needed after manual listening, not the absence of a gain-staging architecture.

---

## 13. Desktop distribution (final phase) — Electron + WebGPU

This is the **final** product phase. It runs only after all earlier release gates pass (video-first correction pass complete, Color `sum`/`.r .g .b .a` shipped, Blend family shipped, audible sign-off filed in `qa/reviews/`, public/professional web release shipped). Desktop is not a substitute for the web app — it is a higher-headroom delivery target for the same codebase.

### 13.1 Why Electron (not Tauri)

- **Chromium parity is the feature, not the cost.** av-synth is a WebGL2/WebGPU + AudioWorklet app. What ships in Electron is the exact engine debugged in the browser. Tauri's system-WebView (WKWebView on macOS, WebView2 on Windows, WebKitGTK on Linux) introduces three different rendering and AudioWorklet substrates with three different bug surfaces. For an AV tool this is not acceptable.
- **WebGPU availability is guaranteed.** Electron ships a known Chromium version, so WebGPU and `EXT_color_buffer_float`-class capabilities are present unconditionally. Tauri inherits whatever the user's system WebView supports, which on Linux WebKitGTK is partial and on older macOS is gated by OS version.
- **AudioWorklet behaviour is consistent.** Garbage-collection profiles, audio thread scheduling, and `AudioContext` latency hints differ between Chromium and WebKit. Electron pins this; Tauri does not.
- **Distribution size is not the bottleneck.** ~150 MB Chromium runtime is fine for a creative tool. Ableton Live is 2 GB, TouchDesigner is 800 MB, Max/MSP is 600 MB. The audience already accepts large installs in this category.
- **Trade accepted**: higher memory baseline, larger installer, Node.js attack surface. Mitigations: context-isolation on, `nodeIntegration: false` in the renderer, IPC contract narrow, no remote module, CSP locked down. Treat the renderer as a sandboxed web page that happens to have a privileged Node host behind a typed IPC bridge.

### 13.2 WebGPU power (coupled to the desktop phase)

- **Rationale**: WebGL2 has carried the operator set defined in §1–§6 of this document and is sufficient for Hydra-shaped 2D ping-pong chains. The ceiling appears when av-synth wants compute shaders for TouchDesigner-style work: particle systems with 10⁵–10⁶ points, fluid sims, point-cloud video, mesh-shader-class geometry, GPU-side audio-feature extraction, and large-kernel image processing that does not factor cleanly into a fragment pass.
- **Backend strategy**: add a `RenderBackend` interface in `src/video/renderer.ts` with two implementations — `webgl2` (current) and `webgpu` (new). Operators register both a GLSL fragment and a WGSL fragment/compute pair; the renderer picks the backend at boot via a capability probe with a user override flag. No operator is WebGPU-only at this phase unless it is genuinely impossible on WebGL2 (compute-heavy ops only).
- **What WebGPU buys specifically**:
  - Compute shaders → real particle systems, fluid sims, histogram/CDF passes for adaptive color, GPU-side FFT for video-reactive ops without a CPU readback.
  - Storage buffers → audio feature buffers (FFT bins, RMS history, onset markers) live on the GPU instead of being uniform-uploaded each frame.
  - Multiple render targets in one pass → many of the modulate-family ops fold into a single dispatch.
  - Bindless-ish texture access → cleaner multi-input composition for the Blend family.
- **Coupling math is unchanged.** The `coupling.ts` mapping (one normalised parameter → video range + audio range) is backend-agnostic. WebGPU only changes how the video side executes the mapped value.
- **WebGPU is gated to the desktop phase** because Electron pins Chromium ≥ the version that ships stable WebGPU, removing the browser-availability matrix. The web build keeps WebGL2 as the default backend and may expose WebGPU behind a feature flag once Safari WebGPU coverage is acceptable for the web target audience.

### 13.3 Desktop-only affordances (in scope for this phase)

- **Lower-latency audio**: use Electron's `--enable-features=AudioServiceOutOfProcess` and tune `AudioContext` latency hint to `interactive`; expose an explicit "audio buffer size" preference (128/256/512). Target round-trip < 12 ms on macOS CoreAudio, < 20 ms on Windows WASAPI exclusive-mode-equivalent, < 25 ms on Linux PipeWire. Not a guarantee on every device — a target.
- **File system**: native open/save for video files, presets, project bundles, and rendered output without the browser's File System Access API quirks. Drag-and-drop a video file from Finder/Explorer onto the window.
- **Hardware MIDI**: Web MIDI works in Chromium; on macOS this gives stable hardware controller mapping without Safari's gaps.
- **Offline render**: GPU-paced offline render of a project to ProRes/H.264/PNG sequence with synchronized audio. Not realistic in the web build; native FFmpeg sidecar in the desktop build.
- **System-audio capture**: optional, platform-specific, behind permission. macOS via ScreenCaptureKit (Sequoia+); Windows via WASAPI loopback; Linux via PipeWire. Not promised, listed as deferred.
- **Persistent project format**: `.avsynth` bundle (zipped JSON graph + linked media references + preset cache). Same format readable by the web build for share-link interop.

### 13.4 Out of scope for this phase (explicitly)

- Native VST/AU plugin host. Different product. If pursued, it is a separate track using a JUCE/CLAP shell, not Electron.
- Shipping av-synth itself as a VST/AU/CLAP plugin. Different product. Would require rewriting the audio engine outside the browser sandbox.
- Mobile (iPadOS) packaging. Web build covers iPad via Safari; native iPad is a separate phase if pursued.
- Custom GPU compositor outside the browser stack. The whole point of Electron + WebGPU is to keep the web stack.

### 13.5 Engineering preconditions (must hold before this phase opens)

1. Web build is at public/professional release — all gates from §10.5 / §10.6 / the release policy in `CLAUDE.md` §2 are green.
2. `RenderBackend` interface is landed in the web build with `webgl2` as the only implementation, so the WebGPU backend can be added without architectural churn.
3. Operator registry is backend-aware: each operator declares which backends implement it. CI fails if a registered operator is missing its declared backends.
4. Coupling tests are backend-parametrised: the AV-coupling acceptance tests run against every available backend and must produce identical mapped values (the *mapping* is backend-independent; only the *render* differs).
5. Audio engine has zero allocations in `process()` across every worklet, verified by a soak test, before any desktop-headroom claim is made. Desktop does not fix GC stutter; it only moves the budget.

### 13.6 Acceptance criteria for the desktop phase

- App boots on macOS (Apple Silicon + Intel), Windows 10/11 x64, Linux x64 (Ubuntu LTS + one rolling distro), with code-signed installers on macOS and Windows.
- WebGPU backend is the default on desktop; WebGL2 backend is a fallback toggle.
- Every operator that runs on web also runs on desktop with identical mapped output for the same normalised parameter (parity test in CI).
- At least one operator family in `§12 Planned av-synth originals` that was deferred for web due to compute requirements (e.g. particle-based modulate, GPU-side audio analysis) ships in the desktop build, demonstrating the WebGPU headroom.
- Audible sign-off in `qa/reviews/` repeats on the desktop build under each supported OS, not just inherited from web.
- Crash-free session rate ≥ 99% over a 4-hour soak on each OS with a representative project.
- Installer + first-run experience reviewed: no Node-bridge security warnings, no unsigned-binary warnings, no permission prompts that the user does not understand.

### 13.7 Status

- `not-started` (planned final phase). No Electron scaffolding, no WebGPU backend, no `RenderBackend` interface yet. Web build comes first; this section exists so the architecture decisions made before the desktop phase do not accidentally close the door on it.

---

## 14. Granulation engine (core, dual-domain)

This section is now a **summary and release-policy wrapper** around the real engineering contract in [references/granulator-port-spec.md](/Users/marcscully/Projects/av-synth/references/granulator-port-spec.md:1). If this section and the reference spec ever diverge, the reference spec wins and this section must be updated in the same change.

### 14.1 Product rule

- The shipped audio surface is: **granulator + feedback delay + master limiter**.
- The shipped video surface is: **video grain engine feeding the existing Hydra-style FX rack** from §1–§7.
- The shared public modulation surface is: **six global LFOs first**, with MIDI/MPE and selected video-derived features joining through the same routing model.
- The old multi-engine audio rack and the old "every Hydra op has an audio twin" framing are historical context only.

### 14.2 Authoritative control surface

The shipped granulator control set is the 14-control surface defined in [references/granulator-port-spec.md](/Users/marcscully/Projects/av-synth/references/granulator-port-spec.md:112):

- `position`
- `position_jitter`
- `pitch`
- `pitch_jitter`
- `duration`
- `duration_jitter`
- `density`
- `distribution`
- `envelope`
- `pan_spread`
- `y_spread`
- `reverse_probability`
- `voice_count`
- `mode` (`classic` / `loop` / `cloud`)

Important anti-drift note: there is **no separate `attack/decay` control in v1**. Envelope asymmetry is expressed by envelope choice (`expdec` / `rexpdec`) unless the spec is amended later.

### 14.3 Architectural commitments

- One grain event drives both domains with shared `voice_id`, shared timing, and identical per-grain random statistics.
- Audio follows the Bencina-style split of scheduling, voice management, and rendering described in [references/granulator-port-spec.md](/Users/marcscully/Projects/av-synth/references/granulator-port-spec.md:15).
- The scheduler still uses the same grain-event contract to feed the video twin, but transport is now pragmatic rather than ideological: non-isolated sessions may use `MessagePort`, while isolated builds may move grain events over a fixed `SharedArrayBuffer` ring so the audio worklet stays zero-allocation under dense clouds.
- The video source path uses the pre-decoded texture-ring strategy from the reference spec; on the web this is intentionally a short-form-footage path with explicit refusal of oversize clips rather than a hidden streaming fallback.

### 14.4 DSP and performance commitments

- Shipped builds use **8-point windowed sinc** as the default interpolator and may fall back to **4-point Hermite** under CPU pressure; linear interpolation is architecture-scaffolding only and never a shipped endpoint.
- Anti-alias filtering on upward pitch shift, reverse playback support, zero-allocation `process()`, and the 32-default / 64-max voice model are all part of the contract.
- The quality bar is benchmark parity against Granulator II by listening, not just "it works."

### 14.5 MIDI and modulation

- MIDI is first-class, not stretch scope.
- MPE support, MIDI-learn, and note-on latency targets are part of the release contract.
- The six-LFO bank in `src/core/mod-bank.ts` remains the first public modulation language.
- Video-derived features such as `v.luma`, `v.flux`, and `v.edge` remain valid modulation sources into granulator parameters, but should arrive through the same routing model rather than through standalone monitor-heavy UI.

### 14.6 QA and acceptance policy

The public audio release gate is now narrow:

- granulator listening/performance/timing quality
- feedback delay sanity and true-peak safety
- master limiter compliance

Legacy operator-audio audits remain useful as historical/internal coverage where they still exercise shared DSP blocks, but they are no longer the public audio acceptance story.

The acceptance criteria are the ones defined in [references/granulator-port-spec.md](/Users/marcscully/Projects/av-synth/references/granulator-port-spec.md:216), with one important browser-facing clarification: video grain sync is judged as frame-accurate state alignment plus perceptual onset coherence, not as a literal 3 ms visible-pixel requirement.

### 14.7 Reference stack and license boundary

The current reference stack is fixed in:

- [references/README.md](/Users/marcscully/Projects/av-synth/references/README.md:1)
- [references/granulator-port-spec.md](/Users/marcscully/Projects/av-synth/references/granulator-port-spec.md:1)

That stack is:

- Borderlands source for AV instrument shape
- Csound `partikkel` for feature taxonomy
- Bencina for implementation architecture
- Brandtsegg LAC 2011 for theory/cut confidence
- Monolake Granulator II pack for listening calibration only

No GPL/LGPL source from `references/` is copied into `src/`.

### 14.7a Multi-source routing model (2026-05-28, landed)

The video graph previously had one canonical input — `source` (the loaded clip). A second loaded video ("Source B") existed as a renderer-side FBO bound to texture unit 8, but was only addressable through the bespoke `sourceBlend` operator. That violated the coupling-layer principle in this document: routing should be uniform, not per-op.

Model now in place (G1–G5 + G8 landed 2026-05-28; G6/G7 deferred and tracked in `todo.md`):

- Add a second source node `sourceB` alongside `source` in the patch graph (`src/core/graph.svelte.ts`).
- Every two-input operator's primary/secondary input picker already enumerates `source` + bus returns `src(o0..o3)`; `sourceB` joins that list whenever a second clip is loaded.
- Bus 1's chain-start defaults to `sourceB` (so "A occupies monitor o0, B occupies monitor o1" works out of the box); buses 0/2/3 still default to `source`. Users override per-node.
- The dedicated `sourceBlend` op becomes redundant with `blend(primary=source, secondary=sourceB)` — kept for now, deprecation deferred.

This is a routing / coupling change, not a shader or operator-set change. No new audio engines, no expansion of the granulator surface. It is compatible with both the granulator-first audio direction (§0a) and the Hydra-shaped video rack (§1–§7).

If the routing model ever needs to scale to N sources (live webcam, procedural patterns, MIDI-selected clip slots), the same node-in-graph pattern generalises — `sourceC`, `sourceD`, etc. — without changing the two-input operator surface. v1 ships with exactly two sources.

### 14.8 Status

- `in-progress` (2026-05-24): the reference stack is in-repo, the spec is written, and the granulator implementation is materially underway.
- Landed already: grain-buffer decode path, clip-derived fps plumbing, app-owned `mode` / `envelope`, preset recall, LFO-bank targeting, per-channel MIDI pitch routing, Hermite auto-dispatch, listening-pack generation, latency-proxy harness, true-peak gate fix, the public feedback-delay card, the shared-feedback app wiring, and the final removal of the legacy rack from the mounted Audio tab.
- Remaining release-track work is no longer "start implementation." It is the narrower closure set captured in `todo.md`: the 4-hour soak confirmation, reference-hardware CPU re-measurement, D3 listening verdicts, D4 real loopback latency run, and final staging/public sign-off.

---
