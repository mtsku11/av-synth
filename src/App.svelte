<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { clock } from './core/clock.svelte';
  import { audio } from './audio/engine';
  import { VideoRenderer } from './video/renderer';
  import { VideoElementSource } from './video/sources';
  import { VideoElementAudioSource } from './audio/sources';
  import { createInstance, type OperatorInstance } from './core/operators';
  import { DEFAULT_CHAIN } from './ops';
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

  onMount(async () => {
    if (!canvasEl) return;
    try {
      renderer = new VideoRenderer(canvasEl, couplingCtx);
      instances = DEFAULT_CHAIN.map((op) => createInstance(op, renderer!.gl));
      renderer.setInstances(instances);
      renderer.start();
    } catch (e) {
      initError = e instanceof Error ? e.message : String(e);
      return;
    }
    try {
      presets = await loadPresets();
    } catch (e) {
      initError = e instanceof Error ? e.message : String(e);
    }
  });

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
    renderer?.dispose();
    renderer = null;
  });

  async function onStart() {
    audio.init();
    audio.setInstances(instances);
    await clock.start();
  }

  async function onStop() {
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
    renderer.setSource(new VideoElementSource(renderer.gl, videoEl));
    sourceLoaded = true;

    if (audio.isInitialised) {
      try {
        const audioSrc = new VideoElementAudioSource(audio.ctx, videoEl);
        audio.setSource(audioSrc);
      } catch (e) {
        // MediaElementAudioSource can only be created once per element; if the
        // user loads a second file we'd need to recreate the element. M5 work.
        initError = e instanceof Error ? e.message : String(e);
      }
    }
  }
</script>

<video bind:this={videoEl} style="display:none" playsinline></video>

<main class="shell">
  <header class="topbar">
    <div class="brand">
      <h1>av-synth</h1>
      <span class="boot">M2 · {instances.length} ops · source: {sourceLoaded ? 'video' : 'placeholder'}</span>
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
      <div class="readouts">
        <span class="readout"><span class="rl">bpm</span>{clock.bpm.toFixed(0)}</span>
        <span class="readout"><span class="rl">baseFreq</span>{clock.baseFreq.toFixed(2)} Hz/cps</span>
        <span class="readout"><span class="rl">t</span>{clock.displayTime.toFixed(3)} s</span>
        <span class="readout"><span class="rl">audio</span>{audio.isInitialised ? 'on' : 'off'}</span>
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
    <span class="status">M2 · all 7 prototype operators ported · presets and audio worklets next</span>
  </footer>
</main>

<style>
  .shell {
    display: grid;
    grid-template-rows: auto auto 1fr auto auto;
    min-height: 100vh;
    color: var(--fg);
    background: var(--bg);
    font-family: var(--font-mono);
  }

  .presets {
    display: flex;
    gap: 0.4rem;
    padding: 0.5rem 1.5rem;
    border-bottom: 1px solid var(--line);
    flex-wrap: wrap;
  }

  .presets button {
    background: var(--bg);
    color: var(--fg);
    border: 1px solid var(--line);
    padding: 0.25rem 0.6rem;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    letter-spacing: 0.04em;
  }

  .presets button:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .presets button.active {
    border-color: var(--accent);
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, var(--bg));
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
