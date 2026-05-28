const COMMON_VIDEO_FPS = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60] as const;

function roundFps(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function snapCommonVideoFps(fps: number): number {
  if (!Number.isFinite(fps) || fps <= 0) return fps;
  let best = fps;
  let bestError = Number.POSITIVE_INFINITY;
  for (const candidate of COMMON_VIDEO_FPS) {
    const error = Math.abs(candidate - fps);
    if (error < bestError) {
      best = candidate;
      bestError = error;
    }
  }
  return bestError <= 0.05 ? best : roundFps(fps);
}

export function estimateVideoFpsFromMediaTimes(mediaTimesSec: readonly number[]): number | null {
  if (mediaTimesSec.length < 2) return null;
  const frameDeltasSec: number[] = [];
  for (let i = 1; i < mediaTimesSec.length; i++) {
    const prev = mediaTimesSec[i - 1]!;
    const next = mediaTimesSec[i]!;
    if (!Number.isFinite(prev) || !Number.isFinite(next)) continue;
    const delta = next - prev;
    if (delta > 1e-6) frameDeltasSec.push(delta);
  }
  if (frameDeltasSec.length === 0) return null;
  const sorted = [...frameDeltasSec].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) * 0.5 : sorted[mid]!;
  if (!Number.isFinite(median) || median <= 0) return null;
  return snapCommonVideoFps(1 / median);
}
