<script lang="ts">
  import {
    buildAudioRackControls,
    buildAudioRackModulationViews,
    listAudioRackModulationSources,
    listAudioRackModulationTargetViews,
    listAudioRackFamilies,
    listAudioRackOptionsForFamily,
    type AudioRackFamily,
    type AudioRackInstance,
  } from '../core/audio-rack';
  import { listGlobalLfoOptions, type GlobalLfo } from '../core/mod-bank';
  import type { ParamSpec } from '../core/params';
  import Slider from './Slider.svelte';

  interface Props {
    instances: AudioRackInstance[];
    lfoBank: readonly GlobalLfo[];
    onAddEngine?: (engineId: string) => void;
    onAddModulation?: (id: string) => void;
    onMove?: (id: string, direction: -1 | 1) => void;
    onRemove?: (id: string) => void;
    onRemoveModulation?: (id: string, modulationId: string) => void;
    onSetParam?: (id: string, paramId: string, value: number) => void;
    onSetParamLfo?: (id: string, paramId: string, lfoIndex: number | null) => void;
    onSetModulationAmount?: (id: string, modulationId: string, value: number) => void;
    onSetModulationSource?: (
      id: string,
      modulationId: string,
      source: 'v.luma' | 'v.flux' | 'v.edge',
    ) => void;
    onSetModulationTarget?: (id: string, modulationId: string, target: string) => void;
  }

  let {
    instances,
    lfoBank,
    onAddEngine,
    onAddModulation,
    onMove,
    onRemove,
    onRemoveModulation,
    onSetParam,
    onSetParamLfo,
    onSetModulationAmount,
    onSetModulationSource,
    onSetModulationTarget,
  }: Props = $props();

  const familyOrder = listAudioRackFamilies();
  const lfoOptions = $derived(listGlobalLfoOptions(lfoBank));
  const modulationSources = listAudioRackModulationSources();
  const modulationAmountSpec: ParamSpec = {
    id: 'amount',
    label: 'depth',
    range: [-1, 1],
    default: 0.2,
    curve: 'lin',
    unit: 'norm',
    hint: 'signed modulation depth from the selected video feature',
  };
  let familySelections = $state<Record<AudioRackFamily, string>>({
    Granular: '',
    'FM/PM': '',
    'Fold/Saturate': '',
    'Delay/Freeze': '',
    'Filter/Tone': '',
    'Dynamics/Spatial': '',
  });
  let advancedOpen = $state<Record<string, boolean>>({});

  function handleFamilySelection(family: AudioRackFamily, value: string) {
    const nextSelections = { ...familySelections, [family]: value };
    familySelections = nextSelections;
    if (!value) return;
    onAddEngine?.(value);
    familySelections = { ...nextSelections, [family]: '' };
  }

  function setAdvancedOpen(id: string, open: boolean) {
    advancedOpen = { ...advancedOpen, [id]: open };
  }

  function getControlSections(instance: AudioRackInstance) {
    const controls = buildAudioRackControls(instance);
    const coreIds = new Set(instance.def.coreParams);
    const primary =
      instance.def.coreParams.length > 0
        ? controls.filter((control) => coreIds.has(control.id))
        : controls.slice(0, Math.min(4, controls.length));
    const fallbackPrimary =
      primary.length > 0 ? primary : controls.slice(0, Math.min(4, controls.length));
    const primaryIds = new Set(fallbackPrimary.map((control) => control.id));
    const secondary = controls.filter((control) => !primaryIds.has(control.id));
    return { primary: fallbackPrimary, secondary };
  }
</script>

<aside class="audio-rack">
  <header>
    <div>
      <h2>audio rack</h2>
      <p class="subhead">add dedicated engines here; when active, the rack becomes the public audio path</p>
    </div>
    <span class="counts">{instances.length} engines</span>
  </header>

  <div class="rack">
    <div class="family-picker-row">
      {#each familyOrder as family (family)}
        {@const options = listAudioRackOptionsForFamily(family)}
        <select
          class="family-select"
          value={familySelections[family] ?? ''}
          onchange={(event) =>
            handleFamilySelection(family, (event.currentTarget as HTMLSelectElement).value)}
        >
          <option value="">{family.toLowerCase()}</option>
          {#each options as option (option.id || option.label)}
            <option value={option.id} disabled={!option.enabled}>{option.label}</option>
          {/each}
        </select>
      {/each}
    </div>

    {#if instances.length === 0}
      <div class="empty-state">
        <strong>Start with one engine.</strong>
        <p>Granular, FM/PM, fold, filter, freeze, and spatial shaping all live here now.</p>
      </div>
    {:else}
      <div class="engine-list">
        {#each instances as instance, index (instance.id)}
          {@const controls = getControlSections(instance)}
          <article class="node-card">
            <div class="node-head">
              <div class="node-copy">
                <span class="eyebrow">engine {index + 1} · {instance.def.family}</span>
                <h3>{instance.def.label}</h3>
                <p class="meta node-blurb">{instance.def.blurb}</p>
              </div>
              <span class="pill active-pill">live</span>
            </div>

            <div class="signal-flow">
              <span>{index === 0 ? 'source audio' : (instances[index - 1]?.def.label ?? 'source')}</span>
              <span class="arrow">→</span>
              <span>{instance.def.label}</span>
            </div>

            <div class="slider-stack">
              {#each controls.primary as control (control.id)}
                <div class="mod-control">
                  <Slider
                    spec={control.spec}
                    value={control.value}
                    onValueChange={(value) => onSetParam?.(instance.id, control.id, value)}
                  />
                  <label class="mod-select">
                    <span>mod</span>
                    <select
                      value={control.lfo.lfoIndex === null ? '' : String(control.lfo.lfoIndex)}
                      onchange={(event) =>
                        onSetParamLfo?.(
                          instance.id,
                          control.id,
                          (event.currentTarget as HTMLSelectElement).value === ''
                            ? null
                            : Number((event.currentTarget as HTMLSelectElement).value),
                        )}
                    >
                      {#each lfoOptions as option (option.id)}
                        <option value={option.value}>{option.label}</option>
                      {/each}
                    </select>
                  </label>
                </div>
              {/each}
            </div>

            <details class="advanced modulation-panel">
              <summary>reactive routes · {instance.modulations.length}</summary>
              <div class="modulation-copy">
                <span>route `v.luma`, `v.flux`, or `v.edge` into this engine without reopening debug monitors</span>
                <button class="add-route" onclick={() => onAddModulation?.(instance.id)}>add route</button>
              </div>
              {#if instance.modulations.length === 0}
                <p class="modulation-empty">Start with `v.flux` into density, feedback, duck, or spread.</p>
              {:else}
                {@const targetViews = listAudioRackModulationTargetViews(instance)}
                <div class="modulation-list">
                  {#each buildAudioRackModulationViews(instance) as modulation (modulation.id)}
                    <div class="modulation-row">
                      <div class="modulation-selects">
                        <label>
                          <span class="eyebrow">source</span>
                          <select
                            value={modulation.source}
                            onchange={(event) =>
                              onSetModulationSource?.(
                                instance.id,
                                modulation.id,
                                (event.currentTarget as HTMLSelectElement).value as
                                  | 'v.luma'
                                  | 'v.flux'
                                  | 'v.edge',
                              )}
                          >
                            {#each modulationSources as source (source)}
                              <option value={source}>{source}</option>
                            {/each}
                          </select>
                        </label>
                        <label>
                          <span class="eyebrow">target</span>
                          <select
                            value={modulation.target}
                            onchange={(event) =>
                              onSetModulationTarget?.(
                                instance.id,
                                modulation.id,
                                (event.currentTarget as HTMLSelectElement).value,
                              )}
                          >
                            {#each targetViews as targetView (targetView.id)}
                              <option value={targetView.id}>{targetView.label}</option>
                            {/each}
                          </select>
                        </label>
                      </div>
                      <Slider
                        spec={modulationAmountSpec}
                        value={modulation.amount}
                        onValueChange={(value) =>
                          onSetModulationAmount?.(instance.id, modulation.id, value)}
                      />
                      <div class="modulation-actions">
                        <button class="danger" onclick={() => onRemoveModulation?.(instance.id, modulation.id)}>
                          remove route
                        </button>
                      </div>
                    </div>
                  {/each}
                </div>
              {/if}
            </details>

            {#if controls.secondary.length > 0}
              <details
                class="advanced"
                open={advancedOpen[instance.id] ?? false}
                ontoggle={(event) =>
                  setAdvancedOpen(instance.id, (event.currentTarget as HTMLDetailsElement).open)}
              >
                <summary>advanced · {controls.secondary.length} more controls</summary>
                <div class="slider-stack advanced-stack">
                  {#each controls.secondary as control (control.id)}
                    <div class="mod-control">
                      <Slider
                        spec={control.spec}
                        value={control.value}
                        onValueChange={(value) => onSetParam?.(instance.id, control.id, value)}
                      />
                      <label class="mod-select">
                        <span>mod</span>
                        <select
                          value={control.lfo.lfoIndex === null ? '' : String(control.lfo.lfoIndex)}
                          onchange={(event) =>
                            onSetParamLfo?.(
                              instance.id,
                              control.id,
                              (event.currentTarget as HTMLSelectElement).value === ''
                                ? null
                                : Number((event.currentTarget as HTMLSelectElement).value),
                            )}
                        >
                          {#each lfoOptions as option (option.id)}
                            <option value={option.value}>{option.label}</option>
                          {/each}
                        </select>
                      </label>
                    </div>
                  {/each}
                </div>
              </details>
            {/if}

            <div class="actions">
              <button
                onclick={() => onMove?.(instance.id, -1)}
                disabled={index === 0}
                aria-label={`Move ${instance.def.label} earlier in the rack`}
              >
                move up
              </button>
              <button
                onclick={() => onMove?.(instance.id, 1)}
                disabled={index === instances.length - 1}
                aria-label={`Move ${instance.def.label} later in the rack`}
              >
                move down
              </button>
              <button class="danger" onclick={() => onRemove?.(instance.id)}>remove</button>
            </div>
          </article>
        {/each}
      </div>
    {/if}
  </div>
</aside>

<style>
  .audio-rack {
    display: grid;
    grid-template-rows: auto 1fr;
    min-width: 0;
    min-height: 100%;
  }

  header {
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--line);
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
  }

  h2,
  h3,
  p {
    margin: 0;
  }

  h2 {
    font-size: 0.96rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  h3 {
    font-size: 0.96rem;
  }

  .counts,
  .subhead,
  .meta {
    color: var(--muted);
    font-size: 0.75rem;
    line-height: 1.45;
  }

  .eyebrow {
    color: var(--muted);
    font-size: 0.7rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .rack {
    display: grid;
    gap: 0.75rem;
    padding: 0 1rem 1rem;
    align-content: start;
    overflow: auto;
  }

  .node-card,
  .empty-state {
    border: 1px solid var(--line);
    background: color-mix(in srgb, var(--line) 6%, transparent);
    padding: 0.75rem;
  }

  .node-head,
  .node-copy {
    display: grid;
    gap: 0.18rem;
  }

  .engine-list,
  .slider-stack,
  .advanced-stack,
  .modulation-list {
    display: grid;
    gap: 0.55rem;
  }

  .family-picker-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    align-items: center;
  }

  .family-select {
    flex: 1 1 0;
    min-width: 6rem;
    background: var(--bg);
    color: var(--fg);
    border: 1px solid var(--line);
    padding: 0.35rem 0.5rem;
    font-size: 0.74rem;
    font-family: var(--font-mono);
  }

  .family-select:hover,
  .family-select:focus {
    border-color: var(--accent);
  }

  .node-blurb {
    font-size: 0.82rem;
    font-weight: 600;
    line-height: 1.45;
  }

  .mod-control {
    display: grid;
    gap: 0.15rem;
  }

  .mod-select {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 0.45rem;
    padding-left: 7rem;
    font-family: var(--font-mono);
    font-size: 0.68rem;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .mod-select select {
    min-width: 6.2rem;
    font-family: var(--font-mono);
    text-transform: lowercase;
  }

  select,
  button {
    background: var(--bg);
    color: var(--fg);
    border: 1px solid var(--line);
    padding: 0.45rem 0.55rem;
    font-family: var(--font-mono);
    font-size: 0.74rem;
  }

  select:hover,
  select:focus,
  button:hover,
  button:focus {
    border-color: var(--accent);
  }

  .pill {
    align-self: start;
    justify-self: end;
    border: 1px solid var(--line);
    padding: 0.18rem 0.4rem;
    font-size: 0.68rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .active-pill {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 45%, var(--line));
  }

  .signal-flow {
    display: flex;
    gap: 0.45rem;
    align-items: center;
    color: var(--muted);
    font-size: 0.72rem;
    margin: 0.45rem 0 0.7rem;
    flex-wrap: wrap;
  }

  .arrow {
    opacity: 0.7;
  }

  .advanced {
    border-top: 1px solid var(--line);
    margin-top: 0.4rem;
    padding-top: 0.45rem;
  }

  .advanced summary {
    cursor: pointer;
    color: var(--muted);
    font-size: 0.74rem;
  }

  .modulation-copy,
  .modulation-row,
  .modulation-actions {
    display: grid;
    gap: 0.55rem;
  }

  .modulation-copy {
    margin-top: 0.55rem;
    color: var(--muted);
    font-size: 0.74rem;
  }

  .modulation-selects {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.6rem;
  }

  .modulation-selects label {
    display: grid;
    gap: 0.2rem;
  }

  .modulation-empty {
    margin-top: 0.55rem;
    color: var(--muted);
    font-size: 0.74rem;
  }

  .add-route {
    justify-self: start;
  }

  .advanced summary::-webkit-details-marker {
    display: none;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.7rem;
  }

  .danger {
    color: #f08989;
  }

  @media (max-width: 700px) {
    header,
    .modulation-selects {
      grid-template-columns: 1fr;
    }
  }
</style>
