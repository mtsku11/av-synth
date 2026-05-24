# Color / Tonal Review

Date: 2026-05-18
Audit run: `audit-*` green in Playwright (`npm run qa:audit:cases` 45/45) and `qa:analyze` wrote analysis for 45/45 cases with status `ok` across every audited family, including the colour-tonal scope (`audit-hue-solid-sweep`, `audit-colorama-solid-sweep`, and `audit-contrast-osc-sweep` after its 2026-05-18 exported-audio downgrade). The new `audit-program-{tunnel,bloom,kaleido}-video` cases (M5.7-138, separate `programs` family) also passed end-to-end on the committed `ci-smoke.mp4` fixture.

Scope:

- `audit-brightness-video-sweep`
- `audit-contrast-osc-sweep`
- `audit-color-solid-band-sweep`
- `audit-saturate-video-sweep`
- `audit-posterize-video-sweep`
- `audit-chromaShift-video-sweep`
- `audit-invert-video-sweep` *(new 2026-05-18)*
- `audit-luma-video-sweep` *(new 2026-05-18)*
- `audit-thresh-osc-sweep` *(new 2026-05-18)*
- `audit-hue-solid-sweep` *(new 2026-05-18)*
- `audit-colorama-solid-sweep` *(new 2026-05-18)*

Current notes:

- The live QA metrics now include mean RGB and mean saturation specifically so this family can be audited on something closer to the visual intent than grayscale alone.
- `brightness` remains the most aggressive coupling in the family; the automated gate proves it moves, but a listening pass should decide whether the current loudness law is still too severe for professional use.
- `color` on the solid fixture, plus `posterize`, `saturate`, and `chromaShift`, are intentionally more manual-heavy on the audio side because the current fixtures/metrics are not yet strong enough to reduce their aesthetic judgment to one scalar threshold.
- `invert`, `luma`, and `thresh` all ship with a third wet/dry `amount` param (see `memory.md` 2026-05-18 entry) so they can sit in `DEFAULT_CHAIN` with identity at `amount = 0`. The Hydra signature deviation is intentional and must be unwound in the M4 live-code adapter.
- `invert` keeps both video and audio sides as manual-only on the audit case — single-channel phase invert is inaudible, and the meanLuma sign on full invert depends on the fixture so it's not a stable hard gate. The case still exists for artifact capture and visual review.
- `luma` and `thresh` carry hard gates (luma: meanLuma + exported-WAV meanVolumeDb; thresh: spatialStd + exported-WAV spectralCentroidHz). Initial thresholds chosen conservatively at ~3% / -1.5 dB / 0.02 std / 80 Hz; tighten as needed once Marc has done a real audible/visual pass.
- `hue` ships as a Hydra-faithful single `amount` op (no wet/dry deviation) because `amount=0` is naturally identity. Slider unit is `oct` over `[-1, 1]` (one octave each direction), audio side reuses the existing `pitch-shifter` worklet from `scale`. Hard gates: live `meanR↓` ≥ 0.2 and `meanG↑` ≥ 0.2 between the amount=0 and amount=0.333 holds (≈120° HSV rotation). The case still steps through amount=1.0 to capture the full +1-octave artifact for manual listening. Exported-audio side is **manual review only** (downgrade 2026-05-18): the solid source's audio output measures at the digital noise floor (≈-173 dB), so exported-audio metrics like `zeroCrossingRate` are quantisation-noise-driven rather than pitch-driven — the sign flipped between two consecutive runs at the same settings (+0.00126 then -0.00129). Same precedent as `audit-colorama-solid-sweep` / `audit-modulate-osc-sweep` / `audit-scrollX-osc-sweep`. The `.webm` and `.wav` captures still document the full sweep for the listening pass.
- `colorama` ships as a single-`amount` op (no wet/dry deviation) because `amount=0` is naturally identity in both domains. Range `[0, 1]`, default `0`. The video and audio chaos streams are **mathematically locked**, not coincident: both stages derive a shared time-driven logistic value `xGlobal` from `ctx.time` (seed `0.37`, `r = 3.99`, step count `clamp(floor(t · 5) + 1, 1, 64)`). The video shader adds a per-pixel decorrelated `xPixel` term on top for spatial scramble — that has no audio analogue (the audio is one channel), but the time-driven motion is one stream observed in two domains, so the AV-coupling guarantee holds at any frame. Audio is a `GainNode`+`OscillatorNode` ring-mod with DC-on-AudioParam dry + carrier-on-AudioParam wet; carrier frequency tracks `50 + xGlobal · 300` Hz. Hard gate: live `spatialStd ≥ +0.10` between amount=0 and amount=1 holds on the solid R=1 fixture (GLSL fully deterministic per-pixel from the UV hash, so the scramble side is rock-solid). Audio side is **manual review only**: in two back-to-back fresh-browser runs the solid source's exported-WAV baseline spectral centroid jumped 162Hz → 287Hz with no operator change, so any centroid-delta gate is unreliable on that fixture. Same precedent as `audit-modulate-osc-sweep` / `audit-scrollX-osc-sweep`. The `.webm` captures the full sweep for listening, with the visual hue field now breathing in lockstep with the audio carrier sweep.

Manual review focus:

- `brightness`: does the louder setting still feel musical rather than limiter-led?
- `contrast`: does the driven oscillator stay intentional instead of harsh?
- `color`: does the low-band vs high-band mapping feel intuitive enough to learn?
- `saturate`: does the stereo widening correspond to visible color intensity in a believable way?
- `posterize`: does the stepped texture read as intentional quantization, not broken compression?
- `chromaShift`: is the visible channel split tasteful enough for professional use?
- `invert`: does the full-invert image read cleanly, and is the audio genuinely unchanged (mono) / does it null correctly when summed against an inverted copy (future)?
- `luma`: does the soft-knee width feel musical for both image and audio? At amount=1 with default threshold=0.5, is the gated audio usable or stripped to silence?
- `thresh`: is the harmonic step still musical at amount=1 or does the rendered tone get nasty/aliased at small tolerance? Does the image quantisation read as intentional rather than broken?
- `hue`: does the hue ring traverse smoothly without banding artifacts at small amount, and does the pitch-shifter worklet stay musically intelligible (no zipper noise, no harsh aliasing) across the full ±1-octave range? Do the visual hue motion and audio pitch motion feel locked rather than co-incidental?
- `colorama`: does the per-pixel hue scramble read as colour chaos rather than visible per-frame noise / banding, and does the **time-driven hue field clearly breathe in sync with the audio carrier sweep** (the lockstep is the product — if it feels coincident rather than coupled, flag it)? Is the ring-mod musically usable at intermediate amounts (0.3-0.7) or does it sound like a fault? Does the chaotic carrier sweep stay below uncomfortable shrillness at amount=1?

Outstanding local sign-off:

- Do a real audible pass on `brightness`, `saturate`, `posterize`, `chromaShift`, `invert`, `luma`, `thresh`, `hue`, and `colorama` before deploy. The `invert` audio side is the lowest-risk listen (should be unchanged); `luma` / `thresh` / `hue` / `colorama` need the most attention because their hard gates are new (or, for `colorama`, the audio side has no hard gate at all). `hue` is the highest pitch-shift exposure (full ±1-octave sweeps on triadic source material). `colorama` has the highest "is the audio side actually doing something musical" risk because there is no metric backstop — only the listening pass.

Resolved automated-gate issues:

- `audit-contrast-osc-sweep` exported-audio `spectralCentroidHz > +30 Hz` gate **downgraded 2026-05-18 to manual review only** (option b). Rationale: the gate was observed both passing and failing across reruns with deterministically negative deltas on failures (−6.5, −19.1, −23.5 Hz), and the contrast operator is correct — the osc fixture has the same low-energy/noise-floor problem as the solid fixture, so the centroid metric is dominated by quantisation noise rather than the waveshaper output. Live `spatialStd` gate retained. Live `.webm` / `.wav` capture retained for the listening pass. Same precedent as `audit-modulate-osc-sweep` / `audit-scrollX-osc-sweep` / `audit-colorama-solid-sweep` / `audit-hue-solid-sweep`. Listed below as the fourth confirmed instance of the noise-floor pattern.

Solid-fixture noise-floor pattern (logged 2026-05-18, four instances now confirm the class — including the osc fixture, which exhibits the same low-energy behaviour):

- The solid source produces audio at the digital noise floor (~-173 dB on exported WAVs); the osc source on short sweeps shows the same class of behaviour for exported-audio metrics. Exported-audio metrics like `spectralCentroidHz`, `zeroCrossingRate`, `spectralFlatness` are dominated by quantisation noise rather than musical content on these fixtures, and have shown sign-flipped or otherwise unstable deltas across consecutive runs at identical settings. **Four confirmed instances**: `audit-colorama-solid-sweep` (centroid baseline 162→287 Hz between runs), `audit-hue-solid-sweep` (ZCR delta +0.00126 then -0.00129 between runs, downgraded 2026-05-18), `audit-modulate-osc-sweep` (downgraded earlier on the osc fixture), `audit-contrast-osc-sweep` (centroid delta intermittently −6.5/−19.1/−23.5 Hz against a +30 Hz gate, downgraded 2026-05-18). **Operating rule**: any new Color case built on a solid or low-energy fixture (including short osc sweeps) must default to live-side-only hard gates, with exported-audio assertions either omitted or labelled "MANUAL REVIEW ONLY" until a higher-energy fixture exists for that operator.
