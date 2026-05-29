<script lang="ts">
  import { getOperatorUiMeta, listOperatorFamilies, type OperatorFamily } from '../core/operators';
  import { BUS_INDICES, SOURCE_NODE_ID, type BusIndex } from '../core/graph.svelte';
  import { listGlobalLfoOptions, type GlobalLfo } from '../core/mod-bank';
  import type { ParamSpec } from '../core/params';
  import type { GraphDiagnostic, PatchNodeView } from '../core/patch-graph';
  import Slider from './Slider.svelte';
  import Knob from './Knob.svelte';

  interface ControlView {
    id: string;
    spec: ParamSpec;
    value: number;
  }

  interface Props {
    nodes: PatchNodeView[];
    operatorOptions: readonly string[];
    lfoBank: readonly GlobalLfo[];
    sourceLabel: string;
    sourceControls: readonly ControlView[];
    diagnostics?: GraphDiagnostic[];
    onAddNode?: (op: string) => void;
    onMove?: (id: string, direction: -1 | 1) => void;
    onRemove?: (id: string) => void;
    onSetNodeModSource?: (id: string, paramId: string, encoded: string) => void;
    onSetNodeParam?: (id: string, paramId: string, value: number) => void;
    onSetNodeBus?: (id: string, bus: BusIndex) => void;
    onSetNodePrimaryInput?: (id: string, inputId: string | null) => void;
    onSetNodeSecondaryInput?: (id: string, inputId: string | null) => void;
    onSetSourceControl?: (id: string, value: number) => void;
  }

  let {
    nodes,
    operatorOptions,
    lfoBank,
    sourceLabel,
    sourceControls,
    diagnostics = [],
    onAddNode,
    onMove,
    onRemove,
    onSetNodeModSource,
    onSetNodeParam,
    onSetNodeBus,
    onSetNodePrimaryInput,
    onSetNodeSecondaryInput,
    onSetSourceControl,
  }: Props = $props();

  const activeCount = $derived(nodes.filter((node) => node.active).length);
  const lfoOptions = $derived(listGlobalLfoOptions(lfoBank));
  let familySelections = $state<Record<string, string>>({});
  const familyOrder = listOperatorFamilies();
  const operatorChoices = $derived(
    operatorOptions.map((op) => {
      const meta = getOperatorUiMeta(op);
      return { op, ...meta };
    }),
  );

  function getChoicesForFamily(family: OperatorFamily) {
    return operatorChoices.filter((choice) => choice.family === family);
  }

  function handleFamilySelection(family: OperatorFamily, value: string) {
    const nextSelections = { ...familySelections, [family]: value };
    familySelections = nextSelections;
    if (!value) return;
    onAddNode?.(value);
    familySelections = { ...nextSelections, [family]: '' };
  }

  function usesRouting(node: PatchNodeView): boolean {
    return node.inputArity > 1 || node.bus !== 0 || node.primaryInputId !== SOURCE_NODE_ID;
  }
</script>

<aside class="patch">
  <header>
    <div>
      <h2>chain</h2>
      <p class="subhead">add effects one by one and reorder them in series</p>
    </div>
    <span class="counts">{nodes.length} ops · {activeCount} active</span>
  </header>

  {#if diagnostics.length > 0}
    <div class="diagnostics">
      {#each diagnostics as diagnostic (diagnostic.message)}
        <p>{diagnostic.message}</p>
      {/each}
    </div>
  {/if}

  <div class="chain">
    <article class="stack-card source-card">
      <span class="eyebrow">input</span>
      <strong>{sourceLabel}</strong>
      {#if sourceControls.length > 0}
        <div class="slider-stack">
          {#each sourceControls as control (control.id)}
            <Slider
              spec={control.spec}
              value={control.value}
              onValueChange={(value) => onSetSourceControl?.(control.id, value)}
            />
          {/each}
        </div>
      {:else}
        <span class="meta">load a video to feed the chain</span>
      {/if}
    </article>

    {#if operatorOptions.length > 0}
      <div class="family-picker-row">
        {#each familyOrder as family (family)}
          {@const choices = getChoicesForFamily(family)}
          {#if choices.length > 0}
            <select
              class="family-select"
              value={familySelections[family] ?? ''}
              onchange={(event) =>
                handleFamilySelection(family, (event.currentTarget as HTMLSelectElement).value)}
            >
              <option value="">{family.toLowerCase()}</option>
              {#each choices as choice (choice.op)}
                <option value={choice.op}>{choice.op}</option>
              {/each}
            </select>
          {/if}
        {/each}
      </div>
    {/if}

    {#if nodes.length === 0}
      <div class="empty-state">
        <strong>Start with one operator.</strong>
        <p>Choose an effect from the menu above. The chain runs top to bottom, in order.</p>
      </div>
    {:else}
      <div class="node-list">
        {#each nodes as node (node.id)}
          {@const meta = getOperatorUiMeta(node.op)}
          <article class:inactive={!node.active} class="node-card">
            <div class="node-head">
              <div class="node-copy">
                <span class="eyebrow">step {node.order + 1} · {meta.family}</span>
                <h3>{node.op}</h3>
                <p class="meta node-blurb">{meta.blurb}</p>
              </div>
              <span class:active-pill={node.status === 'live'} class="pill">{node.status}</span>
            </div>

            <div class="signal-flow">
              <span>{node.order === 0 ? sourceLabel : (nodes[node.order - 1]?.op ?? 'source')}</span
              >
              <span class="arrow">→</span>
              <span>{node.op}</span>
            </div>

            <div class="knob-grid">
              {#each node.params as param (param.id)}
                {#if param.spec.choices}
                  <div class="mod-control slider-mode">
                    <Slider
                      spec={{ ...param.spec, label: param.label }}
                      value={param.value}
                      onValueChange={(value) => onSetNodeParam?.(node.id, param.id, value)}
                    />
                  </div>
                {:else}
                  <div class="knob-control">
                    <Knob
                      spec={{ ...param.spec, label: param.label }}
                      value={param.value}
                      size={44}
                      onValueChange={(value) => onSetNodeParam?.(node.id, param.id, value)}
                    />
                    <select
                      class="knob-mod"
                      value={param.lfo.videoFeature !== null
                        ? `v:${param.lfo.videoFeature}`
                        : param.lfo.lfoIndex === null
                          ? ''
                          : String(param.lfo.lfoIndex)}
                      onchange={(event) =>
                        onSetNodeModSource?.(
                          node.id,
                          param.id,
                          (event.currentTarget as HTMLSelectElement).value,
                        )}
                    >
                      {#each lfoOptions as option (option.id)}
                        <option value={option.value}>{option.label}</option>
                      {/each}
                    </select>
                  </div>
                {/if}
              {/each}
            </div>

            {#if usesRouting(node)}
              <div class="routing-panel">
                <div class="routing-grid">
                  <label class="routing-field">
                    <span>output bus</span>
                    <select
                      value={String(node.bus)}
                      onchange={(event) =>
                        onSetNodeBus?.(
                          node.id,
                          Number((event.currentTarget as HTMLSelectElement).value) as BusIndex,
                        )}
                    >
                      {#each BUS_INDICES as bus (bus)}
                        <option value={bus}>o{bus}</option>
                      {/each}
                    </select>
                  </label>

                  <label class="routing-field">
                    <span>primary input</span>
                    <select
                      value={node.primaryInputId}
                      onchange={(event) =>
                        onSetNodePrimaryInput?.(
                          node.id,
                          (event.currentTarget as HTMLSelectElement).value,
                        )}
                    >
                      {#each node.primaryInputOptions as option (option.id)}
                        <option value={option.id}>{option.label}</option>
                      {/each}
                    </select>
                  </label>

                  {#if node.inputArity > 1}
                    <label class="routing-field">
                      <span>secondary input</span>
                      <select
                        value={node.secondaryInputId}
                        onchange={(event) =>
                          onSetNodeSecondaryInput?.(
                            node.id,
                            (event.currentTarget as HTMLSelectElement).value,
                          )}
                      >
                        {#each node.secondaryInputOptions as option (option.id)}
                          <option value={option.id}>{option.label}</option>
                        {/each}
                      </select>
                    </label>
                  {/if}
                </div>
              </div>
            {/if}

            {#if node.summary.length === 0}
              <p class="muted">identity defaults</p>
            {/if}

            {#if node.warnings.length > 0}
              <div class="node-warnings">
                {#each node.warnings as warning (warning)}
                  <p>{warning}</p>
                {/each}
              </div>
            {/if}

            <div class="actions">
              <button
                onclick={() => onMove?.(node.id, -1)}
                disabled={node.order === 0}
                aria-label={`Move ${node.op} earlier in the chain`}
              >
                move up
              </button>
              <button
                onclick={() => onMove?.(node.id, 1)}
                disabled={node.order === nodes.length - 1}
                aria-label={`Move ${node.op} later in the chain`}
              >
                move down
              </button>
              <button class="danger" onclick={() => onRemove?.(node.id)}>remove</button>
            </div>
          </article>
        {/each}
      </div>
    {/if}
  </div>
</aside>

<style>
  .patch {
    display: grid;
    grid-template-rows: auto auto 1fr;
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
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--accent);
    font-family: var(--font-mono);
  }

  h3 {
    font-size: 0.95rem;
    font-weight: 600;
    text-transform: lowercase;
  }

  .subhead,
  .counts,
  .meta,
  .eyebrow,
  .muted,
  .actions button {
    font-family: var(--font-mono);
  }

  .subhead,
  .counts,
  .muted,
  .meta {
    color: var(--muted);
    font-size: 0.72rem;
  }

  .diagnostics {
    padding: 0.65rem 1rem;
    border-bottom: 1px solid var(--line);
    background: color-mix(in srgb, var(--accent) 5%, transparent);
    display: grid;
    gap: 0.35rem;
  }

  .diagnostics p {
    font-size: 0.72rem;
    color: var(--muted);
  }

  .chain {
    padding: 1rem;
    display: grid;
    gap: 0.9rem;
    align-content: start;
    overflow: auto;
  }

  .stack-card,
  .node-card,
  .empty-state {
    border: 1px solid var(--line);
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--accent) 7%, transparent), transparent 45%),
      color-mix(in srgb, var(--bg) 92%, white);
  }

  .stack-card,
  .node-card {
    padding: 0.9rem;
  }

  .source-card {
    display: grid;
    gap: 0.35rem;
  }

  .routing-grid {
    display: grid;
    gap: 0.7rem;
    grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
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

  .slider-stack {
    display: grid;
    gap: 0.2rem;
    margin-top: 0.55rem;
  }

  .knob-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    margin-top: 0.55rem;
    align-items: flex-start;
  }

  .knob-control {
    display: grid;
    justify-items: center;
    gap: 0.15rem;
  }

  .knob-mod {
    width: 100%;
    font-size: 0.6rem;
    font-family: var(--font-mono);
    background: var(--bg);
    color: var(--muted);
    border: 1px solid var(--line);
    padding: 0.1rem 0.15rem;
    text-transform: lowercase;
    cursor: pointer;
  }

  .knob-mod:focus {
    border-color: var(--accent);
    outline: none;
  }

  .slider-mode {
    flex: 0 0 100%;
  }

  .routing-panel {
    margin-top: 0.75rem;
    padding-top: 0.7rem;
    border-top: 1px solid var(--line);
  }

  .routing-field {
    display: grid;
    gap: 0.35rem;
  }

  .routing-field span {
    color: var(--muted);
    font-size: 0.68rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    font-family: var(--font-mono);
  }

  .routing-field select {
    background: var(--bg);
    color: var(--fg);
    border: 1px solid var(--line);
    padding: 0.4rem 0.45rem;
    font-size: 0.74rem;
    font-family: var(--font-mono);
  }

  .empty-state {
    padding: 1rem;
    display: grid;
    gap: 0.3rem;
    color: var(--muted);
  }

  .node-list {
    display: grid;
    gap: 0.85rem;
  }

  .node-card.inactive {
    opacity: 0.72;
  }

  .node-head,
  .actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .node-head {
    align-items: flex-start;
  }

  .node-copy {
    display: grid;
    gap: 0.15rem;
  }

  .node-blurb {
    max-width: 28rem;
  }

  .mod-control {
    display: grid;
    gap: 0.15rem;
  }

  .eyebrow {
    font-size: 0.68rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
  }

  .pill {
    border: 1px solid var(--line);
    padding: 0.15rem 0.35rem;
    font-size: 0.68rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    font-family: var(--font-mono);
  }

  .active-pill {
    color: var(--accent);
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }

  .signal-flow {
    margin: 0.7rem 0 0.15rem;
    display: flex;
    align-items: center;
    gap: 0.45rem;
    color: var(--muted);
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-family: var(--font-mono);
  }

  .arrow {
    color: var(--accent);
  }

  .actions button {
    background: var(--bg);
    color: var(--fg);
    border: 1px solid var(--line);
  }

  .actions {
    margin-top: 0.85rem;
  }

  .node-warnings {
    margin-top: 0.7rem;
    display: grid;
    gap: 0.25rem;
  }

  .node-warnings p {
    color: #e2c7a1;
    font-size: 0.7rem;
    line-height: 1.35;
    font-family: var(--font-mono);
  }

  .actions button {
    cursor: pointer;
    font-family: var(--font-mono);
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .actions button {
    padding: 0.28rem 0.5rem;
    font-size: 0.68rem;
  }

  .actions button.danger {
    color: #f4b1a8;
  }

  .actions button:disabled {
    cursor: not-allowed;
    color: var(--muted);
    opacity: 0.55;
  }
</style>
