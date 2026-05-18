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

### 2026-05-16 — Geometry family: M3.3 built-in-Web-Audio approximations

**Decision**: `pixelate`, `repeat`, `repeatX`, `repeatY`, `scrollX`, `scrollY` ship with audio analogues built from BiquadFilter / DelayNode / StereoPanner / ChannelSplitter+Merger only. AudioWorklet upgrades deferred (cross-ref [[2026-05-16-procedural-sources-m3-2]]).

- `pixelate(pixelX, pixelY)`: per-channel lowpass at SR/(2·N). Frequency-domain proxy for decimation. The aliasing component requires a true decimating worklet — deferred.
- `repeat(repeatX, repeatY, offsetX, offsetY)`: IIR feedback comb per channel, delay = (60/bpm) / reps, feedback fixed at 0.6. Offset shifts tap phase within one period. Plan §2.4 calls for a *multi-tap* comb but a feedback comb produces taps at every integer multiple of d, which is the same spectral structure.
- `repeatX(reps, offset)`: feedforward comb on L only (X = FF axis per plan §2.5).
- `repeatY(reps, offset)`: feedback comb on R only (Y = FB axis per plan §2.5).
- `scrollX(amount, speed)`: DelayNode with delayTime = amount · 0.5s, modulated at |speed| Hz, sign of speed selects LFO phase direction. Mono.
- `scrollY(amount, speed)`: StereoPannerNode with pan = 2·amount − 1, modulated at |speed| Hz.

**Identity defaults** (not Hydra invocation defaults): chain ops must default to a no-op so they can sit in the always-on DEFAULT_CHAIN without distorting a fresh-load preset. This matches the convention established by rotate (angle=0), modulate (amount=0), scale (amount=1.0), posterize (bins=64). Hydra invocation defaults (e.g. `pixelate(20, 20)`) come into play in M4 when the live-code API is implemented.

**How to apply**: When the AudioWorklet pass replaces these stages, change ONLY the audio sub-graph internals — `OperatorDef.createAudioStage` remains the seam. Coupling specs and param IDs are canonical. `repeat` will gain a true multi-tap implementation (e.g. 8 staggered taps with per-tap allpass). `scrollX` is the most likely candidate for a true varispeed read-head scrub.

The chain ordering in DEFAULT_CHAIN places geometry between scale/rotate (continuous transforms) and kaleid (polar fold), with `pixelate` last in the geometry block so other geometric ops see the pre-quantised UV grid.

Cross-ref: [[2026-05-16-source-architecture]], [[2026-05-16-procedural-sources-m3-2]].

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

### 2026-05-16 — Coupling runtime uses raw control values and neutral-op bypass

**Decision**: `src/core/coupling.ts` now evaluates domain parameters from the raw UI value stored on each instance/source param, and both the renderer and audio engine call that evaluator at runtime. Operators sitting exactly at their defaults are treated as neutral and bypassed in graph wiring/render traversal.

**Why**:
- The project stores slider-visible values, not normalized `0..1` controls. Making coupling evaluators consume raw values keeps the UI, presets, and runtime aligned.
- The default chain must boot visually interesting without silently wrecking the audio path. Bypassing neutral operators fixes the `pixelate`/comb-filter problem without inventing fake identity mappings for approximated audio DSP.

**How to apply**: New operators should define `toVideo` / `toAudio` in terms of raw control values in `ParamSpec.range`. If an audio approximation cannot be identity at the visual default, rely on neutral bypass until a better DSP implementation exists.

---

### 2026-05-16 — Renderer quality and transport sync hardening

**Decision**: Once audio exists, video time follows `AudioContext.currentTime`; the WebGL canvas resizes to device-pixel-ratio-backed dimensions; and `MediaElementAudioSourceNode` instances are cached per `(AudioContext, HTMLMediaElement)` pair.

**Why**:
- Shared time is the minimum bar for believable AV coupling.
- Fixed 1280×720 backbuffers look soft on high-DPI displays and undersell the visual side of a professional tool.
- Recreating a media-element source node for the same `<video>` is a browser error path waiting to happen.

**How to apply**: Future time-based operators should trust `ctx.time` only. Source switching should reuse cached media nodes. Resolution/pixel-ratio logic belongs in the renderer, not in `App.svelte`.

---

### 2026-05-16 — First color family and worklet DSP upgrades

**Decision**: `brightness`, `contrast`, `color`, and `saturate` are now implemented in both domains, and `scale`, `pixelate`, and `modulate` now use AudioWorklets instead of the old placeholder/built-in-node approximations.

**Why**:
- The product was missing the first professional-grade color controls where image and sound move together in an intelligible way.
- `scale`, `pixelate`, and `modulate` were the weakest audio links: passthrough pitch, filtered pseudo-decimation, and k-rate delay modulation broke the “same law in both domains” claim.

**How to apply**:
- `brightness` stores a raw visual offset in `[-1, 1]` and maps audio to linear gain with a +/-20 dB law via `10^amount`.
- `contrast` keeps the shared raw ratio and uses a tanh-normalized waveshaper on audio.
- `color` is the canonical RGB-to-3-band coupling. Crossovers are now fixed in `src/core/coupling.ts` as `COLOR_BAND_CROSSOVERS_HZ = { lowMid: 300, midHigh: 3000 }`.
- `saturate` remains HSV saturation on video and M/S stereo-width on audio.
- Future DSP-heavy operators should load modules through `src/audio/worklets.ts`, not ad hoc per-operator module URLs.

---

### 2026-05-17 — QA stack is Playwright + external MCP analyzers

**Decision**: The repo QA direction is now:
- Playwright for live app behavior
- `mcp-music-analysis` for audio behavior
- `ffmpeg-quality-metrics` as the authoritative full-reference visual metrics backend
- `video-quality-mcp` for metadata, GOP, and artifact summaries
- `ffmpeg-mcp` as the structured probe/transform helper
- manual audible/visual review for the explicitly exception-heavy operator cases

**Why**:
- No single tool covers live browser runtime, musical audio inspection, objective codec/image metrics, and the subjective coupling judgments that still matter for pro-facing AV behavior.
- The stack has to reflect how this product actually fails: boot/runtime issues, coupling-law drift, visual artifacts, and musical/timbral regressions are different classes of problems.

**How to apply**:
- Keep the in-repo automation focused on manifest-driven Playwright smoke/regression plus artifact generation.
- Treat the MCP analyzers as artifact consumers, not as a replacement for live browser checks.
- With app-side AV export landed, the local regression signal is now: authoritative `.webm` captures plus live QA bridge state. The repo now also extracts `.wav`, probes media with `ffprobe`, writes machine-readable case summaries, and runs this stack in GitHub Actions against a committed deterministic fixture; richer third-party analyzer output still depends on local adapter configuration. `ffmpeg-quality-metrics` is now the authoritative PSNR / SSIM layer, with VMAF available once the configured `ffmpeg` build exposes `libvmaf`. `mcp-video-analyzer` is not part of the active stack because its transcript/OCR focus is a poor fit for synth-output regression, though the wrapper is kept in-repo for reference.

---

### 2026-05-17 — Audit cases are structured by family/operator/kind

**Decision**: Manifest-driven pre-deploy audit cases now carry explicit `audit` metadata (`family`, `operator`, `kind`, expected audio/video behavior, manual checks), and `qa/analyze.js` groups `analysis-summary.json` by family rather than leaving the audit output as a flat list of cases.

**Why**:
- The deployment gate is family-by-family, not screenshot-by-screenshot.
- As the matrix grows, review needs to answer “is feedback/composition green?” or “which geometry operator still has warnings?” without reconstructing that grouping by hand.

**How to apply**:
- Any case intended to satisfy `plan.md §10.6` should include `audit`.
- `audit-feedback-*` and `audit-modulate-*` are the seeded template for future source/geometry/color family cases.
- Plain smoke cases may remain unclassified, but they should not be mistaken for release-audit coverage.

---

### 2026-05-17 — Live checkpoint metrics are a video gate first; exported WAV segments gate audio

**Decision**: Playwright audit cases now sample live checkpoint metrics from the QA bridge and persist them as `metrics.json`. Video keeps using those live checkpoint deltas as the fast gate, while audio now uses segmented exported-WAV assertions keyed off the same checkpoints.

**Why**:
- The new live sampling is good enough to prove semantic visual movement: feedback lowers temporal frame delta on decoded video, and modulate raises temporal warp on both procedural and decoded sources.
- The same bridge's live audio analyser readings are not stable enough for release-gate assertions. Exported WAV segments, by contrast, stayed stable and were precise enough to catch an actual engine bug in the seeded `feedback` / `modulate` audit family.

**How to apply**:
- Use `metrics.json` + `analysis.json.liveMetrics` for checkpoint review on seeded audit cases.
- Keep hard automated comparisons on video metrics for browser-visible movement.
- Put hard audio comparisons on `source: "exported-audio"` manifest assertions so `qa:analyze` evaluates the rendered WAV around each checkpoint window.
- Audio still needs manual listening before deploy, but the automated release gate should trust exported segments over the live analyser stream.

---

### 2026-05-17 — AudioEngine rewires must not disconnect stage inputs

**Decision**: `AudioEngine.#rewire()` may disconnect `source.output` and each stage's `output`, but it must never call `disconnect()` on `stage.input`.

**Why**:
- Several operators build their internal graph by wiring `input` into downstream nodes once in the stage constructor.
- Calling `stage.input.disconnect()` during a rewire severs those internal connections, so any operator that transitions from neutral to active can go silent even though the outer chain reconnects.
- The new exported-WAV assertions exposed this immediately on `feedback` and `modulate`, which both appeared to "work" visually while their late-checkpoint audio collapsed.

**How to apply**:
- Treat `stage.input` as the stable ingress for the operator's private graph.
- Future rewires should only tear down external chain links, not a stage's internal topology.

---

### 2026-05-17 — First geometry audit batch seeded; pixelate-on-video keeps manual visual review

**Decision**: The pre-deploy geometry audit now has seeded hard-gated cases for `scale`, `pixelate`, and `kaleid`, but `audit-pixelate-video-cross-source` keeps its visual side as manual review only.

**Why**:
- `scale` and `kaleid` produced stable live-video deltas and stable exported-WAV shifts on both oscillator and decoded-media cases, so they were good candidates for the first geometry hard gates.
- `pixelate` on the committed decoded-media fixture did produce stable exported-audio shifts, but the CI clip was too weak to give a trustworthy live-video threshold. Forcing one would create noise in CI rather than meaningful regression signal.

**How to apply**:
- Keep `audit-scale-*`, `audit-pixelate-*`, and `audit-kaleid-*` as the template for the remaining geometry operators.
- Treat `audit-pixelate-video-cross-source` as a valid audio hard gate plus manual visual review until a better committed fixture or reference-video workflow exists.

---

### 2026-05-17 — Geometry audit matrix now spans every spatial operator; a few gates stay manual by design

**Decision**: The pre-deploy geometry audit now has seeded cases across `rotate`, `scrollX`, `scrollY`, `repeat`, `repeatX`, and `repeatY` in addition to `scale`, `pixelate`, and `kaleid`, but four caveats remain explicit: `audit-pixelate-video-cross-source` keeps manual visual review, `audit-scrollY-osc-sweep` keeps manual visual review, `audit-repeatY-osc-sweep` keeps manual visual review, and `audit-scrollX-osc-sweep` keeps manual exported-audio review.

**Why**:
- `rotate`, `repeat`, `repeatX`, `repeatY`, `scrollX` on decoded media, and `scrollY` on decoded media all produced stable enough live/exported deltas to support hard gates after threshold tuning.
- `scrollY` on the procedural osc source flipped sign on the best available live-video metric across runs, so forcing that into CI would create noise instead of signal.
- `repeatY` on the procedural osc source does change the audio side clearly, but the chosen osc fixture does not produce a meaningful visible vertical-repeat discriminator; a tiny `spatialStd` threshold there was giving false failures.
- `scrollX` on the procedural osc source changed audibly and visually, but the exported-WAV spectral descriptors were not stable enough across runs to serve as a trustworthy hard audio gate.
- `repeatX` showed a useful stereo asymmetry, but not as a louder-left result; the left-channel feedforward comb more reliably manifests as stronger left-channel treatment with lower left RMS, so the gate should track asymmetry direction rather than a naive “left gets louder” assumption.

**How to apply**:
- Keep the new `audit-rotate-*`, `audit-scrollX-*`, `audit-scrollY-*`, `audit-repeat-*`, `audit-repeatX-*`, and `audit-repeatY-*` cases as the geometry-family template going forward.
- When a metric proves unstable across runs, downgrade that side to explicit manual review rather than forcing a brittle threshold into CI.
- For channel-specific operators, prefer exported-WAV left/right asymmetry metrics over broad mono summaries.

---

### 2026-05-17 — Feedback/modulate audit also needs explicit manual exceptions where the fixture/metric pair is brittle

**Decision**: `audit-feedback-video-cross-source` now keeps its decoded-video visual side as manual review only, and `audit-modulate-osc-sweep` now keeps its exported-audio timbre shift as manual review only.

**Why**:
- The committed decoded-media fixture still shows visible persistence under feedback, but the old `temporalDiff` gate no longer moves monotonically enough to trust as a hard release check.
- Stronger phase modulation on the oscillator does change the rendered timbre, but not as a stable monotonic spectral-centroid lift. Forcing that assumption into CI produced false failures.

**How to apply**:
- Keep the hard audio gate on `audit-feedback-video-cross-source`; only the decoded-video visual side is downgraded.
- Keep the hard video gates on `audit-modulate-osc-sweep`; only the exported-audio timbre side is downgraded.
- When a metric stops matching the real visual/audio intent, prefer an explicit manual exception over encoding the wrong invariant into the release gate.

---

### 2026-05-17 — QA bridge now targets duplicate operators explicitly and pushes param updates into the runtime

**Decision**: `window.__AV_SYNTH_QA__` now accepts an optional operator occurrence index for duplicate-op targeting, updates operator/source params immutably, and pushes those updated params back into `VideoRenderer` / `AudioEngine` explicitly instead of relying on shared mutable references.

**Why**:
- The previous bridge only targeted the first matching operator by `op` name, which conflicted with the engine/preset model once duplicate instances are allowed.
- The new source/color audit work exposed that source-param changes coming from the bridge were not reliably reaching the live runtime; the `solid` source stayed black until the bridge called `renderer.setSourceParams()` / `audio.setSourceParams()` directly.

**How to apply**:
- Future audit cases that need duplicate operators should use the QA bridge occurrence targeting instead of assuming a single op instance.
- Treat the QA bridge as an explicit runtime control path, not a side effect of Svelte state mutation.

---

### 2026-05-17 — Pre-deploy audit matrix now covers every implemented family; manual review notes are first-class QA artifacts

**Decision**: The audit matrix now spans sources, feedback/modulate, all implemented geometry ops, and the first full color family. Manual review notes now live under `qa/reviews/`, CI is frozen against the audit-only path via `npm run qa:audit:ci`, committed reference captures live under `qa/references/`, and analyzer wrappers are repo-local in `qa/adapters/`.

**Why**:
- The repo had real smoke coverage and partial family audits, but not a single durable place to capture the remaining human judgment needed for professional release.
- The completed source/color expansion exposed one real runtime issue (`solid` source param propagation through the QA bridge) and also clarified which cases should stay manual rather than pretending to have trustworthy scalar gates.

**How to apply**:
- Use `npm run qa:audit` / `npm run qa:audit:ci` as the release-facing regression gate.
- Keep `qa/reviews/*.md` updated alongside any threshold or coupling-law changes.
- Remaining blocker before deploy is a final human audible sign-off on the documented manual exceptions.

---

## Open mathematical questions

(Mirrored from `plan.md §11` — resolve here as decisions land.)

- [ ] Spatial-frequency unit for sources (provisional: `osc(N)` = `N Hz`, see above; revisit with transport).
- [x] 3-band crossover frequencies for `color()` — landed as 300 Hz / 3 kHz in `src/core/coupling.ts`; later decision is whether presets may override them.
- [ ] `hue` pitch-shift law: octaves (`2^amount`) vs cents (`1200·amount`). UI presentation, not math.
- [ ] `scrollX` (time-domain delay) vs `scrollY` (stereo pan) asymmetry. Defensible if we think of X as the "time" axis of a delay line and Y as the spatial axis — analogous to the visual where X is horizontal and Y is vertical. Provisional.
- [ ] `colorama` chaotic-map choice: Hénon (2D, smoother) vs logistic (1D, sharper bifurcation). Provisional: logistic for predictability, swap to Hénon if it sounds boring.
- [ ] `solid` RGB → triad mapping. Options: fifth+octave `(1, 3/2, 2)`; major triad `(1, 5/4, 3/2)`; tritone `(1, √2, 2)`. UI-selectable, default fifth+octave for consonance.

## Design tensions to track

- **Smoke coverage vs release coverage.** The current QA harness proves runtime stability, export, and analysis plumbing. It does not yet certify every implemented operator family for professional release. Before deploy, run the explicit family-by-family AV audit gate from `plan.md §10.6` and treat deployment as blocked until that matrix is green.
- **Live-code vs visual-patch.** The live-code editor (M4) and the future drag-wire patch UI both target the same graph. Keep the graph the source of truth so neither becomes the canonical front-end. The editor *generates* graph updates; the patch UI *manipulates* the graph. Same model, two views.
- **Hydra dialect tolerance.** Hydra users paste snippets expecting them to run. Our parser/eval must accept Hydra's API verbatim (no required `await`, no required imports). Trade-off: leaks Hydra's globals into the live-code scope. Acceptable.
- **Bidirectional coupling latency.** Audio→video reaction takes ~1 audio block (≈3 ms). Video→audio takes ~1 frame (~16 ms). The asymmetry will be audible when running feedback loops at fast rates. Document, then look at whether a sub-frame video analysis (e.g. running analysis in the audio worklet from a shared ring buffer of canvas reads) is worth the complexity.

### 2026-05-18 — Staging deploy is allowed before the full public release, but public/professional deployment is blocked on essential unfinished M3 families

**Decision**: The project now has two distinct release tracks:
- a **staging/private deploy** is allowed once the current QA/audit gate and human audible sign-off are good enough for real-world manual testing;
- the **public/professional release** remains blocked until the remaining essential `M3` work lands: unfinished Color operators (`invert`, `luma`, `thresh`, `hue`, `colorama`, `sum`, `.r .g .b .a`) plus the full Blend family (`add`, `sub`, `mult`, `diff`, `layer`, `blend`, `mask`).

**Why**:
- The implemented subset is now strong enough to benefit from live-environment validation.
- Shipping publicly as a “professional” tool while those families are still missing would misrepresent product completeness.
- This split gives us deployment feedback without losing pressure to finish the core Hydra surface area that materially defines the product.

**How to apply**:
- Do not treat “QA green on the implemented subset” as permission for public release.
- If a session is about deployment, first determine whether it is a staging/manual-testing deploy or the public/professional release.
- Public deploy remains blocked until the missing Color and Blend items are implemented, audited, and documented.

### 2026-05-18 — Claude must not commit or push without explicit user approval after review

**Decision**: Repo-level operating rules now explicitly forbid Claude from creating commits, pushing branches, amending commits, rebasing, or rewriting git history unless the user explicitly asks for that action after review.

**Why**:
- The repo now contains substantial integrated QA, audit, and release-policy work that should not be accidentally blessed into git history by an autonomous session.
- The user wants an external review gate before any git write, not just before destructive history edits.

**How to apply**:
- Default session workflow is: implement, update docs, run verification, stop for review.
- Only commit or push when the user explicitly asks for it.

## Notes that don't belong elsewhere

- Personal global rule: post-push verification via `mcp__github__list_commits` + Playwright screenshot. Applies here once we have a deployed URL.
- DeepSeek delegation rules apply: every survey of the 999-line prototype goes through `ask-deepseek`; every test/config file goes through `deepseek-write`.
