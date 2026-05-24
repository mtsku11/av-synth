import type { ParamSpec } from '../core/params';

export type FeedbackDelayParamName = 'time' | 'feedback' | 'damping' | 'cross' | 'mix';

export const FEEDBACK_DELAY_PARAM_SPECS: Readonly<Record<FeedbackDelayParamName, ParamSpec>> =
  Object.freeze({
    time: {
      id: 'time',
      label: 'time',
      range: [0.005, 4],
      default: 0.25,
      curve: 'exp',
      unit: 's',
      hint: 'stereo delay time for the shared post-granulator feedback path',
    },
    feedback: {
      id: 'feedback',
      label: 'feedback',
      range: [0, 0.99],
      default: 0,
      curve: 'lin',
      unit: 'norm',
      hint: 'shared AV feedback amount; also drives visual feedback recursion depth',
    },
    damping: {
      id: 'damping',
      label: 'damping',
      range: [200, 20000],
      default: 6000,
      curve: 'exp',
      unit: 'hz',
      hint: 'lowpass cutoff inside the feedback loop',
    },
    cross: {
      id: 'cross',
      label: 'cross',
      range: [0, Math.PI / 2],
      default: 0,
      curve: 'lin',
      unit: 'rad',
      hint: '0=self-feedback, pi/4=ping-pong, pi/2=full swap',
    },
    mix: {
      id: 'mix',
      label: 'mix',
      range: [0, 1],
      default: 0,
      curve: 'lin',
      unit: 'norm',
      hint: 'equal-power dry/wet blend for the delay return',
    },
  });

export const FEEDBACK_DELAY_DEFAULTS: Readonly<Record<FeedbackDelayParamName, number>> =
  Object.freeze({
    time: FEEDBACK_DELAY_PARAM_SPECS.time.default,
    feedback: FEEDBACK_DELAY_PARAM_SPECS.feedback.default,
    damping: FEEDBACK_DELAY_PARAM_SPECS.damping.default,
    cross: FEEDBACK_DELAY_PARAM_SPECS.cross.default,
    mix: FEEDBACK_DELAY_PARAM_SPECS.mix.default,
  });

export const FEEDBACK_DELAY_PARAM_ORDER: readonly FeedbackDelayParamName[] = Object.freeze([
  'time',
  'feedback',
  'damping',
  'cross',
  'mix',
]);
