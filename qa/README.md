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
- MCP config templates under [`qa/mcp`](./mcp)
- Optional analyzer adapter config under `qa/analyzers.config.json` (copy from `qa/analyzers.config.example.json`)
- Committed reference captures under [`qa/references`](./references)
- A browser QA bridge exposed as `window.__AV_SYNTH_QA__` for deterministic test control/state inspection
- App-side capture/export of rendered canvas + mixed audio as `.webm`
- A GitHub Actions workflow at `.github/workflows/qa.yml` that runs the committed QA pipeline in CI
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

`audit` metadata is optional for smoke cases but required for the pre-deploy operator-family gate. `qa:analyze` copies it into each case `analysis.json` and also groups `analysis-summary.json` by family/operator/kind so review can happen family-by-family instead of case-by-case. Playwright now also writes per-checkpoint live metrics to `metrics.json`, and `qa:analyze` includes that payload under `liveMetrics`. When a comparison sets `"source": "exported-audio"`, `qa:analyze` slices the rendered WAV around each checkpoint window and evaluates the comparison against those segment metrics instead of the exploratory live analyser payload.

## Running

Install deps, then:

```bash
npm run qa:smoke
npm run qa:analyze
npm run qa:references:sync
npm run qa:audit
npm run qa:audit:ci
npm run qa:ci
```

Artifacts land in `qa/results/playwright/`.

## Recommended local workflow

1. Use the committed fixture `qa/fixtures/ci-smoke.mp4` for CI-safe smoke coverage, and add local fixtures only for manual exploration.
2. Run `npm run qa:audit` for the pre-deploy gate, or `npm run qa:ci` for the broader local pipeline.
3. Run `npm run qa:analyze` if you did not use `qa:audit` / `qa:ci`.
4. Review `analysis.json` and exported `.webm` / `.wav` artifacts.
5. Use `npm run qa:references:sync` after a deliberately accepted visual-output change so the committed baselines track the new intended look.
6. If you want third-party analyzer output in the JSON, the repo already points `qa:analyze` at the wrapper scripts in `qa/adapters/`; provide the local MCP server commands through environment variables.
7. `uvx`-launched analyzers such as `mcp-music-analysis` need a normal local user environment with access to the uv cache. They can fail in restricted sandboxes even when the wrapper code is correct.
8. `mcp-video-analyzer` wrapper note: it serves the local `.webm` to the MCP server over an ephemeral `127.0.0.1` HTTP port. That works on a normal dev machine and will fail in sandboxes that forbid local binds.
9. If a case exposes a regression, add a narrower manifest rather than expanding an existing one blindly.

## Current audit seeding

The pre-deploy matrix now spans every implemented family:

- **Sources** — `audit-source-osc-sweep.json`, `audit-source-noise-sweep.json`, `audit-source-voronoi-sweep.json`, `audit-source-shape-sweep.json`, `audit-source-gradient-sweep.json`, `audit-source-solid-sweep.json`, `audit-source-video-baseline.json`
- **Feedback / composition** — `audit-feedback-osc-baseline.json`, `audit-feedback-osc-sweep.json`, `audit-feedback-video-cross-source.json`, `audit-modulate-osc-baseline.json`, `audit-modulate-osc-sweep.json`, `audit-modulate-video-cross-source.json`
- **Geometry / spatial** — `audit-scale-*`, `audit-rotate-*`, `audit-scrollX-*`, `audit-scrollY-*`, `audit-repeat-*`, `audit-repeatX-*`, `audit-repeatY-*`, `audit-pixelate-*`, `audit-kaleid-*`
- **Color / tonal** — `audit-brightness-video-sweep.json`, `audit-contrast-osc-sweep.json`, `audit-color-solid-band-sweep.json`, `audit-saturate-video-sweep.json`, `audit-posterize-video-sweep.json`, `audit-chromaShift-video-sweep.json`

Current stable gate status:

- `npm run qa:audit` now regenerates a fully green `audit-*` batch and `npm run qa:audit:analyze` writes a green audit-only `analysis-summary.json`.
- `npm run qa:references:sync` now snapshots the current `audit-*` `.webm` artifacts into committed `qa/references/`.
- Live video metrics now include `meanR`, `meanG`, `meanB`, and `meanSaturation` so the color family is no longer audited only through grayscale proxies.
- Exported-WAV segment assertions remain the hard audio gate wherever the fixture/metric pair is stable.
- `qa:analyze` now attempts `mcp-music-analysis`, `ffmpeg-quality-metrics`, and `video-quality-mcp` through repo-local wrappers and persists their sidecar JSON beside each case artifact.

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

Manual review notes now live under [`qa/reviews`](./reviews):

- [`sources.md`](./reviews/sources.md)
- [`feedback-composition.md`](./reviews/feedback-composition.md)
- [`geometry-spatial.md`](./reviews/geometry-spatial.md)
- [`color-tonal.md`](./reviews/color-tonal.md)
