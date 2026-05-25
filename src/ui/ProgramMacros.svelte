<script lang="ts">
  import Knob from './Knob.svelte';
  import type { ParamSpec } from '../core/params';
  import type { ProgramMacroValues, VideoEffectProgramMacro } from '../core/presets';

  interface Props {
    macros: readonly VideoEffectProgramMacro[];
    values: ProgramMacroValues;
    onSetValue: (id: string, value: number) => void;
  }

  let { macros, values, onSetValue }: Props = $props();

  function macroSpec(macro: VideoEffectProgramMacro): ParamSpec {
    return {
      id: macro.id,
      label: macro.label,
      range: [0, 1],
      default: macro.default,
      curve: 'lin',
      unit: 'pct',
    };
  }
</script>

<section class="program-macros" data-qa="program-macros">
  <div class="macro-header">
    <span class="sec-label">── macros ──</span>
    <p>Program-level moves across video, granulator, and shared delay.</p>
  </div>
  <div class="macro-grid">
    {#each macros as macro (macro.id)}
      <div class="macro" data-qa={`program-macro-${macro.id}`}>
        <Knob spec={macroSpec(macro)} value={values[macro.id] ?? macro.default} size={62} />
        <input
          class="macro-hit"
          type="range"
          min="0"
          max="1"
          step="0.0001"
          value={values[macro.id] ?? macro.default}
          aria-label={macro.label}
          oninput={(event) =>
            onSetValue(macro.id, Number((event.currentTarget as HTMLInputElement).value))}
        />
      </div>
    {/each}
  </div>
</section>

<style>
  .program-macros {
    display: grid;
    gap: 0.75rem;
    border-top: 1px solid var(--line);
    padding-top: 0.9rem;
  }

  .macro-header {
    display: grid;
    gap: 0.25rem;
  }

  .macro-header p {
    margin: 0;
    color: var(--muted);
    font-size: 0.75rem;
    line-height: 1.4;
  }

  .macro-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(5rem, 1fr));
    gap: 0.9rem;
  }

  .macro {
    display: grid;
    justify-items: center;
    gap: 0.4rem;
  }

  .macro-hit {
    width: 100%;
    -webkit-appearance: none;
    appearance: none;
    background: transparent;
    height: 1rem;
  }

  .macro-hit::-webkit-slider-runnable-track {
    height: 2px;
    background: var(--line);
  }

  .macro-hit::-moz-range-track {
    height: 2px;
    background: var(--line);
  }

  .macro-hit::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 0.65rem;
    height: 0.65rem;
    margin-top: -0.25rem;
    border: 0;
    border-radius: 999px;
    background: var(--accent);
    cursor: ew-resize;
  }

  .macro-hit::-moz-range-thumb {
    width: 0.65rem;
    height: 0.65rem;
    border: 0;
    border-radius: 999px;
    background: var(--accent);
    cursor: ew-resize;
  }
</style>
