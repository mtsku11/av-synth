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
  <header>
    <h2>feedback delay</h2>
    <p>
      Post-granulator stereo delay. `feedback` is the shared AV control and follows the video
      feedback operators.
    </p>
  </header>

  <section class="knob-row">
    {#each FEEDBACK_DELAY_PARAM_ORDER as param (param)}
      <div data-qa={`feedback-delay-${param}`}>
        <Knob
          spec={FEEDBACK_DELAY_PARAM_SPECS[param]}
          value={values[param]}
          size={44}
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
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 16px;
    color: var(--fg);
    font-family: var(--font-mono);
  }

  header {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 12px;
  }

  h2 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: lowercase;
  }

  p {
    margin: 0;
    color: var(--muted);
    font-size: 0.8rem;
    line-height: 1.45;
  }

  .knob-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    align-items: flex-start;
  }
</style>
