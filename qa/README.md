# QA stack

This repo uses a layered QA model:

1. `Playwright` for live browser/runtime behavior.
2. `mcp-music-analysis` for audio behavior and structure.
3. `ffmpeg-quality-metrics` as the authoritative full-reference visual metrics backend for PSNR / SSIM, plus VMAF when the configured `ffmpeg` build exposes `libvmaf`.
4. `video-quality-mcp` for metadata, GOP structure, artifact summaries, and secondary visual context.
5. `ffmpeg` (direct invocation, no MCP) for `.wav` extraction and basic audio level probing.

`mcp-video-analyzer` is intentionally not wired into the pipeline — it is built for Loom/screen-recording transcript + OCR analysis, which is not what synth output needs. The wrapper in `qa/adapters/` is kept for reference only.

## What is built in-repo today

- Manifest-driven Playwright cases under [`qa/cases`](./cases)
- Live browser tests under [`qa/e2e`](./e2e)
- Artifact output root at `qa/results/` (git-ignored)
- Granulator listening fixtures at `qa/fixtures/granulator-{held-tone,source}-48k.wav`
- Granulator listening-pack generator at `qa/scripts/granulator-listening-pack.mjs`
- MCP config templates under [`qa/mcp`](./mcp)
- Optional analyzer adapter config under `qa/analyzers.config.json` (copy from `qa/analyzers.config.example.json`)
- Committed reference captures under [`qa/references`](./references)
- A browser QA bridge exposed as `window.__AV_SYNTH_QA__` for deterministic test control/state inspection
- Runtime `v.luma` / `v.flux` / `v.edge` signals sampled from the loaded clip and exposed through the QA bridge state
- App-side capture/export of rendered canvas + mixed audio as `.webm`
- Granulator MIDI-latency proxy harness at `qa/e2e/d4-midi-latency-proxy.spec.ts`
- A GitHub Actions workflow at `.github/workflows/qa.yml` that runs the committed QA pipeline in CI
- A manual Cloudflare Pages workflow at `.github/workflows/deploy-pages.yml` for staging/private deploy plus optional post-deploy smoke
- Live checkpoint metrics captured during Playwright cases and persisted as `metrics.json` beside each case's artifacts

## Current limitation

The app now ships first-class AV export, so Playwright can save authoritative rendered `.webm` output from the synth itself. The remaining gap is richer external analyzer wiring:

- `.webm` export is available now through the app QA bridge and transport UI.
- `npm run qa:analyze` extracts `.wav`, probes media with `ffprobe`, measures basic audio level with `ffmpeg`, evaluates segmented exported-WAV comparisons, runs the configured analyzer wrappers, and writes `analysis.json` per case plus an `analysis-summary.json`.
- The live QA bridge can expose runtime/audio-analyser state now, and seeded audit cases can assert checkpoint-to-checkpoint **video** deltas in-browser.
- Live audio-analyser checkpoint metrics remain exploratory. The hard audio gate now comes from segmented exported-WAV analysis keyed off the Playwright checkpoints in `metrics.json`.
- External analyzer adapters are now wired by default through repo-local wrapper scripts in `qa/adapters/`, but they still depend on locally available tools: MCP servers for `mcp-music-analysis` / `video-quality-mcp`, and a local `ffmpeg-quality-metrics` command or `uvx` environment for the authoritative visual metrics layer.
- `qa/references/<recording filename>.webm` is now the default committed reference convention for the audit matrix.

The intended next flow is:

1. Run Playwright case.
2. Save rendered `.webm` / extracted `.wav`.
3. Feed `.wav` into `mcp-music-analysis`.
4. Compare current vs reference videos with `ffmpeg-quality-metrics` for authoritative PSNR / SSIM / VMAF metrics.
5. Use `video-quality-mcp` for metadata, GOP, and artifact summaries that complement the strict metrics.

## HTTP-only Playwright policy

This QA stack assumes Playwright reaches the app over HTTP. `file:///...` navigation is not part of the supported workflow.

- Local fast path: let Playwright start the dev server itself with `npm run qa:smoke` or `npm run qa:cases`.
- Local production-like path: run `npm run qa:smoke:preview` or `npm run qa:cases:preview` so Playwright tests the built app through `vite preview`.
- Attached-server path: start the app yourself, or use a staging deployment, then run `npm run qa:smoke:external` or `npm run qa:cases:external`.
- Override target URL by setting `PLAYWRIGHT_BASE_URL`, for example `PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 npm run qa:smoke:external` or `PLAYWRIGHT_BASE_URL=https://staging.example.com npm run qa:smoke:external`.

`qa/playwright.config.ts` now supports three explicit server modes through environment variables:

- `PLAYWRIGHT_SERVER_MODE=dev` — auto-start `npm run dev:http` on `http://127.0.0.1:4173` (default)
- `PLAYWRIGHT_SERVER_MODE=preview` — auto-start `npm run preview:http` against the built app
- `PLAYWRIGHT_SERVER_MODE=external` — do not start any server; attach to `PLAYWRIGHT_BASE_URL`

If your environment forbids local port binding, the repo-side fix is to use the attached-server path rather than `file:` URLs.

Granulator-specific helpers:

- `npm run qa:granulator:listening` refreshes the committed listening input fixtures and writes the av-synth comparison renders to `qa/results/granulator-listening/`.
- `npm run qa:granulator:latency` runs the internal lower-bound MIDI-latency proxy and writes `qa/results/granulator-latency-proxy.json`.
- The review/protocol note for both harnesses lives at `qa/reviews/granulator/2026-05-24-d3-d4-harnesses.md`.

## Directory layout

- `qa/cases/` — JSON manifests for smoke/regression scenarios
- `qa/e2e/` — Playwright tests + helpers
- `qa/fixtures/` — notes about local fixtures; media files may live elsewhere in the repo
- `qa/mcp/` — recommended MCP server config templates
- `qa/references/` — committed baseline `.webm` captures for visual comparison
- `qa/reviews/` — durable family-by-family manual review notes
- `qa/results/` — generated artifacts, reports, traces, videos, screenshots

## Case format

Each case manifest uses raw parameter values:

```json
{
  "id": "video-cello2-color-smoke",
  "title": "Color sweep on committed cello fixture",
  "source": { "kind": "video", "fixture": "qa/fixtures/ci-smoke.mp4" },
  "transport": { "start": true, "settleMs": 1500 },
  "recording": { "filename": "video-cello2-color-smoke", "tailMs": 750 },
  "referenceVideo": "qa/references/video-cello2-color-smoke.webm",
  "expectations": {
    "sourceKind": "video",
    "minVideoAdvanceSeconds": 1,
    "videoFeaturesActive": true,
    "audioActive": true,
    "allowConsoleErrors": ["favicon.ico"]
  },
  "audit": {
    "family": "color-tonal",
    "operator": "brightness",
    "kind": "sweep",
    "expectedVideo": ["image brightens without clipping to flat white"],
    "expectedAudio": ["loudness rises without harsh clipping"],
    "manualChecks": ["Does the coupling still feel usable at the top end?"]
  },
  "steps": [
    {
      "type": "set-operator-param",
      "op": "brightness",
      "paramId": "amount",
      "value": 1,
      "screenshot": "brightness-max"
    }
  ]
}
```

Graph/bus smoke cases can also use:

- `add-blend-node`
- `set-node-bus`
- `set-node-primary-input`
- `add-node-input`
- `set-monitor-bus`
- `set-preview-mode`

`audit` metadata is optional for smoke cases but required for the pre-deploy operator-family gate. The `audit.path` field — `"product" | "operator-regression" | "source-coverage"` — classifies whether a case represents the video-first product surface, deterministic-fixture operator-math regression, or per-source-kind infrastructure coverage. `qa:analyze` copies the whole `audit` block into each case `analysis.json` and groups `analysis-summary.json` both by `paths[]` (product-first) and by `families[]` so review can happen along either axis. The Playwright suite itself is split into family-grouped spec files under `qa/e2e/`; case order stays lexicographic within each group, while cross-group scheduling is file/worker dependent. Playwright now also writes per-checkpoint live metrics to `metrics.json`, and `qa:analyze` includes that payload under `liveMetrics`. When a comparison sets `"source": "exported-audio"`, `qa:analyze` slices the rendered WAV around each checkpoint window and evaluates the comparison against those segment metrics instead of the exploratory live analyser payload.

## Running

Install deps, then:

```bash
npm run qa:smoke
npm run qa:smoke:preview
npm run qa:smoke:external
npm run qa:analyze
npm run qa:references:sync
npm run qa:audit
npm run qa:audit:ci
npm run qa:ci
```

Artifacts land in `qa/results/playwright/`.

## Recommended local workflow

1. Use the committed fixture `qa/fixtures/ci-smoke.mp4` for CI-safe smoke coverage, and add local fixtures only for manual exploration.
2. Pick the server mode explicitly:
   - use `npm run qa:smoke` / `qa:cases` for the fast dev-server path
   - use `npm run qa:smoke:preview` / `qa:cases:preview` for the production-like built path
   - use `PLAYWRIGHT_BASE_URL=... npm run qa:smoke:external` when the server is already running or hosted elsewhere
3. Local Playwright runs now default to `3` workers across those family-grouped spec files; CI stays at `1` worker. Override with `PLAYWRIGHT_WORKERS=<n>` when you need a slower serial repro or a more aggressive local run.
4. Playwright browser video is `retain-on-failure`, not `on`, because the app already exports its own per-case `.webm` capture. This keeps failure debugging intact without doubling steady-state recording load in parallel runs.
5. Run `npm run qa:audit` for the pre-deploy gate, or `npm run qa:ci` for the broader local pipeline.
6. Run `npm run qa:analyze` if you did not use `qa:audit` / `qa:ci`.
7. Review `analysis.json` and exported `.webm` / `.wav` artifacts.
8. Use `npm run qa:references:sync` after a deliberately accepted visual-output change so the committed baselines track the new intended look.
9. If you want third-party analyzer output in the JSON, the repo already points `qa:analyze` at the wrapper scripts in `qa/adapters/`; provide the local MCP server commands through environment variables.
10. `uvx`-launched analyzers such as `mcp-music-analysis` need a normal local user environment with access to the uv cache. They can fail in restricted sandboxes even when the wrapper code is correct.
11. `mcp-video-analyzer` wrapper note: it serves the local `.webm` to the MCP server over an ephemeral `127.0.0.1` HTTP port. That works on a normal dev machine and will fail in sandboxes that forbid local binds.
12. If a case exposes a regression, add a narrower manifest rather than expanding an existing one blindly.

## Current audit seeding

The pre-deploy matrix is organised by **audit path** — the product the case represents — not by operator family alone. Each manifest carries `audit.path` so `qa:analyze` and the README can lead with the video-first product surface and treat procedural-source cases as deeper regression coverage. Note: Playwright execution order is no longer one global lexicographic-by-id list. The suite is split into family-grouped spec files so local runs can parallelise safely; cases stay lexicographic within each group, while cross-group scheduling depends on file order and worker availability. We still do **not** sort execution product-first, because that kind of path-priority reorder previously destabilised tight exported-audio gates once the browser reached warmer later-case positions. The "primary path" framing lives in the docs and in `analysis-summary.json`'s `paths[]` block, where the product matrix is listed first regardless of run order.

## Current QA policy after the granulator-first redirect

The repo is mid-transition.

- The **public audio acceptance story** is no longer "every visual operator's audio analogue still sounds good." It is now the granulator-first path: granulator quality, feedback-delay sanity, limiter safety, MIDI timing, and audio/video grain coherence.
- The existing operator-family audio audits remain useful as **legacy/internal regression coverage** while the old worklets are still in-repo and while the granulator path is not implemented yet.
- Until the granulator lands, keep running the current operator-path suite for protection, but do not mistake a green operator-audio audit matrix for public-release sign-off on the new product direction.
- Once the granulator path exists, add a parallel `granulator` QA family and treat that family as the release gate for audio. At that point, the older operator-audio checks can be consciously demoted, narrowed, or deleted.

### Product path (video-input, leads the matrix)

These exercise the actual user-facing product: an uploaded video clip is the signal, operators and programs manipulate that signal. This is the path users see and the surface a deploy is judged against.

- **Sources / baseline** — `audit-source-video-baseline.json` (live `v.luma` / `v.flux` / `v.edge` come up on the loaded clip)
- **Programs / finish surface** — `audit-program-tunnel-video.json`, `audit-program-bloom-video.json`, `audit-program-kaleido-video.json`, `audit-finish-imported-lut-video.json`, plus the targeted Hydra-port smokes `audit-program-nelson-twist-video.json`, `audit-program-pixelscape-video.json`, `audit-program-disintegration-video.json`, `audit-program-acid-bus-seat-video.json`, `audit-program-glitchy-slit-scan-video.json`, and `audit-program-velasco-video.json` (named video-first treatments exercised through the real `applyProgram` UI path plus the imported-LUT finish path; `Pixelscape`, `Acid Bus Seat`, and `Glitchy Slit Scan` now also carry real video metric comparisons after their routed-scale / routed-pixelate rebuilds, so those ports are no longer protected by prose-only smoke checks)
- **Color / tonal** — `audit-brightness-video-sweep.json`, `audit-chromaShift-video-sweep.json`, `audit-invert-video-sweep.json`, `audit-luma-video-sweep.json`, `audit-posterize-video-sweep.json`, `audit-saturate-video-sweep.json`
- **Geometry / spatial** — `audit-grain-video-cross-source.json`, `audit-scale-video-cross-source.json`, `audit-rotate-video-cross-source.json`, `audit-scrollX-video-cross-source.json`, `audit-scrollY-video-cross-source.json`, `audit-repeat-video-cross-source.json`, `audit-repeatX-video-cross-source.json`, `audit-repeatY-video-cross-source.json`, `audit-pixelate-video-cross-source.json`, `audit-kaleid-video-cross-source.json`
- **Feedback / composition** — `audit-feedback-video-cross-source.json`, `audit-modulate-video-cross-source.json`, `audit-modulateDisplace-video-cross-source.json`
- **End-to-end smoke** — `video-cello2-color-smoke.json`, `video-bus-return-blend-smoke.json`, `video-quad-monitor-smoke.json`

### Operator-regression path (procedural-source operator math)

These are not product demos — they exist because their fixtures (`osc`, `solid`) are deterministic enough to hard-gate operator math. They stay in the matrix as load-bearing regression coverage but are explicitly not the path a deploy is judged against.

- **Feedback / composition** — `audit-feedback-osc-baseline.json`, `audit-feedback-osc-sweep.json`, `audit-modulate-osc-baseline.json`, `audit-modulate-osc-sweep.json`, `audit-modulateDisplace-osc-sweep.json`
- **Geometry / spatial** — `audit-scale-osc-sweep.json`, `audit-rotate-osc-sweep.json`, `audit-scrollX-osc-sweep.json`, `audit-scrollY-osc-sweep.json`, `audit-repeat-osc-sweep.json`, `audit-repeatX-osc-sweep.json`, `audit-repeatY-osc-sweep.json`, `audit-pixelate-osc-sweep.json`, `audit-kaleid-osc-sweep.json`
- **Color / tonal** — `audit-color-solid-band-sweep.json`, `audit-contrast-osc-sweep.json`, `audit-hue-solid-sweep.json`, `audit-colorama-solid-sweep.json`, `audit-thresh-osc-sweep.json`
- **Smoke** — `procedural-osc-smoke.json`

### Source-coverage path (procedural source kinds)

One case per procedural source kind. These are infrastructure — they prove each source still boots and produces audio + video — and they are not part of the product-facing matrix.

- `audit-source-osc-sweep.json`, `audit-source-noise-sweep.json`, `audit-source-voronoi-sweep.json`, `audit-source-shape-sweep.json`, `audit-source-gradient-sweep.json`, `audit-source-solid-sweep.json`

Current stable gate status:

- `npm run qa:audit` now regenerates a fully green `audit-*` batch and `npm run qa:audit:analyze` writes a green audit-only `analysis-summary.json`.
- `npm run qa:references:sync` now snapshots the current `audit-*` `.webm` artifacts into committed `qa/references/`.
- `audit-source-video-baseline.json` now asserts that `v.luma` / `v.flux` / `v.edge` become active on a real loaded video fixture, so the first shipped video-feature path is part of the committed smoke/audit surface.
- Live video metrics now include `meanR`, `meanG`, `meanB`, and `meanSaturation` so the color family is no longer audited only through grayscale proxies.
- Exported-WAV segment assertions remain the hard audio gate wherever the fixture/metric pair is stable.
- `qa:analyze` now attempts `mcp-music-analysis`, `ffmpeg-quality-metrics`, and `video-quality-mcp` through repo-local wrappers and persists their sidecar JSON beside each case artifact.

Important interpretation note:

- The product/video matrix above is still the right way to judge the visible shipped app.
- The operator-regression audio checks below are not the long-term public audio gate anymore; they are transition-period protection while the codebase moves from the older operator-audio/rack experiments toward the single granulator + feedback surface.

## Local analyzer environment

The wrappers are committed in `qa/adapters/`, and `qa/analyzers.config.json` is wired to the active analyzers. The simplest setup is to source `qa/mcp-env.sh` before running QA, which exports the required variables. To configure manually:

- `AV_SYNTH_MUSIC_ANALYSIS_COMMAND` (e.g. `uvx`)
- `AV_SYNTH_MUSIC_ANALYSIS_ARGS_JSON` (e.g. `["mcp-music-analysis"]`)
- `AV_SYNTH_FFMPEG_QUALITY_METRICS_COMMAND` (e.g. `uvx` or a local `ffmpeg-quality-metrics` binary)
- `AV_SYNTH_FFMPEG_QUALITY_METRICS_ARGS_JSON` (e.g. `["ffmpeg-quality-metrics"]`)
- `AV_SYNTH_FFMPEG_QUALITY_METRICS_FFMPEG_PATH` if you want the wrapper to use a non-default `ffmpeg` binary
- `AV_SYNTH_FFMPEG_QUALITY_METRICS_FRAMERATE` if your rendered captures need an explicit fallback fps for analysis (defaults to `60`)
- `AV_SYNTH_VIDEO_QUALITY_ROOT` pointing at a checkout of `https://github.com/hlpsxc/video-quality-mcp`
- `AV_SYNTH_VIDEO_QUALITY_PYTHON` if the video-quality server should run under a venv python (recommended: `$AV_SYNTH_VIDEO_QUALITY_ROOT/.venv/bin/python`)

Install steps (one time):

```bash
brew install uv                                # for mcp-music-analysis via uvx
uv tool install ffmpeg-quality-metrics         # optional; otherwise the wrapper can use `uvx ffmpeg-quality-metrics`
git clone https://github.com/hlpsxc/video-quality-mcp ~/Projects/video-quality-mcp
cd ~/Projects/video-quality-mcp && uv venv && uv pip install -r requirements.txt
```

Known limitations of the current visual-analysis layer:

- `ffmpeg-quality-metrics` needs an explicit framerate for the repo’s generated `.webm` captures because `ffprobe` reports unusable default rates (`avg_frame_rate=0/0`, `r_frame_rate=1000/1`). The wrapper now probes and falls back to `60`, which matches the app’s `canvas.captureStream(60)` export path.
- VMAF requires a `libvmaf`-enabled `ffmpeg` build. The default Homebrew `ffmpeg` on this machine does not expose the `libvmaf` filter, so the wrapper currently computes authoritative PSNR / SSIM immediately and reports VMAF as unavailable until `AV_SYNTH_FFMPEG_QUALITY_METRICS_FFMPEG_PATH` points at a compatible build.
- `video-quality-mcp` remains useful for metadata/GOP/artifact summaries, but it is no longer treated as the authoritative source for PSNR / SSIM / VMAF.

Current explicit manual exceptions:

- `audit-feedback-video-cross-source.json` — decoded-video visual side stays manual
- `audit-modulate-osc-sweep.json` — exported-audio timbre side stays manual
- `audit-kaleid-osc-sweep.json`, `audit-pixelate-osc-sweep.json`, and `audit-pixelate-video-cross-source.json` — visual side stays manual
- `audit-scrollY-osc-sweep.json` and `audit-repeatY-osc-sweep.json` — visual side stays manual
- `audit-scrollX-osc-sweep.json` — exported-audio side stays manual
- `audit-source-noise-sweep.json`, `audit-source-shape-sweep.json`, and `audit-source-gradient-sweep.json` — audio judgment stays manual because the current descriptors do not yet encode the intended timbral law robustly enough
- `audit-color-solid-band-sweep.json`, `audit-saturate-video-sweep.json`, `audit-posterize-video-sweep.json`, and `audit-chromaShift-video-sweep.json` remain more manual-heavy on the audio side for the same reason
- `audit-invert-video-sweep.json` — both video and audio sides stay manual: single-channel phase invert is inaudible and meanLuma deltas are fixture-sign-dependent
- `audit-hue-solid-sweep.json` — the +1-octave (`amount=1.0`) audio endpoint stays manual review only because it sits at the `pitch-shifter` worklet's `ratio=2` edge; the gate fires on the conservative 0→0.333 ratio≈1.26 pair, same pattern `scale` uses
- `audit-colorama-solid-sweep.json` — exported-audio side stays manual review only because the solid source's exported-WAV baseline spectral centroid jumped 162→287 Hz between back-to-back fresh-browser runs, making any centroid-delta gate unreliable on that fixture. Live `spatialStd` video gate remains hard (deterministic per-pixel GLSL). Same precedent as `audit-modulate-osc-sweep` / `audit-scrollX-osc-sweep`

Manual review notes now live under [`qa/reviews`](./reviews):

- [`sources.md`](./reviews/sources.md)
- [`feedback-composition.md`](./reviews/feedback-composition.md)
- [`geometry-spatial.md`](./reviews/geometry-spatial.md)
- [`color-tonal.md`](./reviews/color-tonal.md)
