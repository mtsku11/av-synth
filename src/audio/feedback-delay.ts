// Cross-coupled stereo feedback delay (spec §15 step 7).
//
// Topology (stereo, per spec):
//   inL ─→ sumL ─→ delayL ─→ dampL ─┬─→ a·L → sumL
//                                   └─→ b·L → sumR
//   inR ─→ sumR ─→ delayR ─→ dampR ─┬─→ a·R → sumR
//                                   └─→ b·R → sumL
//   wet = merge(delayL, delayR) · mix
//   dry = input · (1 - mix)
//   out = wet + dry
//
// a = feedback · cos(cross), b = feedback · sin(cross). cross=0 is pure self-feedback,
// π/4 is ping-pong, π/2 swaps the channels completely. Feedback hard-clamped to 0.99 so
// even at full cross there is no runaway; damping in the loop keeps high frequencies in
// check.

export const FEEDBACK_DELAY_LIMITS = {
  timeMinSec: 0.005,
  timeMaxSec: 4,
  feedbackMax: 0.99,
  dampingMinHz: 200,
  dampingMaxHz: 20000,
  crossMin: 0,
  crossMax: Math.PI / 2,
  mixMin: 0,
  mixMax: 1,
} as const;

export interface CouplingGains {
  readonly a: number;
  readonly b: number;
}

export function clampFeedback(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  if (value > FEEDBACK_DELAY_LIMITS.feedbackMax) return FEEDBACK_DELAY_LIMITS.feedbackMax;
  return value;
}

export function clampCross(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < FEEDBACK_DELAY_LIMITS.crossMin) return FEEDBACK_DELAY_LIMITS.crossMin;
  if (value > FEEDBACK_DELAY_LIMITS.crossMax) return FEEDBACK_DELAY_LIMITS.crossMax;
  return value;
}

export function clampTimeSec(value: number): number {
  if (!Number.isFinite(value) || value < FEEDBACK_DELAY_LIMITS.timeMinSec) {
    return FEEDBACK_DELAY_LIMITS.timeMinSec;
  }
  if (value > FEEDBACK_DELAY_LIMITS.timeMaxSec) return FEEDBACK_DELAY_LIMITS.timeMaxSec;
  return value;
}

export function clampDampingHz(value: number): number {
  if (!Number.isFinite(value) || value < FEEDBACK_DELAY_LIMITS.dampingMinHz) {
    return FEEDBACK_DELAY_LIMITS.dampingMinHz;
  }
  if (value > FEEDBACK_DELAY_LIMITS.dampingMaxHz) return FEEDBACK_DELAY_LIMITS.dampingMaxHz;
  return value;
}

export function clampMix(value: number): number {
  if (!Number.isFinite(value) || value < FEEDBACK_DELAY_LIMITS.mixMin) {
    return FEEDBACK_DELAY_LIMITS.mixMin;
  }
  if (value > FEEDBACK_DELAY_LIMITS.mixMax) return FEEDBACK_DELAY_LIMITS.mixMax;
  return value;
}

export function couplingGains(feedback: number, cross: number): CouplingGains {
  const fb = clampFeedback(feedback);
  const c = clampCross(cross);
  return { a: fb * Math.cos(c), b: fb * Math.sin(c) };
}

export interface FeedbackDelayOptions {
  time?: number;
  feedback?: number;
  damping?: number;
  cross?: number;
  mix?: number;
}

export class FeedbackDelay {
  readonly ctx: BaseAudioContext;
  readonly input: GainNode;
  readonly output: GainNode;

  #splitter: ChannelSplitterNode;
  #merger: ChannelMergerNode;
  #sumL: GainNode;
  #sumR: GainNode;
  #delayL: DelayNode;
  #delayR: DelayNode;
  #dampL: BiquadFilterNode;
  #dampR: BiquadFilterNode;
  #fbLL: GainNode;
  #fbLR: GainNode;
  #fbRR: GainNode;
  #fbRL: GainNode;
  #wet: GainNode;
  #dry: GainNode;

  #feedback = 0.5;
  #cross = 0;
  #disposed = false;

  constructor(ctx: BaseAudioContext, opts: FeedbackDelayOptions = {}) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();

    this.#splitter = ctx.createChannelSplitter(2);
    this.#merger = ctx.createChannelMerger(2);
    this.#sumL = ctx.createGain();
    this.#sumR = ctx.createGain();
    this.#delayL = ctx.createDelay(FEEDBACK_DELAY_LIMITS.timeMaxSec);
    this.#delayR = ctx.createDelay(FEEDBACK_DELAY_LIMITS.timeMaxSec);
    this.#dampL = ctx.createBiquadFilter();
    this.#dampR = ctx.createBiquadFilter();
    this.#fbLL = ctx.createGain();
    this.#fbLR = ctx.createGain();
    this.#fbRR = ctx.createGain();
    this.#fbRL = ctx.createGain();
    this.#wet = ctx.createGain();
    this.#dry = ctx.createGain();

    this.#dampL.type = 'lowpass';
    this.#dampR.type = 'lowpass';
    this.#dampL.Q.value = Math.SQRT1_2;
    this.#dampR.Q.value = Math.SQRT1_2;

    this.input.connect(this.#splitter);
    this.#splitter.connect(this.#sumL, 0);
    this.#splitter.connect(this.#sumR, 1);

    this.#sumL.connect(this.#delayL);
    this.#sumR.connect(this.#delayR);

    this.#delayL.connect(this.#dampL);
    this.#delayR.connect(this.#dampR);

    this.#dampL.connect(this.#fbLL).connect(this.#sumL);
    this.#dampL.connect(this.#fbLR).connect(this.#sumR);
    this.#dampR.connect(this.#fbRR).connect(this.#sumR);
    this.#dampR.connect(this.#fbRL).connect(this.#sumL);

    this.#delayL.connect(this.#merger, 0, 0);
    this.#delayR.connect(this.#merger, 0, 1);
    this.#merger.connect(this.#wet).connect(this.output);
    this.input.connect(this.#dry).connect(this.output);

    const time = clampTimeSec(opts.time ?? 0.25);
    const damping = clampDampingHz(opts.damping ?? 6000);
    const mix = clampMix(opts.mix ?? 0.35);
    this.#feedback = clampFeedback(opts.feedback ?? 0.5);
    this.#cross = clampCross(opts.cross ?? 0);

    this.#delayL.delayTime.value = time;
    this.#delayR.delayTime.value = time;
    this.#dampL.frequency.value = damping;
    this.#dampR.frequency.value = damping;
    this.#wet.gain.value = mix;
    this.#dry.gain.value = 1 - mix;
    this.#applyCouplingGains();
  }

  setTime(seconds: number, atTime?: number): void {
    const t = clampTimeSec(seconds);
    const when = atTime ?? this.ctx.currentTime;
    this.#delayL.delayTime.setValueAtTime(t, when);
    this.#delayR.delayTime.setValueAtTime(t, when);
  }

  setFeedback(amount: number, atTime?: number): void {
    this.#feedback = clampFeedback(amount);
    this.#applyCouplingGains(atTime);
  }

  setCross(theta: number, atTime?: number): void {
    this.#cross = clampCross(theta);
    this.#applyCouplingGains(atTime);
  }

  setDamping(frequencyHz: number, atTime?: number): void {
    const f = clampDampingHz(frequencyHz);
    const when = atTime ?? this.ctx.currentTime;
    this.#dampL.frequency.setValueAtTime(f, when);
    this.#dampR.frequency.setValueAtTime(f, when);
  }

  setMix(mix: number, atTime?: number): void {
    const m = clampMix(mix);
    const when = atTime ?? this.ctx.currentTime;
    this.#wet.gain.setValueAtTime(m, when);
    this.#dry.gain.setValueAtTime(1 - m, when);
  }

  get feedback(): number {
    return this.#feedback;
  }
  get cross(): number {
    return this.#cross;
  }

  #applyCouplingGains(atTime?: number): void {
    const { a, b } = couplingGains(this.#feedback, this.#cross);
    const when = atTime ?? this.ctx.currentTime;
    this.#fbLL.gain.setValueAtTime(a, when);
    this.#fbRR.gain.setValueAtTime(a, when);
    this.#fbLR.gain.setValueAtTime(b, when);
    this.#fbRL.gain.setValueAtTime(b, when);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    try {
      this.input.disconnect();
      this.output.disconnect();
      this.#splitter.disconnect();
      this.#merger.disconnect();
      this.#sumL.disconnect();
      this.#sumR.disconnect();
      this.#delayL.disconnect();
      this.#delayR.disconnect();
      this.#dampL.disconnect();
      this.#dampR.disconnect();
      this.#fbLL.disconnect();
      this.#fbLR.disconnect();
      this.#fbRR.disconnect();
      this.#fbRL.disconnect();
      this.#wet.disconnect();
      this.#dry.disconnect();
    } catch {
      // ignore — context may already be torn down
    }
  }
}
