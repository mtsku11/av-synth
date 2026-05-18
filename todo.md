# todo.md — av-synth build-out checklist

Staged from "single 999-line HTML" to "professional, productisable web app." Check off as items close. Add dates next to completed items (`✅ 2026-05-16`).

Success criterion for each milestone is listed; do not declare it done until the criterion is met.

## Current next step

Complete the final human audible sign-off in `qa/reviews/` on a normal local machine with speakers/headphones. After that, a staging/private deploy is allowed for real-world manual testing, but public/professional deployment remains blocked until the essential unfinished `M3` surface area lands: the remaining Color operators and the full Blend family.

---

## M0 — Repo & tooling bootstrap

Success: a Vite+TS+Svelte dev server runs, displays a blank canvas, and `git status` is clean.

- [ ] `git init`; first commit with the prototype HTML preserved as-is at the root (rename to `prototype.html` once the new app is rendering)
- [ ] `npm create vite@latest .` → Svelte + TypeScript template; merge with existing files (don't blow them away)
- [ ] Configure `vite.config.ts`: `?raw` for `.glsl` and `.wgsl`; static asset handling for `worklets/*.js`; dev server with COOP/COEP headers if we end up needing `SharedArrayBuffer` for the audio worklet ring buffer
- [ ] `tsconfig.json`: `strict: true`, `noUncheckedIndexedAccess: true`, `target: "ES2022"`
- [ ] ESLint + Prettier + Svelte plugin → delegate config to `deepseek-write`
- [ ] Vitest + jsdom for unit tests; AudioWorklet tests in node's `worker_threads`
- [ ] `.mcp.json` for project-local MCP servers (none required yet — placeholder)
- [ ] Add `.gitignore`, `.editorconfig`
- [ ] `npm run dev` shows the Svelte boilerplate; commit

## M1 — Architectural skeleton

Success: a `App.svelte` mounts; an empty `Patch.svelte` panel; an empty `<canvas>` for video; an `AudioContext` exists; the `currentTime` clock is visible in the footer.

- [ ] `src/core/clock.ts` — transport singleton: `audioContext`, `bpm`, `baseFreq`, derived `time` (audio-driven), public start/stop
- [ ] `src/core/params.ts` — `ParamSpec` type: `{ id, label, range: [min,max], curve: 'lin'|'log'|'exp', unit, default, automation?: AutomationSource }`
- [ ] `src/core/graph.ts` — patch graph data model. Nodes: `{ id, op, params, inputs: nodeId[], outputs: bus[] }`. Reactive store (Svelte's writable, or a plain pub-sub).
- [ ] `src/core/coupling.ts` — the registry that maps a control value through the per-operator coupling spec from `plan.md` into video-domain and audio-domain effective parameter values. **Single source of truth for AV math.**
- [ ] `src/video/renderer.ts` — WebGL2 context init, FBO ping-pong, draw-fullscreen-triangle utility, render-loop scaffolding (no operators yet, just clears + copies)
- [ ] `src/audio/engine.ts` — `AudioContext` creation, master bus, limiter, analyser tap, output routing scaffolding (no operators yet, just `gainNode → destination`)
- [ ] `src/ui/Knob.svelte`, `Slider.svelte` — bind to a `ParamSpec`, render label/value/unit
- [ ] `App.svelte` lays out: top header (transport), centre canvas, right control panel, bottom scope/spectrum

## M2 — Port the prototype's existing operators into the new architecture

Success: open the new app, load a video file, every slider from the prototype works identically, every preset matches the prototype output bit-for-bit (or, for audio, ear-for-ear).

Each operator below has both a video shader and an audio sub-graph, both registered against the same `op` key, both consuming a value from `coupling.ts`.

- [ ] `feedback` (port from prototype — `u_feedback` shader + delay-feedback audio gain)
- [ ] `kaleid` (port — `u_kaleid` shader + waveshaper wavefolder, now mathematically coupled per `plan.md §2.6`)
- [x] `modulate` (port — `u_modulate` shader + AudioWorklet phase modulation, coupled per `plan.md §5.1`) ✅ 2026-05-16
- [ ] `rotate` (port — `u_rotate` shader + M/S rotation matrix node, coupled per `plan.md §2.1`)
- [x] `scale` (port — `u_scale` shader + AudioWorklet pitch shifter, coupled per `plan.md §2.2`) ✅ 2026-05-16
- [ ] `posterize` (port — `u_crush` shader + bitcrush worklet, coupled per `plan.md §3.1`; add the missing `gamma` parameter)
- [ ] `shift` (port — `u_shift` shader; audio-side SSB per-band is `todo` for M3, scaffold the param now)
- [ ] global `rate` LFO source (port — shared `u_rate`-driven LFO + audio LFO at same frequency)
- [ ] Port the 7 presets (`tunnel`, `bloom`, `lattice`, `chaos`, `ghost`, `kaleido`, `zero`) as JSON in `public/presets/`; preset = a set of `(paramId, value)` pairs

## M3 — Fill in the rest of the Hydra surface area

Success: every operator listed in `plan.md` is implemented in both domains, the coupling spec is enforced, each operator has a unit test (audio worklet correctness + GLSL shader compile check), and the chainable API works end-to-end.

Release note: not every open `M3` item blocks a staging/manual-test deploy, but the remaining **Color** work and the full **Blend** family are considered essential blockers for a public/professional release.

Work in family-batches. Order chosen by mathematical-foundation dependency:

- [ ] **Sources** — `osc` ✅ 2026-05-16, `noise` ✅ 2026-05-16, `voronoi` ✅ 2026-05-16, `shape` ✅ 2026-05-16, `gradient` ✅ 2026-05-16, `solid` ✅ 2026-05-16, multi-source `src(oN)`, external `s0..s3` with cam/mic init
- [ ] **Geometry** — `pixelate` ✅ 2026-05-16, `repeat` ✅ 2026-05-16, `repeatX` ✅ 2026-05-16, `repeatY` ✅ 2026-05-16, `scrollX` ✅ 2026-05-16, `scrollY` ✅ 2026-05-16
- [x] **Runtime hardening** — coupling evaluation is live in renderer/audio engine, neutral ops bypass by default, video clock follows audio when present, procedural/video source switching no longer double-disposes, media-element audio nodes are reused, and check/test/lint/build are green ✅ 2026-05-16
- [x] **Worklet DSP pass** — `scale` pitch shift, `pixelate` true decimation, and `modulate` sample-accurate phase modulation are AudioWorklet-backed ✅ 2026-05-16
- [ ] **Color** — `brightness` ✅ 2026-05-16, `contrast` ✅ 2026-05-16, `color` ✅ 2026-05-16, `saturate` ✅ 2026-05-16, `invert`, `luma`, `thresh`, `hue`, `colorama`, `sum`, channel accessors `.r .g .b .a`
- [ ] **Blend** — `add`, `sub`, `mult`, `diff`, `layer`, `blend`, `mask`
- [ ] **Modulate (full family)** — `modulateRotate`, `modulateScale`, `modulatePixelate`, `modulateRepeat`, `modulateScrollX`, `modulateScrollY`, `modulateKaleid`, `modulateHue`
- [ ] **Output/buses** — full 4-bus `o0..o3` routing in both domains
- [ ] **Array modifiers** — `.fast`, `.smooth`, `.ease`, `.offset`, `.invert` as universal `ParamSpec.automation` modes
- [ ] **Audio input** — `AnalyserNode` + bins exposed as `a.fft[i]`; `a.setBins`, `a.setSmooth`, `a.setCutoff`, `a.setScale`
- [ ] **Video features** — luminance / frame-flux / edge-density exposed as `v.luma`, `v.flux`, `v.edge` for audio reactivity (the reverse direction Hydra doesn't have)

## M4 — Chainable live-coding API

Success: a CodeMirror editor accepts Hydra-style chained calls (`osc(60,0.1,1.5).modulate(noise(3)).out()`) and the result drives both renderers. The parser is permissive of Hydra dialect.

- [ ] CodeMirror 6 instance in `src/ui/Editor.svelte`, JS syntax mode
- [ ] Chain-builder mock objects (`osc()` returns a `ChainNode` with `.modulate()`, `.out()`, etc.) that mutate the graph rather than imperatively rendering
- [ ] Live-eval: `new Function('osc, noise, …, out, render', userCode)(…)` in a try/catch with an error overlay
- [ ] Hot-swap: a syntactically-valid edit takes effect without resetting the audio context
- [ ] Optional: a non-textual patch UI (drag-wire nodes in `Patch.svelte`) as a future track

## M5 — Polish & product surface

Success: the app looks and feels like a product, not a prototype. Could ship to a public URL.

- [ ] Visual design pass: dark theme, panel hierarchy, monospace numeric readouts, hardware-synth feel
- [ ] Knob and slider components with proper drag semantics, fine-tune modifier keys, double-click-to-reset, right-click context menu
- [ ] Oscilloscope + spectrum analyser components on the bottom rail
- [ ] Preset browser with thumbnails (auto-captured), tagging, save/load
- [ ] Save/share: serialise graph + presets to a shareable URL hash (or a paste service)
- [x] Recording: capture canvas + audio as a `.webm` via `MediaRecorder` ✅ 2026-05-17
- [ ] Mobile / touch-input considerations (knobs are hard on touch; consider list-of-sliders fallback)
- [ ] Performance budget: 60 fps at 1080p, <10 ms audio block CPU on a mid-range laptop
- [ ] Accessibility: keyboard nav for all controls, ARIA labels, focus-visible everywhere

## M5.5 — QA & Regression Harness

Success: the repo can run a repeatable live-browser QA pass locally, save artifacts to a stable layout, and feed those artifacts into the recommended MCP analyzers.

- [x] Define the QA stack: Playwright for live behavior, `mcp-music-analysis` for audio behavior, `ffmpeg-quality-metrics` as the authoritative visual metrics backend, `video-quality-mcp` for metadata/GOP/artifact summaries, `ffmpeg-mcp` as a pipeline helper, and explicit manual audible/visual review for the remaining exception-heavy cases ✅ 2026-05-17; hardened 2026-05-18
- [x] Add a `qa/` subtree with fixtures/results layout, manifest-driven case definitions, and MCP config templates ✅ 2026-05-17
- [x] Add Playwright-based smoke/regression coverage for source upload, transport start, video clock advance, audio activity, and color/worklet operator sweeps ✅ 2026-05-17
- [x] Add app-side capture/export so analyzer input comes from rendered AV output, not only browser video artifacts ✅ 2026-05-17
- [x] Wire analyzer outputs into a machine-readable regression summary (`qa/results/.../analysis.json`) ✅ 2026-05-17
- [x] Add CI entrypoint for the local QA pipeline (`.github/workflows/qa.yml`) ✅ 2026-05-17

## M5.6 — Pre-deploy operator-family audit

Success: every implemented operator family has passed both automated and manual AV QA on committed fixtures, regressions are fixed, and deploy is blocked until the audit matrix is green.

- [x] Define the operator audit matrix in `qa/cases/`: one or more cases per implemented family, with low/mid/high parameter sweeps and explicit audio+video expectations ✅ 2026-05-17
- [x] **Sources audit** — `osc`, `noise`, `voronoi`, `shape`, `gradient`, `solid`, plus `video` input: verify source load/start/export, expected visual motion/content, and expected audio activity/spectral shape. Source-family cases now live in `qa/cases/audit-source-*`; current explicit manual-audio exceptions are `audit-source-noise-sweep`, `audit-source-shape-sweep`, and `audit-source-gradient-sweep` because the current descriptors are not robust enough to hard-gate their intended timbral laws ✅ 2026-05-17
- [x] **Feedback / composition audit** — `feedback`, `modulate`: verify no runaway instability at intended ranges, expected visual persistence/warp, and expected audio feedback/phase behavior. Cases live in `qa/cases/audit-feedback-*` and `qa/cases/audit-modulate-*`; current explicit caveats remain `audit-feedback-video-cross-source` on the decoded-video visual side and `audit-modulate-osc-sweep` on the exported-audio timbre side ✅ 2026-05-17
- [x] **Geometry audit** — `scale`, `rotate`, `scrollX`, `scrollY`, `repeat`, `repeatX`, `repeatY`, `pixelate`, `kaleid`: verify visual transform intent, exported-video continuity, and audio-domain analogue behavior from the coupling law. The matrix now spans every implemented geometry operator. Current explicit caveats: `audit-kaleid-osc-sweep`, `audit-pixelate-osc-sweep`, `audit-pixelate-video-cross-source`, `audit-scrollY-osc-sweep`, and `audit-repeatY-osc-sweep` keep manual visual review, and `audit-scrollX-osc-sweep` keeps manual exported-audio review ✅ 2026-05-17
- [x] **Color audit** — `brightness`, `contrast`, `color`, `saturate`, `posterize`, `chromaShift`: verify visual tonal/spectral changes and corresponding audio amplitude/timbral/stereo changes. Color-family cases now live in `qa/cases/audit-brightness-video-sweep.json`, `audit-contrast-osc-sweep.json`, `audit-color-solid-band-sweep.json`, `audit-saturate-video-sweep.json`, `audit-posterize-video-sweep.json`, and `audit-chromaShift-video-sweep.json`; `color`, `saturate`, `posterize`, and `chromaShift` keep more manual-heavy audio review by design ✅ 2026-05-17
- [x] Add committed reference videos for stable cases so `video-quality-mcp` comparisons stop being skipped on audited operators. `qa/references/` now holds committed `.webm` baselines for all current `audit-*` cases, and `npm run qa:references:sync` refreshes them from a green audit run ✅ 2026-05-17
- [x] Add configured analyzer adapters for the active external stack on the audit machine, then persist their outputs in `analysis.json`. `qa/analyzers.config.json` now points at repo-local wrappers for `mcp-music-analysis`, `ffmpeg-quality-metrics`, and `video-quality-mcp` in `qa/adapters/`, and `qa:analyze` writes sidecar analyzer JSON plus embeds their status/output in `analysis.json`. `mcp-video-analyzer` is retained as a reference-only wrapper, not part of the active audit path ✅ 2026-05-17; hardened 2026-05-18
- [ ] Complete final human audible sign-off on the explicitly manual-heavy cases in `qa/reviews/` on a normal local machine with speakers/headphones
- [x] Add segmented exported-WAV assertions for audited audio behavior; live analyser checkpoint metrics remain inspection-only while exported segments back the hard audio gate on seeded audit cases ✅ 2026-05-17
- [x] Add manual review notes per family: audible coupling correctness, clipping/harshness, visual artifacts, and any “professional use” issues that metrics will miss. Notes now live in `qa/reviews/` ✅ 2026-05-17
- [x] Fix every issue found by the audit before opening M6 deploy work. This cycle fixed the QA-bridge duplicate-instance targeting gap and the source-param propagation bug exposed by the `solid` cases ✅ 2026-05-17
- [x] Freeze the audited matrix as the pre-deploy regression gate in CI. `.github/workflows/qa.yml` now runs `npm run qa:audit:ci` and `qa:analyze` supports audit-only filtering ✅ 2026-05-17

## M6 — Deploy

Success: staging URL serves the app for real-world manual testing, or public URL serves the app once the public-release blockers are cleared; in both cases `mcp__playwright__browser_navigate` to the target URL returns a working synth.

- [ ] Confirm the final human audible sign-off item above is complete: final human audible sign-off is finished and any issues found there are either fixed or consciously deferred in writing
- [ ] Use Cloudflare Pages as the default deployment target unless the user explicitly overrides that decision
- [ ] Treat the first deploy as **staging/private** unless the user explicitly asks for a public release
- [ ] Document the production deployment inputs before changing CI:
  - build command: `npm run build`
  - output directory: `dist`
  - required env vars / secrets for the chosen host and GitHub Action
  - production branch / trigger branch
- [ ] Configure deployment GitHub Action for the chosen host and keep the audited QA gate in front of deploy
- [ ] Deploy a first staging build and record the canonical staging URL in repo docs
- [ ] Run a post-deploy Playwright smoke pass against the staging URL and fix any live-only regressions
- [ ] Before any public/professional release, complete these additional blockers:
  - remaining Color operators: `invert`, `luma`, `thresh`, `hue`, `colorama`, `sum`, channel accessors `.r .g .b .a`
  - Blend family: `add`, `sub`, `mult`, `diff`, `layer`, `blend`, `mask`
  - rerun QA/audit for the newly implemented families and update `qa/reviews/`
- [ ] Only after the blockers above are closed: deploy the public/professional build, record the canonical public URL in repo docs, and rerun the post-deploy Playwright smoke pass against that public URL
- [ ] Custom domain (deferred unless explicitly decided)

---

## Standing items (always-on)

- [ ] After every meaningful change: update `memory.md` if a decision was made or a design tension surfaced
- [ ] Keep `plan.md` status flags (`present`/`partial`/`todo`) in sync with reality
- [ ] After every push: run the Post-Push Verification Protocol from `~/.claude/CLAUDE.md`
