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

  function onInput(e: Event) {
    const c = Number((e.currentTarget as HTMLInputElement).value);
    value = mapToCurve(c, spec.range, spec.curve);
    onValueChange?.(value);
  }
</script>

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
</style>
