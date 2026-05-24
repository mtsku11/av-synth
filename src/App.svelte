<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { clock } from './core/clock.svelte';
  import { audio } from './audio/engine';
  import {
    IMPORTED_PRESENTATION_LUT_NAME,
    PRESENTATION_LENS_DIRTS,
    PRESENTATION_LOOKS,
    PRESENTATION_LUTS,
    PRESENTATION_POST_PRESETS,
    PRESENTATION_QUALITIES,
    parseCubeLut,
    type PresentationLensDirtName,
    type PresentationLookName,
    type PresentationLutName,
    type PresentationLutSelection,
    type PresentationPostPresetName,
    type PresentationQualityName,
    type PreviewMode,
    VideoRenderer,
  } from './video/renderer';
  import { PlaceholderSource, VideoElementSource } from './video/sources';
  import { SilentSource, VideoElementAudioSource } from './audio/sources';
  import { Granulator, type GranulatorEnvelope, type GranulatorMode } from './audio/granulator';
  import { FeedbackDelay } from './audio/feedback-delay';
  import {
    FEEDBACK_DELAY_DEFAULTS,
    type FeedbackDelayParamName,
  } from './audio/feedback-delay-params';
  import { captureMonoFromStream, findOnsetSample } from './audio/latency-probe';
  import {
    GRANULATOR_DEFAULTS,
    GRANULATOR_PARAM_SPECS,
    type GranulatorSliderParam,
  } from './audio/granulator-params';
  import { GrainBuffer, planGrainBuffer } from './video/grain-buffer';
  import { estimateVideoFpsFromMediaTimes } from './video/clip-fps';
  import { GrainScheduler } from './core/grain-scheduler';
  import { GrainCompositeSource } from './video/grain-composite';
  import { MidiRouter, WebMidiInput, parseMidiMessage, type WebMidiDevice } from './core/midi';
  import {
    createInstance,
    disposeInstance,
    listOps,
    type OperatorInstance,
  } from './core/operators';
  import {
    BUS_INDICES,
    SOURCE_NODE_ID,
    busReturnId,
    graph,
    type BusIndex,
  } from './core/graph.svelte';
  import {
    createSourceInstance,
    attachSourceAudio,
    disposeSourceAudio,
    type SourceInstance,
  } from './core/sources';
  import { DEFAULT_CHAIN } from './ops';
  import {
    EMPTY_VIDEO_FEATURES,
    type CouplingContext,
    type VideoFeatureState,
  } from './core/coupling';
  import {
    loadPrograms,
    applyProgram,
    applyProgramAudio,
    applyProgramAutomation,
    getOrderedProgramOps,
    programHasAutomation,
    type ProgramAutomationRuntime,
    type VideoEffectProgramBank,
    type VideoEffectProgram,
    type VideoEffectRenderStyle,
  } from './core/presets';
  import {
    buildPatchNodeViews,
    compileGraphExecution,
    orderInstancesByGraph,
  } from './core/patch-chain';
  import { BLEND_OPS } from './ops/blend';
  import FeedbackDelayCard from './ui/FeedbackDelayCard.svelte';
  import GranulatorCard from './ui/GranulatorCard.svelte';
  import MasterMeter from './ui/MasterMeter.svelte';
  import LfoBank from './ui/LfoBank.svelte';
  import Patch from './ui/Patch.svelte';
  import type { ParamSpec } from './core/params';
  import {
    applyGlobalLfoAssignments,
    createParamLfoAssignment,
    type GlobalLfoWaveform,
    type ParamLfoAssignments,
  } from './core/mod-bank';

  let canvasEl: HTMLCanvasElement | undefined = $state();
  let videoEl: HTMLVideoElement | undefined = $state();
  let renderer: VideoRenderer | null = null;
  let initError = $state<string | null>(null);
  let instances = $state<OperatorInstance[]>([]);
  let sourceLoaded = $state(false);
  let loadedVideoName = $state<string | null>(null);
  let programs = $state<VideoEffectProgramBank>({});
  let activeProgram = $state<string | null>(null);
  let videoFeatures = $state<VideoFeatureState>({ ...EMPTY_VIDEO_FEATURES });
  let monitorBus = $state<BusIndex>(0);
  let previewMode = $state<PreviewMode>('single');
  type WorkspaceSurface = 'video' | 'audio' | 'lfo' | 'presets';
  let activeWorkspaceSurface = $state<WorkspaceSurface>('video');

  // Source kind: 'video' = external <video> element, 'placeholder' = built-in
  // plasma, or a registered procedural source name (e.g. 'osc').
  type SourceKind = 'video' | 'placeholder' | string;
  let sourceKind = $state<SourceKind>('placeholder');
  let sourceInstance = $state<SourceInstance | null>(null);

  // Granulator + MIDI + grain pipeline. Instantiated lazily after audio.init() in
  // onStart / onFileChange. The granulator runs in parallel to the operator rack via
  // engine.attachAuxiliarySource(); MIDI input wires note-on / CC / MPE through
  // MidiRouter directly into the granulator's ParamSink (and worklet trigger).
  let granulator = $state<Granulator | null>(null);
  let granulatorEnabled = $state(false);
  let granulatorEnvelope = $state<GranulatorEnvelope>('hann');
  let granulatorMode = $state<GranulatorMode>('classic');
  let feedbackDelay: FeedbackDelay | null = null;
  let feedbackDelayDisconnect: (() => void) | null = null;
  let feedbackDelayParams = $state<Record<FeedbackDelayParamName, number>>({
    ...FEEDBACK_DELAY_DEFAULTS,
  });
  let midiRouter = $state<MidiRouter | null>(null);
  let webMidiInput: WebMidiInput | null = null;
  let midiDevices = $state<readonly WebMidiDevice[]>([]);
  let midiUnavailableReason = $state<string | null>(null);
  let grainBuffer: GrainBuffer | null = null;
  let grainScheduler: GrainScheduler | null = null;
  let grainCompositeSource: GrainCompositeSource | null = null;
  let grainSourceMessage = $state<string | null>(null);
  // Decode-progress channel, kept distinct from grainSourceMessage (which is refusal-only).
  // grainDecodedSrc remembers which videoEl.src has already been uploaded into the texture
  // array so re-selecting the source kind doesn't re-decode. grainDecodeGen is bumped on
  // every new-clip load so in-flight decodes can no-op their progress writes.
  let grainDecodeStatus = $state<{ frameIndex: number; frameCount: number } | null>(null);
  let grainDecodedSrc: string | null = null;
  let grainDecodeGen = 0;
  let grainVideoFps = $state<number | null>(null);
  // Granulator raw param values (what the sliders show) and per-param LFO assignment
  // indices. The raw values flow through applyGlobalLfoAssignments() each animation
  // frame and the modulated result is pushed to the worklet's k-rate AudioParams via
  // granulator.setParam(). Slider UI mirrors the raw values, not the modulated values —
  // standard synth UX where the knob shows what the user set, not what the LFO is doing.
  let granulatorRawParams = $state<Record<GranulatorSliderParam, number>>({
    ...GRANULATOR_DEFAULTS,
  });
  let granulatorLfoAssignments = $state<ParamLfoAssignments>({});
  let featureProbeCanvas: HTMLCanvasElement | null = null;
  let featureProbeCtx: CanvasRenderingContext2D | null = null;
  let featureSampleTimer = 0;
  let programAutomationRaf = 0;
  let previousFeatureLumas: Float32Array<ArrayBuffer> | null = null;
  const operatorOptions = [...listOps()].sort((left, right) => {
    const leftIndex = DEFAULT_CHAIN.indexOf(left);
    const rightIndex = DEFAULT_CHAIN.indexOf(right);
    if (leftIndex >= 0 && rightIndex >= 0) return leftIndex - rightIndex;
    if (leftIndex >= 0) return -1;
    if (rightIndex >= 0) return 1;
    return left.localeCompare(right);
  });
  const presentationLookOptions = Object.keys(PRESENTATION_LOOKS) as PresentationLookName[];
  let presentationLook = $state<PresentationLookName>('cine');
  const builtInPresentationLutOptions = Object.keys(PRESENTATION_LUTS) as PresentationLutName[];
  let presentationLut = $state<PresentationLutSelection>('neutral');
  const presentationQualityOptions = Object.keys(
    PRESENTATION_QUALITIES,
  ) as PresentationQualityName[];
  let presentationQuality = $state<PresentationQualityName>('standard');
  const presentationPostPresetOptions = Object.keys(
    PRESENTATION_POST_PRESETS,
  ) as PresentationPostPresetName[];
  let presentationPostPreset = $state<PresentationPostPresetName>('none');
  const presentationLensDirtOptions = Object.keys(
    PRESENTATION_LENS_DIRTS,
  ) as PresentationLensDirtName[];
  let presentationLensDirt = $state<PresentationLensDirtName>('none');
  const HIDDEN_PROGRAM_KEYS = new Set([
    'haloKey',
    'rgbSpill',
    'shadowMatte',
    'tunnel',
    'bloom',
    'lattice',
    'chaos',
    'ghost',
    'kaleido',
    'zero',
  ]);

  const VIDEO_FEATURE_SAMPLE_WIDTH = 96;
  const VIDEO_FEATURE_SAMPLE_HEIGHT = 54;
  const VIDEO_FEATURE_SAMPLE_MS = 120;
  const VIDEO_FEATURE_SMOOTHING = 0.35;

  const sourceBadge = $derived(
    sourceKind === 'video'
      ? (loadedVideoName ?? 'video input')
      : sourceKind === 'placeholder'
        ? sourceLoaded && loadedVideoName
          ? `${loadedVideoName} (standby)`
          : 'video input'
        : `${sourceKind} (exploratory)`,
  );

  const couplingCtx = $derived<CouplingContext>({
    baseFreq: clock.baseFreq,
    bpm: clock.bpm,
    sampleRate: audio.isInitialised ? audio.ctx.sampleRate : 48000,
    time: clock.displayTime, // overridden per-frame by renderer; this is the fallback
    rate: clock.rate,
    lfoBank: clock.lfoBank,
    videoFeatures,
  });

  interface ControlView {
    id: string;
    spec: ParamSpec;
    value: number;
  }

  const graphNodes = $derived(graph.list());

  const orderedInstances = $derived(orderInstancesByGraph(instances, graphNodes));

  const graphPlan = $derived(compileGraphExecution(graphNodes, orderedInstances, monitorBus));

  const patchNodes = $derived(buildPatchNodeViews(graphNodes, orderedInstances, graphPlan));
  const visiblePrograms = $derived(
    Object.entries(programs).filter(([name]) => !HIDDEN_PROGRAM_KEYS.has(name)),
  );

  interface QaBridge {
    getState(): {
      sourceKind: string;
      clockRunning: boolean;
      audioInitialised: boolean;
      videoFeatures: VideoFeatureState;
      video: {
        currentTime: number;
        paused: boolean;
        readyState: number;
        duration: number;
      } | null;
    };
    getFftSnapshot(count?: number): number[] | null;
    sampleMetrics(durationMs?: number): Promise<{
      video: {
        meanLuma: number;
        meanR: number;
        meanG: number;
        meanB: number;
        meanSaturation: number;
        spatialStd: number;
        temporalDiff: number;
        edgeDensity: number;
      } | null;
      audio: {
        meanDb: number;
        spectralCentroidHz: number;
        spectralSpreadHz: number;
        activeBins: number;
      } | null;
      samples: number;
      timing: {
        sampleDurationMs: number;
        audioStartSeconds: number | null;
        audioEndSeconds: number | null;
        captureStartSeconds: number | null;
        captureEndSeconds: number | null;
      };
    } | null>;
    getCaptureState(): {
      status: 'idle' | 'recording' | 'ready';
      bytes: number;
      filename: string | null;
      mimeType: string | null;
    };
    setSourceKind(kind: string): Promise<boolean>;
    setOperatorParam(
      op: string,
      paramId: string,
      value: number,
      opIndex?: number,
    ): Promise<boolean>;
    setSourceParam(paramId: string, value: number): Promise<boolean>;
    applyProgram(name: string): Promise<boolean>;
    setGranulatorParam(name: string, value: number): Promise<boolean>;
    setFeedbackDelayParam(name: string, value: number): Promise<boolean>;
    getAudioContext(): AudioContext | null;
    isGrainDecoded(): boolean;
    ensureGrainAudioLoaded(): Promise<boolean>;
    readCenterPixel(): { r: number; g: number; b: number } | null;
    readGrainBufferFrame(frameIndex: number): { r: number; g: number; b: number } | null;
    measureGranulatorLatencyProxy(): Promise<{
      latencyMs: number;
      markerSample: number;
      onsetSample: number;
      sampleRate: number;
      dispatchAudioTime: number;
      baseLatencyMs: number;
      outputLatencyMs: number | null;
    } | null>;
    fireGranulatorLatencyProbe(): Promise<{
      dispatchAudioTime: number;
      baseLatencyMs: number;
      outputLatencyMs: number | null;
    } | null>;
    setPresentationFinish(finish: {
      look?: PresentationLookName;
      quality?: PresentationQualityName;
      lut?: PresentationLutSelection;
      postPreset?: PresentationPostPresetName;
      lensDirt?: PresentationLensDirtName;
    }): Promise<boolean>;
    loadImportedLut(url: string, label?: string): Promise<boolean>;
    startTransport(): Promise<boolean>;
    stopTransport(): Promise<boolean>;
    startCapture(filenameStem?: string): Promise<boolean>;
    stopCapture(): Promise<{
      bytes: number;
      filename: string;
      mimeType: string;
    } | null>;
    exportLastCapture(): Promise<boolean>;
    addBlendNode(op: string): Promise<boolean>;
    setPatchNodeBus(op: string, bus: BusIndex, opIndex?: number): Promise<boolean>;
    setPatchNodePrimaryInput(op: string, input: string, opIndex?: number): Promise<boolean>;
    addPatchNodeInput(op: string, input: string, opIndex?: number): Promise<boolean>;
    setPatchNodeSecondaryInput(op: string, input: string, opIndex?: number): Promise<boolean>;
    setMonitorBus(bus: BusIndex): Promise<boolean>;
    setPreviewMode(mode: PreviewMode): Promise<boolean>;
  }

  type CaptureStatus = 'idle' | 'recording' | 'ready';

  interface CaptureArtifact {
    blob: Blob;
    bytes: number;
    filename: string;
    mimeType: string;
    url: string;
  }

  let captureStatus = $state<CaptureStatus>('idle');
  let latestCapture = $state<CaptureArtifact | null>(null);
  let captureRecorder: MediaRecorder | null = null;
  let captureStream: MediaStream | null = null;
  let captureFilename = '';
  let captureChunks: Blob[] = [];
  let captureStartedAtAudioTime: number | null = null;
  let captureStartedAtPerfMs: number | null = null;

  function analyseCanvasFrame(
    frame: Uint8ClampedArray,
    width: number,
    height: number,
  ): {
    meanLuma: number;
    meanR: number;
    meanG: number;
    meanB: number;
    meanSaturation: number;
    spatialStd: number;
    edgeDensity: number;
    lumas: Float32Array<ArrayBuffer>;
  } {
    const count = frame.length / 4;
    const lumas = new Float32Array(count);
    let sum = 0;
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let saturationSum = 0;
    for (let index = 0, pixel = 0; index < frame.length; index += 4, pixel += 1) {
      const r = frame[index] ?? 0;
      const g = frame[index + 1] ?? 0;
      const b = frame[index + 2] ?? 0;
      const rNorm = r / 255;
      const gNorm = g / 255;
      const bNorm = b / 255;
      const maxChannel = Math.max(rNorm, gNorm, bNorm);
      const minChannel = Math.min(rNorm, gNorm, bNorm);
      const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      lumas[pixel] = luma;
      sum += luma;
      sumR += rNorm;
      sumG += gNorm;
      sumB += bNorm;
      saturationSum += maxChannel > 0 ? (maxChannel - minChannel) / maxChannel : 0;
    }
    const meanLuma = sum / count;
    let variance = 0;
    for (let pixel = 0; pixel < lumas.length; pixel += 1) {
      const centered = (lumas[pixel] ?? 0) - meanLuma;
      variance += centered * centered;
    }
    let edgeSum = 0;
    for (let y = 0; y < height - 1; y += 1) {
      for (let x = 0; x < width - 1; x += 1) {
        const index = y * width + x;
        const here = lumas[index] ?? 0;
        const right = lumas[index + 1] ?? 0;
        const down = lumas[index + width] ?? 0;
        edgeSum += Math.abs(here - right) + Math.abs(here - down);
      }
    }
    const edgeSamples = Math.max((width - 1) * (height - 1) * 2, 1);
    return {
      meanLuma,
      meanR: sumR / count,
      meanG: sumG / count,
      meanB: sumB / count,
      meanSaturation: saturationSum / count,
      spatialStd: Math.sqrt(variance / count),
      edgeDensity: edgeSum / edgeSamples,
      lumas,
    };
  }

  function resetVideoFeatures(): void {
    if (!videoFeatures.available && previousFeatureLumas === null) return;
    previousFeatureLumas = null;
    videoFeatures = { ...EMPTY_VIDEO_FEATURES };
  }

  function routeVideoAudioThroughGraph(): void {
    if (!videoEl) return;
    videoEl.muted = false;
    videoEl.volume = 1;
  }

  async function waitForVideoFrame(video: HTMLVideoElement): Promise<void> {
    if (video.readyState >= 2) return;
    await new Promise<void>((resolve) => {
      const onReady = () => resolve();
      video.addEventListener('loadeddata', onReady, { once: true });
      video.addEventListener('canplay', onReady, { once: true });
    });
  }

  async function waitForVideoSeek(video: HTMLVideoElement, time: number): Promise<void> {
    if (Math.abs(video.currentTime - time) < 1e-4) return;
    await new Promise<void>((resolve, reject) => {
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('error', onError);
        resolve();
      };
      const onError = () => {
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('error', onError);
        reject(new Error(`video seek failed at ${time}s`));
      };
      video.addEventListener('seeked', onSeeked, { once: true });
      video.addEventListener('error', onError, { once: true });
      video.currentTime = time;
    });
  }

  async function probeClipFrameRate(video: HTMLVideoElement): Promise<number | null> {
    if (typeof video.requestVideoFrameCallback !== 'function') return null;
    if (!Number.isFinite(video.duration) || video.duration <= 0) return null;
    const wasPaused = video.paused;
    const savedTime = video.currentTime;
    const savedMuted = video.muted;
    const mediaTimes: number[] = [];
    try {
      video.muted = true;
      await waitForVideoSeek(video, 0);
      const fps = await new Promise<number | null>((resolve) => {
        let settled = false;
        const timeoutId = window.setTimeout(() => finish(null), 2000);
        function finish(value: number | null): void {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeoutId);
          resolve(value);
        }
        const onFrame = (_now: number, metadata: { mediaTime: number }): void => {
          mediaTimes.push(metadata.mediaTime);
          if (mediaTimes.length >= 8) {
            finish(estimateVideoFpsFromMediaTimes(mediaTimes));
            return;
          }
          video.requestVideoFrameCallback(onFrame);
        };
        video.requestVideoFrameCallback(onFrame);
        void video.play().catch(() => finish(null));
      });
      return fps;
    } catch {
      return null;
    } finally {
      video.pause();
      video.muted = savedMuted;
      try {
        await waitForVideoSeek(video, savedTime);
      } catch {
        // Ignore — clip may have changed while probing.
      }
      if (!wasPaused) void video.play().catch(() => {});
    }
  }

  async function playActiveVideoSource(): Promise<void> {
    if (!videoEl || sourceKind !== 'video' || !videoEl.src) return;
    routeVideoAudioThroughGraph();
    await waitForVideoFrame(videoEl);
    try {
      await videoEl.play();
    } catch {
      // User gesture / decoder timing can still block here; Start remains the retry path.
    }
  }

  function pauseVideoSource(): void {
    videoEl?.pause();
  }

  function ensureFeatureProbe(): CanvasRenderingContext2D | null {
    if (featureProbeCtx) return featureProbeCtx;
    featureProbeCanvas = document.createElement('canvas');
    featureProbeCanvas.width = VIDEO_FEATURE_SAMPLE_WIDTH;
    featureProbeCanvas.height = VIDEO_FEATURE_SAMPLE_HEIGHT;
    featureProbeCtx =
      featureProbeCanvas.getContext('2d', {
        willReadFrequently: true,
      }) ?? null;
    return featureProbeCtx;
  }

  function smoothFeatureValue(previous: number, next: number): number {
    return previous + (next - previous) * VIDEO_FEATURE_SMOOTHING;
  }

  function sampleVideoFeatureSignals(): void {
    if (
      typeof document === 'undefined' ||
      sourceKind !== 'video' ||
      !sourceLoaded ||
      !videoEl ||
      videoEl.readyState < 2
    ) {
      resetVideoFeatures();
      return;
    }

    const probe = ensureFeatureProbe();
    if (!probe || !featureProbeCanvas) {
      resetVideoFeatures();
      return;
    }

    probe.drawImage(videoEl, 0, 0, featureProbeCanvas.width, featureProbeCanvas.height);
    const image = probe.getImageData(0, 0, featureProbeCanvas.width, featureProbeCanvas.height);
    const frame = analyseCanvasFrame(
      image.data,
      featureProbeCanvas.width,
      featureProbeCanvas.height,
    );
    let flux = 0;
    if (previousFeatureLumas) {
      for (let index = 0; index < frame.lumas.length; index += 1) {
        flux += Math.abs((frame.lumas[index] ?? 0) - (previousFeatureLumas[index] ?? 0));
      }
      flux /= frame.lumas.length;
    }
    previousFeatureLumas = frame.lumas;
    videoFeatures = videoFeatures.available
      ? {
          available: true,
          luma: smoothFeatureValue(videoFeatures.luma, frame.meanLuma),
          flux: smoothFeatureValue(videoFeatures.flux, flux),
          edge: smoothFeatureValue(videoFeatures.edge, frame.edgeDensity),
        }
      : {
          available: true,
          luma: frame.meanLuma,
          flux,
          edge: frame.edgeDensity,
        };
  }

  function startVideoFeatureSampling(): void {
    if (featureSampleTimer || typeof window === 'undefined') return;
    featureSampleTimer = window.setInterval(sampleVideoFeatureSignals, VIDEO_FEATURE_SAMPLE_MS);
  }

  function stopVideoFeatureSampling(): void {
    if (featureSampleTimer) {
      clearInterval(featureSampleTimer);
      featureSampleTimer = 0;
    }
  }

  function analyseFft(
    fft: Float32Array,
    sampleRate: number,
  ): {
    meanDb: number;
    spectralCentroidHz: number;
    spectralSpreadHz: number;
    activeBins: number;
  } {
    const nyquist = sampleRate / 2;
    const binHz = nyquist / fft.length;
    let dbSum = 0;
    let weightSum = 0;
    let centroidNumerator = 0;
    let activeBins = 0;

    for (let index = 0; index < fft.length; index += 1) {
      const db = fft[index] ?? -120;
      dbSum += db;
      if (db > -80) activeBins += 1;
      const amplitude = Number.isFinite(db) ? 10 ** (db / 20) : 0;
      const hz = (index + 0.5) * binHz;
      weightSum += amplitude;
      centroidNumerator += hz * amplitude;
    }

    const spectralCentroidHz = weightSum > 0 ? centroidNumerator / weightSum : 0;
    let spreadNumerator = 0;
    for (let index = 0; index < fft.length; index += 1) {
      const db = fft[index] ?? -120;
      const amplitude = Number.isFinite(db) ? 10 ** (db / 20) : 0;
      const hz = (index + 0.5) * binHz;
      const delta = hz - spectralCentroidHz;
      spreadNumerator += delta * delta * amplitude;
    }

    return {
      meanDb: dbSum / fft.length,
      spectralCentroidHz,
      spectralSpreadHz: weightSum > 0 ? Math.sqrt(spreadNumerator / weightSum) : 0,
      activeBins,
    };
  }

  async function sampleMetrics(durationMs = 240): Promise<{
    video: {
      meanLuma: number;
      meanR: number;
      meanG: number;
      meanB: number;
      meanSaturation: number;
      spatialStd: number;
      temporalDiff: number;
      edgeDensity: number;
    } | null;
    audio: {
      meanDb: number;
      spectralCentroidHz: number;
      spectralSpreadHz: number;
      activeBins: number;
    } | null;
    samples: number;
    timing: {
      sampleDurationMs: number;
      audioStartSeconds: number | null;
      audioEndSeconds: number | null;
      captureStartSeconds: number | null;
      captureEndSeconds: number | null;
    };
  } | null> {
    if (!canvasEl) return null;
    const probeCanvas = document.createElement('canvas');
    probeCanvas.width = 64;
    probeCanvas.height = 64;
    const probeCtx = probeCanvas.getContext('2d', { willReadFrequently: true });
    if (!probeCtx) return null;

    const audioStartSeconds = audio.isInitialised ? audio.ctx.currentTime : null;
    const perfStartMs = performance.now();
    let samples = 0;
    let videoMeanLuma = 0;
    let videoMeanR = 0;
    let videoMeanG = 0;
    let videoMeanB = 0;
    let videoMeanSaturation = 0;
    let videoSpatialStd = 0;
    let videoTemporalDiff = 0;
    let videoEdgeDensity = 0;
    let audioMeanDb = 0;
    let audioCentroidHz = 0;
    let audioSpreadHz = 0;
    let audioActiveBins = 0;
    let prevLumas: Float32Array<ArrayBuffer> | null = null;
    const deadline = performance.now() + durationMs;

    while (performance.now() < deadline) {
      probeCtx.drawImage(canvasEl, 0, 0, probeCanvas.width, probeCanvas.height);
      const image = probeCtx.getImageData(0, 0, probeCanvas.width, probeCanvas.height);
      const frame = analyseCanvasFrame(image.data, probeCanvas.width, probeCanvas.height);
      videoMeanLuma += frame.meanLuma;
      videoMeanR += frame.meanR;
      videoMeanG += frame.meanG;
      videoMeanB += frame.meanB;
      videoMeanSaturation += frame.meanSaturation;
      videoSpatialStd += frame.spatialStd;
      videoEdgeDensity += frame.edgeDensity;

      if (prevLumas) {
        let diffSum = 0;
        for (let index = 0; index < frame.lumas.length; index += 1) {
          diffSum += Math.abs((frame.lumas[index] ?? 0) - (prevLumas[index] ?? 0));
        }
        videoTemporalDiff += diffSum / frame.lumas.length;
      }
      prevLumas = frame.lumas;

      const fft = audio.getFftMagnitudes();
      if (fft) {
        const snapshot = analyseFft(fft, audio.ctx.sampleRate);
        audioMeanDb += snapshot.meanDb;
        audioCentroidHz += snapshot.spectralCentroidHz;
        audioSpreadHz += snapshot.spectralSpreadHz;
        audioActiveBins += snapshot.activeBins;
      }

      samples += 1;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }

    if (!samples) return null;
    const temporalSamples = Math.max(samples - 1, 1);
    const audioEndSeconds = audio.isInitialised ? audio.ctx.currentTime : null;
    const perfEndMs = performance.now();
    const captureStartSeconds =
      audioStartSeconds !== null && captureStartedAtAudioTime !== null
        ? Math.max(0, audioStartSeconds - captureStartedAtAudioTime)
        : captureStartedAtPerfMs !== null
          ? Math.max(0, (perfStartMs - captureStartedAtPerfMs) / 1000)
          : null;
    const captureEndSeconds =
      audioEndSeconds !== null && captureStartedAtAudioTime !== null
        ? Math.max(0, audioEndSeconds - captureStartedAtAudioTime)
        : captureStartedAtPerfMs !== null
          ? Math.max(0, (perfEndMs - captureStartedAtPerfMs) / 1000)
          : null;
    return {
      video: {
        meanLuma: videoMeanLuma / samples,
        meanR: videoMeanR / samples,
        meanG: videoMeanG / samples,
        meanB: videoMeanB / samples,
        meanSaturation: videoMeanSaturation / samples,
        spatialStd: videoSpatialStd / samples,
        temporalDiff: videoTemporalDiff / temporalSamples,
        edgeDensity: videoEdgeDensity / samples,
      },
      audio: audio.isInitialised
        ? {
            meanDb: audioMeanDb / samples,
            spectralCentroidHz: audioCentroidHz / samples,
            spectralSpreadHz: audioSpreadHz / samples,
            activeBins: audioActiveBins / samples,
          }
        : null,
      samples,
      timing: {
        sampleDurationMs: durationMs,
        audioStartSeconds,
        audioEndSeconds,
        captureStartSeconds,
        captureEndSeconds,
      },
    };
  }

  const sourceControls = $derived<ControlView[]>(
    sourceInstance
      ? sourceInstance.def.paramOrder.map((paramId) => ({
          id: paramId,
          spec: {
            ...sourceInstance!.def.coupling.params[paramId]!.spec,
            label: sourceInstance!.def.coupling.params[paramId]?.spec.label ?? paramId,
          },
          value: sourceInstance!.params[paramId] as number,
        }))
      : [],
  );

  function syncSerialGraph(nextInstances: readonly OperatorInstance[]): void {
    const previousNodes = new Map(graph.list().map((node) => [node.id, node]));
    graph.clear();
    nextInstances.forEach((instance, index) => {
      const previous = previousNodes.get(instance.id);
      const defaultPrimary = index > 0 ? nextInstances[index - 1]!.id : null;
      const preservedInputs =
        previous?.inputs.filter((input) => {
          return (
            input.startsWith('bus:') || nextInstances.some((candidate) => candidate.id === input)
          );
        }) ?? [];
      const nextInputs =
        preservedInputs.length > 0 ? preservedInputs : defaultPrimary ? [defaultPrimary] : [];
      graph.add({
        id: instance.id,
        op: instance.def.op,
        params: { ...instance.params },
        inputs: nextInputs,
        bus: previous?.bus ?? 0,
        order: index,
      });
    });
    graph.syncParams(nextInstances);
    if (!BUS_INDICES.includes(monitorBus)) monitorBus = 0;
  }

  function findProgramInstance(
    instancesForProgram: readonly OperatorInstance[],
    ref: string,
  ): OperatorInstance | null {
    const match = /^(?<op>[^#]+?)(?:#(?<index>\d+))?$/.exec(ref.trim());
    if (!match?.groups?.op) return null;
    const op = match.groups.op;
    const opIndex = match.groups.index ? Number(match.groups.index) : 0;
    return instancesForProgram.filter((instance) => instance.def.op === op)[opIndex] ?? null;
  }

  function resolveProgramInputRef(
    instancesForProgram: readonly OperatorInstance[],
    ref: string,
  ): string {
    const input = ref.trim();
    if (!input || input === 'source') return 'source';
    const busMatch = /^src\(o([0-3])\)$/.exec(input);
    if (busMatch) return busReturnId(Number(busMatch[1]) as BusIndex);
    return findProgramInstance(instancesForProgram, input)?.id ?? input;
  }

  function applyProgramGraph(
    program: VideoEffectProgram,
    instancesForProgram: readonly OperatorInstance[],
  ): void {
    syncSerialGraph(instancesForProgram);
    if (!program.graph) return;
    monitorBus = program.graph.monitorBus ?? 0;
    for (const node of program.graph.nodes) {
      const instance = findProgramInstance(instancesForProgram, node.target);
      if (!instance) continue;
      if (node.bus !== undefined) graph.setBus(instance.id, node.bus);
      if (node.inputs) {
        const resolvedInputs = node.inputs
          .map((input) => resolveProgramInputRef(instancesForProgram, input))
          .filter((input) => input !== 'source');
        graph.setInputs(instance.id, resolvedInputs);
      }
    }
    graph.syncParams(instancesForProgram);
  }

  function ensureOperatorInstance(op: string, opIndex = 0): OperatorInstance | null {
    const existing = orderedInstances.filter((instance) => instance.def.op === op);
    if (existing[opIndex]) return existing[opIndex] ?? null;
    if (!renderer) return null;
    const needed = opIndex + 1 - existing.length;
    if (needed <= 0) return existing[opIndex] ?? null;
    const additions = Array.from({ length: needed }, () => createInstance(op, renderer!.gl));
    instances = [...instances, ...additions];
    syncSerialGraph(instances);
    return instances.filter((instance) => instance.def.op === op)[opIndex] ?? null;
  }

  function setOperatorParamValue(instanceId: string, paramId: string, value: number): void {
    const instance = instances.find((candidate) => candidate.id === instanceId);
    if (!instance) return;
    instance.params[paramId] = value;
    if (instance.def.op === 'feedback' && paramId === 'feedback') {
      setFeedbackDelayParam('feedback', value, { syncVideo: false, clearProgram: false });
    }
    instances = [...instances];
    graph.syncParams(instances);
    activeProgram = null;
  }

  function setOperatorParamLfo(instanceId: string, paramId: string, lfoIndex: number | null): void {
    const instance = instances.find((candidate) => candidate.id === instanceId);
    if (!instance) return;
    const assignment = instance.lfoAssignments[paramId];
    if (!assignment) return;
    assignment.lfoIndex = lfoIndex;
    instances = [...instances];
    activeProgram = null;
  }

  function setSourceParamValue(paramId: string, value: number): void {
    if (!renderer || !sourceInstance) return;
    if (!sourceInstance.def.paramOrder.includes(paramId)) return;
    const nextParams = { ...sourceInstance.params, [paramId]: value };
    sourceInstance = { ...sourceInstance, params: nextParams };
    renderer.setSourceParams(nextParams);
    if (audio.isInitialised && sourceInstance.audioStage) {
      audio.setSourceParams(nextParams);
    }
    activeProgram = null;
  }

  function syncSharedFeedbackToVideoChain(sharedValue: number): void {
    let changed = false;
    for (const instance of instances) {
      if (instance.def.op !== 'feedback') continue;
      const range = instance.def.coupling.params.feedback?.spec.range ?? [0, 0.95];
      const next = Math.max(range[0], Math.min(range[1], sharedValue));
      if (instance.params.feedback === next) continue;
      instance.params.feedback = next;
      changed = true;
    }
    if (!changed) return;
    instances = [...instances];
    graph.syncParams(instances);
  }

  function syncSharedFeedbackFromVideoChain(): void {
    let sawFeedback = false;
    let next = 0;
    for (const instance of instances) {
      if (instance.def.op !== 'feedback') continue;
      sawFeedback = true;
      next = Math.max(next, instance.params.feedback ?? 0);
    }
    if (!sawFeedback) return;
    setFeedbackDelayParam('feedback', next, { syncVideo: false, clearProgram: false });
  }

  function applyFeedbackDelayParam(
    target: FeedbackDelay | null,
    name: FeedbackDelayParamName,
    value: number,
  ): void {
    if (!target) return;
    switch (name) {
      case 'time':
        target.setTime(value);
        return;
      case 'feedback':
        target.setFeedback(value);
        return;
      case 'damping':
        target.setDamping(value);
        return;
      case 'cross':
        target.setCross(value);
        return;
      case 'mix':
        target.setMix(value);
        return;
    }
  }

  function setFeedbackDelayParam(
    name: FeedbackDelayParamName,
    value: number,
    options: { syncVideo?: boolean; clearProgram?: boolean } = {},
  ): void {
    feedbackDelayParams = { ...feedbackDelayParams, [name]: value };
    applyFeedbackDelayParam(feedbackDelay, name, value);
    if (name === 'feedback' && options.syncVideo !== false) {
      syncSharedFeedbackToVideoChain(value);
    }
    if (options.clearProgram !== false) activeProgram = null;
  }

  function setGranulatorParam(name: GranulatorSliderParam, value: number): void {
    granulatorRawParams = { ...granulatorRawParams, [name]: value };
  }

  function setGranulatorEnabled(next: boolean): void {
    granulatorEnabled = next;
    granulator?.setEnabled(next);
    if (!next && sourceKind === 'grain-composite') {
      setSourceKind('video');
      grainSourceMessage = 'Enable the granulator to use the grain source.';
    }
  }

  function setGranulatorEnvelope(next: GranulatorEnvelope): void {
    granulatorEnvelope = next;
    granulator?.setEnvelope(next);
  }

  function setGranulatorMode(next: GranulatorMode): void {
    granulatorMode = next;
    granulator?.setMode(next);
  }

  function setGranulatorParamLfo(name: GranulatorSliderParam, lfoIndex: number | null): void {
    const existing = granulatorLfoAssignments[name] ?? createParamLfoAssignment();
    granulatorLfoAssignments = {
      ...granulatorLfoAssignments,
      [name]: { ...existing, lfoIndex },
    };
  }

  async function ensureGranulatorClipLoaded(): Promise<boolean> {
    if (!granulator || !videoEl?.src || !audio.isInitialised) return false;
    try {
      const ab = await fetch(videoEl.src).then((r) => r.arrayBuffer());
      await granulator.loadFromArrayBuffer(audio.ctx, ab);
      granulator.setEnabled(true);
      granulatorEnabled = true;
      return true;
    } catch {
      return false;
    }
  }

  function applyGranulatorLatencyProbeState(): boolean {
    if (!granulator) return false;
    const probeParams: Partial<Record<GranulatorSliderParam, number>> = {
      position: 0.1,
      positionJitter: 0,
      pitch: 0,
      pitchJitter: 0,
      duration: 35,
      durationJitter: 0,
      density: 0,
      distribution: 0,
      panSpread: 0,
      ySpread: 0,
      reverseProbability: 0,
      voiceCount: 1,
      gain: 1,
    };
    setGranulatorEnabled(true);
    setGranulatorEnvelope('expdec');
    setGranulatorMode('loop');
    for (const [name, value] of Object.entries(probeParams) as [GranulatorSliderParam, number][]) {
      setGranulatorParam(name, value);
      granulator.setParam(name, value);
    }
    granulator.clear();
    return true;
  }

  function routeGranulatorProbeNote(channel = 2, note = 69, velocity = 127): boolean {
    if (!midiRouter) return false;
    midiRouter.ingest({ type: 'noteOn', channel, note, velocity });
    window.setTimeout(() => {
      midiRouter?.ingest({ type: 'noteOff', channel, note, velocity: 0 });
    }, 60);
    return true;
  }

  function emitGranulatorLatencyClick(): boolean {
    if (!audio.isInitialised) return false;
    const ctx = audio.ctx;
    const frames = Math.max(32, Math.round((ctx.sampleRate * 2) / 1000));
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    const pulseFrames = Math.max(8, Math.round(frames / 4));
    for (let i = 0; i < pulseFrames; i++) data[i] = 0.95;
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    gain.gain.value = 1;
    source.buffer = buffer;
    source.connect(gain);
    const disconnect = audio.attachAuxiliarySource(gain);
    source.onended = () => {
      disconnect();
      gain.disconnect();
    };
    source.start();
    return true;
  }

  async function measureGranulatorLatencyProxy(): Promise<{
    latencyMs: number;
    markerSample: number;
    onsetSample: number;
    sampleRate: number;
    dispatchAudioTime: number;
    baseLatencyMs: number;
    outputLatencyMs: number | null;
  } | null> {
    if (!audio.isInitialised || !granulator) return null;
    const loaded = await ensureGranulatorClipLoaded();
    if (!loaded || !applyGranulatorLatencyProbeState()) return null;
    const stream = audio.getCaptureStream();
    if (!stream) return null;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 20));
    const capturePromise = captureMonoFromStream(stream, {
      durationMs: 220,
      sampleRate: audio.ctx.sampleRate,
      channelMode: 'max',
    });
    await new Promise<void>((resolve) => window.setTimeout(resolve, 10));
    const dispatchAudioTime = audio.ctx.currentTime;
    emitGranulatorLatencyClick();
    if (!routeGranulatorProbeNote()) return null;
    const captured = await capturePromise;
    const markerSample = findOnsetSample(captured.samples, {
      threshold: 0.35,
      runLength: 1,
    });
    if (markerSample < 0) return null;
    const onsetSample = findOnsetSample(captured.samples, {
      threshold: 0.015,
      startIndex: markerSample + Math.floor(captured.sampleRate * 0.003),
      runLength: 8,
    });
    if (onsetSample < 0) return null;
    return {
      latencyMs: ((onsetSample - markerSample) / captured.sampleRate) * 1000,
      markerSample,
      onsetSample,
      sampleRate: captured.sampleRate,
      dispatchAudioTime,
      baseLatencyMs: audio.ctx.baseLatency * 1000,
      outputLatencyMs:
        typeof audio.ctx.outputLatency === 'number' ? audio.ctx.outputLatency * 1000 : null,
    };
  }

  async function fireGranulatorLatencyProbe(): Promise<{
    dispatchAudioTime: number;
    baseLatencyMs: number;
    outputLatencyMs: number | null;
  } | null> {
    if (!audio.isInitialised || !granulator) return null;
    const loaded = await ensureGranulatorClipLoaded();
    if (!loaded || !applyGranulatorLatencyProbeState()) return null;
    emitGranulatorLatencyClick();
    const dispatchAudioTime = audio.ctx.currentTime;
    if (!routeGranulatorProbeNote()) return null;
    return {
      dispatchAudioTime,
      baseLatencyMs: audio.ctx.baseLatency * 1000,
      outputLatencyMs:
        typeof audio.ctx.outputLatency === 'number' ? audio.ctx.outputLatency * 1000 : null,
    };
  }

  function setGlobalLfoWaveform(index: number, waveform: GlobalLfoWaveform): void {
    const lfo = clock.lfoBank[index];
    if (!lfo) return;
    lfo.waveform = waveform;
    clock.lfoBank = [...clock.lfoBank];
    activeProgram = null;
  }

  function setGlobalLfoRate(index: number, value: number): void {
    const lfo = clock.lfoBank[index];
    if (!lfo) return;
    lfo.rate = value;
    clock.lfoBank = [...clock.lfoBank];
    activeProgram = null;
  }

  function setGlobalLfoAmount(index: number, value: number): void {
    const lfo = clock.lfoBank[index];
    if (!lfo) return;
    lfo.amount = value;
    clock.lfoBank = [...clock.lfoBank];
    activeProgram = null;
  }

  function findPatchNode(op: string, opIndex = 0) {
    return graphNodes.filter((node) => node.op === op)[opIndex] ?? null;
  }

  function resolvePatchInputRef(input: string): string | null {
    if (input === 'source') return null;
    const busMatch = /^src\(o([0-3])\)$/.exec(input.trim());
    if (busMatch) {
      return busReturnId(Number(busMatch[1]) as BusIndex);
    }
    const [rawOp, indexRaw] = input.split('#');
    const op = rawOp ?? input;
    const node = findPatchNode(op, indexRaw ? Number(indexRaw) : 0);
    return node?.id ?? null;
  }

  function installQaBridge(): void {
    if (typeof window === 'undefined') return;
    const qaWindow = window as Window & { __AV_SYNTH_QA__?: QaBridge };
    qaWindow.__AV_SYNTH_QA__ = {
      getState: () => ({
        sourceKind,
        clockRunning: clock.running,
        audioInitialised: audio.isInitialised,
        videoFeatures,
        video: videoEl
          ? {
              currentTime: videoEl.currentTime,
              paused: videoEl.paused,
              readyState: videoEl.readyState,
              duration: videoEl.duration,
            }
          : null,
      }),
      getFftSnapshot: (count = 32) => {
        const fft = audio.getFftMagnitudes();
        if (!fft) return null;
        return Array.from(fft.slice(0, count));
      },
      sampleMetrics: async (durationMs = 240) => sampleMetrics(durationMs),
      getCaptureState: () => ({
        status: captureStatus,
        bytes: latestCapture?.bytes ?? 0,
        filename: latestCapture?.filename ?? null,
        mimeType: latestCapture?.mimeType ?? null,
      }),
      setSourceKind: async (kind) => {
        if (!renderer) return false;
        setSourceKind(kind);
        await tick();
        return true;
      },
      setOperatorParam: async (op, paramId, value, opIndex = 0) => {
        if (!renderer) return false;
        const match = ensureOperatorInstance(op, opIndex);
        if (!match) return false;
        if (!match.def.paramOrder.includes(paramId)) {
          console.warn(
            `[QA bridge] setOperatorParam: unknown paramId "${paramId}" for op "${op}". Valid ids: ${match.def.paramOrder.join(', ')}`,
          );
          return false;
        }
        setOperatorParamValue(match.id, paramId, value);
        await tick();
        return true;
      },
      setSourceParam: async (paramId, value) => {
        if (!renderer || !sourceInstance) return false;
        if (!sourceInstance.def.paramOrder.includes(paramId)) {
          console.warn(
            `[QA bridge] setSourceParam: unknown paramId "${paramId}" for source "${sourceInstance.def.op}". Valid ids: ${sourceInstance.def.paramOrder.join(', ')}`,
          );
          return false;
        }
        setSourceParamValue(paramId, value);
        await tick();
        return true;
      },
      applyProgram: async (name) => {
        if (!renderer) return false;
        if (!programs[name]) return false;
        onProgram(name);
        await tick();
        return true;
      },
      setGranulatorParam: async (name, value) => {
        if (!granulator) return false;
        setGranulatorParam(name as GranulatorSliderParam, value);
        granulator.setParam(name as GranulatorSliderParam, value);
        await tick();
        return true;
      },
      setFeedbackDelayParam: async (name, value) => {
        if (!feedbackDelay) return false;
        setFeedbackDelayParam(name as FeedbackDelayParamName, value);
        await tick();
        return true;
      },
      getAudioContext: () => (audio.isInitialised ? audio.ctx : null),
      isGrainDecoded: () => !!(videoEl && grainDecodedSrc === videoEl.src),
      readCenterPixel: () => {
        if (!renderer) return null;
        return renderer.readPixelAt(renderer.canvas.width / 2, renderer.canvas.height / 2);
      },
      readGrainBufferFrame: (frameIndex: number) => {
        if (!grainBuffer || !renderer) return null;
        return grainBuffer.readFrameCenter(renderer.gl, frameIndex);
      },
      measureGranulatorLatencyProxy: async () => measureGranulatorLatencyProxy(),
      fireGranulatorLatencyProbe: async () => fireGranulatorLatencyProbe(),
      ensureGrainAudioLoaded: async () => {
        return ensureGranulatorClipLoaded();
      },
      setPresentationFinish: async (finish) => {
        if (finish.look && presentationLookOptions.includes(finish.look))
          presentationLook = finish.look;
        if (finish.quality && presentationQualityOptions.includes(finish.quality)) {
          presentationQuality = finish.quality;
        }
        if (finish.lut) {
          const validBuiltIn =
            finish.lut === IMPORTED_PRESENTATION_LUT_NAME ||
            builtInPresentationLutOptions.includes(finish.lut as PresentationLutName);
          if (validBuiltIn) presentationLut = finish.lut;
        }
        if (finish.postPreset && presentationPostPresetOptions.includes(finish.postPreset)) {
          presentationPostPreset = finish.postPreset;
        }
        if (finish.lensDirt && presentationLensDirtOptions.includes(finish.lensDirt)) {
          presentationLensDirt = finish.lensDirt;
        }
        await tick();
        return true;
      },
      loadImportedLut: async (url, label = 'imported') => {
        const ok = await loadPresentationLutUrl(url, label);
        await tick();
        return ok;
      },
      startTransport: async () => {
        await onStart();
        await tick();
        return true;
      },
      stopTransport: async () => {
        await onStop();
        await tick();
        return true;
      },
      startCapture: async (filenameStem) => startCapture(filenameStem),
      stopCapture: async () => stopCapture(),
      exportLastCapture: async () => exportLastCapture(),
      addBlendNode: async (op) => {
        if (!BLEND_OPS.includes(op as (typeof BLEND_OPS)[number])) return false;
        onAddPatchNode(op);
        await tick();
        return true;
      },
      setPatchNodeBus: async (op, bus, opIndex = 0) => {
        let node = findPatchNode(op, opIndex);
        if (!node) {
          const match = ensureOperatorInstance(op, opIndex);
          if (!match) return false;
          await tick();
          node = findPatchNode(op, opIndex);
        }
        if (!node) return false;
        onSetPatchNodeBus(node.id, bus);
        await tick();
        return true;
      },
      setPatchNodePrimaryInput: async (op, input, opIndex = 0) => {
        let node = findPatchNode(op, opIndex);
        if (!node) {
          const match = ensureOperatorInstance(op, opIndex);
          if (!match) return false;
          await tick();
          node = findPatchNode(op, opIndex);
        }
        if (!node) return false;
        const resolved = resolvePatchInputRef(input);
        if (input !== 'source' && !resolved) return false;
        onSetPatchNodePrimaryInput(node.id, resolved);
        await tick();
        return true;
      },
      addPatchNodeInput: async (op, input, opIndex = 0) => {
        let node = findPatchNode(op, opIndex);
        if (!node) {
          const match = ensureOperatorInstance(op, opIndex);
          if (!match) return false;
          await tick();
          node = findPatchNode(op, opIndex);
        }
        if (!node) return false;
        const resolved = resolvePatchInputRef(input);
        if (!resolved) return false;
        onAddPatchNodeInput(node.id, resolved);
        await tick();
        return true;
      },
      setPatchNodeSecondaryInput: async (op, input, opIndex = 0) => {
        let node = findPatchNode(op, opIndex);
        if (!node) {
          const match = ensureOperatorInstance(op, opIndex);
          if (!match) return false;
          await tick();
          node = findPatchNode(op, opIndex);
        }
        if (!node) return false;
        const resolved = resolvePatchInputRef(input);
        if (input !== 'source' && !resolved) return false;
        onSetPatchNodeSecondaryInput(node.id, resolved);
        await tick();
        return true;
      },
      setMonitorBus: async (bus) => {
        onSetMonitorBus(bus);
        await tick();
        return true;
      },
      setPreviewMode: async (mode) => {
        previewMode = mode;
        await tick();
        return true;
      },
    };
  }

  function sanitiseCaptureStem(filenameStem?: string): string {
    const stem = (filenameStem ?? `av-synth-${sourceKind}`).trim().toLowerCase();
    const safe = stem.replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '');
    return safe || 'av-synth-capture';
  }

  function chooseCaptureMimeType(): string {
    const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    for (const candidate of candidates) {
      if (MediaRecorder.isTypeSupported(candidate)) return candidate;
    }
    return '';
  }

  function clearLatestCapture(): void {
    if (latestCapture) {
      URL.revokeObjectURL(latestCapture.url);
      latestCapture = null;
    }
  }

  function createCaptureStream(): MediaStream | null {
    if (!canvasEl || !audio.isInitialised) return null;
    const canvasStream = canvasEl.captureStream(60);
    const audioStream = audio.getCaptureStream();
    if (!audioStream) return null;
    const stream = new MediaStream();
    for (const track of canvasStream.getVideoTracks()) stream.addTrack(track);
    for (const track of audioStream.getAudioTracks()) stream.addTrack(track);
    return stream;
  }

  async function startCapture(filenameStem?: string): Promise<boolean> {
    if (captureRecorder || captureStatus === 'recording') return false;
    const stream = createCaptureStream();
    if (!stream) return false;

    clearLatestCapture();
    initError = null;

    const mimeType = chooseCaptureMimeType();
    captureFilename = `${sanitiseCaptureStem(filenameStem)}.webm`;
    captureChunks = [];
    captureStream = stream;

    await new Promise<void>((resolve, reject) => {
      try {
        captureRecorder = mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream);
      } catch (error) {
        stream.getTracks().forEach((track) => track.stop());
        captureStream = null;
        reject(error);
        return;
      }

      const recorder = captureRecorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) captureChunks.push(event.data);
      };
      recorder.onerror = () => {
        reject(new Error('MediaRecorder failed'));
      };
      recorder.onstart = () => {
        captureStartedAtAudioTime = audio.isInitialised ? audio.ctx.currentTime : null;
        captureStartedAtPerfMs = performance.now();
        captureStatus = 'recording';
        resolve();
      };
      recorder.start(250);
    }).catch((error) => {
      captureRecorder = null;
      captureStatus = 'idle';
      initError = error instanceof Error ? error.message : String(error);
      return Promise.reject(error);
    });

    return true;
  }

  async function stopCapture(): Promise<{
    bytes: number;
    filename: string;
    mimeType: string;
  } | null> {
    if (!captureRecorder) {
      return latestCapture
        ? {
            bytes: latestCapture.bytes,
            filename: latestCapture.filename,
            mimeType: latestCapture.mimeType,
          }
        : null;
    }
    const recorder = captureRecorder;
    captureRecorder = null;

    const result = await new Promise<CaptureArtifact>((resolve, reject) => {
      recorder.onerror = () => {
        reject(new Error('MediaRecorder stop failed'));
      };
      recorder.onstop = () => {
        const mimeType = recorder.mimeType || 'video/webm';
        const blob = new Blob(captureChunks, { type: mimeType });
        resolve({
          blob,
          bytes: blob.size,
          filename: captureFilename,
          mimeType,
          url: URL.createObjectURL(blob),
        });
      };
      recorder.stop();
    }).catch((error) => {
      captureStatus = 'idle';
      initError = error instanceof Error ? error.message : String(error);
      return null;
    });

    captureStream?.getTracks().forEach((track) => track.stop());
    captureStream = null;
    captureStartedAtAudioTime = null;
    captureStartedAtPerfMs = null;

    if (!result) {
      captureRecorder = null;
      return null;
    }

    clearLatestCapture();
    latestCapture = result;
    captureStatus = 'ready';
    captureChunks = [];
    return {
      bytes: result.bytes,
      filename: result.filename,
      mimeType: result.mimeType,
    };
  }

  async function exportLastCapture(): Promise<boolean> {
    if (!latestCapture || typeof document === 'undefined') return false;
    const link = document.createElement('a');
    link.href = latestCapture.url;
    link.download = latestCapture.filename;
    link.style.display = 'none';
    document.body.append(link);
    link.click();
    link.remove();
    return true;
  }

  onMount(async () => {
    if (!canvasEl) return;
    try {
      renderer = new VideoRenderer(canvasEl, couplingCtx);
      instances = [];
      syncSerialGraph(instances);
      renderer.setPlan(graphPlan);
      renderer.start();
      // Cold boot stays stable on the placeholder, but the product-facing UX
      // now leads toward uploaded video rather than procedural generation.
      setSourceKind('placeholder');
    } catch (e) {
      initError = e instanceof Error ? e.message : String(e);
      return;
    }
    try {
      programs = await loadPrograms();
    } catch (e) {
      initError = e instanceof Error ? e.message : String(e);
    }
    startVideoFeatureSampling();
    installQaBridge();
    startProgramAutomationLoop();
  });

  // Granulator + MIDI initialisation. Idempotent — safe to call from both onStart and
  // onFileChange. Connects the granulator's output to the master bus as a parallel
  // auxiliary source; tries to open Web MIDI and routes raw messages through the
  // router into the granulator's setParam / triggerNoteOn surface.
  async function ensureGranulatorPipeline(): Promise<void> {
    if (!audio.isInitialised) return;
    if (granulator) return;
    try {
      const g = await Granulator.create(audio.ctx);
      const delay = new FeedbackDelay(audio.ctx, feedbackDelayParams);
      granulator = g;
      feedbackDelay = delay;
      g.output.connect(delay.input);
      feedbackDelayDisconnect = audio.attachAuxiliarySource(delay.output);
      g.setEnabled(granulatorEnabled);
      g.setEnvelope(granulatorEnvelope);
      g.setMode(granulatorMode);
      for (const [name, value] of Object.entries(granulatorRawParams) as [
        GranulatorSliderParam,
        number,
      ][]) {
        g.setParam(name, value);
      }
      for (const [name, value] of Object.entries(feedbackDelayParams) as [
        FeedbackDelayParamName,
        number,
      ][]) {
        applyFeedbackDelayParam(delay, name, value);
      }
      midiRouter = new MidiRouter(g);
    } catch (e) {
      initError = e instanceof Error ? e.message : String(e);
      return;
    }
    if (WebMidiInput.isSupported()) {
      try {
        const input = await WebMidiInput.open();
        webMidiInput = input;
        midiDevices = input.devices;
        input.onRawMessage = (bytes) => {
          const msg = parseMidiMessage(bytes);
          if (msg) midiRouter?.ingest(msg);
        };
      } catch (e) {
        midiUnavailableReason = e instanceof Error ? e.message : String(e);
      }
    } else {
      midiUnavailableReason = 'Web MIDI not supported in this browser.';
    }
  }

  // Load the currently-active video clip's audio track into the granulator. Decoded
  // once per file; the granulator runs in parallel to the operator rack, so the
  // user hears the grain cloud on top of (or instead of, when video source is the
  // grain composite) the operator-processed video audio.
  async function loadClipIntoGranulator(file: File): Promise<void> {
    if (!granulator) return;
    try {
      const ab = await file.arrayBuffer();
      await granulator.loadFromArrayBuffer(audio.ctx, ab);
      granulator.setEnabled(granulatorEnabled);
    } catch (e) {
      initError = e instanceof Error ? e.message : String(e);
    }
  }

  function planCurrentGrainBuffer() {
    if (!videoEl || !videoEl.src) return null;
    if (!videoEl.videoWidth || !videoEl.videoHeight || !Number.isFinite(videoEl.duration)) {
      return null;
    }
    if (!Number.isFinite(grainVideoFps) || !grainVideoFps || grainVideoFps <= 0) {
      return null;
    }
    return planGrainBuffer({
      srcWidth: videoEl.videoWidth,
      srcHeight: videoEl.videoHeight,
      durationSec: videoEl.duration,
      fps: grainVideoFps,
    });
  }

  // Allocate / re-allocate the grain buffer for the currently-loaded clip and hook
  // up GrainScheduler + GrainCompositeSource. Frame upload is wired lazily by
  // decodeGrainBufferForCurrentClip(); planCurrentGrainBuffer() now uses the clip's
  // measured fps rather than the old fixed 30 fps assumption.
  function ensureGrainComposite(): GrainCompositeSource | null {
    if (!renderer || !granulator || !videoEl || !videoEl.src) return null;
    if (!grainScheduler) grainScheduler = new GrainScheduler(granulator.node);
    if (!grainBuffer) grainBuffer = new GrainBuffer(renderer.gl);
    const planResult = planCurrentGrainBuffer();
    if (!planResult || !planResult.ok) return null;
    if (!grainBuffer.isAllocated) grainBuffer.allocate(renderer.gl, planResult.plan);
    if (!grainCompositeSource) {
      grainCompositeSource = new GrainCompositeSource(renderer.gl, grainBuffer, grainScheduler, {
        clock: () => (audio.isInitialised ? audio.ctx.currentTime : performance.now() / 1000),
      });
    }
    grainCompositeSource.setPlan(planResult.plan);
    return grainCompositeSource;
  }

  // Decode the loaded clip into the grain buffer's TEXTURE_2D_ARRAY. Lazy + once-per-src.
  // The seek-based upload path lives in GrainBuffer.decodeFromVideo; we wrap it here to
  // (a) pause/restore the user's playback state, (b) gate progress updates on a generation
  // counter so stale decodes don't overwrite UI after a new clip loads, (c) catch the
  // expected seek error if videoEl.src changes mid-decode.
  async function decodeGrainBufferForCurrentClip(): Promise<void> {
    if (!renderer || !videoEl || !videoEl.src) return;
    if (!grainBuffer || !grainBuffer.isAllocated) return;
    if (grainDecodedSrc === videoEl.src) return;

    const gen = ++grainDecodeGen;
    const targetSrc = videoEl.src;
    const planResult = planCurrentGrainBuffer();
    if (!planResult || !planResult.ok) return;

    const wasPaused = videoEl.paused;
    const savedTime = videoEl.currentTime;
    if (!wasPaused) videoEl.pause();

    grainDecodeStatus = { frameIndex: 0, frameCount: planResult.plan.frameCount };
    try {
      await grainBuffer.decodeFromVideo(renderer.gl, videoEl, planResult.plan, (p) => {
        if (gen === grainDecodeGen) grainDecodeStatus = p;
      });
      if (gen === grainDecodeGen) {
        grainDecodedSrc = targetSrc;
        grainDecodeStatus = null;
      }
    } catch {
      // Expected when videoEl.src changes mid-decode; swallow silently and let the next
      // ensureGrainComposite + decode pass reset state. Other errors are non-recoverable
      // for this clip but shouldn't block the rest of the app.
      if (gen === grainDecodeGen) grainDecodeStatus = null;
    } finally {
      if (gen === grainDecodeGen) {
        try {
          videoEl.currentTime = savedTime;
        } catch {
          // Ignore — element may have been torn down or src changed.
        }
        if (!wasPaused) {
          void videoEl.play().catch(() => {});
        }
      }
    }
  }

  function setSourceKind(kind: SourceKind): void {
    if (!renderer) return;
    const nextIsVideo = kind === 'video';
    if (!nextIsVideo) pauseVideoSource();
    sourceKind = kind;
    grainSourceMessage = null;

    // Tear down any current procedural source instance.
    if (sourceInstance) {
      disposeSourceAudio(sourceInstance);
      sourceInstance = null;
    }

    if (kind === 'grain-composite') {
      if (!videoEl || !videoEl.src) {
        grainSourceMessage = 'Load a video clip first to use the grain source.';
        sourceKind = 'placeholder';
        resetVideoFeatures();
        renderer.setSource(new PlaceholderSource(renderer.gl), {});
        return;
      }
      if (!granulator || !granulatorEnabled) {
        grainSourceMessage = granulator
          ? 'Enable the granulator to use the grain source.'
          : 'Start audio, then enable the granulator to use the grain source.';
        sourceKind = 'video';
        resetVideoFeatures();
        renderer.setSource(new VideoElementSource(renderer.gl, videoEl), {});
        sourceLoaded = true;
        if (clock.running) void playActiveVideoSource();
        return;
      }
      if (!Number.isFinite(grainVideoFps) || !grainVideoFps || grainVideoFps <= 0) {
        grainSourceMessage = 'Could not determine the clip frame rate for the grain source.';
        sourceKind = 'video';
        resetVideoFeatures();
        renderer.setSource(new VideoElementSource(renderer.gl, videoEl), {});
        sourceLoaded = true;
        if (clock.running) void playActiveVideoSource();
        return;
      }
      const composite = ensureGrainComposite();
      if (!composite) {
        grainSourceMessage = 'Grain source not ready yet — wait for the clip to finish loading.';
        sourceKind = 'placeholder';
        resetVideoFeatures();
        renderer.setSource(new PlaceholderSource(renderer.gl), {});
        return;
      }
      resetVideoFeatures();
      renderer.setSource(composite, {});
      sourceLoaded = true;
      if (grainDecodedSrc !== videoEl.src) {
        void decodeGrainBufferForCurrentClip();
      }
      return;
    }

    if (kind === 'placeholder') {
      resetVideoFeatures();
      renderer.setSource(new PlaceholderSource(renderer.gl), {});
      if (audio.isInitialised) {
        audio.setSource(new SilentSource(audio.ctx), {});
      }
      sourceLoaded = false;
      return;
    }

    if (kind === 'video') {
      if (!videoEl || !videoEl.src) {
        // No file loaded yet — leave existing source in place.
        sourceKind = 'placeholder';
        resetVideoFeatures();
        renderer.setSource(new PlaceholderSource(renderer.gl), {});
        return;
      }
      routeVideoAudioThroughGraph();
      renderer.setSource(new VideoElementSource(renderer.gl, videoEl), {});
      if (audio.isInitialised) {
        try {
          audio.setSource(new VideoElementAudioSource(audio.ctx, videoEl), {});
        } catch (e) {
          initError = e instanceof Error ? e.message : String(e);
        }
      }
      sourceLoaded = true;
      if (clock.running) void playActiveVideoSource();
      return;
    }

    // Procedural source from the registry.
    resetVideoFeatures();
    const inst = createSourceInstance(kind, renderer.gl);
    sourceInstance = inst;
    renderer.setSource(inst.videoStage, inst.params, inst.def.coupling);
    if (audio.isInitialised) {
      attachSourceAudio(inst, audio.ctx);
      if (inst.audioStage) audio.setSource(inst.audioStage, inst.params, inst.def.coupling);
    }
    sourceLoaded = false;
  }

  function onProgram(name: string) {
    const program = programs[name];
    if (!program || !renderer) return;
    if (sourceLoaded && sourceKind !== 'video') setSourceKind('video');
    const orderedProgramOps = getOrderedProgramOps(program, DEFAULT_CHAIN);
    const reusableByOp = new Map<string, OperatorInstance[]>();
    for (const instance of instances) {
      const bucket = reusableByOp.get(instance.def.op) ?? [];
      bucket.push(instance);
      reusableByOp.set(instance.def.op, bucket);
    }
    const nextInstances = orderedProgramOps.map(
      (op) => reusableByOp.get(op)?.shift() ?? createInstance(op, renderer!.gl),
    );
    for (const stale of instances) {
      if (nextInstances.includes(stale)) continue;
      disposeInstance(stale, renderer.gl);
    }
    instances = nextInstances;
    applyProgramGraph(program, instances);
    applyProgram(program, instances);
    syncSharedFeedbackFromVideoChain();
    applyProgramAudio(program, {
      setGranulatorParam: (name, value) => {
        setGranulatorParam(name, value);
        granulator?.setParam(name, value);
      },
      setGranulatorEnvelope: (value) => setGranulatorEnvelope(value),
      setGranulatorMode: (value) => setGranulatorMode(value),
      setFeedbackDelayParam: (name, value) =>
        setFeedbackDelayParam(name, value, { clearProgram: false }),
    });
    applyActiveProgramAutomation(program);
    applyProgramRenderStyle(program.render);
    activeProgram = name;
    instances = [...instances];
  }

  function currentProgramTime(): number {
    if (audio.isInitialised) return audio.ctx.currentTime;
    return clock.displayTime;
  }

  function currentProgramAutomationRuntime(): ProgramAutomationRuntime {
    return {
      time: currentProgramTime(),
      fft: audio.getFftMagnitudes(),
      videoFeatures,
    };
  }

  function applyActiveProgramAutomation(
    program = activeProgram ? programs[activeProgram] : undefined,
  ): void {
    if (!program || !programHasAutomation(program)) return;
    applyProgramAutomation(program, instances, currentProgramAutomationRuntime());
    graph.syncParams(instances);
  }

  function startProgramAutomationLoop(): void {
    if (typeof window === 'undefined' || programAutomationRaf) return;
    const tickProgramAutomation = () => {
      const program = activeProgram ? programs[activeProgram] : undefined;
      if (programHasAutomation(program)) applyActiveProgramAutomation(program);
      tickGranulatorModulation();
      programAutomationRaf = window.requestAnimationFrame(tickProgramAutomation);
    };
    programAutomationRaf = window.requestAnimationFrame(tickProgramAutomation);
  }

  // Per-frame: pull raw granulator slider values, fold in any assigned global LFOs via
  // mod-bank, and push the modulated result into the worklet's k-rate AudioParams.
  // Runs at rAF cadence (≈60 Hz) — matches video FX LFO timing and is more than fast
  // enough for the granulator's slowest sensible LFO rates (default bank 0.08–0.89 Hz).
  // Costs ~13 setParam writes per frame; AudioParam k-rate scheduling de-dups identical
  // values internally so quiet (no-LFO) state is essentially free.
  function tickGranulatorModulation(): void {
    if (!granulator) return;
    const modulated = applyGlobalLfoAssignments(
      granulatorRawParams,
      GRANULATOR_PARAM_SPECS,
      granulatorLfoAssignments,
      couplingCtx,
    );
    for (const name of Object.keys(modulated) as GranulatorSliderParam[]) {
      const value = modulated[name];
      if (value !== undefined) granulator.setParam(name, value);
    }
  }

  function applyProgramRenderStyle(style: VideoEffectRenderStyle | undefined): void {
    if (!style) return;
    if (style.look) presentationLook = style.look;
    if (style.quality) presentationQuality = style.quality;
    if (style.lut) presentationLut = style.lut;
    if (style.postPreset) presentationPostPreset = style.postPreset;
    if (style.lensDirt) presentationLensDirt = style.lensDirt;
  }

  async function loadPresentationLutText(source: string, label: string): Promise<boolean> {
    if (!renderer) return false;
    try {
      const parsed = parseCubeLut(source, label, 1);
      renderer.setImportedPresentationLut(parsed);
      presentationLut = IMPORTED_PRESENTATION_LUT_NAME;
      return true;
    } catch (error) {
      initError = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  async function loadPresentationLutUrl(url: string, label = 'imported'): Promise<boolean> {
    const response = await fetch(url);
    if (!response.ok) {
      initError = `Failed to load LUT: ${response.status}`;
      return false;
    }
    return loadPresentationLutText(await response.text(), label);
  }

  function onMovePatchNode(id: string, direction: -1 | 1): void {
    const from = instances.findIndex((instance) => instance.id === id);
    if (from < 0) return;
    const to = from + direction;
    if (to < 0 || to >= instances.length) return;
    const next = [...instances];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    instances = next;
    syncSerialGraph(instances);
    activeProgram = null;
  }

  function onAddPatchNode(op: string): void {
    if (!renderer) return;
    const instance = createInstance(op, renderer.gl);
    if (instance.def.op === 'feedback') {
      const range = instance.def.coupling.params.feedback?.spec.range ?? [0, 0.95];
      instance.params.feedback = Math.max(
        range[0],
        Math.min(range[1], feedbackDelayParams.feedback),
      );
    }
    instances = [...instances, instance];
    syncSerialGraph(instances);
    if ((instance.def.inputArity ?? 1) > 1) {
      graph.setPrimaryInput(instance.id, instances.at(-2)?.id ?? null);
    }
    activeProgram = null;
  }

  function onRemovePatchNode(id: string): void {
    if (!renderer) return;
    const instance = instances.find((candidate) => candidate.id === id);
    if (!instance) return;
    const removedFeedback = instance.def.op === 'feedback';
    disposeInstance(instance, renderer.gl);
    instances = instances.filter((candidate) => candidate.id !== id);
    syncSerialGraph(instances);
    if (removedFeedback) syncSharedFeedbackFromVideoChain();
    activeProgram = null;
  }

  function onSetPatchNodeBus(id: string, bus: BusIndex): void {
    graph.setBus(id, bus);
    activeProgram = null;
  }

  function onSetMonitorBus(bus: BusIndex): void {
    monitorBus = bus;
  }

  function onSetPreviewMode(mode: PreviewMode): void {
    previewMode = mode;
  }

  function onSetPatchNodePrimaryInput(id: string, inputId: string | null): void {
    graph.setPrimaryInput(id, inputId);
    activeProgram = null;
  }

  function onAddPatchNodeInput(id: string, inputId: string): void {
    graph.addInput(id, inputId);
    activeProgram = null;
  }

  function onSetPatchNodeSecondaryInput(id: string, inputId: string | null): void {
    const node = graph.get(id);
    if (!node) return;
    const primary = node.inputs[0];
    const nextInputs = [primary, inputId].filter((input): input is string =>
      Boolean(input && input !== SOURCE_NODE_ID),
    );
    graph.setInputs(id, nextInputs);
    activeProgram = null;
  }

  // Push the latest coupling context into the renderer whenever bpm/baseFreq change.
  $effect(() => {
    renderer?.updateCouplingContext(couplingCtx);
  });

  $effect(() => {
    renderer?.setPresentationLook(presentationLook);
  });

  $effect(() => {
    renderer?.setPresentationQuality(presentationQuality);
  });

  $effect(() => {
    renderer?.setPresentationLut(presentationLut);
  });

  $effect(() => {
    renderer?.setPresentationPostPreset(presentationPostPreset);
  });

  $effect(() => {
    renderer?.setPresentationLensDirt(presentationLensDirt);
  });

  $effect(() => {
    renderer?.setPreviewMode(previewMode);
  });

  $effect(() => {
    audio.updateVideoFeatures(videoFeatures);
  });

  $effect(() => {
    graph.syncParams(orderedInstances);
  });

  $effect(() => {
    renderer?.setPlan(graphPlan);
    if (!audio.isInitialised) return;
    audio.setPlan(graphPlan);
  });

  onDestroy(() => {
    stopVideoFeatureSampling();
    captureStream?.getTracks().forEach((track) => track.stop());
    clearLatestCapture();
    if (typeof window !== 'undefined') {
      if (programAutomationRaf) {
        window.cancelAnimationFrame(programAutomationRaf);
        programAutomationRaf = 0;
      }
      delete (window as Window & { __AV_SYNTH_QA__?: QaBridge }).__AV_SYNTH_QA__;
    }
    webMidiInput?.dispose();
    webMidiInput = null;
    midiRouter = null;
    if (grainCompositeSource && renderer) grainCompositeSource.dispose(renderer.gl);
    grainCompositeSource = null;
    if (grainBuffer && renderer) grainBuffer.dispose(renderer.gl);
    grainBuffer = null;
    grainScheduler?.dispose();
    grainScheduler = null;
    feedbackDelayDisconnect?.();
    feedbackDelayDisconnect = null;
    feedbackDelay?.dispose();
    feedbackDelay = null;
    granulator?.dispose();
    granulator = null;
    renderer?.dispose();
    renderer = null;
  });

  async function onStart() {
    await audio.init();
    audio.setPlan(graphPlan);
    await ensureGranulatorPipeline();

    // Audio side of the active source needs the AudioContext, so wire it now
    // if a procedural source is selected. For input sources we leave whatever
    // SilentSource the engine init() created in place until the user picks one.
    if (sourceInstance) {
      attachSourceAudio(sourceInstance, audio.ctx);
      if (sourceInstance.audioStage) {
        audio.setSource(
          sourceInstance.audioStage,
          sourceInstance.params,
          sourceInstance.def.coupling,
        );
      }
    } else if (sourceKind === 'video' && videoEl && videoEl.src) {
      try {
        routeVideoAudioThroughGraph();
        audio.setSource(new VideoElementAudioSource(audio.ctx, videoEl), {});
      } catch (e) {
        initError = e instanceof Error ? e.message : String(e);
      }
    }

    await clock.start();
    await playActiveVideoSource();
  }

  async function onStop() {
    if (captureStatus === 'recording') await stopCapture();
    pauseVideoSource();
    await clock.stop();
  }

  async function onFileChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !renderer || !videoEl) return;
    // New clip invalidates any prior grain-buffer decode. Bumping the gen prevents any
    // in-flight decode from writing to UI state, and disposing the buffer forces
    // ensureGrainComposite() to reallocate against the new clip's dimensions on demand.
    grainDecodeGen++;
    grainDecodedSrc = null;
    grainDecodeStatus = null;
    grainVideoFps = null;
    if (grainCompositeSource) {
      grainCompositeSource.dispose(renderer.gl);
      grainCompositeSource = null;
    }
    if (grainBuffer) {
      grainBuffer.dispose(renderer.gl);
      grainBuffer = null;
    }
    const url = URL.createObjectURL(file);
    loadedVideoName = file.name;
    videoEl.src = url;
    videoEl.loop = true;
    videoEl.preload = 'auto';
    routeVideoAudioThroughGraph();
    // Loading a file implicitly switches the source kind to 'video'.
    setSourceKind('video');
    await waitForVideoFrame(videoEl);
    grainVideoFps = await probeClipFrameRate(videoEl);

    if (!audio.isInitialised) {
      await audio.init();
      audio.setPlan(graphPlan);
    }
    await ensureGranulatorPipeline();
    void loadClipIntoGranulator(file);
    try {
      audio.setSource(new VideoElementAudioSource(audio.ctx, videoEl), {});
    } catch (e) {
      initError = e instanceof Error ? e.message : String(e);
    }

    await clock.start();
    await playActiveVideoSource();
  }
</script>

<video bind:this={videoEl} style="display:none" playsinline></video>

<main class="shell">
  <header class="topbar">
    <div class="brand">
      <h1>av-synth</h1>
      <span class="boot">M5.7 · {instances.length} ops · source: {sourceBadge}</span>
      <span class="cursor" aria-hidden="true">█</span>
    </div>
    <div class="stage-controls">
      <label class="stage-group">
        <span class="rl">── monitor ──</span>
        <div class="stage-toggle">
          {#each BUS_INDICES as bus (bus)}
            <button
              class:active={monitorBus === bus}
              type="button"
              onclick={() => onSetMonitorBus(bus)}
            >
              o{bus}
            </button>
          {/each}
        </div>
      </label>
      <label class="stage-group">
        <span class="rl">── preview ──</span>
        <div class="stage-toggle">
          <button
            class:active={previewMode === 'single'}
            type="button"
            onclick={() => onSetPreviewMode('single')}
          >
            single
          </button>
          <button
            class:active={previewMode === 'quad'}
            type="button"
            onclick={() => onSetPreviewMode('quad')}
          >
            quad
          </button>
        </div>
      </label>
    </div>
  </header>

  <section class="sources">
    <div class="source-primary">
      <div class="source-actions">
        <span class="source-status">
          {#if sourceLoaded && loadedVideoName}
            {loadedVideoName}
          {:else}
            no clip loaded
          {/if}
        </span>
        <label class="file source-file">
          choose video
          <input data-qa="video-file-input" type="file" accept="video/*" onchange={onFileChange} />
        </label>
        <button
          class="source-kind-button"
          type="button"
          data-qa="source-kind-grain-composite"
          aria-pressed={sourceKind === 'grain-composite'}
          onclick={() => setSourceKind('grain-composite')}
        >
          grain composite
        </button>
        <button
          class="source-kind-button"
          type="button"
          aria-pressed={sourceKind === 'video'}
          onclick={() => setSourceKind('video')}
        >
          video
        </button>
      </div>
      {#if grainSourceMessage}
        <p class="source-message" role="status" data-qa="grain-source-message">
          {grainSourceMessage}
        </p>
      {/if}
      {#if grainDecodeStatus}
        <p class="source-progress" role="status" data-qa="grain-decode-progress">
          decoding grain buffer: frame {grainDecodeStatus.frameIndex +
            1}/{grainDecodeStatus.frameCount}
        </p>
      {/if}
      <p class="midi-status" data-qa="midi-status">
        {#if midiUnavailableReason}
          MIDI: {midiUnavailableReason}
        {:else if midiDevices.length === 0}
          MIDI: no devices connected
        {:else}
          MIDI: {midiDevices.map((d) => d.name).join(', ')}
        {/if}
      </p>
    </div>
  </section>

  <section class="workspace">
    <section class="stage">
      <div class="canvas-wrap">
        {#if initError}
          <div class="error">init failed: {initError}</div>
        {/if}
        <canvas bind:this={canvasEl} width="1280" height="720"></canvas>
        {#if previewMode === 'quad'}
          <div class="quad-monitor-overlay">
            {#each BUS_INDICES as bus (bus)}
              <div
                class:active={monitorBus === bus}
                class:empty={!graphPlan.busOutputIds[bus]}
                class="quad-label"
              >
                <strong>o{bus}</strong>
                <span>{graphPlan.busOutputIds[bus] ? 'live' : 'empty'}</span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </section>

    <aside class="patch-panel">
      <div class="patch-head">
        <span class="sec-label">── workspace ──</span>
        <div class="workspace-tabs" role="tablist" aria-label="Edit surface">
          <button
            class:active={activeWorkspaceSurface === 'video'}
            class="workspace-tab"
            type="button"
            role="tab"
            aria-selected={activeWorkspaceSurface === 'video'}
            onclick={() => (activeWorkspaceSurface = 'video')}
          >
            video
          </button>
          <button
            class:active={activeWorkspaceSurface === 'audio'}
            class="workspace-tab"
            type="button"
            role="tab"
            aria-selected={activeWorkspaceSurface === 'audio'}
            onclick={() => (activeWorkspaceSurface = 'audio')}
          >
            audio
          </button>
          <button
            class:active={activeWorkspaceSurface === 'lfo'}
            class="workspace-tab"
            type="button"
            role="tab"
            aria-selected={activeWorkspaceSurface === 'lfo'}
            onclick={() => (activeWorkspaceSurface = 'lfo')}
          >
            lfo
          </button>
          <button
            class:active={activeWorkspaceSurface === 'presets'}
            class="workspace-tab"
            type="button"
            role="tab"
            aria-selected={activeWorkspaceSurface === 'presets'}
            onclick={() => (activeWorkspaceSurface = 'presets')}
          >
            presets
          </button>
        </div>
      </div>
      <div class="graph-shell">
        {#if activeWorkspaceSurface === 'video'}
          <Patch
            nodes={patchNodes}
            {operatorOptions}
            sourceLabel={sourceBadge}
            {sourceControls}
            lfoBank={clock.lfoBank}
            onAddNode={onAddPatchNode}
            onMove={onMovePatchNode}
            onRemove={onRemovePatchNode}
            onSetNodeParamLfo={setOperatorParamLfo}
            onSetNodeParam={setOperatorParamValue}
            onSetNodeBus={onSetPatchNodeBus}
            onSetNodePrimaryInput={onSetPatchNodePrimaryInput}
            onSetNodeSecondaryInput={onSetPatchNodeSecondaryInput}
            onSetSourceControl={setSourceParamValue}
          />
        {:else if activeWorkspaceSurface === 'audio'}
          <MasterMeter poll={() => audio.getMasterPeak()} />
          <GranulatorCard
            {granulator}
            {midiRouter}
            enabled={granulatorEnabled}
            envelope={granulatorEnvelope}
            mode={granulatorMode}
            values={granulatorRawParams}
            lfoBank={clock.lfoBank}
            lfoAssignments={granulatorLfoAssignments}
            onSetEnabled={setGranulatorEnabled}
            onSetEnvelope={setGranulatorEnvelope}
            onSetMode={setGranulatorMode}
            onSetParam={setGranulatorParam}
            onSetParamLfo={setGranulatorParamLfo}
          />
          <FeedbackDelayCard values={feedbackDelayParams} onSetParam={setFeedbackDelayParam} />
        {:else if activeWorkspaceSurface === 'lfo'}
          <LfoBank
            bank={clock.lfoBank}
            onSetAmount={setGlobalLfoAmount}
            onSetRate={setGlobalLfoRate}
            onSetWaveform={setGlobalLfoWaveform}
          />
        {:else}
          <div class="presets-tab">
            {#if activeProgram && programs[activeProgram]}
              <div class="presets-active">
                <span class="sec-label">── active ──</span>
                <strong>{programs[activeProgram]!.title}</strong>
              </div>
            {/if}
            <div class="program-grid">
              {#each visiblePrograms as [name, program] (name)}
                <button
                  class:active={activeProgram === name}
                  class="program-card"
                  title={program.tagline}
                  onclick={() => onProgram(name)}
                >
                  <span class="program-name">{program.title}</span>
                </button>
              {/each}
              {#if visiblePrograms.length === 0}
                <span class="muted">effect programs loading…</span>
              {/if}
            </div>
          </div>
        {/if}
      </div>
    </aside>
  </section>

  <footer>
    <span class="status"
      >staging rc · video-first shell live · final local listening pass and first Cloudflare deploy
      remain</span
    >
  </footer>
</main>

<style>
  .shell {
    display: grid;
    grid-template-rows: auto auto 1fr auto;
    height: 100vh;
    color: var(--fg);
    background: var(--bg);
    font-family: var(--font-mono);
    overflow: hidden;
  }

  .sources {
    display: flex;
    gap: 0.5rem;
    padding: 0.4rem 1.5rem;
    border-bottom: 1px solid var(--line);
    flex-wrap: wrap;
    align-items: center;
  }

  .sec-label {
    color: var(--muted);
    font-size: 0.7rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin-right: 0.3rem;
  }

  .presets-tab {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 0.6rem 0.8rem;
  }

  .presets-active {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
  }

  .presets-active strong {
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--accent);
  }

  .program-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .program-card {
    background: var(--bg);
    color: var(--fg);
    border: 1px solid var(--line);
    padding: 0.3rem 0.7rem;
    cursor: pointer;
    font-family: var(--font-mono);
    text-align: center;
  }

  .program-card:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .program-card.active {
    border-color: var(--accent);
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, var(--bg));
  }

  .program-name {
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .source-primary {
    display: grid;
    gap: 0.5rem;
    width: 100%;
    padding: 0.15rem 0;
  }

  .source-status {
    color: var(--muted);
    font-size: 0.75rem;
    letter-spacing: 0.02em;
    min-width: 0;
  }

  .source-progress {
    color: var(--muted);
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
    margin: 0;
  }

  .source-actions {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-wrap: wrap;
  }

  .source-file {
    align-self: flex-start;
  }

  .topbar {
    padding: 0.75rem 1.5rem;
    border-bottom: 1px solid var(--line);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.5rem;
    flex-wrap: wrap;
  }

  .brand {
    display: flex;
    align-items: baseline;
    gap: 1rem;
  }

  h1 {
    margin: 0;
    font-size: 1rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--accent);
  }

  .boot {
    color: var(--muted);
    font-size: 0.75rem;
  }

  .cursor {
    color: var(--accent);
    font-size: 0.75rem;
    margin-left: -0.4rem;
    animation: blink 1s steps(2, start) infinite;
  }

  @keyframes blink {
    to {
      visibility: hidden;
    }
  }

  .stage-controls {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .stage-group {
    display: grid;
    gap: 0.35rem;
  }

  .stage-toggle {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .stage-toggle button {
    background: var(--bg);
    color: var(--fg);
    border: 1px solid var(--line);
    padding: 0.28rem 0.5rem;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 0.72rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .stage-toggle button.active {
    border-color: var(--accent);
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }

  .file {
    background: var(--bg);
    color: var(--accent);
    border: 1px solid var(--accent);
    padding: 0.35rem 0.9rem;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 0.8rem;
    letter-spacing: 0.05em;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }

  .file:hover {
    background: color-mix(in srgb, var(--accent) 12%, var(--bg));
  }

  .file input {
    display: none;
  }

  .workspace {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(24rem, 1fr);
    min-height: 0;
    min-width: 0;
    overflow: hidden;
  }

  .stage {
    display: flex;
    align-items: stretch;
    justify-content: center;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
  }

  .canvas-wrap {
    padding: 0.75rem 1rem 0.75rem 1.5rem;
    position: relative;
    width: 100%;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
  }

  canvas {
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: #000;
    border: 1px solid var(--line);
    display: block;
  }

  .error {
    position: absolute;
    top: 2rem;
    left: 2rem;
    background: color-mix(in srgb, var(--warn) 20%, var(--bg));
    color: var(--warn);
    border: 1px solid var(--warn);
    padding: 0.5rem 0.75rem;
    font-size: 0.75rem;
  }

  .quad-monitor-overlay {
    position: absolute;
    inset: 0.75rem 1rem 0.75rem 1.5rem;
    pointer-events: none;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-template-rows: repeat(2, minmax(0, 1fr));
    gap: 0;
  }

  .quad-label {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding: 0.6rem 0.7rem;
    color: color-mix(in srgb, white 85%, var(--muted));
    font-size: 0.7rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    background: linear-gradient(180deg, rgb(0 0 0 / 45%), transparent 42%);
    border: 1px solid rgb(255 255 255 / 0.08);
  }

  .quad-label strong {
    font-size: 0.75rem;
    font-weight: 600;
  }

  .quad-label.empty {
    color: color-mix(in srgb, var(--muted) 85%, white);
  }

  .quad-label.active {
    color: color-mix(in srgb, var(--accent) 75%, white);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent);
  }

  .patch-panel {
    display: grid;
    grid-template-rows: auto 1fr;
    min-width: 0;
    min-height: 0;
    border-left: 1px solid var(--line);
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--line) 8%, transparent), transparent 18%),
      var(--bg);
  }

  .patch-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.85rem 1rem 0.5rem;
    border-bottom: 1px solid var(--line);
  }

  .workspace-tabs {
    display: inline-flex;
    gap: 0.35rem;
  }

  .workspace-tab {
    background: transparent;
    color: var(--muted);
    border: 1px solid var(--line);
    padding: 0.28rem 0.62rem;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 0.74rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .workspace-tab.active {
    color: var(--accent);
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, var(--bg));
  }

  .graph-shell {
    min-height: 0;
    overflow: auto;
  }

  .graph-shell :global(.patch) {
    min-width: 0;
    min-height: 100%;
    border-left: none;
    background: transparent;
  }

  .graph-shell :global(.patch header) {
    padding: 0.75rem 1rem;
  }

  .graph-shell :global(.patch .empty-state) {
    place-content: start center;
    padding-top: 2rem;
  }

  .muted {
    color: var(--muted);
    font-size: 0.75rem;
  }

  @media (max-width: 1100px) {
    .workspace {
      grid-template-columns: 1fr;
      grid-template-rows: minmax(16rem, 42vh) minmax(0, 1fr);
    }

    .patch-panel {
      border-left: none;
      border-top: 1px solid var(--line);
    }

    .canvas-wrap {
      padding-right: 1.5rem;
    }
  }

  @media (max-width: 720px) {
    .patch-head {
      align-items: flex-start;
      flex-direction: column;
    }
  }

  footer {
    padding: 0.5rem 1.5rem;
    border-top: 1px solid var(--line);
    font-size: 0.75rem;
    color: var(--muted);
  }

  .status::before {
    content: '·  ';
    color: var(--accent);
  }
</style>
