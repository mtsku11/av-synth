<script lang="ts">
  import { onMount } from 'svelte';

  interface Props {
    poll: () => number | null;
    running?: boolean;
  }

  let { poll, running = true }: Props = $props();

  const MIN_DB = -60;
  const HOLD_MS = 1000;
  const SLEW_DB_PER_S = 12;
  const CLIP_LATCH_MS = 1000;

  let peakDb = $state(MIN_DB);
  let holdDb = $state(MIN_DB);
  let clipped = $state(false);

  let raf = 0;
  let lastTs = 0;
  let holdSetAt = 0;
  let clipSetAt = 0;

  function linToDb(lin: number): number {
    if (lin <= 0) return MIN_DB;
    const db = 20 * Math.log10(lin);
    return db < MIN_DB ? MIN_DB : db;
  }

  function dbToPct(db: number): number {
    const clamped = db < MIN_DB ? MIN_DB : db > 0 ? 0 : db;
    return ((clamped - MIN_DB) / -MIN_DB) * 100;
  }

  function tick(ts: number): void {
    const dt = lastTs ? (ts - lastTs) / 1000 : 0;
    lastTs = ts;

    const lin = poll();
    if (lin != null) {
      const db = linToDb(lin);
      peakDb = db;
      if (db >= holdDb) {
        holdDb = db;
        holdSetAt = ts;
      } else if (ts - holdSetAt > HOLD_MS) {
        holdDb = Math.max(db, holdDb - SLEW_DB_PER_S * dt);
      }
      if (lin >= 1.0) {
        clipped = true;
        clipSetAt = ts;
      } else if (clipped && ts - clipSetAt > CLIP_LATCH_MS) {
        clipped = false;
      }
    }

    raf = requestAnimationFrame(tick);
  }

  onMount(() => {
    if (running) raf = requestAnimationFrame(tick);
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  });

  function resetClip(): void {
    clipped = false;
  }

  const peakPct = $derived(dbToPct(peakDb));
  const holdPct = $derived(dbToPct(holdDb));
  const peakLabel = $derived(peakDb <= MIN_DB ? '−∞' : peakDb.toFixed(1));
</script>

<div class="master-meter" data-qa="master-meter">
  <div class="label">master</div>
  <div class="bar" role="meter" aria-valuemin={MIN_DB} aria-valuemax="0" aria-valuenow={peakDb}>
    <div class="fill" style="width: {peakPct}%"></div>
    <div class="hold" style="left: {holdPct}%"></div>
    <div class="tick" style="left: {dbToPct(-30)}%"></div>
    <div class="tick" style="left: {dbToPct(-20)}%"></div>
    <div class="tick" style="left: {dbToPct(-12)}%"></div>
    <div class="tick" style="left: {dbToPct(-6)}%"></div>
    <div class="tick" style="left: {dbToPct(-3)}%"></div>
  </div>
  <button
    type="button"
    class="clip"
    class:lit={clipped}
    aria-pressed={clipped}
    aria-label="clip indicator, click to reset"
    title="clip — click to reset"
    onclick={resetClip}
  >
    clip
  </button>
  <div class="value" aria-live="off">{peakLabel} dB</div>
</div>

<style>
  .master-meter {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    background: #111;
    border: 1px solid #222;
    border-radius: 4px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    color: #aaa;
  }
  .label {
    color: #666;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    flex: 0 0 auto;
  }
  .bar {
    position: relative;
    flex: 1 1 auto;
    height: 12px;
    background: #050505;
    border: 1px solid #222;
    border-radius: 2px;
    overflow: hidden;
  }
  .fill {
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
    background: linear-gradient(to right, #2a6 0%, #2a6 70%, #cc4 85%, #d62 95%, #e44 100%);
    background-size: 142.857% 100%; /* stretch gradient so colour anchors at -30/-9/-3/0 dBFS */
    background-position: left center;
    transition: width 40ms linear;
  }
  .hold {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: #eee;
    transform: translateX(-1px);
    opacity: 0.8;
    pointer-events: none;
  }
  .tick {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: rgba(255, 255, 255, 0.08);
    pointer-events: none;
  }
  .clip {
    flex: 0 0 auto;
    width: 36px;
    height: 18px;
    padding: 0;
    background: #1a0a0a;
    border: 1px solid #331;
    border-radius: 2px;
    color: #443;
    font: inherit;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    cursor: pointer;
  }
  .clip.lit {
    background: #c22;
    border-color: #e44;
    color: #fff;
  }
  .clip:focus-visible {
    outline: 1px solid #88aaff;
    outline-offset: 1px;
  }
  .value {
    flex: 0 0 auto;
    min-width: 56px;
    text-align: right;
    color: #ddd;
    font-variant-numeric: tabular-nums;
  }
</style>
