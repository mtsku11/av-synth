# Granulator quality-gate sweep — 2026-05-23

Verdict document for the six §13 gates in `references/granulator-port-spec.md`.

This is the **B2** pass, taken in one sitting on 2026-05-23. Gate 1 (listening parity) is **deferred to D3** per user direction; gates 2/3/4 are honestly scoped as sub-passes (B2.2/D4/B2.3 respectively) rather than handwaved; gates 5 and 6 have real measurements today.

Release implication: **public/professional release stays blocked.** This pass closes the lowest-cost gates and turns the rest from "unknown" into "scheduled with named harnesses."

---

## Status at a glance

| # | Gate | Status | Owner / next |
|---|------|--------|--------------|
| 1 | Listening-test panel (Granulator II parity) | **HARNESS LANDED; human reviews still owed** | Run `npm run qa:granulator:listening`, then complete the reviewer sheet in `2026-05-24-d3-d4-harnesses.md` |
| 2 | Video grain accuracy (fps, scrubbing, AV alignment) | **(a) fps PROVISIONAL PASS on M4 Pro** (median 100 fps, worst 83 fps); **(b) scrubbing PASS** — grain-buffer readback at 6 positions, max Δ=3 vs expected ramp brightness, tolerance ±8; **(c) AV-alignment PASS** (worst &#124;drift&#124; 27.5 ms ≤ 36 ms gate over 11 playback epochs) | 2020-class MBP fps re-measurement owed |
| 3 | MIDI latency ≤ 5 ms (note-on → first audible grain) | **PROXY PASS; hardware loopback still owed** — internal marker-to-grain proxy measured **2.993 ms** on this host | Run `npm run qa:granulator:latency` for regression protection; final sign-off still needs the manual loopback probe in `2026-05-24-d3-d4-harnesses.md` |
| 4 | Zero-allocation 4-hour soak (64 voices, no major GC) | **HARNESS + ATTRIBUTION LANDED; full 4-hour run owed** — 60 s short verification with worklet-thread attribution shows worklet major=0, minor=4 (page-wide major=3, minor=190) | Run `GRANULATOR_SOAK_S=14400` on demand |
| 5 | CPU < 20% of one core (32 voices, 8-tap sinc, 2020 MBP) | **HEADROOM-PASS on M4 Pro** (median **0.16%**) — canonical sign-off on the spec's reference-class hardware (2020 Intel MBP) still owed | Re-run `qa/scripts/granulator-cpu.mjs` on a 2020-class MBP (machine access TBD) |
| 6 | Master bus ≤ 0 dBFS true-peak (any granulator + feedback combo) | **PASS (letter and spirit)** after the √N normalisation fix landed. Pre-limit true-peak -0.06 dBFS, post-limit -1.79 dBFS at adversarial settings. The brick-wall limiter is back in its intended safety-net role. | Re-measure if any gain-staging or voice-pool change lands. |

**Gate 6 PASS after the √N normalisation fix landed.** The initial B2.4 measurement found a hard FAIL (+0.15 dBFS post-limit), which triggered the gain-staging design follow-up. After the √N normalisation landed in `public/worklets/granulator.js`, the same adversarial settings produce -0.06 dBFS pre-limit and -1.79 dBFS post-limit — the limiter is back in its intended safety-net role.

A bug was also found and fixed in the truepeak FIR cutoff during this pass — the original `0.25 / 4 = 0.0625` was a half-width filter that biased the measurement low. Both the pre-limit Node harness and the B2.4 Playwright spec now use the canonical 4×-upsample cutoff of 0.125 (cycles/sample of the 4× rate, i.e. original Nyquist Fs/2). Without the cutoff fix, the gate #6 spirit issue would have been hidden behind biased-low numbers.

---

## 1. Listening-test panel (gate #1) — harness landed, reviews still owed

Spec §13 #1 calls for ≥ 2 reviewers comparing av-synth granulator vs Granulator II on `qa/fixtures/granulator-source-stereo-48k.wav`, judging artefact-freeness, ±12/±24 st musicality, cloud-density stability at 100+ grains/sec, and parameter feel.

This pass lands the repeatable D3 assets instead of leaving the gate as prose-only:

- committed input fixtures: `qa/fixtures/granulator-held-tone-48k.wav`, `qa/fixtures/granulator-source-stereo-48k.wav`
- av-synth render pack command: `npm run qa:granulator:listening`
- review sheet + protocol: `qa/reviews/granulator/2026-05-24-d3-d4-harnesses.md`

The actual ≥2-reviewer listening verdict is still open. Status: **HARNESS LANDED, HUMAN REVIEWS OWED**.

---

## 2. Video grain accuracy (gate #2)

Spec §13 #2 requires:
- (a) ≥ 30 fps at 720p × 32 voices,
- (b) frame-accurate scrubbing under `grain-composite` mode,
- (c) audio grain onset and video envelope phase aligned to within one rendered frame + one audio block.

### (a) fps — measured today, PROVISIONAL PASS on M4 Pro

Harness: `qa/e2e/b2.2-video-fps.spec.ts` — sets the viewport to 1280×720, loads `qa/fixtures/ci-smoke.mp4`, applies `grainField`, overrides `voiceCount` to 32, starts transport, warms up for 2 s, then measures rAF intervals for 30 s. Results in `qa/results/granulator-fps.json`.

Measurements (M4 Pro, headless Chrome):

| stat | value |
|------|-------|
| frames over 30 s | 2998 |
| median fps | 100.0 |
| p5 fps | 86.3 |
| p1 fps (worst tail) | 84.1 |
| worst single frame | 83.4 fps (≈12 ms) |

The 100 fps median sitting exactly at the vsync ceiling (10 ms interval) indicates the renderer is not bottlenecked on this hardware. Worst-case frame at ~12 ms still clears the 30 fps gate by 2.7×.

Honest interpretation:
- Same 3-4× M4-Pro → 2020-Intel-i7 scaling caveat as gate #5 applies. Worst-frame projection on 2020-class MBP: 83 fps / 3-4 = **21-28 fps**, which can land **below** the 30 fps gate. Median projection: 100 / 3-4 = 25-33 fps, which can land **at or below** the gate.
- Therefore: provisional pass on M4 Pro, **gate #2(a) signoff is not yet earned on the reference hardware.** Re-measurement on a 2020-class MBP is queued.

### (b) frame-accurate scrubbing — PASS (both layers)

Gate claim: when `granulator.position = P`, the grain composite source reads from frame `round(P * frameCount) % frameCount`.

**B2.2.2-a — scrubbing math invariant (landed 2026-05-23).** 14 vitest tests in `src/core/grain-scheduler.test.ts` describe block `'B2.2.2-a — frame-accurate scrubbing (gate §13 #2b)'` verify the `computeFrameIndex` function �� which is the only code path that maps source time to frame index — across:

- Full 0.0–1.0 position range (7 named positions, all computed against the invariant `round(position * frameCount) % frameCount`)
- Monotone-increase property (100-step sweep confirms frameIndex never decreases mid-range)
- Stability at `elapsedSec=0` (confirms the scrub snapshot is independent of grain duration)
- Non-30fps clips (25 fps, 125-frame clip)
- Edge cases: `frameCount=0` returns 0 without crash, `frameCount=1` always returns 0
- Reverse pitch (`pitchRatio=-1`) at elapsed=1s reads back correctly

**B2.2.2-b — grain-buffer frame accuracy (landed 2026-05-23).** Harness: `qa/e2e/b2.2.2-scrubbing.spec.ts`. Loads `qa/fixtures/frame-ramp.mp4` (3 s, 30 fps, 90 frames, 128×128 px, solid-colour grayscale ramp where frame N has brightness `round(N × 255 / 89)`). Calls `startTransport()` → `ensureGrainAudioLoaded()` → `setSourceKind('grain-composite')` → waits for `isGrainDecoded()`. Then for each position in {0.0, 0.1, 0.25, 0.5, 0.75, 1.0}: reads the centre pixel of the GrainBuffer texture at frame `round(position × 90) % 90` via `readGrainBufferFrame()` bridge method (reads directly from the RGBA8 TEXTURE_2D_ARRAY via a temporary FBO — bypasses grain envelope, avoids `preserveDrawingBuffer:false` default framebuffer clearing). Asserts measured brightness within ±8 of expected.

Result on M4 Pro headless Chrome (2026-05-23):

| position | frame | expected | measured | Δ |
|---|---|---|---|---|
| 0.00 | 0 | 0 | 0 | 0 |
| 0.10 | 9 | 26 | 26 | 0 |
| 0.25 | 23 | 66 | 63 | 3 |
| 0.50 | 45 | 129 | 129 | 0 |
| 0.75 | 68 | 195 | 192 | 3 |
| 1.00 | 0 | 0 | 0 | 0 |

Max Δ = 3 (H.264 near-lossless encode rounding). Gate ±8 tolerance. **PASS.**

Implementation notes: `GrainBuffer.readFrameCenter()` added to `grain-buffer.ts`; `readGrainBufferFrame()` added to QA bridge; `granulatorEnabled` forced to `true` in `ensureGrainAudioLoaded()` (was `false` by default, silently preventing grain events); `VideoRenderer.readPixelAt()` added for `readCenterPixel()` bridge (reads `#prevFrame` FBO, not default framebuffer).

### (c) audio/video alignment — PASS

Harness: `qa/e2e/b2.2.3-av-alignment.spec.ts`. Inside `page.evaluate()` it registers `requestVideoFrameCallback` on the `<video>` element; inside the callback it synchronously reads `AudioContext.currentTime` (both reads happen on the same JS task so the pair captures the audio/video time relationship at one instant). Samples for 20 s under `grainField` × `voiceCount` defaults.

The fixture `ci-smoke.mp4` loops within the measurement window, so the test groups samples into "epochs" separated by `mediaTime` regressions and computes drift relative to each epoch's start. Loop-seek latency is intentionally excluded (different operation from steady-state playback alignment).

Gate: drift ≤ one video frame at 30 fps (33.33 ms) + one audio block at 48 kHz / 128 samples (2.67 ms) = **36.00 ms**.

Result on M4 Pro headless Chrome (20 s, 11 epochs, 587 drift samples):

- **Worst &#124;drift&#124;: 27.53 ms** (signed −27.53 ms — audio behind video at worst)
- Median signed drift: −6.76 ms
- 598 video frames captured by rVFC

**PASS.** Bridge addition required for this measurement: `getAudioContext(): AudioContext | null` so the page-side spec can read `currentTime` synchronously inside `rVFC`.

---

## 3. MIDI latency (gate #3) — proxy landed, loopback still owed

Spec §13 #3 requires note-on → first audible grain ≤ 5 ms in the audio path. The proper measurement is a loopback rig (audio interface output of the host → audio interface input, scope the timestamp difference). That harness is explicitly **D4** in the audit follow-up backlog.

This pass lands two D4 pieces:

- `npm run qa:granulator:latency` — internal lower-bound proxy against the app's own post-limit capture stream
- `window.__AV_SYNTH_QA__.fireGranulatorLatencyProbe()` — manual marker-click + note trigger for the real loopback/scope run

Current proxy result on this host: **2.993 ms** marker-to-grain delta (`qa/results/granulator-latency-proxy.json`).

Important honesty rule: the proxy is **not** the final gate. It is regression protection and a lower bound. Final sign-off still needs the real loopback recording protocol documented in `qa/reviews/granulator/2026-05-24-d3-d4-harnesses.md`.

---

## 4. Zero-allocation soak (gate #4) — harness + attribution landed, full 4-hour run owed

Spec §13 #4: 64 voices for 4 hours, Chrome DevTools Performance trace, zero major-GC events **attributable to the granulator worklet**.

The granulator worklet hot path was written to avoid `new` inside `process()` (voice pool pre-allocated, parameter blocks reused, sinc LUT precomputed at construction). The `qa/scripts/granulator-cpu.mjs` warm-up + 30 s loop showed no run-to-run drift that would indicate accumulating allocations, but that is not a substitute for a 4-hour Chrome trace.

Harness: `qa/e2e/b2.3-granulator-soak.spec.ts` — applies `grainField` at voiceCount 64, starts a CDP `Tracing.start` over the `v8` / `disabled-by-default-v8.gc{,_stats}` / `devtools.timeline` categories, runs for `GRANULATOR_SOAK_S` seconds (default 60), then parses the trace for `V8.GCMajorMarkCompact` / `V8.GCFinalizeMC` / `V8.GCScavenger` / `MajorGC` / `MinorGC` events. Results in `qa/results/granulator-soak-{trace,summary}.json`.

Attribution layer (landed 2026-05-23): pass 1 walks `ph='M', name='thread_name'` metadata events to build a `pid:tid → name` map, identifying the AudioWorklet thread via `/audioworklet/i` matching on `args.name`. Pass 2 counts GC events split into:
- `majorGC.count` / `minorGC.count` — **on the worklet thread (gate metric)**
- `majorGC.pageWide` / `minorGC.pageWide` — diagnostic, host page + all other threads

The test asserts both `workletThreadsFound > 0` (no false PASS if attribution silently breaks) and `worklet majorGC === 0`.

Short-form 60 s verification (`GRANULATOR_SOAK_S=60`):
- 1 AudioWorklet thread identified
- **Worklet major-GC: 0, minor-GC: 4**
- Page-wide major-GC: 3, minor-GC: 190 (i.e. the host page does have major-GC churn, the worklet thread does not)
- ~356 k trace events total

**PROVISIONAL PASS at 60 s.** The 4-hour soak is still needed before gate #4 is closed at release quality; invoke with `GRANULATOR_SOAK_S=14400 npx playwright test -g B2.3` on demand.

---

## 5. CPU (gate #5) — measured today, HEADROOM-PASS on this host

Spec target: 32 voices at 8-tap sinc holds under **20%** of one core on the reference machine (2020 MBP).

Harness: `qa/scripts/granulator-cpu.mjs` — loads `public/worklets/granulator.js` via the same stub pattern as `granulator.test.ts`, runs 30 s of audio time at 32 voices / density 60 / pitchJitter 12 cents (forces sinc engagement on every grain), repeats 5 times after a 200-block warm-up. Results in `qa/results/granulator-cpu.json`.

Measurements (M4 Pro / arm64 / darwin, 12 cores):

| run | wall ms | audio ms | ratio | % of one core |
|-----|---------|----------|-------|---------------|
| 1   | 46.24   | 30 000   | 0.001541 | 0.15% |
| 2   | 46.35   | 30 000   | 0.001545 | 0.15% |
| 3   | 48.20   | 30 000   | 0.001607 | 0.16% |
| 4   | 51.08   | 30 000   | 0.001703 | 0.17% |
| 5   | 53.63   | 30 000   | 0.001788 | 0.18% |

Median: **0.16% of one core** on M4 Pro. That is ~125× under the 20% target.

Honest interpretation:
- This host is materially faster than a 2020 MBP. A reasonable arm64-M4 → Intel-i7-2020 single-thread scaling is in the 3–4× range; the gate-relevant projection is therefore in the **0.5–0.7%** band — still well under 20%.
- The Node harness omits browser audio-thread overhead, audio-graph cross-thread scheduling, and the SoftClip + DynamicsCompressor + AnalyserNode chain that runs after the worklet. Those add fixed cost, not 100× cost.
- **Verdict for this pass:** HEADROOM-PASS as an indicator. Canonical sign-off still requires re-running `qa/scripts/granulator-cpu.mjs` on a 2020-class Intel MBP (the spec's reference hardware) and replacing the median row in this document with that result. Marc does not own one; machine access is a separate follow-up.

---

## 6. True-peak compliance (gate #6) — PASS after √N gain-staging fix

Spec target: at any combination of granulator + feedback delay settings, the master bus measures **≤ 0 dBFS true-peak**. The brick-wall limiter is the safety net, **not** the design.

Harness: `qa/scripts/granulator-truepeak.mjs` — adversarial settings (density 200, duration 80 ms, voiceCount 64, gain 1.0, panSpread 0, distribution 0 = strictly periodic), 5 s × 3 runs with different reseed values. 4× oversample via 31-tap windowed-sinc lowpass. Results in `qa/results/granulator-truepeak.json`.

Measurements (granulator-only, **pre-limiter**, in dBFS):

| run | sample-peak | true-peak |
|-----|-------------|-----------|
| 1   | +12.26      | +12.27    |
| 2   | +11.19      | +11.35    |
| 3   | +10.97      | +11.04    |

Worst-case observed true-peak: **+12.27 dBFS pre-limiter.** (Numbers re-measured after fixing the FIR cutoff; see the bug note in the top section. The prior +11.51 dBFS row was understated.)

### Post-limit (B2.4)

`qa/e2e/b2.4-postlimit-truepeak.spec.ts` runs the same adversarial settings through an `OfflineAudioContext` mirror of the production engine chain: granulator → master gain 0.7 → softClip (4× tanh × 1.35) → DynamicsCompressor (threshold −1, knee 0, ratio 20, attack 1 ms, release 50 ms). Results in `qa/results/granulator-truepeak-postlimit.json`.

Worst-case observed true-peak: **+0.15 dBFS post-limiter** (sample-peak +0.06 dBFS). The brick-wall limiter **does not bring the bus to ≤ 0 dBFS** at these settings — the 1 ms attack and -1 dB threshold are insufficient to catch inter-sample peaks at +12 dBFS input.

### Interpretation

- The granulator delivers +12.27 dBFS true-peak at adversarial settings. The current softClip (tanh×1.35, 4× oversample) + DynamicsCompressor (threshold −1, ratio 20, attack 1 ms) chain only attenuates this to +0.15 dBFS true-peak — i.e. **gate #6 is failed by the letter, not just the spirit**.
- The default `grainField` preset (density 35, voiceCount 24, gain 0.55) sits well below this and likely measures fine — but the gate is about what a user *can* configure, not the default.
- **Verdict for this pass: FAIL.** This is a release-blocking finding. The design remediation must reduce the granulator's pre-limit output so the limiter is back in its intended "safety net" role. Three viable directions:
  1. **Voice-count-aware √N normalisation inside the worklet** — divide grain amplitude by √(active voices). Physically principled (assumes uncorrelated grains); does shift perceived loudness as polyphony changes.
  2. **Tighter `gain` slider ceiling** — clamp the public param's max so the worst case sits closer to 0 dBFS by construction. Simple; reduces expressive headroom.
  3. **Tighter limiter parameters** — sub-ms attack, lower threshold. Keeps the limiter on the path but with more decisive clamping. Does not fix the spirit issue.
- Direction (1) is most aligned with the spec's framing of the limiter as a safety net. Decision needs user input before code lands.

### Resolution — √N normalisation landed

Direction (1) chosen by user. Implementation: `public/worklets/granulator.js` counts `vActive[i]` voices per block, computes target divisor `1/√(max(1, activeNow))`, and single-pole-smooths toward it with τ = 30 ms to avoid zipper noise on polyphony changes. The smoothed divisor multiplies the gain arg at the `renderActiveVoices()` call site; the inner DSP path is untouched.

Re-measured at the same adversarial settings:

| | before fix | after fix |
|---|---|---|
| pre-limit true-peak | +12.27 dBFS | **−0.06 dBFS** |
| post-limit true-peak | +0.15 dBFS | **−1.79 dBFS** |

Letter AND spirit satisfied: the granulator delivers ≤ 0 dBFS pre-limit at adversarial settings; the brick-wall limiter is back to safety-net role. The `test.fail()` annotation on `b2.4-postlimit-truepeak.spec.ts` was removed.

Side effect to be aware of: at the default `grainField` settings (≈2.45 average concurrent grains) perceived loudness drops ≈4 dB. Preset gain values may want re-tuning over time but are functionally fine.

---

## What this pass landed

- `qa/scripts/granulator-truepeak.mjs` — Node pre-limit harness, gate #6.
- `qa/scripts/granulator-cpu.mjs` — Node CPU harness, gate #5.
- `qa/e2e/b2.4-postlimit-truepeak.spec.ts` — Playwright post-limit harness, gate #6.
- `qa/e2e/b2.2-video-fps.spec.ts` — Playwright fps harness, gate #2(a).
- `qa/e2e/b2.3-granulator-soak.spec.ts` — Playwright + CDP soak harness, gate #4 (env-tunable), now with per-pid/tid attribution to the AudioWorklet thread.
- `qa/e2e/b2.2.3-av-alignment.spec.ts` — Playwright rVFC + AudioContext.currentTime correlation harness, gate #2(c).
- `public/worklets/granulator.js` — √N voice-count normalisation in `process()` (gate #6 release-blocking fix; see §6 Resolution).
- `src/App.svelte` — QA bridge gained `setGranulatorParam(name, value)`, `getAudioContext()`, `isGrainDecoded()`, `ensureGrainAudioLoaded()`, `readCenterPixel()`, `readGrainBufferFrame()` to support B2.2 overrides, B2.2.2-b grain-buffer readback, and B2.2.3 audio-time reads.
- `src/video/grain-buffer.ts` — `readFrameCenter()` added: reads centre pixel of a named frame layer via temporary FBO.
- `src/video/renderer.ts` — `readPixelAt()` added: reads `#prevFrame` FBO centre (avoids `preserveDrawingBuffer:false` default-framebuffer issue).
- `qa/e2e/b2.2.2-scrubbing.spec.ts` — Gate #2(b) e2e harness (grain-buffer frame accuracy).
- `qa/fixtures/frame-ramp.mp4` — Synthetic 3s 30fps 128×128 grayscale ramp fixture for scrubbing test.
- `qa/results/granulator-{truepeak,truepeak-postlimit,cpu,fps,soak-{trace,summary}}.json` — raw measurements (git-ignored).
- `qa/reviews/granulator/2026-05-23-quality-gate-sweep.md` — this document.

Truepeak FIR cutoff bug found and fixed in this pass: `0.0625` → `0.125` (the canonical 4× upsample half-band). Without the fix the pre-limit measurement would have been biased low (+11.51 dBFS instead of the actual +12.27 dBFS), partially hiding the gate-#6 severity.

## What is queued

- **B2.3 full 4-hour run** — `GRANULATOR_SOAK_S=14400 npx playwright test -g B2.3`. On-demand only.
- **2020-class MBP re-runs** — gate #5 CPU (`qa/scripts/granulator-cpu.mjs`) and gate #2(a) fps (`qa/e2e/b2.2-video-fps.spec.ts`). Marc does not own one; machine access TBD.
- **D3** — listening-test panel (gate #1).
- **D4** — MIDI loopback latency harness (gate #3).

## Release gating

Public/professional release blocked. Of the six gates:

- Gate 1 — blocked by D3.
- Gate 2 — (a) fps provisional pass on M4 Pro; 2020-class MBP re-measurement owed. (b) scrubbing PASS — grain-buffer readback at 6 positions, max Δ=3, tolerance ±8 (B2.2.2-a unit pass + B2.2.2-b e2e pass). (c) AV-alignment PASS (worst |drift| 27.5 ms ≤ 36 ms gate).
- Gate 3 — blocked by D4.
- Gate 4 — provisional PASS at 60 s with worklet-thread attribution (worklet major=0, page-wide major=3). Full 4-hour run owed.
- Gate 5 — provisional PASS pending 2020 MBP re-measurement.
- Gate 6 — **PASS (letter and spirit)** after √N gain-staging fix. Pre-limit −0.06 dBFS, post-limit −1.79 dBFS at adversarial settings.
