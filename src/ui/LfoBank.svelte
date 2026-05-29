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
  <div class="bank-head">
    <div>
      <span class="eyebrow">mod bank</span>
      <strong>6 global lfos</strong>
    </div>
    <span class="meta">map any operator or engine parameter to one shared motion source</span>
  </div>

  <div class="bank-list">
    {#each bank as lfo, index (lfo.id)}
      <article class="lfo-row">
        <div class="lfo-copy">
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
              <option value={waveform}>{waveform}</option>
            {/each}
          </select>
        </div>
        <div class="lfo-controls">
          <Knob
            spec={rateSpec}
            value={lfo.rate}
            size={44}
            onValueChange={(value) => onSetRate?.(index, value)}
          />
          <Knob
            spec={amountSpec}
            value={lfo.amount}
            size={44}
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
    gap: 0.75rem;
    padding: 0.85rem 1rem;
    border: 1px solid var(--line);
    background: color-mix(in oklab, var(--bg) 92%, black 8%);
  }

  .bank-head {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: end;
  }

  .bank-head strong,
  .lfo-copy select {
    font-family: var(--font-mono);
  }

  .bank-list {
    display: grid;
    gap: 0.6rem;
  }

  .lfo-row {
    display: grid;
    grid-template-columns: 9rem auto;
    gap: 1rem;
    padding-top: 0.5rem;
    border-top: 1px solid color-mix(in oklab, var(--line) 72%, transparent);
  }

  .lfo-row:first-child {
    padding-top: 0;
    border-top: none;
  }

  .lfo-copy {
    display: grid;
    gap: 0.35rem;
    align-content: start;
  }

  .lfo-copy select {
    min-width: 0;
  }

  .lfo-controls {
    display: flex;
    gap: 0.6rem;
    align-items: flex-start;
  }

  .eyebrow,
  .meta {
    color: var(--muted);
    font-size: 0.72rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .meta {
    text-transform: none;
    letter-spacing: 0.02em;
  }

  @media (max-width: 900px) {
    .bank-head,
    .lfo-row {
      grid-template-columns: 1fr;
    }
  }
</style>
