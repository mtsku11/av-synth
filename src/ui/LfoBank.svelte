<script lang="ts">
  import type { GlobalLfo, GlobalLfoWaveform } from '../core/mod-bank';
  import type { ParamSpec } from '../core/params';
  import Knob from './Knob.svelte';

  interface Props {
    bank: readonly GlobalLfo[];
    onSetWaveform?: (index: number, waveform: GlobalLfoWaveform) => void;
    onSetRate?: (index: number, value: number) => void;
    onSetAmount?: (index: number, value: number) => void;
  }

  let { bank, onSetWaveform, onSetRate, onSetAmount }: Props = $props();

  const waveformOptions: readonly GlobalLfoWaveform[] = [
    'sine',
    'triangle',
    'saw',
    'ramp',
    'square',
    'sample-hold',
  ];

  function waveLabel(w: GlobalLfoWaveform): string {
    return w === 'sample-hold' ? 's&h' : w;
  }

  const rateSpec: ParamSpec = {
    id: 'rate',
    label: 'rate',
    range: [0.02, 4],
    default: 0.3,
    curve: 'exp',
    unit: 'hz',
    hint: 'global modulation speed',
  };

  const amountSpec: ParamSpec = {
    id: 'amount',
    label: 'depth',
    range: [0, 1],
    default: 0.2,
    curve: 'lin',
    unit: 'pct',
    hint: 'how much of each mapped parameter range this lfo travels',
  };
</script>

<section class="lfo-bank">
  <span class="bank-label">mod bank · 6 lfos</span>
  <div class="bank-list">
    {#each bank as lfo, index (lfo.id)}
      <article class="lfo-row">
        <span class="eyebrow">{lfo.label}</span>
        <select
          value={lfo.waveform}
          onchange={(event) =>
            onSetWaveform?.(
              index,
              (event.currentTarget as HTMLSelectElement).value as GlobalLfoWaveform,
            )}
        >
          {#each waveformOptions as waveform (waveform)}
            <option value={waveform}>{waveLabel(waveform)}</option>
          {/each}
        </select>
        <div class="lfo-controls">
          <Knob
            spec={rateSpec}
            value={lfo.rate}
            size={32}
            onValueChange={(value) => onSetRate?.(index, value)}
          />
          <Knob
            spec={amountSpec}
            value={lfo.amount}
            size={32}
            onValueChange={(value) => onSetAmount?.(index, value)}
          />
        </div>
      </article>
    {/each}
  </div>
</section>

<style>
  .lfo-bank {
    display: grid;
    gap: 0.3rem;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--line);
    background: color-mix(in oklab, var(--bg) 92%, black 8%);
  }

  .bank-label {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }

  .bank-list {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.25rem;
  }

  .lfo-row {
    display: grid;
    gap: 0.2rem;
    padding: 0.2rem 0.15rem;
    border-top: 1px solid color-mix(in oklab, var(--line) 40%, transparent);
  }

  .lfo-row:nth-child(-n+3) {
    border-top: none;
    padding-top: 0;
  }

  .lfo-row select {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    width: 100%;
    min-width: 0;
    background: var(--bg);
    color: var(--fg);
    border: 1px solid var(--line);
    padding: 1px 2px;
  }

  .lfo-controls {
    display: flex;
    gap: 0.4rem;
    justify-content: center;
    align-items: flex-start;
  }

  .eyebrow {
    color: var(--muted);
    font-size: 0.58rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    font-family: var(--font-mono);
  }
</style>
