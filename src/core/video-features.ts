import { clamp01 } from '../lib/math';
import type { VideoFeatureName, VideoFeatureState } from './coupling';

export interface AnalysedVideoFrame {
  meanLuma: number;
  meanR: number;
  meanG: number;
  meanB: number;
  edgeDensity: number;
  lumas: Float32Array<ArrayBuffer>;
}

export interface SampledVideoSource {
  frame: AnalysedVideoFrame;
  previousLumas: Float32Array<ArrayBuffer> | null;
  motion?: number | null;
}

export const VIDEO_FEATURE_OPTIONS: readonly { name: VideoFeatureName; label: string }[] = [
  { name: 'luma', label: 'v.luma' },
  { name: 'flux', label: 'v.flux' },
  { name: 'edge', label: 'v.edge' },
  { name: 'motion', label: 'v.motion' },
  { name: 'bLuma', label: 'v.b.luma' },
  { name: 'bFlux', label: 'v.b.flux' },
  { name: 'bEdge', label: 'v.b.edge' },
  { name: 'bMotion', label: 'v.b.motion' },
  { name: 'abLumaDiff', label: 'v.ab.lumaDiff' },
  { name: 'abFluxDiff', label: 'v.ab.fluxDiff' },
  { name: 'abEdgeAgreement', label: 'v.ab.edgeAgreement' },
  { name: 'abDifference', label: 'v.ab.difference' },
  { name: 'abSimilarity', label: 'v.ab.similarity' },
  { name: 'abTension', label: 'v.ab.tension' },
] as const;

const VIDEO_FEATURE_LABELS = new Map<VideoFeatureName, string>(
  VIDEO_FEATURE_OPTIONS.map(({ name, label }) => [name, label]),
);

function smoothFeatureValue(previous: number, next: number, smoothing: number): number {
  return previous + (next - previous) * smoothing;
}

export function formatVideoFeatureLabel(feature: VideoFeatureName): string {
  return VIDEO_FEATURE_LABELS.get(feature) ?? `v.${feature}`;
}

export function computeTemporalFlux(
  lumas: Float32Array<ArrayBuffer>,
  previousLumas: Float32Array<ArrayBuffer> | null,
): number {
  if (!previousLumas || previousLumas.length !== lumas.length) return 0;
  let flux = 0;
  for (let index = 0; index < lumas.length; index += 1) {
    flux += Math.abs((lumas[index] ?? 0) - (previousLumas[index] ?? 0));
  }
  return clamp01(flux / Math.max(1, lumas.length));
}

function summariseSource(sample: SampledVideoSource): {
  luma: number;
  flux: number;
  edge: number;
  motion: number;
} {
  const flux = computeTemporalFlux(sample.frame.lumas, sample.previousLumas);
  return {
    luma: clamp01(sample.frame.meanLuma),
    flux,
    edge: clamp01(sample.frame.edgeDensity),
    motion: clamp01(sample.motion ?? flux),
  };
}

export function buildVideoFeatureState(
  previous: VideoFeatureState,
  sourceA: SampledVideoSource,
  sourceB: SampledVideoSource | null,
  smoothing: number,
): VideoFeatureState {
  const a = summariseSource(sourceA);

  if (!sourceB) {
    if (!previous.available) {
      return {
        available: true,
        luma: a.luma,
        flux: a.flux,
        edge: a.edge,
        motion: a.motion,
        bLuma: 0,
        bFlux: 0,
        bEdge: 0,
        bMotion: 0,
        abLumaDiff: 0,
        abFluxDiff: 0,
        abEdgeAgreement: 0,
        abDifference: 0,
        abSimilarity: 0,
        abTension: 0,
      };
    }
    return {
      available: true,
      luma: smoothFeatureValue(previous.luma, a.luma, smoothing),
      flux: smoothFeatureValue(previous.flux, a.flux, smoothing),
      edge: smoothFeatureValue(previous.edge, a.edge, smoothing),
      motion: smoothFeatureValue(previous.motion, a.motion, smoothing),
      bLuma: 0,
      bFlux: 0,
      bEdge: 0,
      bMotion: 0,
      abLumaDiff: 0,
      abFluxDiff: 0,
      abEdgeAgreement: 0,
      abDifference: 0,
      abSimilarity: 0,
      abTension: 0,
    };
  }

  const b = summariseSource(sourceB);
  const abLumaDiff = clamp01(Math.abs(a.luma - b.luma));
  const abFluxDiff = clamp01(Math.abs(a.flux - b.flux));
  const abEdgeAgreement = clamp01(1 - Math.abs(a.edge - b.edge));
  const edgeDisagreement = 1 - abEdgeAgreement;
  const abDifference = clamp01(abLumaDiff * 0.4 + abFluxDiff * 0.35 + edgeDisagreement * 0.25);
  const abSimilarity = clamp01(1 - abDifference);
  const activity = clamp01(Math.max(a.motion, b.motion));
  const abTension = clamp01(abDifference * (0.35 + activity * 0.65));

  if (!previous.available) {
    return {
      available: true,
      luma: a.luma,
      flux: a.flux,
      edge: a.edge,
      motion: a.motion,
      bLuma: b.luma,
      bFlux: b.flux,
      bEdge: b.edge,
      bMotion: b.motion,
      abLumaDiff,
      abFluxDiff,
      abEdgeAgreement,
      abDifference,
      abSimilarity,
      abTension,
    };
  }

  return {
    available: true,
    luma: smoothFeatureValue(previous.luma, a.luma, smoothing),
    flux: smoothFeatureValue(previous.flux, a.flux, smoothing),
    edge: smoothFeatureValue(previous.edge, a.edge, smoothing),
    motion: smoothFeatureValue(previous.motion, a.motion, smoothing),
    bLuma: smoothFeatureValue(previous.bLuma, b.luma, smoothing),
    bFlux: smoothFeatureValue(previous.bFlux, b.flux, smoothing),
    bEdge: smoothFeatureValue(previous.bEdge, b.edge, smoothing),
    bMotion: smoothFeatureValue(previous.bMotion, b.motion, smoothing),
    abLumaDiff: smoothFeatureValue(previous.abLumaDiff, abLumaDiff, smoothing),
    abFluxDiff: smoothFeatureValue(previous.abFluxDiff, abFluxDiff, smoothing),
    abEdgeAgreement: smoothFeatureValue(previous.abEdgeAgreement, abEdgeAgreement, smoothing),
    abDifference: smoothFeatureValue(previous.abDifference, abDifference, smoothing),
    abSimilarity: smoothFeatureValue(previous.abSimilarity, abSimilarity, smoothing),
    abTension: smoothFeatureValue(previous.abTension, abTension, smoothing),
  };
}
