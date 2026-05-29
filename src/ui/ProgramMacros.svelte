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
  <span class="sec-label">── macros ──</span>
  <div class="macro-grid">
    {#each macros as macro (macro.id)}
      <div class="macro" data-qa={`program-macro-${macro.id}`}>
        <Knob
          spec={macroSpec(macro)}
          value={values[macro.id] ?? macro.default}
          size={48}
          onValueChange={(v) => onSetValue(macro.id, v)}
        />
      </div>
    {/each}
  </div>
</section>

<style>
  .program-macros {
    display: grid;
    gap: 0.4rem;
    border-top: 1px solid var(--line);
    padding-top: 0.5rem;
  }

  .macro-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .macro {
    display: grid;
    justify-items: center;
  }
</style>
