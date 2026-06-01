# AV Synth

AV Synth is a browser-based, video-first audio/visual effects instrument. Load short-form video, process it through a Hydra-inspired WebGL2 effects rack, and bind visual motion, audio granulation, feedback delay, MIDI, and LFO modulation into one performable patch.

The project is currently in staging / release-candidate development. The web build is the primary target. Desktop packaging is deferred until the remaining performance, listening, latency, hosted-smoke, and showcase-review gates are closed.

## What it does

- Video-first signal path: uploaded footage is the main source.
- Hydra-inspired effects rack: motion, color, texture, feedback, blend/composite, finish, and field operators.
- Granulator-first audio engine: source audio is processed through a high-quality granular engine.
- Shared feedback delay: one focused delay path rather than a broad synth rack.
- Shared modulation fabric: LFO, MIDI, and video-derived features can all route into the same parameter space.
- Stateful temporal effects: feedback, slit-scan, datamosh, flow, pixel sort, warps, and field operators.
- Curated showcase programs: public presets are authored as immediate video-first looks rather than open-ended synth templates.
- Browser QA/export path: Playwright-driven runs can capture rendered canvas plus mixed audio for regression review.

AV Synth is not intended to be a general-purpose procedural synth or a many-engine audio playground. The intended public product is a video-effects instrument with a strong granular-audio companion.

## Current Status

The repo is near its first private Cloudflare Pages staging deployment. The main remaining release gates are:

- final hosted smoke on the real staging URL
- reference-class CPU measurement on 2020-era Intel hardware
- D3 human listening sign-off against the granulator benchmark
- D4 physical loopback / scope latency measurement
- manual review of hosted showcase captures
- final license selection before public release

See [RELEASE_VERDICT.md](./RELEASE_VERDICT.md), [deploy.md](./deploy.md), [todo.md](./todo.md), and [SHOWCASE_CAPTURES.md](./SHOWCASE_CAPTURES.md).

## Stack

- Svelte 5
- TypeScript
- Vite
- WebGL2 / GLSL
- Web Audio / AudioWorklet
- Playwright
- Vitest
- ESLint / Prettier

## Requirements

- Node.js 22 or newer
- A modern Chromium-based browser for development and QA
- WebGL2
- AudioWorklet support
- `ffmpeg` / `ffprobe` for the richer local QA and media-analysis path

## Getting Started

```bash
npm install
npm run dev
```

Open the Vite URL shown in the terminal.

For the fixed local QA/dev URL:

```bash
npm run dev:http
```

This binds the app at `http://127.0.0.1:4173`.

## Common Commands

```bash
npm run check
npm run lint
npm run test:run
npm run build
```

Browser QA:

```bash
npm run qa:smoke
npm run qa:smoke:preview
npm run qa:cases
npm run qa:analyze
```

Granulator / release-track QA:

```bash
npm run qa:granulator:listening
npm run qa:granulator:latency
npm run qa:showcase:capture
```

Operator characterisation:

```bash
npm run qa:opSweep
npm run qa:opSweep:thorough
```

The thorough operator sweep is intentionally long-running and is meant for overnight or release-gate use.

## Project Layout

```text
src/
  App.svelte              Main shell and workspace tabs
  core/                   Coupling, modulation, graph, operators, presets
  audio/                  Granulator, feedback delay, engine wiring
  ops/                    Video operator definitions
  video/                  WebGL renderer, shaders, grain buffers
  ui/                     Svelte UI components
public/
  worklets/               AudioWorklet modules
  presets.json            Public program data
  luts/                   Built-in LUT assets
qa/
  cases/                  Manifest-driven QA cases
  e2e/                    Playwright tests
  references/             Committed reference captures
  reviews/                Durable manual review notes
  results/                Generated local QA artifacts (git-ignored)
references/
  granulator-port-spec.md Granulator engineering contract
docs/
  archive/                Older phase/build narrative
```

## Deployment Path

Local production-like preview:

```bash
npm run build
npm run preview:http
```

Staging deployment is currently manual via Cloudflare Pages. The repo workflow and runbook live in [deploy.md](./deploy.md).

External smoke against a deployed URL:

```bash
PLAYWRIGHT_BASE_URL=https://your-staging-url.example npm run qa:smoke:external
```

Current deployment sequence:

1. Pass local `check`, `lint`, `test:run`, and `build`.
2. Close the remaining release blockers in [todo.md](./todo.md) and confirm the current gate state in [RELEASE_VERDICT.md](./RELEASE_VERDICT.md).
3. Deploy to private Cloudflare staging.
4. Run hosted smoke and review showcase captures on the real host.
5. Add license details before any public release or desktop distribution.

## Desktop Plan

Electron is the planned packaging target after the web/staging release gates close.

Desktop packaging should preserve the browser security model:

- keep `nodeIntegration` disabled
- keep `contextIsolation` enabled
- keep renderer sandboxing enabled
- expose native-only features through a narrow preload bridge
- serve the built app through a secure custom protocol or local static HTTP server
- do not rely on `file://` loading

See [DESKTOP_FEASIBILITY.md](./DESKTOP_FEASIBILITY.md).

## Known Limitations

- The current build is designed for short-form video clips, not long-form footage.
- WebGL2 is the active rendering backend.
- WebGPU compute work is deferred to a later desktop/advanced phase.
- Some analyzer workflows depend on local tools outside the npm dependency tree.
- The project is still pre-release and should be treated as an active instrument build, not a stable library.

## License

License details have not been finalized yet. Add the project license before public release or desktop distribution.
