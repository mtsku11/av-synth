<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { clock } from './core/clock.svelte';
  import { audio } from './audio/engine';
  import { VideoRenderer } from './video/renderer';
  import type { ParamSpec } from './core/params';
  import Slider from './ui/Slider.svelte';
  import Knob from './ui/Knob.svelte';
  import Patch from './ui/Patch.svelte';

  let canvasEl: HTMLCanvasElement | undefined = $state();
  let renderer: VideoRenderer | null = null;
  let initError = $state<string | null>(null);

  // Demo params, just to prove the controls bind correctly. Removed in M2.
  const feedbackSpec: ParamSpec = {
    id: 'feedback',
    label: 'feedback',
    range: [0, 0.95],
    default: 0.85,
    curve: 'lin',
    unit: 'norm',
  };
  const rateSpec: ParamSpec = {
    id: 'rate',
    label: 'rate',
    range: [0.05, 8],
    default: 0.3,
    curve: 'log',
    unit: 'hz',
  };
  const bpmSpec: ParamSpec = {
    id: 'bpm',
    label: 'bpm',
    range: [40, 220],
    default: 120,
    curve: 'lin',
    unit: 'norm',
  };

  let feedback = $state(feedbackSpec.default);
  let rate = $state(rateSpec.default);
  // Two-way bind bpm directly to the clock store.
  // (Svelte's bindable accepts a getter-via-prop pattern; we use a derived UI value.)

  onMount(() => {
    if (!canvasEl) return;
    try {
      renderer = new VideoRenderer(canvasEl);
      renderer.start();
    } catch (e) {
      initError = e instanceof Error ? e.message : String(e);
    }
  });

  onDestroy(() => {
    renderer?.dispose();
    renderer = null;
  });

  async function onStart() {
    audio.init(); // must be in a user-gesture handler
    await clock.start();
  }

  async function onStop() {
    await clock.stop();
  }
</script>

<main class="shell">
  <header class="topbar">
    <div class="brand">
      <h1>av-synth</h1>
      <span class="boot">M1 architectural skeleton</span>
    </div>
    <div class="transport">
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

  <section class="stage">
    <div class="canvas-wrap">
      {#if initError}
        <div class="error">video init failed: {initError}</div>
      {/if}
      <canvas bind:this={canvasEl} width="1280" height="720"></canvas>
    </div>
    <Patch />
  </section>

  <section class="controls">
    <div class="row">
      <Slider spec={feedbackSpec} bind:value={feedback} />
      <Slider spec={rateSpec} bind:value={rate} />
    </div>
    <div class="row knobs">
      <Knob spec={feedbackSpec} bind:value={feedback} />
      <Knob spec={rateSpec} bind:value={rate} />
      <Knob spec={bpmSpec} value={clock.bpm} />
    </div>
  </section>

  <footer>
    <span class="status">M1 · skeleton ready · operators land in M2</span>
  </footer>
</main>

<style>
  .shell {
    display: grid;
    grid-template-rows: auto 1fr auto auto;
    min-height: 100vh;
    color: var(--fg);
    background: var(--bg);
    font-family: var(--font-mono);
  }

  .topbar {
    padding: 0.75rem 1.5rem;
    border-bottom: 1px solid var(--line);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.5rem;
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
  }

  .transport button {
    background: var(--bg);
    color: var(--accent);
    border: 1px solid var(--accent);
    padding: 0.35rem 0.9rem;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 0.8rem;
    letter-spacing: 0.05em;
  }

  .transport button:hover {
    background: color-mix(in srgb, var(--accent) 12%, var(--bg));
  }

  .readouts {
    display: flex;
    gap: 1rem;
    font-size: 0.75rem;
    color: var(--fg);
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
    gap: 1rem;
  }

  .row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
    gap: 1.5rem;
    align-items: center;
  }

  .row.knobs {
    grid-template-columns: repeat(auto-fit, minmax(6rem, max-content));
    gap: 2rem;
    justify-content: start;
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
