# memory.md — av-synth decision log (live)

The **live** engineering memory: active decisions, open questions, and design tensions. The full
historical log (every decision and landing entry since 2026-05-16) lives verbatim in
`memory-archive.md` — search it with `grep -n '^##' memory-archive.md` or by keyword; never load it whole.

This file is project-scoped engineering memory, distinct from Claude's harness memory at
`~/.claude/projects/-Users-marcscully-Projects-av-synth/memory/` (which holds cross-session
preferences and user feedback).

## Maintenance rules (replaces the old append-only rule)

- **Add** new decisions at the top of `## Decisions` in the existing format (`### date — title`, **Decision/Why/How to apply**).
- **Prune as you add**: when a decision is superseded or its work has fully landed and stopped
  being load-bearing, move the entry verbatim to the top of `memory-archive.md` (under its
  matching section) in the same commit.
- **Size budget**: keep this file under ~400 lines. If it grows past that, prune before adding.
- A session should read this file in full; it should never need the archive unless investigating
  the history of a specific decision.

---
## Decisions

### 2026-06-05 — Shared grain-event protocol tests must cover backing-store size, not just field offsets

**Decision**: treat the grain-event ring's byte length as part of the shared-memory protocol and derive it from `GRAIN_EVENT_RING_FIELDS` instead of hardcoding a stride at the allocation site.

**Why**:
- The amplitude-depth pass expanded each grain event from 10 to 11 float64 fields, but `src/audio/granulator.ts` still allocated the SharedArrayBuffer as `capacity * 10`.
- That left the worklet, main-thread scheduler, and tests agreeing on field offsets while still disagreeing on the actual ring backing-store size, which is enough to black out the visible grain composite even when the audio granulator is healthy.
- A constant-sync suite that only checks field indices is incomplete for SharedArrayBuffer protocols; byte-length drift is the same class of correctness bug.

**How to apply**:
- Allocate the grain-event SAB with `Float64Array.BYTES_PER_ELEMENT * GRAIN_EVENT_RING_CAPACITY * GRAIN_EVENT_RING_FIELDS`.
- Keep regression tests covering both the worklet constants and the derived backing-store size.

### 2026-06-05 — White-on-black contour extraction remains a preset recipe, not a revived standalone edge operator

**Decision**: expose the strictest current “white lines on black” look as a curated preset built from canonical `structure -> composite(diff) -> extract`, rather than reintroducing a dedicated `edge` operator.

**Why**:
- The current `structure` operator already owns contour analysis and user-facing “edge” semantics, but its shader is a contour-driven image treatment, not a pure mask generator.
- The most usable result comes from differencing the contour-treated branch against the clean source first, then hard-thresholding that difference into a binary matte. That stays within the current registry and avoids treating `structure` itself like a pure edge-mask shader.
- This preserves the recent operator-consolidation policy while still giving users an obvious way to reach the remembered edge-outline look.

**How to apply**:
- Keep `edgeOutline` and similar contour-matte looks authored as canonical presets against `structure`, `composite`, and `extract`.
- If a future release needs a truly clean Sobel-style or Laplacian edge mask as a first-class building block, treat that as a new operator proposal rather than a reason to resurrect legacy names.

### 2026-06-05 — Legacy operator names stay discoverable through picker aliases, not duplicate registrations

**Decision**: keep the consolidated operator registry as the public surface, but thread remembered legacy names like `edge`, `luma`, `invert`, `chromaShift`, `brightness`, and `pinchBulge` into the add-effect picker search instead of reviving them as separate registered ops.

**Why**:
- Most of the “missing” names were intentional consolidations, not accidental deletions: `grade`, `extract`, `glitch`, `warp`, `scroll`, `repeat`, and the unified `modulate*` family already cover the old math without duplicating the picker surface.
- Re-registering the old names would immediately reverse the operator-consolidation pass and make the product surface harder to navigate again.
- The real usability bug was discoverability: users remember old names, while the current `Patch` add-effect UI exposed only family dropdowns with canonical ids.

**How to apply**:
- Treat `OperatorUiMeta.aliases` as the stable place for legacy-name search tags.
- `Patch.svelte` should search across canonical op id, family, blurb, intents, and aliases, and may surface short alias hints while a search query is active.
- Do not use aliases as a reason to re-register duplicate public ops unless the underlying effect is genuinely absent from the canonical surface.

### 2026-06-05 — Cross-granulation stays above the existing granulator instead of becoming a second sampler

**Decision**: implement the new cross-granulation modes as source-buffer resolution plus low-rate relationship-bus control on top of the current one-granulator path, rather than adding another public sampler, another worklet, or a second scheduling architecture.

**Why**:
- The Source Relationship Bus already provides the low-rate A/B state needed for trigger and density behavior, and the existing A/B audio path already supports resolving one decoded buffer from Source A, Source B, or A+B.
- `A grains / B trigger` and `B grains / A trigger` only need one-shot note triggers plus a near-idle base density; they do not justify a new voice pool.
- `Blend grains / AB tension density` and `Dual cloud stereo split` are both simple buffer-shape choices: one is a mixed stereo buffer, the other is A-mono-left / B-mono-right. Both fit cleanly inside the current worklet load contract.

**How to apply**:
- Keep cross mode state additive and default-off so existing presets and single-source sessions stay unchanged.
- Treat cross modes as a compatibility layer above `Granulator.loadFromAudioBuffer(...)`: trigger modes resolve to one source buffer and fire `noteOn` events from relationship-bus motion, blend mode modulates `density` from `abTension`, and split mode resolves a stereo A/B buffer.
- Do not add a second public granulator instance unless a future requirement cannot be expressed as one decoded buffer plus existing scheduler controls.

### 2026-06-04 — Commit the preset bank in canonical operator form and keep the loader shim as import compatibility

**Decision**: rewrite `public/presets.json` onto the current canonical operator/param names now that the loader-side normaliser exists, but keep that normaliser in place for stale imported presets and future drift protection.

**Why**:
- The loader shim fixed the release-candidate crash path, but leaving dozens of legacy aliases committed in the bank made every preset harder to inspect and masked whether a bad scope lived in authored data or compatibility code.
- Canonical JSON makes the public bank truthfully match the current operator registry (`grade`, `extract`, `glitch`, `warp`, unified routed `modulate*`, etc.) and lets tests fail when newly committed presets regress back to stale names.
- One older program (`nelsonTwist`) also carried axis hints in `graph.values`, which the typed loader never modeled directly. Folding those into top-level `values` makes that intent explicit instead of depending on dead structure.

**How to apply**:
- Treat `public/presets.json` as canonical current-state authored data: new presets should be written against live operator names, not legacy aliases.
- Keep `normalizeProgram()` in `src/core/presets.ts` as the compatibility boundary for imported/stale snapshots, including the `graph.values` fold-in path.
- Enforce the rule in tests by asserting the committed bank is already equal to its normalized form.

### 2026-06-04 — Preset loading now canonicalises legacy operator scopes at the loader boundary

**Decision**: preserve release-candidate preset compatibility by normalising stale pre-consolidation scope names as programs are loaded from `public/presets.json`, instead of hand-editing only the one preset that happened to crash first.

**Why**:
- `Port / Pixelscape` exposed the real failure mode: the preset bank still contains old graph targets, automation keys, and macro targets (`saturate`, `hue`, `contrast`, routed modulate variants, older warp aliases, etc.) from the operator-merging pass.
- `onProgram()` derives the operator instantiate list from those scopes. One stale key is enough to make the app try to instantiate a deleted op and abort the apply path before any user-facing fallback can happen.
- A loader-side canonicalisation shim is safer for the RC than a sweeping manual rewrite of every preset JSON node, because it keeps the current authored bank loading while still allowing the canonical JSON to be cleaned up later on deliberate terms.

**How to apply**:
- Keep `public/presets.json` load-bearing but treat `src/core/presets.ts` as the compatibility boundary. Legacy aliases should normalise there into the current canonical ops/params plus the minimal injected defaults (`grade`, `extract.mode`, `glitch.type`, routed `source=1`, `warp.mode`, etc.).
- Maintain a bank-wide smoke test over the committed preset JSON so future operator consolidations fail in CI if they leave behind un-normalised scopes.
- Prefer removing stale aliases from the JSON over time, but do not delete the loader shim until the committed bank and any supported imported preset format are proven clean.

### 2026-06-04 — Source relationship features stay on the existing 120 ms probe path

**Decision**: add the new Source B mirrors and A/B-derived relationship signals on top of the existing low-rate feature sampler instead of adding a second GPU analysis path or new per-source render passes.

**Why**:
- The release-candidate constraint is stability first. The current sampler already extracts Source A luma/edge/flux from a 96×54 CPU probe and motion from the existing renderer motion field; extending that path keeps the new bus cheap and easy to reason about.
- Source B only needed coarse low-rate control signals, not frame-accurate optical flow. Reusing the same CPU probe for Source B and treating its motion as flux-level activity is good enough for modulation while avoiding new renderer architecture.
- Backwards compatibility mattered more than purity, so the legacy `v.luma` / `v.flux` / `v.edge` / `v.motion` names continue to mean Source A. The new fields are additive: `v.b.*` for Source B and `v.ab.*` for the derived relationship signals.

**How to apply**:
- Keep Source B / A-B fields hard-reset to zero when Source B is absent so old presets and single-source sessions behave exactly like before.
- Route the new names through the same `VideoFeatureState` / `VideoFeatureName` / modulation-picker path the existing features already use; do not create a second modulation registry.
- If a future version needs true Source B optical flow, prove the current flux-level proxy is insufficient before adding another renderer pass.

### 2026-06-03 — Recursive glitch sketches should land as bounded live-video feedback ops, not literal buffer graphs

The requested RGB glitch sketch came in as a Shadertoy-style `Buffer A` / `Buffer B` / `Image` graph, but AV Synth should not grow a public multipass import surface for one look. The chosen extraction is `acidFeedback`: a single `Feedback`-family operator with per-instance `ownedState`, the loaded clip on `u_tex` as the canonical current-frame signal, and one recursive shader that derives RGB offsets from the operator’s own prior state before mixing back against live video.

That boundary matters for both honesty and product shape. The source look is clearly temporal and glitchy, so it belongs with `flow`, `dataMosh`, and `voidEater`, but the app remains a video-first effects instrument over footage rather than a Shadertoy buffer host. No extra renderer subsystem, no general `iChannel` buffer graph, and no claim of exact parity with the original pass topology.

### 2026-06-01 — `voidEater` should stay a bounded single-pass owned-state operator

**Decision**: land `voidEater` as a normal `OperatorDef`/`VideoStage` feedback operator that uses one per-instance `ownedState` ping-pong buffer, not as a renderer-level preset path or a new temporal subsystem.

**Why**:
- The requested TouchDesigner-style look is fundamentally "edge seed + warped accumulation," which the existing owned-state contract already covers.
- Keeping it inside the current WebGL2 operator path preserves neutral-default bypass, normal coupling/LFO metadata, and the existing QA sweep infrastructure.
- A reusable erosion primitive is more valuable than a one-off authored program, so the implementation should expose the growth/spread/twirl thresholds directly instead of hiding them behind preset logic.

**How to apply**:
- `voidEater` reads `u_tex` plus `u_owned_state`, guards the uninitialised state path, and writes its next state in the same pass.
- Twirl/pixel-snap/edge-growth controls stay ordinary coupled params so the op can sit anywhere the feedback family already can.
- If the effect ever needs a more elaborate mask/simulation path later, prove that the current single-pass owned-state version is insufficient before changing renderer architecture.

### 2026-06-01 — The shell should not carry separate Safe Mode or Advanced toggles

**Decision**: remove the top-level `safe mode` and `advanced` buttons from the shell. Keep the real workspace tabs visible at all times, keep the stage controls always present, and stop presenting performance quality or edit-surface exposure as separate shell modes.

**Why**:
- User feedback was explicit: those controls were not earning their space in the primary shell.
- `advanced` was only a presentation toggle over surfaces that already represent the normal product workflow, so hiding them behind a mode switch added state without adding capability.
- `safe mode` was a coarse quality bundle that changed preview mode and granulator behavior together; that is better treated as internal tuning/preset policy than as a front-and-center public button.

**How to apply**:
- The shell should expose `video`, `audio`, `lfo`, and `presets` directly without an `advanced` gate.
- Keep the experiment preset bank reachable from the presets surface rather than tying it to a separate top-bar mode.
- Performance quality tiers may remain in implementation/preset policy, but not as a dedicated top-level shell toggle unless product direction changes again.

### 2026-06-01 — Playwright local runs should start fresh servers by default

**Decision**: stop reusing an already-running local Vite server by default in `qa/playwright.config.ts`. Reuse is now opt-in through `PLAYWRIGHT_REUSE_SERVER=1`; the normal `dev` and `preview` modes should start fresh servers unless the caller explicitly asks otherwise.

**Why**:
- A failing local shell run looked like a broken browser/assertion path at first, but the Playwright trace showed the real issue: the reused Vite server answered `GET /node_modules/.vite/deps/svelte.js?...` with `504 Outdated Optimize Dep`.
- That failure mode renders as a blank page, no `window.__AV_SYNTH_QA__`, and a misleading timeout in the first `waitForFunction`, so it wastes time in the wrong layer unless the trace is inspected.
- The explicit attached-server path (`PLAYWRIGHT_SERVER_MODE=external`) already exists for the cases where the caller really does want to bind Playwright to a long-lived manual server or a hosted URL.

**How to apply**:
- Treat `npm run qa:smoke`, `qa:cases`, and the preview variants as fresh-server commands.
- Use `PLAYWRIGHT_SERVER_MODE=external` when the server is already running somewhere else.
- Use `PLAYWRIGHT_REUSE_SERVER=1` only for deliberate local-server reuse, and prefer a restart if Vite serves a blank page or `Outdated Optimize Dep`.

### 2026-06-01 — Remove the explicit Start Demo gate; let presets and grain mode be the natural first gestures

**Decision**: drop the separate `Start Demo` overlay/button flow from the shell. The built-in footage clip and flagship program should auto-load visually on first run, preset clicks should be allowed to start audio/granulator naturally, and clicking the `grain` source should attempt to bring up the granulator path instead of quietly failing back to plain video.

**Why**:
- User feedback was clear: the explicit hand-holding path was unnecessary friction. In this product, choosing a preset is already the obvious first action.
- The old shell flow created secondary bugs in practice: audio felt like it "really started" only after `Start Demo`, and the grain-composite source button could appear inert because it depended on prior hidden setup.
- Removing the dedicated demo gate lets the staged product behave more like the intended instrument: visuals are present immediately, audio still respects browser gesture rules, and the first meaningful gesture can be a preset choice rather than a separate onboarding button.

**How to apply**:
- Keep the built-in footage clip as the first-run visual source, but do not reintroduce a welcome overlay that blocks the shell until a demo-only button is pressed.
- Preset-selection UI should remain a valid audio-start gesture path as long as browsers require user interaction for `AudioContext.resume()`.
- Grain-composite source activation should either complete the needed setup or show a concrete refusal message; it should not look like a dead button.
- The granulator `mix` control is part of the public dry/wet story: when the wet side is at `1.0`, the direct source audio must be fully attenuated rather than remaining audible in parallel.

### 2026-06-01 — Neutral cold start beats auto-loading a flagship program

**Decision**: keep the built-in footage clip as the first-run visual source, but stop auto-applying any preset or program on boot. The shell should open on plain source video with an empty chain and no active preset card.

**Why**:
- User feedback was explicit: the forced flagship state made the app feel like it had already made creative choices for them and obscured whether the grain source was actually working.
- The targeted grain-composite browser probe still passes, which points away from a global renderer failure and toward startup state masking the behavior. A neutral cold start makes the source/grain transition legible again.
- The built-in clip is enough to keep the shell from looking empty; the extra preset boot state added more confusion than value.

**How to apply**:
- Built-in footage may still auto-load and autoplay visually, but it should start at its normal beginning rather than jumping to a curated preview seek.
- Presets remain the main authored-on-ramp, but they should be user-invoked from the presets tab.
- Cold-start QA should expect no `.presets-active` section until the user selects a program.

### 2026-06-01 — Root README is the public repo entrypoint; local capture clutter is not durable project state

**Decision**: add a real root `README.md` for the staging/release-candidate product surface, and treat root-level PNG/JPG dumps plus `.ci-repro/` as disposable local artifacts rather than meaningful repo content.

**Why**:
- The repo had strong internal planning docs (`plan.md`, `todo.md`, `deploy.md`, `RELEASE_VERDICT.md`) but no obvious public entrypoint for a collaborator, reviewer, or future public reader.
- Local QA/debugging had started to spill one-off screenshots and reproduction snapshots into the repo root, which makes the project look less intentional than it is and obscures the real release docs.
- The versioned screenshot material already has better homes: `screenshots/`, `.screenshots/`, and `qa/results/` depending on whether the asset is curated, internal review, or generated QA output.

**How to apply**:
- Keep the root README aligned with the actual release direction and real npm scripts.
- Do not treat root-level capture files as durable context; if they matter, move them into a named screenshots or QA location with an explicit purpose.
- `.ci-repro/` is scratch, not product history.


## Open mathematical questions

(Mirrored from `plan.md §11` — resolve here as decisions land.)

- [ ] Spatial-frequency unit for sources (provisional: `osc(N)` = `N Hz`, see above; revisit with transport).
- [x] 3-band crossover frequencies for `color()` — landed as 300 Hz / 3 kHz in `src/core/coupling.ts`; later decision is whether presets may override them.
- [x] `hue` pitch-shift law: octaves (`2^amount`) vs cents (`1200·amount`). UI presentation, not math. **Resolved 2026-05-18**: octaves, slider unit `oct`, range `[-1, 1]` (one octave each direction). See decision entry below.
- [ ] `scrollX` (time-domain delay) vs `scrollY` (stereo pan) asymmetry. Defensible if we think of X as the "time" axis of a delay line and Y as the spatial axis — analogous to the visual where X is horizontal and Y is vertical. Provisional.
- [x] `colorama` chaotic-map choice: Hénon (2D, smoother) vs logistic (1D, sharper bifurcation). **Resolved 2026-05-18**: logistic, `r = 3.99` fixed, single scalar state. Shared semantics across the video shader (per-pixel iterated logistic seeded from a UV hash, scaled by `amount`) and the audio ring-mod carrier (k-rate iterated frequency in `[50, 350] Hz` per poll). No worklet — `OscillatorNode` + `GainNode` with AudioParam-additive wet/dry. See decision entry below.
- [ ] `solid` RGB → triad mapping. Options: fifth+octave `(1, 3/2, 2)`; major triad `(1, 5/4, 3/2)`; tritone `(1, √2, 2)`. UI-selectable, default fifth+octave for consonance.

## Known open audit-gate issues

- **Resolved 2026-05-18**: `audit-contrast-osc-sweep` exported-audio `spectralCentroidHz > +30 Hz` gate was downgraded to manual review only (option b). The contrast operator is correct; the osc fixture exhibits the same low-energy/noise-floor behaviour as `solid`, so the centroid metric was measuring quantisation noise. Live `spatialStd` gate retained. Same precedent as `audit-modulate-osc-sweep` / `audit-scrollX-osc-sweep` / `audit-colorama-solid-sweep` / `audit-hue-solid-sweep`. Now folded into the rule entry below as the fourth confirmed instance.

### 2026-05-18 — Solid-fixture exported-audio metrics are noise-floor-driven (rule, not just an observation)

**Rule**: on the solid source (and other near-silent fixtures), do not hard-gate exported-audio metrics. Default new Color cases built on `solid` to live-side-only hard gates, and either omit the exported-audio comparison or label it explicitly `MANUAL REVIEW ONLY`.

**Why**:
- The solid source measures at the digital noise floor on the exported WAV (~-173 dB observed for `audit-hue-solid-sweep`); short osc sweeps exhibit the same low-energy class behaviour for exported-audio metrics. Metrics like `spectralCentroidHz`, `zeroCrossingRate`, `spectralFlatness` are dominated by quantisation noise rather than musical content at that signal level, so threshold-bound deltas have unstable sign and magnitude.
- Four confirmed instances by 2026-05-18:
  1. `audit-colorama-solid-sweep` — centroid baseline drifted 162 Hz → 287 Hz between back-to-back fresh-browser runs at identical settings (exported-audio downgraded to manual review at case creation).
  2. `audit-hue-solid-sweep` — ZCR delta was +0.00126 on the first run, then −0.00129 on the second run at identical settings; the gate is currently flipped sign rather than just wrong magnitude (exported-audio downgraded 2026-05-18 same day).
  3. `audit-modulate-osc-sweep` / `audit-scrollX-osc-sweep` — earlier downgrades on the osc fixture, same low-energy class.
  4. `audit-contrast-osc-sweep` — `spectralCentroidHz > +30 Hz` assertion produced deterministically negative deltas (−6.5, −19.1, −23.5 Hz) across failing runs and passed cleanly on others; the contrast operator is correct, the osc fixture is too low-energy to gate centroid on the waveshaper output (exported-audio downgraded 2026-05-18 same day as option b).

**How to apply**:
- For any new Color or single-input op case built on `solid` or a short low-energy osc sweep, default to live-side-only hard gates. If you want any audio coverage at all on that case, write it as a `manual-review` note in the `expectedAudio` block rather than a `metricComparisons` assertion.
- For ops that need genuine exported-audio gating, use a higher-energy fixture (osc with non-silent audio, or video). The decoded-media video fixture has produced reliable centroid/ZCR deltas for `posterize`, `saturate`, `chromaShift`, `brightness`, `luma`.
- This rule is not a permission to skip the listening pass. Every solid-fixture case still needs `.webm` + `.wav` capture, and the manual sign-off in `qa/reviews/color-tonal.md` covers it.

## Design tensions to track

- **Smoke coverage vs release coverage.** The current QA harness proves runtime stability, export, and analysis plumbing. It does not yet certify every implemented operator family for professional release. Before deploy, run the explicit family-by-family AV audit gate from `plan.md §10.6` and treat deployment as blocked until that matrix is green.
- **Live-code vs visual-patch.** The live-code editor (M4) and the future drag-wire patch UI both target the same graph. Keep the graph the source of truth so neither becomes the canonical front-end. The editor *generates* graph updates; the patch UI *manipulates* the graph. Same model, two views.
- **Hydra dialect tolerance.** Hydra users paste snippets expecting them to run. Our parser/eval must accept Hydra's API verbatim (no required `await`, no required imports). Trade-off: leaks Hydra's globals into the live-code scope. Acceptable.
- **Bidirectional coupling latency.** Audio→video reaction takes ~1 audio block (≈3 ms). Video→audio takes ~1 frame (~16 ms). The asymmetry will be audible when running feedback loops at fast rates. Document, then look at whether a sub-frame video analysis (e.g. running analysis in the audio worklet from a shared ring buffer of canvas reads) is worth the complexity.
- **Temporal history: source vs post-chain.** (2026-05-25) The bounded temporal-history ring exposed by `VideoRenderer` is currently fed from `#prevFrame` (the conditioned monitor final), not from the raw source target. `timeDisplace` was authored as a slit-scan/time-drag of source content, but with itself as the only op it ends up scrubbing its own past output, so `depth/scan/smear` largely disappear. Two consistent resolutions exist: (a) add a second source-anchored history ring used by source-shaped ops, keeping the current post-chain ring for chain-shaped ops, or (b) honestly relabel timeDisplace as a post-chain time smear and update docs. Either is in scope of §10.5 stateful systems and outside the surgical pass that shipped the structure rebalance on the same date.
- **Motion estimator as a product ceiling.** (2026-05-25) `src/video/shaders/motion-analysis.frag` runs 8-direction block matching with a 1.75-pixel search radius. That is enough to populate a motion texture but cannot represent real motion in most footage; the result is quantised and noisy, and `flow` plus any future routed `modulate*` consumer inherit that ceiling. The same kind of small-search artefact will appear wherever the motion field is used. Real upgrade is multi-scale / wider-radius search; scope it inside the stateful-systems quality work, not inside individual operator passes.
- **Audio-only params on coupled operators.** (2026-05-25) `feedback.delayTime` is video-uncoupled by spec — the param hint already declares it audio-only, the audio worklet uses it, the video shader does not. The UI does not currently surface that distinction, so video-tab users see a "dead" knob. Open follow-up is a UI marker on `OPERATOR_UI_META.coreParams` rather than deleting working audio params; until then, leaving the knob in place is honest to the audio side but confusing to the video side. Superseded direction: Marc asked to strip the feedback audio path entirely (granulator + feedback delay is the public audio surface now); see todo.md "Strip the legacy feedback-freeze audio path" for the queued cleanup.
- **Authored vs measured vector fields.** (2026-05-25) The first authored-field op (`vortex`, Biot-Savart point-vortex sum) shipped and is visibly the strongest displacement op in the chain. Lesson worth keeping: visual quality in this product comes more from *the math of the field* than from cleverer post-processing. Authored fields (vortex, future curl-noise, swept saddles) are cheap and independent of the weak motion estimator; measured-field ops (`flow`, routed `modulate*`) inherit `motion-analysis.frag`'s 1.75-px search-radius ceiling. Prefer authored-field additions over more post passes when the goal is "make the public chain feel less amateur".
- **Authored-field set now covers four distinct field classes.** (2026-05-25) Same-day follow-up to the vortex op: shipped `curlNoise` (divergence-free 2-octave noise curl, GPU-only), `vortexPacket` (macro + micro Biot-Savart bands, two CPU advections), and `saddleField` (oriented saddles with anisotropic stretch/compress). The deliberate design tension that emerged while authoring them is that *each new field op must contribute a different mathematical class* — swirl (vortex), turbulence (curl), banded packet (vortexPacket), directional sweep (saddleField). Adding a fifth op that's a re-skin of an existing class would expand the Feedback family's surface without expanding what it can do, and that's the bar to clear before any more authored fields ship. Public allowlist accordingly grew from 13 to 16 programs, one preset per new op.
- **Per-op audio twins are gone for good.** (2026-05-25) `OperatorDef.createAudioStage` and `AudioStage` no longer exist; the public audio surface is permanently granulator + feedback delay + master limiter. Re-introducing per-operator audio worklets requires an explicit scope expansion in `plan.md` first, not "just one more op". The legacy `audio-rack.ts` / `AudioRack.svelte` / `feedback-freeze.js` / `modulate-*.js` / `phase-*.js` / `pitch-shifter.js` / `pixelate-*.js` files are deleted, not commented out — do not resurrect them by reading git history without re-justifying scope.
- **Renderer uniform discipline after stripping a shader.** (2026-05-25) When simplifying a renderer-owned shader (e.g. `history.frag` reduced to an identity copy), uniforms that the shader no longer references get optimized out by the GLSL compiler; `getUniformLocation` then returns null, the strict init guard in `renderer.ts` (`!uHistoryResolution || !uHistoryFeedbackAmount || ...`) throws, and the app boots with `init failed: post-processing program missing required uniforms` in the canvas. Fix is always: remove the now-dead uniform lookups, dead `WebGLUniformLocation` fields, and dead `gl.uniform*` calls in the same pass. Do not "keep the uniform alive" with `u * 0.0` tricks — drivers fold them anyway and it leaves dead code in the renderer.

## Recent landings (2026-06)

## 2026-06-01 — ReShade-inspired finishing pack must stay native, license-safe, and bounded

The right product move is a small pack of native finish operators, not any form of ReShade runtime
integration. AV Synth now carries five new finish-family ops — `filmGrade`, `clarity`, `gradeLUT`,
`debandDither`, and `retroDisplay` — but the implementation boundary is strict: no ReShade FX compiler,
no injector/runtime/add-on system, no `.ini` preset compatibility, and no game depth-buffer effects.

The licensing split is equally important. `SweetFX` and `prod80` provide permissive MIT references for
grading/sharpening ideas, and `reshade-shaders/Shaders/Deband.fx` carries an MIT notice in-file, so those
can inform clean-room AV Synth ports. `reshade-shaders/Shaders/LUT.fx` is not a safe copy source from the
inspected path, so `gradeLUT` should reuse AV Synth's own procedural presentation LUTs instead of pulling
in third-party LUT code or textures. The obvious CRT reference (`SweetFX/CRT.fx`) is GPL, so
`retroDisplay` must remain handwritten inspiration only.

Implementation discipline for this pack: keep `filmGrade`, `clarity`, `gradeLUT`, and `debandDither`
single-pass; avoid new renderer subsystems; allocate no per-frame JS objects; expose params through the
existing operator/modulation registry; and document the candidate/attribution boundary in-repo so the
decision survives compaction. This is a release-hardening polish slice, not the start of a shader-pack
import surface.

## 2026-06-01 — Shadertoy `lfscD7` should land as one bounded damage op plus authored finishing, not as a direct port

The saved `lfscD7` references under `references/shadertoy/` show a clear split: renderer-level separable
bloom, one distinctive low-resolution interference/dither/quantisation look pass, and a light final
composite/vignette stage. AV Synth already has its own renderer bloom stack, vignette, scanline/display
finish, and general grading controls, so copying the Shadertoy pass graph literally would duplicate
existing systems and widen scope for no product gain.

The correct extraction plan is therefore:

- keep bloom in the renderer/presentation path
- keep vignette and any scanline flavour in `filmGrade` / `retroDisplay`
- add at most one new reusable operator for the genuinely missing idea cluster: interference-driven signal
  damage with ordered-dither corruption and conditional colour quantisation
- optionally add a narrow `filmGrade.hueCurve` control only if the shader's small sinusoidal hue warp is
  still needed after the first authored rebuild
- ship the full look as a curated program, not as a monolithic one-off shader operator

The public boundary matters. This repo is a video-first effects instrument, not a procedural Shadertoy
scene browser. The saved snippets do not include the bodies for helpers like `Render(...)` or
`Interfere(...)`, and even if they did, procedural scene-generation from those helpers is not the
release-track goal. Extract reusable treatment ideas that work on loaded footage; leave unknown
scene-generation logic out of the public scope unless the product direction changes.

### 2026-06-01 — `lfscD7` step 1 landed as an experimental approximation program, not a fake parity claim

**Decision**: ship the first `lfscD7` checkpoint as `broadcastGhostBloom` in `public/presets.json` using
only the existing operator and renderer surface, and keep it in the experimental bank until the dedicated
`signalDamage` operator exists.

**Why**:

- The saved shader fragments are enough to justify the effect family, but not enough to claim exact
  reconstruction of the missing `Interfere(...)`, `OrderedDither(...)`, `Overlay(...)`, and `Render(...)`
  kernels.
- A current-stack approximation gives the repo a stable visual/audio baseline and a real QA target
  (`qa/cases/audit-program-broadcast-ghost-bloom-video.json`) for the later `signalDamage` pass.
- Promoting it to the public showcase before the missing operator lands would overstate how close the
  current program is to the source shader's actual damage logic.

### 2026-06-01 — `signalDamage` is the bounded lfscD7 extraction surface

**Decision**: land the missing `lfscD7` idea cluster as one single-pass `signalDamage` Texture operator,
then retune `broadcastGhostBloom` around that operator instead of keeping the earlier
`turbulenceWarp` / `chromaFract` approximation stack.

**Why**:

- The saved shader snippets show current-frame interference, ordered-dither corruption, conditional
  quantisation, and cool overlay tint as one inseparable treatment idea; exposing that as one operator
  is more honest and more reusable than multiplying small stand-in ops.
- Keeping the op current-frame only, with no `ownedState`, preserves the product boundary from the
  extraction plan: no second bloom stack, no monolithic full-port shader, and no fake temporal parity.
- The dedicated video QA sweep (`qa/cases/audit-signal-damage-video-sweep.json`) gives the extracted
  operator its own regression surface instead of relying only on the authored program.

### 2026-06-01 — `filmGrade.hueCurve` is the lfscD7 colour-shaping follow-up, not a new operator

**Decision**: carry the shader's small sinusoidal hue remap inside `filmGrade` as one narrow
`hueCurve` control instead of creating a separate hue-warp operator.

**Why**:

- The saved `lfscD7` snippet only exposes a tiny finishing contour:
  `hsv.x += -sin((hsv.x + 0.05) * kTwoPi) * 0.07`.
- That behaviour is materially different from plain `hue`, but too narrow to justify a new public
  effect family or another lfscD7-specific one-off.
- Folding it into `filmGrade` keeps the extraction bounded; presentation bloom/look tuning is now the
  only remaining lfscD7 follow-up.

### 2026-06-01 — lfscD7 renderer tuning should be a named presentation look, not a second bloom profile

**Decision**: finish the lfscD7 extraction with a dedicated `ghostBloom` presentation look in the
renderer and point `broadcastGhostBloom` at that look plus `bloomMist` lens dirt, instead of adding
another bloom stack or a one-off post shader.

**Why**:

- The remaining source-shader character after `signalDamage` and `filmGrade.hueCurve` is mostly in bloom
  tint, halation colour, and the soft final composite response the renderer already owns.
- `PRESENTATION_LOOKS` is already the stable public surface for that class of behaviour, so the tuned
  look stays reusable by other programs instead of hard-coding lfscD7 logic into one preset.
- This closes the extraction plan without widening the renderer architecture or breaking the product
  boundary around uploaded-video treatment.

### 2026-06-04 — Source B audio goes through the one granulator, not a second public engine

**Decision**: when two clips are loaded, expose Source A, Source B, and A+B as input options on the
existing granulator. A+B is decoded/mixed on the main thread into one stereo buffer before loading the
worklet; the feedback delay and limiter remain downstream of that single granulator.

**Why**:

- Users can granulate either clip or both clips without reviving the old multi-engine audio rack.
- One shared grain parameter set keeps the Audio tab compact and matches the public direction:
  granulator + feedback delay + master limiter.
- Keeping the worklet input singular avoids scheduler/voice-pool duplication and preserves the
  current zero-allocation render path.
