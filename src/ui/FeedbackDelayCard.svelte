<script lang="ts">
  import {
    FEEDBACK_DELAY_PARAM_ORDER,
    FEEDBACK_DELAY_PARAM_SPECS,
    type FeedbackDelayParamName,
  } from '../audio/feedback-delay-params';
  import Knob from './Knob.svelte';

  interface Props {
    values: Readonly<Record<FeedbackDelayParamName, number>>;
    onSetParam: (name: FeedbackDelayParamName, value: number) => void;
  }

  let { values, onSetParam }: Props = $props();
</script>

<article class="feedback-delay-card" data-qa="feedback-delay-card">
  <h2>feedback delay</h2>
  <section class="knob-row">
    {#each FEEDBACK_DELAY_PARAM_ORDER as param (param)}
      <div data-qa={`feedback-delay-${param}`}>
        <Knob
          spec={FEEDBACK_DELAY_PARAM_SPECS[param]}
          value={values[param]}
          size={32}
          onValueChange={(value) => onSetParam(param, value)}
        />
      </div>
    {/each}
  </section>
</article>

<style>
  .feedback-delay-card {
    background: var(--bg);
    border: 1px solid var(--line);
    padding: 10px 12px;
    color: var(--fg);
    font-family: var(--font-mono);
  }

  h2 {
    margin: 0 0 6px;
    font-size: 0.8rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: lowercase;
  }

  .knob-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    align-items: flex-start;
  }
</style>
