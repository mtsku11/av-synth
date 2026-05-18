# Source this file before running `npm run qa:analyze` / `qa:audit` / `qa:ci`
# so the analyzer wrappers in qa/adapters/ can launch their MCP servers.
#
#   source qa/mcp-env.sh
#
# To make permanent, append the same line to ~/.zshrc (with the absolute path):
#   source /Users/marcscully/Projects/av-synth/qa/mcp-env.sh

# --- mcp-video-analyzer is intentionally NOT wired up:
#     it is designed for Loom/screen-recording transcript + OCR analysis, not
#     synth output. The wrapper in qa/adapters/ is kept for reference but is
#     no longer listed in qa/analyzers.config.json. Visual regression is
#     covered by ffmpeg-quality-metrics (PSNR/SSIM/VMAF when available),
#     video-quality-mcp (artifacts/metadata/GOP), and the in-repo
#     exported-WAV / temporal-delta gates.

# --- mcp-music-analysis (Python, launched via uvx — no install needed, uv caches it)
export AV_SYNTH_MUSIC_ANALYSIS_COMMAND="uvx"
export AV_SYNTH_MUSIC_ANALYSIS_ARGS_JSON='["mcp-music-analysis"]'

# --- ffmpeg-quality-metrics (authoritative PSNR / SSIM, plus VMAF when ffmpeg exposes libvmaf)
#     Uses uvx by default. The current Homebrew ffmpeg on this machine does not
#     expose libvmaf, so VMAF stays disabled until you point
#     AV_SYNTH_FFMPEG_QUALITY_METRICS_FFMPEG_PATH at a libvmaf-enabled build.
export AV_SYNTH_FFMPEG_QUALITY_METRICS_COMMAND="uvx"
export AV_SYNTH_FFMPEG_QUALITY_METRICS_ARGS_JSON='["ffmpeg-quality-metrics"]'
export AV_SYNTH_FFMPEG_QUALITY_METRICS_FRAMERATE="60"

# --- video-quality-mcp (https://github.com/hlpsxc/video-quality-mcp)
#     Cloned to ~/Projects/video-quality-mcp with deps installed in a uv venv.
export AV_SYNTH_VIDEO_QUALITY_ROOT="/Users/marcscully/Projects/video-quality-mcp"
export AV_SYNTH_VIDEO_QUALITY_PYTHON="/Users/marcscully/Projects/video-quality-mcp/.venv/bin/python"
