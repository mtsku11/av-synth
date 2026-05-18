<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { clock } from './core/clock.svelte';
  import { audio } from './audio/engine';
  import { VideoRenderer } from './video/renderer';
  import { PlaceholderSource, VideoElementSource } from './video/sources';
  import { SilentSource, VideoElementAudioSource } from './audio/sources';
  import { createInstance, type OperatorInstance } from './core/operators';
  import {
    createSourceInstance,
    attachSourceAudio,
    disposeSourceAudio,
    listSources,
    type SourceInstance,
  } from './core/sources';
  import { DEFAULT_CHAIN } from './ops';
  import { DEFAULT_SOURCE } from './sources';
  import type { CouplingContext } from './core/coupling';
  import { loadPresets, applyPreset, type PresetBank } from './core/presets';
  import Slider from './ui/Slider.svelte';
  import Patch from './ui/Patch.svelte';
  import type { ParamSpec } from './core/params';

  const rateSpec: ParamSpec = {
    id: 'clock.rate',
    label: 'rate',
    range: [0.05, 8],
    default: 0.3,
    curve: 'log',
    unit: 'hz',
    hint: 'global LFO frequency (clock.rate) — modulate and future LFO-driven ops read this',
  };
  const bpmSpec: ParamSpec = {
    id: 'clock.bpm',
    label: 'bpm',
    range: [40, 220],
    default: 120,
    curve: 'lin',
    unit: 'norm',
  };

  let canvasEl: HTMLCanvasElement | undefined = $state();
  let videoEl: HTMLVideoElement | undefined = $state();
  let renderer: VideoRenderer | null = null;
  let initError = $state<string | null>(null);
  let instances = $state<OperatorInstance[]>([]);
  let sourceLoaded = $state(false);
  let presets = $state<PresetBank>({});
  let activePreset = $state<string | null>(null);

  // Source kind: 'video' = external <video> element, 'placeholder' = built-in
  // plasma, or a registered procedural source name (e.g. 'osc').
  type SourceKind = 'video' | 'placeholder' | string;
  const proceduralSources = listSources(); // computed once on mount; ops are registered before this component
  let sourceKind = $state<SourceKind>('placeholder');
  let sourceInstance = $state<SourceInstance | null>(null);

  const couplingCtx = $derived<CouplingContext>({
    baseFreq: clock.baseFreq,
    bpm: clock.bpm,
    sampleRate: audio.isInitialised ? audio.ctx.sampleRate : 48000,
    time: clock.displayTime, // overridden per-frame by renderer; this is the fallback
    rate: clock.rate,
  });

  // Tag each param entry with its instance/key so the UI can render flat.
  interface ParamRow {
    instanceId: string;
    paramId: string;
    label: string;
    instance: OperatorInstance;
  }

  const paramRows = $derived<ParamRow[]>(
    instances.flatMap((inst) =>
      inst.def.paramOrder.map((paramId) => {
        const coupling = inst.def.coupling.params[paramId];
        return {
          instanceId: inst.id,
          paramId,
          label: `${inst.def.op} · ${coupling?.spec.label ?? paramId}`,
          instance: inst,
        };
      }),
    ),
  );

  // Source has its own (smaller, separate) params row list, rendered above
  // the operator-chain sliders so the patch reads top-down: source → chain.
  interface SourceParamRow {
    paramId: string;
    label: string;
    instance: SourceInstance;
  }

  interface QaBridge {
    getState(): {
      sourceKind: string;
      clockRunning: boolean;
      audioInitialised: boolean;
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
    startCapture(filenameStem?: string): Promise<boolean>;
    stopCapture(): Promise<{
      bytes: number;
      filename: string;
      mimeType: string;
    } | null>;
    exportLastCapture(): Promise<boolean>;
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

  function analyseCanvasFrame(frame: Uint8ClampedArray): {
    meanLuma: number;
    meanR: number;
    meanG: number;
    meanB: number;
    meanSaturation: number;
    spatialStd: number;
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
    return {
      meanLuma,
      meanR: sumR / count,
      meanG: sumG / count,
      meanB: sumB / count,
      meanSaturation: saturationSum / count,
      spatialStd: Math.sqrt(variance / count),
      lumas,
    };
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
    let audioMeanDb = 0;
    let audioCentroidHz = 0;
    let audioSpreadHz = 0;
    let audioActiveBins = 0;
    let prevLumas: Float32Array<ArrayBuffer> | null = null;
    const deadline = performance.now() + durationMs;

    while (performance.now() < deadline) {
      probeCtx.drawImage(canvasEl, 0, 0, probeCanvas.width, probeCanvas.height);
      const image = probeCtx.getImageData(0, 0, probeCanvas.width, probeCanvas.height);
      const frame = analyseCanvasFrame(image.data);
      videoMeanLuma += frame.meanLuma;
      videoMeanR += frame.meanR;
      videoMeanG += frame.meanG;
      videoMeanB += frame.meanB;
      videoMeanSaturation += frame.meanSaturation;
      videoSpatialStd += frame.spatialStd;

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

  const sourceParamRows = $derived<SourceParamRow[]>(
    sourceInstance
      ? sourceInstance.def.paramOrder.map((paramId) => ({
          paramId,
          label: `${sourceInstance!.def.op} · ${sourceInstance!.def.coupling.params[paramId]?.spec.label ?? paramId}`,
          instance: sourceInstance!,
        }))
      : [],
  );

  function installQaBridge(): void {
    if (typeof window === 'undefined') return;
    const qaWindow = window as Window & { __AV_SYNTH_QA__?: QaBridge };
    qaWindow.__AV_SYNTH_QA__ = {
      getState: () => ({
        sourceKind,
        clockRunning: clock.running,
        audioInitialised: audio.isInitialised,
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
        let matchIndex = -1;
        let seen = 0;
        for (let index = 0; index < instances.length; index += 1) {
          if (instances[index]?.def.op !== op) continue;
          if (seen === opIndex) {
            matchIndex = index;
            break;
          }
          seen += 1;
        }
        if (matchIndex < 0) return false;
        const match = instances[matchIndex]!;
        const nextParams = { ...match.params, [paramId]: value };
        const nextInstances = [...instances];
        nextInstances[matchIndex] = { ...match, params: nextParams };
        instances = nextInstances;
        renderer.setInstances(nextInstances);
        if (audio.isInitialised) audio.setInstances(nextInstances);
        await tick();
        return true;
      },
      setSourceParam: async (paramId, value) => {
        if (!renderer || !sourceInstance) return false;
        const nextParams = { ...sourceInstance.params, [paramId]: value };
        sourceInstance = { ...sourceInstance, params: nextParams };
        renderer.setSourceParams(nextParams);
        if (audio.isInitialised && sourceInstance.audioStage) {
          audio.setSourceParams(nextParams);
        }
        await tick();
        return true;
      },
      startCapture: async (filenameStem) => startCapture(filenameStem),
      stopCapture: async () => stopCapture(),
      exportLastCapture: async () => exportLastCapture(),
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
      instances = DEFAULT_CHAIN.map((op) => createInstance(op, renderer!.gl));
      renderer.setInstances(instances);
      renderer.start();
      // Default to a procedural source so the AV-coupling story is visible
      // immediately without needing a file load.
      setSourceKind(DEFAULT_SOURCE);
    } catch (e) {
      initError = e instanceof Error ? e.message : String(e);
      return;
    }
    try {
      presets = await loadPresets();
    } catch (e) {
      initError = e instanceof Error ? e.message : String(e);
    }
    installQaBridge();
  });

  function setSourceKind(kind: SourceKind): void {
    if (!renderer) return;
    sourceKind = kind;

    // Tear down any current procedural source instance.
    if (sourceInstance) {
      disposeSourceAudio(sourceInstance);
      sourceInstance = null;
    }

    if (kind === 'placeholder') {
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
        renderer.setSource(new PlaceholderSource(renderer.gl), {});
        return;
      }
      renderer.setSource(new VideoElementSource(renderer.gl, videoEl), {});
      if (audio.isInitialised) {
        try {
          audio.setSource(new VideoElementAudioSource(audio.ctx, videoEl), {});
        } catch (e) {
          initError = e instanceof Error ? e.message : String(e);
        }
      }
      sourceLoaded = true;
      return;
    }

    // Procedural source from the registry.
    const inst = createSourceInstance(kind, renderer.gl);
    sourceInstance = inst;
    renderer.setSource(inst.videoStage, inst.params, inst.def.coupling);
    if (audio.isInitialised) {
      attachSourceAudio(inst, audio.ctx);
      if (inst.audioStage) audio.setSource(inst.audioStage, inst.params, inst.def.coupling);
    }
    sourceLoaded = false;
  }

  function onPreset(name: string) {
    const p = presets[name];
    if (!p) return;
    applyPreset(p, instances);
    activePreset = name;
    // Trigger reactivity on params by replacing each instance's params ref.
    instances = instances.map((inst) => ({ ...inst, params: { ...inst.params } }));
  }

  // Push the latest coupling context into the renderer whenever bpm/baseFreq change.
  $effect(() => {
    renderer?.updateCouplingContext(couplingCtx);
  });

  // Whenever the chain composition changes, hand it to the audio engine too.
  $effect(() => {
    if (!audio.isInitialised) return;
    audio.setInstances(instances);
  });

  onDestroy(() => {
    captureStream?.getTracks().forEach((track) => track.stop());
    clearLatestCapture();
    if (typeof window !== 'undefined') {
      delete (window as Window & { __AV_SYNTH_QA__?: QaBridge }).__AV_SYNTH_QA__;
    }
    renderer?.dispose();
    renderer = null;
  });

  async function onStart() {
    await audio.init();
    audio.setInstances(instances);

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
        audio.setSource(new VideoElementAudioSource(audio.ctx, videoEl), {});
      } catch (e) {
        initError = e instanceof Error ? e.message : String(e);
      }
    }

    await clock.start();
  }

  async function onStop() {
    if (captureStatus === 'recording') await stopCapture();
    await clock.stop();
  }

  async function onFileChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !renderer || !videoEl) return;
    const url = URL.createObjectURL(file);
    videoEl.src = url;
    videoEl.loop = true;
    videoEl.muted = false;
    try {
      await videoEl.play();
    } catch {
      // Autoplay can fail before user gesture — that's OK; user can click Start.
    }
    // Loading a file implicitly switches the source kind to 'video'.
    setSourceKind('video');
  }
</script>

<video bind:this={videoEl} style="display:none" playsinline></video>

<main class="shell">
  <header class="topbar">
    <div class="brand">
      <h1>av-synth</h1>
      <span class="boot">M3 · {instances.length} ops · source: {sourceKind}</span>
    </div>
    <div class="transport">
      <label class="file">
        load video
        <input type="file" accept="video/*" onchange={onFileChange} />
      </label>
      {#if clock.running}
        <button onclick={onStop}>■ stop</button>
      {:else}
        <button onclick={onStart}>▶ start</button>
      {/if}
      {#if captureStatus === 'recording'}
        <button class="recording" onclick={stopCapture}>● stop rec</button>
      {:else}
        <button
          onclick={() => void startCapture()}
          disabled={!clock.running || !audio.isInitialised}
        >
          ● record
        </button>
      {/if}
      <button onclick={() => void exportLastCapture()} disabled={!latestCapture}
        >download capture</button
      >
      <div class="readouts">
        <span class="readout"><span class="rl">bpm</span>{clock.bpm.toFixed(0)}</span>
        <span class="readout"
          ><span class="rl">baseFreq</span>{clock.baseFreq.toFixed(2)} Hz/cps</span
        >
        <span class="readout"><span class="rl">t</span>{clock.displayTime.toFixed(3)} s</span>
        <span class="readout"
          ><span class="rl">audio</span>{audio.isInitialised ? 'on' : 'off'}</span
        >
        <span class="readout"
          ><span class="rl">capture</span>{captureStatus === 'ready'
            ? `${(latestCapture!.bytes / 1024).toFixed(0)} KB`
            : captureStatus}</span
        >
      </div>
    </div>
  </header>

  <section class="presets">
    {#each Object.keys(presets) as name (name)}
      <button class:active={activePreset === name} onclick={() => onPreset(name)}>
        {name}
      </button>
    {/each}
    {#if Object.keys(presets).length === 0}
      <span class="muted">presets loading…</span>
    {/if}
  </section>

  <section class="sources">
    <span class="sec-label">source</span>
    <button
      class:active={sourceKind === 'placeholder'}
      onclick={() => setSourceKind('placeholder')}
    >
      placeholder
    </button>
    <button
      class:active={sourceKind === 'video'}
      onclick={() => setSourceKind('video')}
      disabled={!sourceLoaded && sourceKind !== 'video'}
      title={sourceLoaded ? '' : 'load a video file first'}
    >
      video
    </button>
    {#each proceduralSources as name (name)}
      <button class:active={sourceKind === name} onclick={() => setSourceKind(name)}>
        {name}
      </button>
    {/each}
  </section>

  <section class="stage">
    <div class="canvas-wrap">
      {#if initError}
        <div class="error">init failed: {initError}</div>
      {/if}
      <canvas bind:this={canvasEl} width="1280" height="720"></canvas>
    </div>
    <Patch />
  </section>

  <section class="controls">
    <Slider spec={rateSpec} bind:value={clock.rate} />
    <Slider spec={bpmSpec} bind:value={clock.bpm} />
    {#if sourceParamRows.length > 0}
      <hr />
      {#each sourceParamRows as row (sourceInstance!.id + '/' + row.paramId)}
        <Slider
          spec={{
            ...row.instance.def.coupling.params[row.paramId]!.spec,
            label: row.label,
          }}
          bind:value={row.instance.params[row.paramId] as number}
        />
      {/each}
    {/if}
    <hr />
    {#each paramRows as row (row.instanceId + '/' + row.paramId)}
      <Slider
        spec={{
          ...row.instance.def.coupling.params[row.paramId]!.spec,
          label: row.label,
        }}
        bind:value={row.instance.params[row.paramId] as number}
      />
    {/each}
    {#if paramRows.length === 0}
      <span class="muted">no operators registered — check ops/index.ts</span>
    {/if}
  </section>

  <footer>
    <span class="status"
      >M3.4 · first color family landed · AudioWorklet DSP upgraded for scale/pixelate/modulate</span
    >
  </footer>
</main>

<style>
  .shell {
    display: grid;
    grid-template-rows: auto auto auto 1fr auto auto;
    min-height: 100vh;
    color: var(--fg);
    background: var(--bg);
    font-family: var(--font-mono);
  }

  .presets,
  .sources {
    display: flex;
    gap: 0.4rem;
    padding: 0.5rem 1.5rem;
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

  .presets button,
  .sources button {
    background: var(--bg);
    color: var(--fg);
    border: 1px solid var(--line);
    padding: 0.25rem 0.6rem;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    letter-spacing: 0.04em;
  }

  .presets button:hover,
  .sources button:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .presets button.active,
  .sources button.active {
    border-color: var(--accent);
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, var(--bg));
  }

  .sources button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
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

  .transport {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .transport button,
  .transport .file {
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

  .transport button:hover,
  .transport .file:hover {
    background: color-mix(in srgb, var(--accent) 12%, var(--bg));
  }

  .transport .file input {
    display: none;
  }

  .readouts {
    display: flex;
    gap: 1rem;
    font-size: 0.75rem;
    color: var(--fg);
    flex-wrap: wrap;
  }

  .readout {
    display: inline-flex;
    align-items: baseline;
    gap: 0.35rem;
    font-variant-numeric: tabular-nums;
  }

  .readout .rl {
    color: var(--muted);
    text-transform: uppercase;
    font-size: 0.65rem;
    letter-spacing: 0.06em;
  }

  .stage {
    display: grid;
    grid-template-columns: 1fr auto;
    min-height: 0;
  }

  .canvas-wrap {
    padding: 1.5rem;
    display: grid;
    place-items: center;
    position: relative;
  }

  canvas {
    width: 100%;
    max-width: 1280px;
    aspect-ratio: 16 / 9;
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

  .controls {
    border-top: 1px solid var(--line);
    padding: 0.75rem 1.5rem;
    display: grid;
    gap: 0.25rem;
  }

  .controls hr {
    border: none;
    border-top: 1px solid var(--line);
    margin: 0.4rem 0;
  }

  .muted {
    color: var(--muted);
    font-size: 0.75rem;
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
