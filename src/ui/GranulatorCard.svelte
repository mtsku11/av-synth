<script lang="ts">
  import type {
    Granulator,
    GranulatorEnvelope,
    GranulatorMode,
    GranulatorParamName,
    GranulatorQuality,
    GranulatorRuntimeSnapshot,
  } from '../audio/granulator';
  import {
    GRANULATOR_ENVELOPES,
    GRANULATOR_MODES,
    GRANULATOR_QUALITIES,
  } from '../audio/granulator';
  import { GRANULATOR_SLIDER_ORDER, type GranulatorSliderParam } from '../audio/granulator-params';
  import type { MidiBinding, MidiRouter } from '../core/midi';
  import { listGlobalLfoOptions, type GlobalLfo, type ParamLfoAssignments } from '../core/mod-bank';
  import type { ParamSpec } from '../core/params';
  import Knob from './Knob.svelte';

  interface Props {
    granulator: Granulator | null;
    midiRouter: MidiRouter | null;
    enabled: boolean;
    envelope: GranulatorEnvelope;
    mode: GranulatorMode;
    quality: GranulatorQuality;
    adaptiveQuality: boolean;
    runtimeSnapshot: GranulatorRuntimeSnapshot | null;
    values: Readonly<Record<GranulatorSliderParam, number>>;
    lfoBank: readonly GlobalLfo[];
    lfoAssignments: Readonly<ParamLfoAssignments>;
    onSetEnabled: (next: boolean) => void;
    onSetEnvelope: (next: GranulatorEnvelope) => void;
    onSetMode: (next: GranulatorMode) => void;
    onSetQuality: (next: GranulatorQuality) => void;
    onSetAdaptiveQuality: (next: boolean) => void;
    onSetParam: (name: GranulatorSliderParam, value: number) => void;
    onSetParamLfo: (name: GranulatorSliderParam, encoded: string) => void;
  }

  let {
    granulator,
    midiRouter,
    enabled,
    envelope,
    mode,
    quality,
    adaptiveQuality,
    runtimeSnapshot,
    values,
    lfoBank,
    lfoAssignments,
    onSetEnabled,
    onSetEnvelope,
    onSetMode,
    onSetQuality,
    onSetAdaptiveQuality,
    onSetParam,
    onSetParamLfo,
  }: Props = $props();

  interface ControlSpec {
    readonly name: GranulatorSliderParam;
    readonly label: string;
    readonly min: number;
    readonly max: number;
    readonly step: number;
    readonly unit: string;
  }

  // Slider display metadata — kept here rather than in granulator-params.ts because the
  // unit strings and step sizes are UI concerns, not modulation-fabric concerns. The
  // ordering and parameter names are sourced from the canonical GRANULATOR_SLIDER_ORDER
  // in granulator-params.ts.
  const SLIDER_DISPLAY: Readonly<Record<GranulatorSliderParam, Omit<ControlSpec, 'name'>>> = {
    position: { label: 'position', min: 0, max: 1, step: 0.001, unit: '0–1' },
    positionJitter: { label: 'pos jitter', min: 0, max: 1, step: 0.001, unit: '0–1' },
    pitch: { label: 'pitch', min: -48, max: 48, step: 0.01, unit: 'st' },
    pitchJitter: { label: 'pitch jitter', min: 0, max: 24, step: 0.01, unit: 'st' },
    duration: { label: 'duration', min: 5, max: 2000, step: 1, unit: 'ms' },
    durationJitter: { label: 'dur jitter', min: 0, max: 1, step: 0.001, unit: '0–1' },
    density: { label: 'density', min: 0.1, max: 200, step: 0.1, unit: 'Hz' },
    distribution: { label: 'distribution', min: 0, max: 1, step: 0.001, unit: '0–1' },
    panSpread: { label: 'pan spread', min: 0, max: 1, step: 0.001, unit: '0–1' },
    ySpread: { label: 'width', min: 0, max: 1, step: 0.001, unit: 'M/S' },
    reverseProbability: { label: 'reverse p', min: 0, max: 1, step: 0.001, unit: '0–1' },
    voiceCount: { label: 'voices', min: 1, max: 64, step: 1, unit: '' },
    gain: { label: 'gain', min: 0, max: 1, step: 0.001, unit: '0–1' },
    mix: { label: 'mix', min: 0, max: 1, step: 0.001, unit: '0–1' },
    fmAmount: { label: 'fm amount', min: 0, max: 48, step: 0.01, unit: 'st' },
    fmFreq: { label: 'fm freq', min: 0.1, max: 500, step: 0.1, unit: 'Hz' },
    envAttack: { label: 'attack', min: 1, max: 10000, step: 1, unit: 'ms' },
    envDecay: { label: 'decay', min: 1, max: 10000, step: 1, unit: 'ms' },
    envSustain: { label: 'sustain', min: 0, max: 1, step: 0.001, unit: '0–1' },
    envRelease: { label: 'release', min: 1, max: 20000, step: 1, unit: 'ms' },
  };

  const SLIDERS: readonly ControlSpec[] = GRANULATOR_SLIDER_ORDER.map((name) => ({
    name,
    ...SLIDER_DISPLAY[name],
  }));

  const CTRL_MAP = Object.fromEntries(SLIDERS.map((s) => [s.name, s])) as Record<
    GranulatorSliderParam,
    ControlSpec
  >;

  // Knob params are any with 0–1 range.
  function isKnobParam(ctrl: ControlSpec): boolean {
    return ctrl.min === 0 && ctrl.max === 1;
  }

  const KNOB_DEFAULTS: Partial<Record<GranulatorSliderParam, number>> = {
    position: 0.5,
    positionJitter: 0,
    durationJitter: 0,
    distribution: 0.5,
    panSpread: 0,
    ySpread: 0,
    reverseProbability: 0,
    gain: 0.8,
    mix: 1.0,
    envSustain: 1.0,
  };

  function toKnobSpec(ctrl: ControlSpec): ParamSpec {
    return {
      id: ctrl.name,
      label: ctrl.label,
      range: [0, 1],
      default: KNOB_DEFAULTS[ctrl.name] ?? 0.5,
      curve: 'lin',
      unit: 'norm',
    };
  }

  const GROUPS: readonly { readonly label: string; readonly params: readonly GranulatorSliderParam[] }[] =
    [
      {
        label: 'grain shape',
        params: ['position', 'positionJitter', 'duration', 'durationJitter', 'density', 'distribution', 'reverseProbability'],
      },
      { label: 'pitch', params: ['pitch', 'pitchJitter', 'fmAmount', 'fmFreq'] },
      { label: 'space', params: ['panSpread', 'ySpread'] },
      { label: 'envelope', params: ['envAttack', 'envDecay', 'envSustain', 'envRelease'] },
      { label: 'output', params: ['voiceCount', 'gain', 'mix'] },
    ];

  // MIDI-learn state. learningParam is the name of the slider awaiting a MIDI surface
  // event; bindingsByParam reflects whatever the router currently has bound. Last
  // binding wins on display (the spec allows multiple bindings per param).
  let learningParam = $state<GranulatorParamName | null>(null);
  let bindingsByParam = $state<Record<string, MidiBinding | null>>({});

  const lfoOptions = $derived(listGlobalLfoOptions(lfoBank));

  async function startLearn(
    param: GranulatorParamName,
    range: { min: number; max: number },
  ): Promise<void> {
    if (!midiRouter) return;
    if (learningParam === param) {
      midiRouter.cancelLearn();
      learningParam = null;
      return;
    }
    if (learningParam) midiRouter.cancelLearn();
    learningParam = param;
    try {
      const binding = await midiRouter.learn(param, range);
      if (learningParam === param) {
        bindingsByParam = { ...bindingsByParam, [param]: binding };
        learningParam = null;
      }
    } catch {
      learningParam = null;
    }
  }

  function clearBinding(param: GranulatorParamName): void {
    if (!midiRouter) return;
    midiRouter.removeBindings((b) => b.param === param);
    bindingsByParam = { ...bindingsByParam, [param]: null };
  }

  function bindingLabel(b: MidiBinding | null): string {
    if (!b) return 'learn';
    const s = b.source;
    const ch = s.channel === 'any' ? 'any' : `ch${s.channel}`;
    switch (s.kind) {
      case 'cc':
        return `CC${s.controller} ${ch}`;
      case 'pitchBend':
        return `PB ${ch}`;
      case 'channelPressure':
        return `AT ${ch}`;
      case 'noteVelocity':
        return `vel ${ch}`;
    }
  }

  function formatVoiceSummary(snapshot: GranulatorRuntimeSnapshot | null): string {
    if (!snapshot) return 'n/a';
    const active = Math.round(snapshot.activeVoices);
    const fading = Math.round(snapshot.fadingVoices);
    const max = Math.round(snapshot.voiceCount);
    return `${active}/${max}${fading > 0 ? ` +${fading} fading` : ''}`;
  }
</script>

<article class="granulator-card" data-qa="granulator-card">
  <header>
    <div class="title-row">
      <h2>granulator</h2>
      <label class="enable">
        <input
          type="checkbox"
          checked={enabled}
          onchange={(e) => onSetEnabled((e.currentTarget as HTMLInputElement).checked)}
        />
        <span>enabled</span>
      </label>
    </div>
    <p class="status">
      {#if !granulator}
        not ready — press start
      {:else if !midiRouter}
        ready (no MIDI router)
      {:else}
        ready · MIDI routed
      {/if}
    </p>
  </header>

  <section class="mode-row">
    <div class="picker">
      <span class="picker-label">envelope</span>
      <div class="picker-buttons">
        {#each GRANULATOR_ENVELOPES as env (env)}
          <button
            type="button"
            class:active={envelope === env}
            onclick={() => onSetEnvelope(env)}
            disabled={!granulator}
          >
            {env}
          </button>
        {/each}
      </div>
    </div>
    <div class="picker">
      <span class="picker-label">mode</span>
      <div class="picker-buttons">
        {#each GRANULATOR_MODES as m (m)}
          <button
            type="button"
            class:active={mode === m}
            onclick={() => onSetMode(m)}
            disabled={!granulator}
          >
            {m}
          </button>
        {/each}
      </div>
    </div>
    <div class="picker">
      <span class="picker-label">quality</span>
      <div class="picker-buttons">
        {#each GRANULATOR_QUALITIES as q (q)}
          <button
            type="button"
            class:active={quality === q}
            onclick={() => onSetQuality(q)}
            disabled={!granulator}
          >
            {q}
          </button>
        {/each}
      </div>
    </div>
    <label class="adaptive-toggle">
      <input
        type="checkbox"
        checked={adaptiveQuality}
        onchange={(e) => onSetAdaptiveQuality((e.currentTarget as HTMLInputElement).checked)}
        disabled={!granulator || quality !== 'high'}
      />
      <span>auto step-down in high</span>
    </label>
  </section>

  <section class="diagnostics" data-qa="granulator-diagnostics">
    <div class="diag-row">
      <span class="diag-label">voices</span>
      <span class="diag-value">{formatVoiceSummary(runtimeSnapshot)}</span>
    </div>
    <div class="diag-row">
      <span class="diag-label">interp</span>
      <span class="diag-value">{runtimeSnapshot?.interpMode ?? 'n/a'}</span>
    </div>
    <div class="diag-row">
      <span class="diag-label">quality</span>
      <span class="diag-value">
        {#if runtimeSnapshot}
          {runtimeSnapshot.requestedQuality}
          {#if runtimeSnapshot.effectiveQuality !== runtimeSnapshot.requestedQuality}
            → {runtimeSnapshot.effectiveQuality}
          {/if}
        {:else}
          n/a
        {/if}
      </span>
    </div>
    <div class="diag-row">
      <span class="diag-label">budget</span>
      <span class="diag-value">
        {#if !runtimeSnapshot}
          n/a
        {:else if runtimeSnapshot.budgetLimited}
          limited
        {:else}
          clear
        {/if}
      </span>
    </div>
    <div class="diag-row">
      <span class="diag-label">pitch load</span>
      <span class="diag-value"
        >{runtimeSnapshot ? runtimeSnapshot.pitchLoad.toFixed(1) : 'n/a'}</span
      >
    </div>
  </section>

  <section class="param-sections">
    {#each GROUPS as group (group.label)}
      <div class="param-group">
        <span class="group-label">{group.label}</span>
        <div class="group-params">
          {#each group.params as name (name)}
            {@const ctrl = CTRL_MAP[name]}
            {#if isKnobParam(ctrl)}
              <div class="knob-item">
                <Knob
                  spec={toKnobSpec(ctrl)}
                  value={values[ctrl.name]}
                  size={42}
                  onValueChange={(v) => onSetParam(ctrl.name, v)}
                />
                <select
                  class="param-mod"
                  value={lfoAssignments[ctrl.name]?.videoFeature != null
                    ? `v:${lfoAssignments[ctrl.name]?.videoFeature}`
                    : lfoAssignments[ctrl.name]?.lfoIndex == null
                      ? ''
                      : String(lfoAssignments[ctrl.name]?.lfoIndex)}
                  onchange={(event) =>
                    onSetParamLfo(ctrl.name, (event.currentTarget as HTMLSelectElement).value)}
                  disabled={!granulator}
                  data-qa={`gran-lfo-${ctrl.name}`}
                >
                  {#each lfoOptions as option (option.id)}
                    <option value={option.value}>{option.label}</option>
                  {/each}
                </select>
                <button
                  type="button"
                  class="learn"
                  class:learning={learningParam === ctrl.name}
                  class:bound={!!bindingsByParam[ctrl.name]}
                  disabled={!midiRouter}
                  onclick={() =>
                    bindingsByParam[ctrl.name]
                      ? clearBinding(ctrl.name)
                      : startLearn(ctrl.name, { min: ctrl.min, max: ctrl.max })}
                  data-qa={`gran-learn-${ctrl.name}`}
                >
                  {learningParam === ctrl.name ? '…' : bindingLabel(bindingsByParam[ctrl.name] ?? null)}
                </button>
              </div>
            {:else}
              <div class="slider-item">
                <label class="slider-label" for={`gran-${ctrl.name}`}>{ctrl.label}</label>
                <input
                  id={`gran-${ctrl.name}`}
                  type="range"
                  min={ctrl.min}
                  max={ctrl.max}
                  step={ctrl.step}
                  value={values[ctrl.name]}
                  oninput={(e) =>
                    onSetParam(ctrl.name, Number((e.currentTarget as HTMLInputElement).value))}
                  disabled={!granulator}
                  data-qa={`gran-${ctrl.name}`}
                />
                <span class="slider-value"
                  >{(values[ctrl.name] ?? 0).toFixed(ctrl.step < 1 ? 3 : 0)}{ctrl.unit
                    ? ` ${ctrl.unit}`
                    : ''}</span
                >
                <select
                  class="param-mod"
                  value={lfoAssignments[ctrl.name]?.videoFeature != null
                    ? `v:${lfoAssignments[ctrl.name]?.videoFeature}`
                    : lfoAssignments[ctrl.name]?.lfoIndex == null
                      ? ''
                      : String(lfoAssignments[ctrl.name]?.lfoIndex)}
                  onchange={(event) =>
                    onSetParamLfo(ctrl.name, (event.currentTarget as HTMLSelectElement).value)}
                  disabled={!granulator}
                  data-qa={`gran-lfo-${ctrl.name}`}
                >
                  {#each lfoOptions as option (option.id)}
                    <option value={option.value}>{option.label}</option>
                  {/each}
                </select>
                <button
                  type="button"
                  class="learn"
                  class:learning={learningParam === ctrl.name}
                  class:bound={!!bindingsByParam[ctrl.name]}
                  disabled={!midiRouter}
                  onclick={() =>
                    bindingsByParam[ctrl.name]
                      ? clearBinding(ctrl.name)
                      : startLearn(ctrl.name, { min: ctrl.min, max: ctrl.max })}
                  data-qa={`gran-learn-${ctrl.name}`}
                >
                  {learningParam === ctrl.name ? '…' : bindingLabel(bindingsByParam[ctrl.name] ?? null)}
                </button>
              </div>
            {/if}
          {/each}
        </div>
      </div>
    {/each}
  </section>
</article>

<style>
  .granulator-card {
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 16px;
    font-family: var(--font-mono);
    color: var(--fg);
  }
  .granulator-card header {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 12px;
  }
  .title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .title-row h2 {
    font-size: 14px;
    font-weight: 600;
    text-transform: lowercase;
    letter-spacing: 0.04em;
    margin: 0;
  }
  .enable {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--muted);
  }
  .status {
    font-size: 11px;
    color: var(--muted);
    margin: 0;
  }
  .mode-row {
    display: flex;
    gap: 16px;
    margin-bottom: 12px;
    flex-wrap: wrap;
  }
  .picker {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .adaptive-toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--muted);
  }
  .picker-label {
    font-size: 11px;
    color: var(--muted);
    min-width: 60px;
  }
  .picker-buttons {
    display: flex;
    gap: 2px;
  }
  .picker-buttons button {
    background: var(--bg);
    border: 1px solid var(--line);
    color: var(--fg);
    padding: 4px 8px;
    font-size: 11px;
    font-family: inherit;
    cursor: pointer;
    border-radius: 3px;
  }
  .picker-buttons button.active {
    background: color-mix(in srgb, var(--accent) 25%, var(--bg));
    border-color: color-mix(in srgb, var(--accent) 60%, var(--bg));
    color: var(--fg);
  }
  .picker-buttons button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .diagnostics {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 8px 12px;
    margin-bottom: 12px;
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: color-mix(in srgb, var(--bg) 85%, black);
  }
  .diag-row {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .diag-label {
    font-size: 10px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .diag-value {
    font-size: 12px;
    color: var(--fg);
  }
  /* grouped param sections */
  .param-sections {
    display: grid;
    gap: 10px;
  }
  .param-group {
    display: grid;
    gap: 6px;
  }
  .group-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
    border-bottom: 1px solid var(--line);
    padding-bottom: 3px;
  }
  .group-params {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: flex-start;
  }
  /* knob params */
  .knob-item {
    display: grid;
    justify-items: center;
    gap: 3px;
  }
  /* slider params (full width within group) */
  .slider-item {
    flex: 0 0 100%;
    display: grid;
    grid-template-columns: 90px 1fr 70px 78px 70px;
    align-items: center;
    gap: 8px;
    font-size: 11px;
  }
  .slider-label {
    color: var(--muted);
  }
  .slider-item input[type='range'] {
    width: 100%;
  }
  .slider-value {
    text-align: right;
    color: var(--fg);
    font-variant-numeric: tabular-nums;
  }
  /* shared mod/lfo select for both knob and slider params */
  .param-mod {
    width: 100%;
    background: var(--bg);
    border: 1px solid var(--line);
    color: var(--muted);
    padding: 2px 3px;
    font-size: 9px;
    font-family: var(--font-mono);
    cursor: pointer;
  }
  .param-mod:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .learn {
    background: var(--bg);
    border: 1px solid var(--line);
    color: var(--muted);
    padding: 3px 6px;
    font-size: 10px;
    font-family: inherit;
    cursor: pointer;
    border-radius: 3px;
  }
  .learn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .learn.learning {
    background: #5e4a2d;
    border-color: #907b4a;
    color: #f6f0e8;
    animation: pulse 1s ease-in-out infinite;
  }
  .learn.bound {
    background: #2d5e4a;
    border-color: #4a907b;
    color: #e8f6f0;
  }
  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.6;
    }
  }
</style>
