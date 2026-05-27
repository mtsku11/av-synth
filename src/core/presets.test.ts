import { beforeEach, describe, expect, it } from 'vitest';

import { clock } from './clock.svelte';
import { createParamLfoAssignment } from './mod-bank';
import {
  applyProgram,
  applyProgramAudio,
  applyProgramAudioState,
  applyProgramAutomation,
  getResolvedProgramSharedFeedback,
  getOrderedProgramOps,
  getProgramMacroDefaults,
  resolveProgramState,
} from './presets';
import type { VideoEffectProgram } from './presets';
import type { OperatorInstance } from './operators';

function makeInstance(op: string, params: Record<string, number>): OperatorInstance {
  return {
    id: `${op}-${Math.random()}`,
    def: {
      op,
      coupling: {
        op,
        params: {},
      },
      paramOrder: Object.keys(params),
      defaults: {},
      createVideoStage() {
        throw new Error('not used in presets tests');
      },
    },
    videoStage: {} as OperatorInstance['videoStage'],
    params,
    lfoAssignments: Object.fromEntries(
      Object.keys(params).map((paramId) => [paramId, createParamLfoAssignment()]),
    ),
  };
}

describe('applyProgram', () => {
  beforeEach(() => {
    clock.rate = 0.3;
    clock.bpm = 120;
    clock.baseFreq = 1;
  });

  it('updates every matching operator instance, not just the first', () => {
    const first = makeInstance('posterize', { bins: 4 });
    const second = makeInstance('posterize', { bins: 8 });
    const other = makeInstance('rotate', { angle: 0 });

    applyProgram({ 'posterize.bins': 16 }, [first, second, other]);

    expect(first.params.bins).toBe(16);
    expect(second.params.bins).toBe(16);
    expect(other.params.angle).toBe(0);
  });

  it('can target a specific repeated operator instance with #index scopes', () => {
    const first = makeInstance('rotate', { angle: 0 });
    const second = makeInstance('rotate', { angle: 0 });

    applyProgram({ 'rotate#1.angle': 0.75 }, [first, second]);

    expect(first.params.angle).toBe(0);
    expect(second.params.angle).toBe(0.75);
  });

  it('applies clock values alongside operator params', () => {
    const rotate = makeInstance('rotate', { angle: 0 });

    applyProgram(
      {
        title: 'Test',
        tagline: 'test',
        videoIntent: 'test',
        audioIntent: 'test',
        operatorFocus: ['rotate'],
        values: {
          'clock.rate': 0.8,
          'clock.bpm': 90,
          'clock.baseFreq': 3,
          'rotate.angle': 1.2,
        },
      },
      [rotate],
    );

    expect(clock.rate).toBe(0.8);
    expect(clock.bpm).toBe(90);
    expect(clock.baseFreq).toBe(3);
    expect(rotate.params.angle).toBe(1.2);
  });

  it('evaluates LFO and stepped-sequence automation against static base values', () => {
    const rotate = makeInstance('rotate', { angle: 0 });
    const kaleid = makeInstance('kaleid', { nSides: 1 });
    const program = {
      title: 'Animated',
      tagline: 'animated',
      videoIntent: 'animated',
      audioIntent: 'animated',
      operatorFocus: ['rotate', 'kaleid'],
      values: {
        'rotate.angle': 0.009,
        'kaleid.nSides': 3,
      },
      automation: {
        'rotate.angle': {
          kind: 'lfo' as const,
          rate: 1 / (Math.PI * 2),
          depth: -0.001,
          phase: 0,
        },
        'kaleid.nSides': {
          kind: 'sequence' as const,
          values: [3, 4, 5, 7],
          fast: 0.1,
          smooth: 0,
          ease: 'linear' as const,
          offset: 0,
          invert: false,
        },
      },
    };

    applyProgram(program, [rotate, kaleid]);
    applyProgramAutomation(program, [rotate, kaleid], Math.PI / 2);
    expect(rotate.params.angle).toBeCloseTo(0.008, 6);
    expect(kaleid.params.nSides).toBe(3);

    applyProgramAutomation(program, [rotate, kaleid], 15);
    expect(kaleid.params.nSides).toBe(4);
  });

  it('evaluates fft automation against a targeted repeated instance', () => {
    const first = makeInstance('scale', { amount: 1 });
    const second = makeInstance('scale', { amount: 1 });
    const program = {
      title: 'FFT',
      tagline: 'fft',
      videoIntent: 'fft',
      audioIntent: 'fft',
      operatorFocus: ['scale'],
      values: {
        'scale#1.amount': 1,
      },
      automation: {
        'scale#1.amount': {
          kind: 'fft' as const,
          bin: 0,
          scale: 2,
          smooth: 0,
          cutoff: 0,
        },
      },
    };

    applyProgram(program, [first, second]);
    applyProgramAutomation(program, [first, second], {
      time: 0,
      fft: new Float32Array([-6]),
    });
    expect(first.params.amount).toBe(1);
    expect(second.params.amount).toBeCloseTo(1 + 10 ** (-6 / 20) * 2, 6);
  });

  it('evaluates motion-feature automation against the public video feature state', () => {
    const flow = makeInstance('flow', { mix: 0.5 });
    const program = {
      title: 'Motion',
      tagline: 'motion',
      videoIntent: 'motion',
      audioIntent: 'motion',
      operatorFocus: ['flow'],
      values: {
        'flow.mix': 0.5,
      },
      automation: {
        'flow.mix': {
          kind: 'video' as const,
          feature: 'motion' as const,
          scale: 0.25,
          smooth: 0,
        },
      },
    };

    applyProgram(program, [flow]);
    applyProgramAutomation(program, [flow], {
      time: 0,
      videoFeatures: {
        available: true,
        luma: 0,
        flux: 0,
        edge: 0,
        motion: 0.4,
      },
    });

    expect(flow.params.mix).toBeCloseTo(0.6, 6);
  });

  it('resolves macro targets into video, clock, and audio state', () => {
    const program: VideoEffectProgram = {
      title: 'Macro',
      tagline: 'macro',
      videoIntent: 'macro',
      audioIntent: 'macro',
      operatorFocus: ['flow'],
      values: {
        'clock.rate': 0.4,
        'flow.mix': 0.3,
      },
      audio: {
        granulator: { density: 18, gain: 0.42 },
        feedbackDelay: { mix: 0.15 },
      },
      macros: [
        {
          id: 'intensity',
          label: 'Intensity',
          default: 0.5,
          targets: [
            { key: 'clock.rate', min: 0.2, max: 0.8 },
            { key: 'flow.mix', min: 0.1, max: 0.9 },
            { key: 'audio.granulator.density', min: 12, max: 36 },
            { key: 'audio.feedbackDelay.mix', min: 0.08, max: 0.34 },
          ],
        },
      ],
    };

    expect(getProgramMacroDefaults(program)).toEqual({ intensity: 0.5 });

    const resolved = resolveProgramState(program, { intensity: 0.75 });
    expect(resolved.values['clock.rate']).toBeCloseTo(0.65, 6);
    expect(resolved.values['flow.mix']).toBeCloseTo(0.7, 6);
    expect(resolved.audio?.granulator?.density).toBeCloseTo(30, 6);
    expect(resolved.audio?.feedbackDelay?.mix).toBeCloseTo(0.275, 6);
  });

  it('uses macro-resolved base values when evaluating automation', () => {
    const flow = makeInstance('flow', { mix: 0.5 });
    const program: VideoEffectProgram = {
      title: 'Macro Motion',
      tagline: 'macro motion',
      videoIntent: 'macro motion',
      audioIntent: 'macro motion',
      operatorFocus: ['flow'],
      values: {
        'flow.mix': 0.2,
      },
      macros: [
        {
          id: 'motion',
          label: 'Motion',
          default: 0.5,
          targets: [{ key: 'flow.mix', min: 0.1, max: 0.7 }],
        },
      ],
      automation: {
        'flow.mix': {
          kind: 'video',
          feature: 'motion',
          scale: 0.25,
          smooth: 0,
        },
      },
    };

    const resolved = resolveProgramState(program, { motion: 1 });
    applyProgram(resolved.values, [flow]);
    applyProgramAutomation(
      program,
      [flow],
      {
        time: 0,
        videoFeatures: {
          available: true,
          luma: 0,
          flux: 0,
          edge: 0,
          motion: 0.4,
        },
      },
      resolved.values,
    );

    expect(flow.params.mix).toBeCloseTo(0.8, 6);
  });

  it('prefers resolved video feedback when syncing the shared feedback identity', () => {
    const program: VideoEffectProgram = {
      title: 'Shared Feedback',
      tagline: 'shared feedback',
      videoIntent: 'shared feedback',
      audioIntent: 'shared feedback',
      operatorFocus: ['feedback'],
      values: {
        'feedback.feedback': 0.32,
      },
      audio: {
        feedbackDelay: { feedback: 0.18, mix: 0.2 },
      },
      macros: [
        {
          id: 'intensity',
          label: 'Intensity',
          default: 0.4,
          targets: [{ key: 'feedback.feedback', min: 0.2, max: 0.74 }],
        },
      ],
    };

    const resolved = resolveProgramState(program, { intensity: 1 });

    expect(getResolvedProgramSharedFeedback(resolved)).toBeCloseTo(0.74, 6);
    expect(resolved.audio?.feedbackDelay?.feedback).toBeCloseTo(0.18, 6);
  });

  it('respects explicit program chain order before appending extra ops', () => {
    const ordered = getOrderedProgramOps(
      {
        title: 'Chain',
        tagline: 'chain',
        videoIntent: 'chain',
        audioIntent: 'chain',
        operatorFocus: ['color'],
        chain: ['color', 'rotate'],
        values: {
          'rotate.angle': 0.1,
          'color.r': 0.5,
          'modulate.amount': 0.2,
        },
      },
      ['modulate', 'rotate', 'color'],
    );

    expect(ordered).toEqual(['color', 'rotate', 'modulate']);
  });

  it('preserves duplicate operators in explicit program chain order', () => {
    const ordered = getOrderedProgramOps(
      {
        title: 'Graph',
        tagline: 'graph',
        videoIntent: 'graph',
        audioIntent: 'graph',
        operatorFocus: ['color', 'rotate'],
        chain: ['color', 'rotate', 'color', 'rotate'],
        values: {
          'color#0.r': 2,
          'rotate#1.angle': 0.2,
        },
      },
      ['rotate', 'color'],
    );

    expect(ordered).toEqual(['color', 'rotate', 'color', 'rotate']);
  });
});

describe('applyProgramAudio', () => {
  function program(audio: VideoEffectProgram['audio']): VideoEffectProgram {
    return {
      title: 'demo',
      tagline: 'demo',
      videoIntent: 'demo',
      audioIntent: 'demo',
      operatorFocus: [],
      values: {},
      audio,
    };
  }

  it('routes every granulator value through the callback', () => {
    const calls: string[] = [];
    applyProgramAudio(
      program({
        granulator: {
          density: 35,
          duration: 70,
          gain: 0.55,
          envelope: 'hann',
          mode: 'cloud',
          quality: 'high',
        },
        feedbackDelay: { time: 0.28, feedback: 0.78, mix: 0.42 },
      }),
      {
        setGranulatorParam: (name, value) => calls.push(`${name}:${value}`),
        setGranulatorEnvelope: (value) => calls.push(`envelope:${value}`),
        setGranulatorMode: (value) => calls.push(`mode:${value}`),
        setGranulatorQuality: (value) => calls.push(`quality:${value}`),
        setFeedbackDelayParam: (name, value) => calls.push(`delay-${name}:${value}`),
      },
    );
    expect(calls).toEqual([
      'density:35',
      'duration:70',
      'gain:0.55',
      'envelope:hann',
      'mode:cloud',
      'quality:high',
      'delay-time:0.28',
      'delay-feedback:0.78',
      'delay-mix:0.42',
    ]);
  });

  it('is a no-op when the program has no audio block', () => {
    const calls: string[] = [];
    applyProgramAudio(program(undefined), {
      setGranulatorParam: (name, value) => calls.push(`${name}:${value}`),
    });
    expect(calls).toEqual([]);
  });

  it('applies a feedback-delay-only audio block without a granulator block', () => {
    const calls: string[] = [];
    applyProgramAudio(
      program({
        feedbackDelay: { time: 0.31, feedback: 0.74, mix: 0.28 },
      }),
      {
        setFeedbackDelayParam: (name, value) => calls.push(`${name}:${value}`),
      },
    );
    expect(calls).toEqual(['time:0.31', 'feedback:0.74', 'mix:0.28']);
  });

  it('skips invalid numeric and enum values', () => {
    const calls: string[] = [];
    applyProgramAudio(
      program({
        granulator: {
          density: NaN,
          duration: Infinity,
          gain: 0.4,
          envelope: 'bogus' as 'hann',
          mode: '???' as 'classic',
        },
      }),
      {
        setGranulatorParam: (name, value) => calls.push(`${name}:${value}`),
        setGranulatorEnvelope: (value) => calls.push(`envelope:${value}`),
        setGranulatorMode: (value) => calls.push(`mode:${value}`),
        setGranulatorQuality: (value) => calls.push(`quality:${value}`),
      },
    );
    expect(calls).toEqual(['gain:0.4']);
  });

  it('applies a resolved audio state without a full program wrapper', () => {
    const calls: string[] = [];
    applyProgramAudioState(
      {
        granulator: { density: 28, gain: 0.5 },
        feedbackDelay: { mix: 0.22 },
      },
      {
        setGranulatorParam: (name, value) => calls.push(`${name}:${value}`),
        setFeedbackDelayParam: (name, value) => calls.push(`${name}:${value}`),
      },
    );
    expect(calls).toEqual(['density:28', 'gain:0.5', 'mix:0.22']);
  });
});
