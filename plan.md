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
- **Audio analogue**: **decimation / sample-rate reduction**. Holding a sample for `N` frames is the time-domain analogue of holding a UV for `N` pixels.
  - `pixelX` → decimation factor on L; `pixelY` → on R (or mono = max).
- **Status**: `todo` (the prototype's `crush` is *posterize*, not pixelate).

### 2.4 `repeat(repeatX=3, repeatY=3, offsetX=0, offsetY=0)`

- **Video**: `uv → fract(uv · [repeatX, repeatY] + offset)`.
- **Audio analogue**: **multi-tap comb filter**. Spatial repetition at period `1/repeatX` ↔ temporal repetition at delay `1/(repeatX · baseFreq) · loopLen`, where `loopLen` is a transport-locked window (default = 1 bar). `repeatX` taps, equal-spaced. `offset` shifts the tap phase.
- **Status**: `todo`.

### 2.5 `repeatX(reps=3, offset=0)` / `repeatY(reps=3, offset=0)`

- **Video**: 1-axis tile.
- **Audio analogue**: comb on left or right channel only (or feedforward vs feedback comb if we treat X as FF and Y as FB).
- **Status**: `todo`.

### 2.6 `kaleid(nSides=4)`

- **Video**: polar fold — `mod(angle, 2π/n)` then mirror.
- **Audio analogue**: **wavefolder with n-fold symmetry**. A wavefolder maps `x → triangle_n(x)` where `triangle_n` reaches `n` peaks per input cycle; equivalently, hard-fold of the input around `n` thresholds.
  - `nSides` → number of folds per input cycle. Generates the same n-th-order harmonic structure that the visual `n`-fold rotational symmetry exhibits in 2D Fourier space.
- **Status**: `partial` (prototype has video `kaleid` + an audio waveshaper called "fold" — they need to be coupled mathematically rather than aesthetically).

### 2.7 `scrollX(amount=0.5, speed=0)` / `scrollY(amount=0.5, speed=0)`

- **Video**: translate UVs.
- **Audio analogue**: **delay-line scrub** (X) and **stereo pan** (Y), or — more rigorously — both axes are *delay-tap position* in a stereo delay matrix.
  - `amount` → pan position (or fixed delay offset).
  - `speed` → LFO on the pan/delay (auto-pan, vibrato).
- **Status**: `todo`.

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
- **Status**: `present` (video). Audio side is `todo`. Currently the prototype's video shift is RGB *spatial* offset (chromatic aberration), not hue — note discrepancy with full-Hydra `shift`; flag in coupling spec.

### 3.3 `invert(amount=1)`

- **Video**: `colour → mix(colour, 1 - colour, amount)`.
- **Audio analogue**: **phase invert with crossfade**. `s → mix(s, -s, amount)`. Indistinguishable on a single channel but produces nulling on summed channels — the audio version of the inverted-spectrum visual effect appears in M/S mixes.
- **Status**: `todo`.

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
- **Status**: `todo`.

### 3.7 `thresh(threshold=0.5, tolerance=0.04)`

- **Video**: hard threshold to b/w.
- **Audio analogue**: **Schmitt-trigger / 1-bit comparator** — `s → sign(s − threshold)` with hysteresis `= tolerance`. Generates square-wave from a sinusoid; harmonic-rich.
- **Status**: `todo`.

### 3.8 `color(r=1, g=1, b=1, a=1)`

- **Video**: per-channel multiplier (gain).
- **Audio analogue**: **3-band EQ**. R/G/B map to low/mid/high band gains (linear or dB). `a` → master gain.
- **Coupling**: this is the most explicit "RGB-as-3-band" coupling in the system. Bands are split at fixed crossovers (default: 300 Hz, 3 kHz). Documented in `coupling.ts`.
- **Status**: `todo`.

### 3.9 `saturate(amount=2)`

- **Video**: HSV saturation multiplier.
- **Audio analogue**: **stereo width** (M/S saturation: `S → S · amount`, clamp). High `saturate` ↔ wide stereo, `0` ↔ mono. Audio "saturation" in the distortion sense is reserved for `contrast`.
- **Status**: `todo`.

### 3.10 `hue(amount=0.4)`

- **Video**: HSV hue rotation by `amount · 2π`.
- **Audio analogue**: **constant-interval pitch shift** (preserves harmonic structure, rotates the entire spectrum on a log axis). `pitchRatio = 2^(amount · 12 / 12) = 2^amount` (one octave per unit). Alternative for cheap version: all-pass phase rotation (Hilbert transform with frequency-independent phase shift `amount · 2π`).
- **Status**: `todo`.

### 3.11 `colorama(amount=0.005)`

- **Video**: chaotic per-pixel hue swap; visually a colour scramble.
- **Audio analogue**: **chaotic ring-modulation** — carrier frequency is a Hénon or logistic map iterated each block, `amount` controls the chaotic-parameter regime. Or: per-bin spectral permutation in an FFT processor.
- **Status**: `todo`.

### 3.12 `sum(scale=[1,1,1,1])`

- **Video**: scalar `dot(rgba, scale)`.
- **Audio analogue**: **channel down-mix**. `mono = dot([L, R, ...], scale)`.
- **Status**: `todo`.

### 3.13 Channel accessors `.r .g .b .a`

- **Video**: pick one channel as luminance.
- **Audio analogue**: **band-split + pick**. Pull one band from the 3-band split and route it forward.
- **Status**: `todo`.

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
- **Status**: `todo`.

### 5.3 `modulateScale(tex, multiple=1, offset=1)`

- **Video**: scale UVs by `multiple · tex.r + offset`.
- **Audio analogue**: **modulated time-scale = pitch modulation** = **vibrato** in the small-amount limit. Drive a varispeed resampler from `mod`.
- **Status**: `todo`.

### 5.4 `modulatePixelate(tex, multiple=10, offset=3)`

- **Video**: pixelation amount driven by `tex`.
- **Audio analogue**: **modulated decimation** — sample-rate-reduction factor varies with the modulator. Drives glitch / "stutter" textures.
- **Status**: `todo`.

### 5.5 `modulateRepeat(tex, repeatX=3, repeatY=3, offsetX=0.5, offsetY=0.5)`

- **Video**: repeat counts driven by `tex`.
- **Audio analogue**: **modulated comb-tap count** — number of taps varies. Cheap implementation: modulated single-tap delay = **chorus / flanger** (when `repeat` ≈ 1) or **tape-stop** (when `repeat → 0`).
- **Status**: `todo`.

### 5.6 `modulateScrollX(tex, scrollX=0.5, speed=0)` / `modulateScrollY`

- **Video**: pan driven by `tex`.
- **Audio analogue**: **modulated pan / modulated delay tap** — auto-pan whose position is set by the modulator.
- **Status**: `todo`.

### 5.7 `modulateKaleid(tex, nSides=4)`

- **Video**: kaleid amount driven by `tex`.
- **Audio analogue**: **wavefolder drive modulation** — fold count or fold gain modulated by `mod`. This produces dynamically evolving harmonic content keyed to the modulator.
- **Status**: `todo`.

### 5.8 `modulateHue(tex, amount=1)`

- **Video**: hue rotation driven by `tex`.
- **Audio analogue**: **modulated SSB shift** — frequency-shift amount varies with `mod`. Creates barber-pole / Shepard-tone-like glissandi when the modulator is a ramp.
- **Status**: `todo`.

---

## 6. Output & buses

| Hydra | Audio analogue |
|---|---|
| `.out(o0)` | route the chain's output to audio bus 0 (4 buses total: `o0..o3`, master-summed by default). |
| `render(o0..o3)` | display/route all four buses simultaneously (audio: monitor all four sub-mixes). |

Status: `partial` (one implicit bus).

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

Status: `todo` for all.

---

## 8. Audio input — `a.fft[i]`, `a.setBins`, `a.setSmooth`, `a.setCutoff`, `a.setScale`

Hydra's audio-input subsystem feeds FFT bins into video as numeric values. We need it bidirectional:

- **Audio → video**: `a.fft[i]` is a bin magnitude; usable as a parameter input to any video operator.
- **Video → audio**: dual API `v.luma`, `v.flux`, `v.edge` exposes per-frame video features (mean luminance, frame-to-frame difference, edge density) as parameter inputs to any audio operator.

Both directions share the same smoothing/cutoff/scale conventions.

Status: `todo`. The prototype has no `AnalyserNode` and no video-feature extractor.

---

## 9. Operators implemented in the prototype but not in Hydra

For honesty: the prototype has `feedback` as a top-level parameter (frame-blend with the previous output). In Hydra this is achieved by `src(o0)` + `.blend()`. Reconcile:

- Make the modular renderer support `src(oN)` cleanly, then express `feedback` as a preset shorthand (`src(o0).blend(o1, fb)`).
- Audio-side feedback (prototype's long delay's feedback gain) is then literally the same parameter as visual feedback, both routing into a `mix(current, previous, fb)` op.

---

## 10. Summary status table

| Family | Total ops | `present` | `partial` | `todo` |
|---|---:|---:|---:|---:|
| Sources | 8 | 0 | 2 | 6 |
| Geometry | 7 | 0 | 3 | 4 |
| Color | 13 | 1 | 1 | 11 |
| Blend | 7 | 0 | 0 | 7 |
| Modulate | 8 | 0 | 1 | 7 |
| Output/buses | 2 | 0 | 1 | 1 |
| Array modifiers | 5 | 0 | 0 | 5 |
| Audio I/O | 5 | 0 | 0 | 5 |
| **Total** | **55** | **1** | **8** | **46** |

Roughly 16% of the full Hydra surface area is wired up in the prototype, none of it with rigorous audio coupling. The work ahead is mostly green-field; see `todo.md`.

---

## 11. Open mathematical questions (parked)

- **Spatial-frequency unit for sources**. Default chosen: `osc(N)` → `N Hz`. Alternative: `N cycles per screen-width × baseFreq`. Decision in `memory.md`.
- **3-band crossover frequencies for `color()`**. Default: 300 Hz / 3 kHz. Should be configurable per-preset.
- **`hue` pitch-shift law**. `2^amount` (octaves) vs `1200 · amount` cents — choose unit-of-presentation in UI without changing the math.
- **`scrollX` vs `scrollY` audio asymmetry**. Treating X as time-domain delay and Y as stereo pan is a design choice — alternative is the opposite. Decision in `memory.md`.
- **`colorama` chaotic-map choice**. Hénon, logistic, or per-bin scramble. Pick one, document why.
- **`solid` RGB → triad mapping**. R=1, G=3/2, B=2 is one option; major triad (1, 5/4, 3/2) and tritone (1, √2, 2) are alternatives. UI-selectable.
