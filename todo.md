# todo.md — av-synth build-out checklist

Staged from "single 999-line HTML" to "professional, productisable web app." Check off as items close. Add dates next to completed items (`✅ 2026-05-16`).

Success criterion for each milestone is listed; do not declare it done until the criterion is met.

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
- [ ] `modulate` (port — `u_modulate` shader + delay-LFO PM, coupled per `plan.md §5.1`)
- [ ] `rotate` (port — `u_rotate` shader + M/S rotation matrix node, coupled per `plan.md §2.1`)
- [ ] `scale` (port — `u_scale` shader + varispeed/pitch node, coupled per `plan.md §2.2`)
- [ ] `posterize` (port — `u_crush` shader + bitcrush worklet, coupled per `plan.md §3.1`; add the missing `gamma` parameter)
- [ ] `shift` (port — `u_shift` shader; audio-side SSB per-band is `todo` for M3, scaffold the param now)
- [ ] global `rate` LFO source (port — shared `u_rate`-driven LFO + audio LFO at same frequency)
- [ ] Port the 7 presets (`tunnel`, `bloom`, `lattice`, `chaos`, `ghost`, `kaleido`, `zero`) as JSON in `public/presets/`; preset = a set of `(paramId, value)` pairs

## M3 — Fill in the rest of the Hydra surface area

Success: every operator listed in `plan.md` is implemented in both domains, the coupling spec is enforced, each operator has a unit test (audio worklet correctness + GLSL shader compile check), and the chainable API works end-to-end.

Work in family-batches. Order chosen by mathematical-foundation dependency:

- [ ] **Sources** — `osc` ✅ 2026-05-16, `noise` ✅ 2026-05-16, `voronoi` ✅ 2026-05-16, `shape` ✅ 2026-05-16, `gradient` ✅ 2026-05-16, `solid` ✅ 2026-05-16, multi-source `src(oN)`, external `s0..s3` with cam/mic init
- [ ] **Geometry** — `pixelate` ✅ 2026-05-16, `repeat` ✅ 2026-05-16, `repeatX` ✅ 2026-05-16, `repeatY` ✅ 2026-05-16, `scrollX` ✅ 2026-05-16, `scrollY` ✅ 2026-05-16
- [ ] **Color** — `invert`, `contrast`, `brightness`, `luma`, `thresh`, `color`, `saturate`, `hue`, `colorama`, `sum`, channel accessors `.r .g .b .a`
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
- [ ] Recording: capture canvas + audio as a `.webm` via `MediaRecorder`
- [ ] Mobile / touch-input considerations (knobs are hard on touch; consider list-of-sliders fallback)
- [ ] Performance budget: 60 fps at 1080p, <10 ms audio block CPU on a mid-range laptop
- [ ] Accessibility: keyboard nav for all controls, ARIA labels, focus-visible everywhere

## M6 — Deploy

Success: live URL serves the app; `mcp__playwright__browser_navigate` to it returns a working synth.

- [ ] Choose hosting (Cloudflare Pages preferred per personal global rules)
- [ ] Configure deployment GitHub Action — delegate workflow file to `deepseek-write`
- [ ] Custom domain (deferred unless decided)
- [ ] Post-deploy Playwright smoke test in CI

---

## Standing items (always-on)

- [ ] After every meaningful change: update `memory.md` if a decision was made or a design tension surfaced
- [ ] Keep `plan.md` status flags (`present`/`partial`/`todo`) in sync with reality
- [ ] After every push: run the Post-Push Verification Protocol from `~/.claude/CLAUDE.md`
