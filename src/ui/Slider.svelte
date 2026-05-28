<script lang="ts">
  import type { ParamSpec } from '../core/params';
  import { formatValue } from '../core/params';
  import { mapToCurve, mapFromCurve } from '../lib/math';

  interface Props {
    spec: ParamSpec;
    value: number;
    onValueChange?: (value: number) => void;
  }

  let { spec, value = $bindable(), onValueChange }: Props = $props();

  const c01 = $derived(mapFromCurve(value, spec.range, spec.curve));
  const isChoice = $derived(!!spec.choices && spec.choices.length > 0);
  const activeChoiceValue = $derived.by(() => {
    const choices = spec.choices;
    if (!choices || choices.length === 0) return null;
    let nearest = choices[0]!.value;
    let bestDelta = Math.abs(value - nearest);
    for (const choice of choices) {
      const delta = Math.abs(value - choice.value);
      if (delta < bestDelta) {
        bestDelta = delta;
        nearest = choice.value;
      }
    }
    return nearest;
  });

  function onInput(e: Event) {
    const c = Number((e.currentTarget as HTMLInputElement).value);
    value = mapToCurve(c, spec.range, spec.curve);
    onValueChange?.(value);
  }

  function pickChoice(next: number) {
    value = next;
    onValueChange?.(next);
  }
</script>

{#if isChoice}
  <div class="slider choice" role="group" aria-label={spec.label}>
    <span class="label">{spec.label}</span>
    <div class="segments">
      {#each spec.choices ?? [] as choice (choice.value)}
        <button
          type="button"
          class="segment"
          class:active={activeChoiceValue === choice.value}
          aria-pressed={activeChoiceValue === choice.value}
          onclick={() => pickChoice(choice.value)}
        >
          {choice.label}
        </button>
      {/each}
    </div>
    <span class="value" aria-live="polite">{formatValue(spec, value)}</span>
  </div>
{:else}
  <label class="slider">
    <span class="label">{spec.label}</span>
    <input
      type="range"
      min="0"
      max="1"
      step="0.0001"
      value={c01}
      oninput={onInput}
      aria-label={spec.label}
    />
    <span class="value" aria-live="polite">{formatValue(spec, value)}</span>
  </label>
{/if}

<style>
  .slider {
    display: grid;
    grid-template-columns: 7rem 1fr 5rem;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0;
    font-family: var(--font-mono);
    font-size: 0.8rem;
  }

  .label {
    color: var(--fg);
    letter-spacing: 0.04em;
  }

  .value {
    color: var(--accent);
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  input[type='range'] {
    -webkit-appearance: none;
    appearance: none;
    background: transparent;
    width: 100%;
    height: 1.5rem;
  }

  input[type='range']::-webkit-slider-runnable-track {
    height: 2px;
    background: var(--line);
  }

  input[type='range']::-moz-range-track {
    height: 2px;
    background: var(--line);
  }

  input[type='range']::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 0.75rem;
    height: 1rem;
    background: var(--accent);
    border: none;
    border-radius: 1px;
    margin-top: -0.5rem;
    cursor: ew-resize;
  }

  input[type='range']::-moz-range-thumb {
    width: 0.75rem;
    height: 1rem;
    background: var(--accent);
    border: none;
    border-radius: 1px;
    cursor: ew-resize;
  }

  .segments {
    display: flex;
    gap: 0.125rem;
    border: 1px solid var(--line);
    border-radius: 2px;
    overflow: hidden;
  }

  .segment {
    flex: 1;
    padding: 0.2rem 0.4rem;
    background: transparent;
    color: var(--fg);
    border: none;
    border-right: 1px solid var(--line);
    font-family: var(--font-mono);
    font-size: 0.75rem;
    letter-spacing: 0.04em;
    cursor: pointer;
  }

  .segment:last-child {
    border-right: none;
  }

  .segment.active {
    background: var(--accent);
    color: var(--bg);
  }

  .segment:hover:not(.active) {
    background: var(--line);
  }
</style>
