<script lang="ts">
  import {
    FEEDBACK_DELAY_PARAM_ORDER,
    FEEDBACK_DELAY_PARAM_SPECS,
    type FeedbackDelayParamName,
  } from '../audio/feedback-delay-params';
  import Slider from './Slider.svelte';

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

  <section class="slider-stack">
    {#each FEEDBACK_DELAY_PARAM_ORDER as param (param)}
      <div class="slider-row" data-qa={`feedback-delay-${param}`}>
        <Slider
          spec={FEEDBACK_DELAY_PARAM_SPECS[param]}
          value={values[param]}
          onValueChange={(value) => onSetParam(param, value)}
        />
      </div>
    {/each}
  </section>
</article>

<style>
  .feedback-delay-card {
    background: #131418;
    border: 1px solid #23262e;
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 16px;
    color: #e8e9ed;
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
    color: #a3a8b7;
    font-size: 0.8rem;
    line-height: 1.45;
    font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace;
  }

  .slider-stack {
    display: grid;
    gap: 0.25rem;
  }
</style>
