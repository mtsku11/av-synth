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
  import {
    GRANULATOR_PARAM_SPECS,
    type GranulatorSliderParam,
  } from '../audio/granulator-params';
  import {
    FEEDBACK_DELAY_PARAM_ORDER,
    FEEDBACK_DELAY_PARAM_SPECS,
    type FeedbackDelayParamName,
  } from '../audio/feedback-delay-params';
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
    feedbackDelayValues: Readonly<Record<FeedbackDelayParamName, number>>;
    onSetFeedbackDelayParam: (name: FeedbackDelayParamName, value: number) => void;
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
    feedbackDelayValues,
    onSetFeedbackDelayParam,
  }: Props = $props();

  function specFor(name: GranulatorSliderParam): ParamSpec {
    return GRANULATOR_PARAM_SPECS[name]!.spec;
  }

  const GROUPS: readonly { readonly label: string; readonly params: readonly GranulatorSliderParam[] }[] =
    [
      {
        label: 'grain',
        params: ['position', 'positionJitter', 'duration', 'durationJitter', 'density', 'distribution', 'reverseProbability'],
      },
      { label: 'pitch · space', params: ['pitch', 'pitchJitter', 'fmAmount', 'fmFreq', 'panSpread', 'ySpread'] },
      { label: 'envelope · output', params: ['envAttack', 'envDecay', 'envSustain', 'envRelease', 'voiceCount', 'gain', 'mix'] },
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

  <div class="diagnostics" data-qa="granulator-diagnostics">
    <span class="diag-label">voices</span><span class="diag-value">{formatVoiceSummary(runtimeSnapshot)}</span>
    <span class="diag-sep">·</span>
    <span class="diag-label">interp</span><span class="diag-value">{runtimeSnapshot?.interpMode ?? 'n/a'}</span>
    <span class="diag-sep">·</span>
    <span class="diag-label">budget</span><span class="diag-value">{!runtimeSnapshot ? 'n/a' : runtimeSnapshot.budgetLimited ? 'lim' : 'ok'}</span>
  </div>

  <section class="param-sections">
    {#each GROUPS as group (group.label)}
      <div class="param-group">
        <span class="group-label">{group.label}</span>
        <div class="group-knobs">
          {#each group.params as name (name)}
            {@const spec = specFor(name)}
            <div class="knob-item">
              <Knob
                {spec}
                value={values[name]}
                size={32}
                onValueChange={(v) => onSetParam(name, v)}
              />
              <div class="knob-aux">
                <select
                  class="param-mod"
                  value={lfoAssignments[name]?.videoFeature != null
                    ? `v:${lfoAssignments[name]?.videoFeature}`
                    : lfoAssignments[name]?.lfoIndex == null
                      ? ''
                      : String(lfoAssignments[name]?.lfoIndex)}
                  onchange={(event) =>
                    onSetParamLfo(name, (event.currentTarget as HTMLSelectElement).value)}
                  disabled={!granulator}
                  data-qa={`gran-lfo-${name}`}
                >
                  {#each lfoOptions as option (option.id)}
                    <option value={option.value}>{option.label}</option>
                  {/each}
                </select>
                <button
                  type="button"
                  class="learn"
                  class:learning={learningParam === name}
                  class:bound={!!bindingsByParam[name]}
                  disabled={!midiRouter}
                  onclick={() =>
                    bindingsByParam[name]
                      ? clearBinding(name)
                      : startLearn(name, { min: spec.range[0], max: spec.range[1] })}
                  data-qa={`gran-learn-${name}`}
                >
                  {learningParam === name ? '…' : bindingLabel(bindingsByParam[name] ?? null)}
                </button>
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/each}
    <div class="param-group">
      <span class="group-label">delay</span>
      <div class="group-knobs">
        {#each FEEDBACK_DELAY_PARAM_ORDER as name (name)}
          <Knob
            spec={FEEDBACK_DELAY_PARAM_SPECS[name]}
            value={feedbackDelayValues[name]}
            size={32}
            onValueChange={(v) => onSetFeedbackDelayParam(name, v)}
          />
        {/each}
      </div>
    </div>
  </section>
</article>

<style>
  .granulator-card {
    background: var(--bg);
    border: 1px solid var(--line);
    padding: 6px 8px;
    font-family: var(--font-mono);
    color: var(--fg);
  }
  .granulator-card header {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin-bottom: 5px;
  }
  .title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .title-row h2 {
    font-size: 0.8rem;
    font-weight: 600;
    text-transform: lowercase;
    letter-spacing: 0.04em;
    margin: 0;
  }
  .enable {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 0.65rem;
    color: var(--muted);
  }
  .status {
    font-size: 0.65rem;
    color: var(--muted);
    margin: 0;
  }
  .mode-row {
    display: flex;
    gap: 6px;
    margin-bottom: 5px;
    flex-wrap: wrap;
    align-items: center;
  }
  .picker {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .adaptive-toggle {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 0.62rem;
    color: var(--muted);
  }
  .picker-label {
    font-size: 0.62rem;
    color: var(--muted);
  }
  .picker-buttons {
    display: flex;
    gap: 1px;
  }
  .picker-buttons button {
    background: var(--bg);
    border: 1px solid var(--line);
    color: var(--fg);
    padding: 2px 6px;
    font-size: 0.62rem;
    font-family: inherit;
    cursor: pointer;
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
    display: flex;
    gap: 4px;
    align-items: baseline;
    flex-wrap: wrap;
    margin-bottom: 6px;
    padding: 3px 6px;
    border: 1px solid var(--line);
    background: color-mix(in srgb, var(--bg) 85%, black);
  }
  .diag-label {
    font-size: 0.55rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .diag-value {
    font-size: 0.6rem;
    color: var(--fg);
    margin-right: 2px;
  }
  .diag-sep {
    font-size: 0.55rem;
    color: var(--line);
    margin: 0 1px;
  }
  .param-sections {
    display: grid;
    gap: 4px;
  }
  .param-group {
    display: grid;
    gap: 2px;
  }
  .group-label {
    font-size: 0.52rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
    border-bottom: 1px solid var(--line);
    padding-bottom: 1px;
  }
  .group-knobs {
    display: flex;
    justify-content: space-evenly;
    align-items: flex-start;
  }
  .knob-item {
    display: grid;
    justify-items: center;
    gap: 1px;
    min-width: 0;
  }
  .knob-aux {
    display: flex;
    gap: 2px;
    align-items: center;
  }
  .param-mod {
    background: var(--bg);
    border: 1px solid var(--line);
    color: var(--muted);
    padding: 1px 2px;
    font-size: 0.52rem;
    font-family: var(--font-mono);
    cursor: pointer;
    max-width: 3.5rem;
  }
  .param-mod:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .learn {
    background: var(--bg);
    border: 1px solid var(--line);
    color: var(--muted);
    padding: 1px 3px;
    font-size: 0.52rem;
    font-family: inherit;
    cursor: pointer;
    white-space: nowrap;
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
