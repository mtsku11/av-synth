// granulator-v1 — av-synth granulator AudioWorklet.
//
// Implements spec §15 steps 2 (skeleton) + 3 (sinc/anti-alias/reverse) + 4 (envelopes/modes/full
// parameter list/voice stealing) of references/granulator-port-spec.md. The shipped path is
// 8-tap windowed sinc by default, with a 4-point Hermite fallback selected automatically when
// active voice / pitch load crosses the current CPU budget.
//
// All AudioParams are k-rate (read once per process() block) per the spec's worklet header policy.
// Per-grain randomisation: each voice carries its own xorshift32 seed advanced from a master PRNG.
// AV-coupling identical-statistics rule (spec §7) is honoured by exposing the master seed for
// future video-twin reuse — the same seed advance will drive the video grain pool.

const ENV_TABLE_LEN = 2048;
const SINC_PHASES = 256;
const SINC_TAPS = 8;
const KAISER_BETA = 8.6;
const POOL_SIZE = 64;
const MIDI_CHANNELS = 16;
const STEAL_FADE_SAMPLES = 64;
const INTERP_SINC = 0;
const INTERP_HERMITE = 1;
const INTERP_COST_BUDGET = 192;
// Voice-count-aware normalisation: divide output by √(active voices) to keep
// the sum of uncorrelated grains bounded (gate #6, spec §13). Smoothed over
// ~30 ms to avoid zipper noise as polyphony changes.
const NORM_SMOOTH_TAU_S = 0.030;

const ENV_HANN = 0;
const ENV_TUKEY25 = 1;
const ENV_GAUSSIAN = 2;
const ENV_EXPDEC = 3;
const ENV_REXPDEC = 4;
const ENV_COUNT = 5;

const MODE_CLASSIC = 0;
const MODE_LOOP = 1;
const MODE_CLOUD = 2;

function besselI0(x) {
  let sum = 1;
  let term = 1;
  const halfXSq = (x * 0.5) ** 2;
  for (let k = 1; k < 80; k++) {
    term *= halfXSq / (k * k);
    sum += term;
    if (term < 1e-15 * sum) break;
  }
  return sum;
}

function kaiserSampled(t, halfWidth, beta, i0Beta) {
  const arg = 1 - (t / halfWidth) ** 2;
  if (arg <= 0) return 0;
  return besselI0(beta * Math.sqrt(arg)) / i0Beta;
}

function sincSampled(t) {
  if (t === 0) return 1;
  const pt = Math.PI * t;
  return Math.sin(pt) / pt;
}

function buildSincLut() {
  const lut = new Float32Array(SINC_PHASES * SINC_TAPS);
  const halfWidth = SINC_TAPS / 2; // 4
  const i0Beta = besselI0(KAISER_BETA);
  for (let phase = 0; phase < SINC_PHASES; phase++) {
    const frac = phase / SINC_PHASES;
    let rowSum = 0;
    for (let k = 0; k < SINC_TAPS; k++) {
      const m = k - 3; // tap offsets relative to i0: -3..+4
      const t = m - frac;
      const c = sincSampled(t) * kaiserSampled(t, halfWidth, KAISER_BETA, i0Beta);
      lut[phase * SINC_TAPS + k] = c;
      rowSum += c;
    }
    if (rowSum !== 0) {
      const inv = 1 / rowSum;
      for (let k = 0; k < SINC_TAPS; k++) {
        lut[phase * SINC_TAPS + k] *= inv;
      }
    }
  }
  return lut;
}

function buildEnvelopeLuts() {
  const N = ENV_TABLE_LEN;
  const luts = new Array(ENV_COUNT);

  const hann = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)));
  }
  luts[ENV_HANN] = hann;

  // tukey-25: flat top, 25% Hann fade at each end
  const tukey = new Float32Array(N);
  const fadeLen = Math.max(1, (N * 0.25) | 0);
  for (let i = 0; i < N; i++) {
    if (i < fadeLen) {
      tukey[i] = 0.5 * (1 - Math.cos((Math.PI * i) / fadeLen));
    } else if (i >= N - fadeLen) {
      tukey[i] = 0.5 * (1 - Math.cos((Math.PI * (N - 1 - i)) / fadeLen));
    } else {
      tukey[i] = 1;
    }
  }
  luts[ENV_TUKEY25] = tukey;

  // gaussian: exp(-((n - N/2) / (0.4·N))²)
  const gauss = new Float32Array(N);
  const center = (N - 1) / 2;
  const sigma = 0.4 * N;
  for (let i = 0; i < N; i++) {
    const u = (i - center) / sigma;
    gauss[i] = Math.exp(-u * u);
  }
  luts[ENV_GAUSSIAN] = gauss;

  // expdec: exp(-n/(N/4)) with a 48-sample linear tail to zero (click-free landing)
  const expdec = new Float32Array(N);
  const tau = N / 4;
  const tailLen = 48;
  const tailStart = N - tailLen;
  for (let i = 0; i < N; i++) {
    let v = Math.exp(-i / tau);
    if (i >= tailStart) {
      v *= (N - 1 - i) / (tailLen - 1);
    }
    expdec[i] = v;
  }
  luts[ENV_EXPDEC] = expdec;

  // rexpdec: time-reversed expdec
  const rexpdec = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    rexpdec[i] = expdec[N - 1 - i];
  }
  luts[ENV_REXPDEC] = rexpdec;

  return luts;
}

// Mirrors midi.ts velocityToGain (gamma 0.7). Kept here so the worklet stays
// self-contained — the ≤5 ms note-on path must not depend on main-thread imports.
function velocityToGainWorklet(velocity) {
  if (!Number.isFinite(velocity) || velocity <= 0) return 0;
  if (velocity >= 127) return 1;
  return Math.pow(velocity / 127, 0.7);
}

function xorshift32(state, idx) {
  let x = state[idx] | 0;
  if (x === 0) x = 0x9e3779b9 | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  state[idx] = x >>> 0;
  return (x >>> 0) / 0x100000000;
}

function hermite4(y0, y1, y2, y3, t) {
  const c0 = y1;
  const c1 = 0.5 * (y2 - y0);
  const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
  const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
  return ((c3 * t + c2) * t + c1) * t + c0;
}

const SINC_LUT = buildSincLut();
const ENV_LUTS = buildEnvelopeLuts();

class GranulatorV1Processor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'position',           defaultValue: 0.5, minValue: 0,   maxValue: 1,    automationRate: 'k-rate' },
      { name: 'positionJitter',     defaultValue: 0,   minValue: 0,   maxValue: 1,    automationRate: 'k-rate' },
      { name: 'pitch',              defaultValue: 0,   minValue: -48, maxValue: 48,   automationRate: 'k-rate' },
      { name: 'pitchJitter',        defaultValue: 0,   minValue: 0,   maxValue: 24,   automationRate: 'k-rate' },
      { name: 'duration',           defaultValue: 80,  minValue: 5,   maxValue: 2000, automationRate: 'k-rate' },
      { name: 'durationJitter',     defaultValue: 0,   minValue: 0,   maxValue: 1,    automationRate: 'k-rate' },
      { name: 'density',            defaultValue: 20,  minValue: 0.1, maxValue: 200,  automationRate: 'k-rate' },
      { name: 'distribution',       defaultValue: 0,   minValue: 0,   maxValue: 1,    automationRate: 'k-rate' },
      { name: 'envelope',           defaultValue: 0,   minValue: 0,   maxValue: 4,    automationRate: 'k-rate' },
      { name: 'panSpread',          defaultValue: 0,   minValue: 0,   maxValue: 1,    automationRate: 'k-rate' },
      { name: 'ySpread',            defaultValue: 0,   minValue: 0,   maxValue: 1,    automationRate: 'k-rate' },
      { name: 'reverseProbability', defaultValue: 0,   minValue: 0,   maxValue: 1,    automationRate: 'k-rate' },
      { name: 'voiceCount',         defaultValue: 32,  minValue: 1,   maxValue: 64,   automationRate: 'k-rate' },
      { name: 'mode',               defaultValue: 0,   minValue: 0,   maxValue: 2,    automationRate: 'k-rate' },
      { name: 'gain',               defaultValue: 0.7, minValue: 0,   maxValue: 1,    automationRate: 'k-rate' },
    ];
  }

  constructor(_options) {
    super();

    this.vActive    = new Uint8Array(POOL_SIZE);
    this.vFading    = new Uint8Array(POOL_SIZE);
    this.vFadeRem   = new Int32Array(POOL_SIZE);
    this.vStart     = new Float32Array(POOL_SIZE);
    this.vRatio     = new Float32Array(POOL_SIZE);
    this.vPitchRand = new Float32Array(POOL_SIZE);
    this.vDur       = new Int32Array(POOL_SIZE);
    this.vElapsed   = new Int32Array(POOL_SIZE);
    this.vSubStart  = new Int32Array(POOL_SIZE);
    this.vPanL      = new Float32Array(POOL_SIZE);
    this.vPanR      = new Float32Array(POOL_SIZE);
    this.vSeed      = new Uint32Array(POOL_SIZE);
    this.vVoiceId   = new Uint32Array(POOL_SIZE);
    this.vEnv       = new Uint8Array(POOL_SIZE);
    this.vAaAlpha   = new Float32Array(POOL_SIZE);
    this.vAaL       = new Float32Array(POOL_SIZE);
    this.vAaR       = new Float32Array(POOL_SIZE);
    this.vGain      = new Float32Array(POOL_SIZE); // per-grain velocity attenuation (1.0 = unattenuated)
    this.vReverse   = new Uint8Array(POOL_SIZE);
    this.vMidiCh    = new Uint8Array(POOL_SIZE);

    // Pending note-on triggers from the main thread (spec §11). Drained at the top of
    // process(); each entry spawns one immediate grain with baked per-grain velocity.
    this.pendingNotes = [];
    this.notePitch = new Float32Array(MIDI_CHANNELS);

    this.masterSeed = new Uint32Array(1);
    this.masterSeed[0] = 0xC0FFEE13;

    this.srcL = null;
    this.srcR = null;
    this.srcLen = 0;
    this.srcReady = false;

    this.samplesUntilNextSpawn = 0;
    this.nextVoiceId = 1;
    this.enabled = false;

    this.classicCursor = 0;
    this.lastPositionK = -1; // sentinel: forces cursor init on first classic-mode block

    // Smoothed √N normalisation gain; tracks 1/√(active voices) over time.
    this.vNormGain = 1.0;
    this.interpMode = INTERP_SINC;

    this.port.onmessage = (ev) => this.handleMessage(ev.data);
  }

  handleMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'load': {
        const channels = msg.channels;
        if (!Array.isArray(channels) || channels.length === 0) return;
        const left = channels[0];
        if (!(left instanceof Float32Array) || left.length === 0) return;
        const right = channels.length > 1 && channels[1] instanceof Float32Array ? channels[1] : left;
        this.srcL = left;
        this.srcR = right;
        this.srcLen = left.length;
        this.srcReady = this.srcLen >= SINC_TAPS;
        this.samplesUntilNextSpawn = 0;
        this.lastPositionK = -1;
        this.port.postMessage({ type: 'loaded', samples: left.length, channels: right === left ? 1 : 2 });
        break;
      }
      case 'enable':
        this.enabled = !!msg.value;
        break;
      case 'clear':
        this.srcReady = false;
        this.srcL = null;
        this.srcR = null;
        this.srcLen = 0;
        for (let i = 0; i < POOL_SIZE; i++) {
          this.vActive[i] = 0;
          this.vFading[i] = 0;
          this.vMidiCh[i] = 0;
        }
        this.notePitch.fill(0);
        this.pendingNotes.length = 0;
        break;
      case 'reseed':
        this.masterSeed[0] = ((msg.seed | 0) >>> 0) || 0xC0FFEE13;
        break;
      case 'noteOn': {
        // Validate at the boundary; ignore malformed triggers rather than crashing the audio thread.
        const pitchSt = Number(msg.pitch);
        const velocity = Number(msg.velocity);
        const channel = msg.channel | 0;
        if (!Number.isFinite(pitchSt) || !Number.isFinite(velocity)) break;
        if (channel >= 1 && channel <= MIDI_CHANNELS) this.notePitch[channel - 1] = pitchSt;
        this.pendingNotes.push({ pitchSt, velocity, channel });
        break;
      }
      case 'noteOff': {
        const channel = msg.channel | 0;
        if (channel >= 1 && channel <= MIDI_CHANNELS) this.releaseChannel(channel);
        break;
      }
      case 'notePitch': {
        const channel = msg.channel | 0;
        const pitchSt = Number(msg.pitch);
        if (channel >= 1 && channel <= MIDI_CHANNELS && Number.isFinite(pitchSt)) {
          this.notePitch[channel - 1] = pitchSt;
          this.updateChannelPitch(channel, pitchSt);
        }
        break;
      }
    }
  }

  releaseChannel(channel) {
    for (let i = 0; i < POOL_SIZE; i++) {
      if (this.vActive[i] && this.vMidiCh[i] === channel) this.vMidiCh[i] = 0;
    }
  }

  updateVoiceRatio(slot, basePitchSt) {
    const grainPitchSt = basePitchSt + this.vPitchRand[slot];
    let ratio = Math.pow(2, grainPitchSt / 12);
    if (this.vReverse[slot]) ratio = -ratio;
    this.vRatio[slot] = ratio;

    const absRatio = ratio < 0 ? -ratio : ratio;
    let aaAlpha = 1;
    if (absRatio > 1) {
      const fc = sampleRate / (2 * absRatio);
      aaAlpha = 1 - Math.exp((-2 * Math.PI * fc) / sampleRate);
    }
    this.vAaAlpha[slot] = aaAlpha;
  }

  updateChannelPitch(channel, pitchSt) {
    for (let i = 0; i < POOL_SIZE; i++) {
      if (this.vActive[i] && this.vMidiCh[i] === channel) this.updateVoiceRatio(i, pitchSt);
    }
  }

  // Returns slot index, or -1 if pool exhausted. Applies voice-stealing fade per spec §5
  // when active-non-fading count meets the voiceCount cap.
  pickSlot(voiceCount) {
    let activeCount = 0;
    for (let i = 0; i < POOL_SIZE; i++) {
      if (this.vActive[i] && !this.vFading[i]) activeCount++;
    }
    if (activeCount >= voiceCount) {
      // FIFO oldest = greatest elapsed
      let oldestIdx = -1;
      let oldestElapsed = -1;
      for (let i = 0; i < POOL_SIZE; i++) {
        if (this.vActive[i] && !this.vFading[i] && this.vElapsed[i] > oldestElapsed) {
          oldestElapsed = this.vElapsed[i];
          oldestIdx = i;
        }
      }
      if (oldestIdx >= 0) {
        this.vFading[oldestIdx] = 1;
        this.vFadeRem[oldestIdx] = STEAL_FADE_SAMPLES;
      }
    }
    for (let i = 0; i < POOL_SIZE; i++) {
      if (this.vActive[i] === 0) return i;
    }
    return -1;
  }

  spawnGrain(
    subStartFrame, mode, voiceCount,
    position, positionJitter, basePitchSt, pitchJitter, duration, durationJitter,
    envelopeIdx, panSpread, ySpread, reverseProb,
    velocityGain = 1, midiChannel = 0,
  ) {
    if (!this.srcReady) return;
    const slot = this.pickSlot(voiceCount);
    if (slot < 0) return;

    // Advance master PRNG and seed this voice (spec §7 — unique-per-spawn seed).
    this.masterSeed[0] = (Math.imul(this.masterSeed[0], 1664525) + 1013904223) >>> 0;
    this.vSeed[slot] = this.masterSeed[0] || 1;
    this.vVoiceId[slot] = this.nextVoiceId++;

    const rPos   = xorshift32(this.vSeed, slot) * 2 - 1;
    const rPitch = xorshift32(this.vSeed, slot) * 2 - 1;
    const rDur   = xorshift32(this.vSeed, slot) * 2 - 1;
    const rPan   = xorshift32(this.vSeed, slot) * 2 - 1;
    const rRev   = xorshift32(this.vSeed, slot);
    // rY is appended after rRev to preserve audio-side seed reproducibility (§7
    // identical-statistics: video twin reuses the same per-grain seed and consumes
    // draws in this canonical order; do not reorder).
    const rY     = xorshift32(this.vSeed, slot) * 2 - 1;

    // Base position depends on mode: classic uses the auto-advancing cursor; loop / cloud read
    // straight off the user-set position.
    const srcLen = this.srcLen;
    let basePos;
    if (mode === MODE_CLASSIC) {
      basePos = this.classicCursor;
    } else {
      const pos01 = position < 0 ? 0 : position > 1 ? 1 : position;
      basePos = pos01 * srcLen;
    }
    const posJitterSamples = rPos * positionJitter * srcLen;
    let startSample = basePos + posJitterSamples;
    if (srcLen > 0) {
      startSample = ((startSample % srcLen) + srcLen) % srcLen;
    }

    const pitchRand = rPitch * pitchJitter;
    let ratio = Math.pow(2, (basePitchSt + pitchRand) / 12);

    const reverseFlag = rRev < reverseProb ? 1 : 0;
    if (reverseFlag) ratio = -ratio;

    const durMs = Math.max(1, duration * (1 + rDur * durationJitter));
    const durSamples = Math.max(16, (durMs * 0.001 * sampleRate) | 0);

    const panNorm = rPan * panSpread;
    const theta = (Math.PI * (panNorm + 1)) / 4;

    const absRatio = ratio < 0 ? -ratio : ratio;
    let aaAlpha = 1; // 1 = pass-through (no IIR smoothing)
    if (absRatio > 1) {
      const fc = sampleRate / (2 * absRatio);
      aaAlpha = 1 - Math.exp((-2 * Math.PI * fc) / sampleRate);
    }

    // Keep the grain's read range inside [3, srcLen-5] so the 8-tap sinc never reads OOB.
    // Clamp startSample to the achievable window. If the source is too short for this duration
    // at this pitch, accept that the grain may produce partial output (render guards each sample).
    const reach = durSamples * absRatio;
    if (reverseFlag) {
      const minStart = 3 + reach;
      if (startSample < minStart) startSample = minStart;
    } else {
      const maxStart = srcLen - 5 - reach;
      if (startSample > maxStart) startSample = maxStart;
    }
    if (startSample < 3) startSample = 3;
    if (startSample > srcLen - 5) startSample = srcLen - 5;

    this.vStart[slot]    = startSample;
    this.vRatio[slot]    = ratio;
    this.vPitchRand[slot]= pitchRand;
    this.vDur[slot]      = durSamples;
    this.vElapsed[slot]  = 0;
    this.vSubStart[slot] = subStartFrame;
    this.vPanL[slot]     = Math.cos(theta);
    this.vPanR[slot]     = Math.sin(theta);
    this.vEnv[slot]      = envelopeIdx;
    this.vAaAlpha[slot]  = aaAlpha;
    this.vAaL[slot]      = 0;
    this.vAaR[slot]      = 0;
    this.vGain[slot]     = velocityGain;
    this.vReverse[slot]  = reverseFlag;
    this.vMidiCh[slot]   = midiChannel >= 1 && midiChannel <= MIDI_CHANNELS ? midiChannel : 0;
    this.vFading[slot]   = 0;
    this.vFadeRem[slot]  = 0;
    this.vActive[slot]   = 1;

    // Voice-event channel for the video grain twin (spec §15 step 6). Resolved per-grain
    // values are baked into the event so the video side never needs its own PRNG — the
    // identical-statistics rule reduces to "consume the same draws in the same order".
    // spawnTime is the absolute AudioContext time at sub-block offset subStartFrame.
    this.port.postMessage({
      type: 'grain',
      voiceId: this.vVoiceId[slot],
      seed: this.vSeed[slot],
      spawnTime: currentTime + subStartFrame / sampleRate,
      durationSec: durSamples / sampleRate,
      positionSec: startSample / sampleRate,
      pitchRatio: ratio,
      panX: panNorm,
      panY: rY * ySpread,
      reverse: reverseFlag,
      envelopeIndex: envelopeIdx,
    });
  }

  process(_inputs, outputs, parameters) {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const outL = out[0];
    const outR = out.length > 1 ? out[1] : out[0];
    const N = outL.length;

    for (let i = 0; i < N; i++) {
      outL[i] = 0;
      if (outR !== outL) outR[i] = 0;
    }

    if (!this.enabled || !this.srcReady) return true;

    const position           = parameters.position[0];
    const positionJitter     = parameters.positionJitter[0];
    const pitchSt            = parameters.pitch[0];
    const pitchJitter        = parameters.pitchJitter[0];
    const duration           = parameters.duration[0];
    const durationJitter     = parameters.durationJitter[0];
    const density            = Math.max(0.1, parameters.density[0]);
    const distribution       = parameters.distribution[0];
    const envelopeIdx        = Math.max(0, Math.min(ENV_COUNT - 1, parameters.envelope[0] | 0));
    const panSpread          = parameters.panSpread[0];
    const ySpread            = parameters.ySpread[0];
    const reverseProbability = parameters.reverseProbability[0];
    const voiceCount         = Math.max(1, Math.min(POOL_SIZE, parameters.voiceCount[0] | 0));
    const mode               = Math.max(0, Math.min(2, parameters.mode[0] | 0));
    const gain               = parameters.gain[0];

    const basePitchRatio = Math.pow(2, pitchSt / 12);
    const meanSamplesPerGrain = Math.max(1, (sampleRate / density) | 0);

    if (mode === MODE_CLASSIC) {
      // Threshold-based detection — small modulation drift tolerated; user scrubs reset the cursor.
      if (this.lastPositionK < 0 || Math.abs(position - this.lastPositionK) > 0.001) {
        this.classicCursor = position * this.srcLen;
      }
    }
    this.lastPositionK = position;

    // Drain pending note triggers first so the spec §11 latency budget is one process()
    // block (≈3 ms at 48 kHz / 128 frames). Each note-on becomes one immediate grain at
    // subStartFrame=0 with baked per-grain velocity gain. Triggered-note pitch now stays
    // local to the tagged grain voices; the ambient cloud remains on the shared `pitch`
    // AudioParam.
    if (this.pendingNotes.length > 0) {
      for (let i = 0; i < this.pendingNotes.length; i++) {
        const note = this.pendingNotes[i];
        this.spawnGrain(
          0, mode, voiceCount,
          position, positionJitter, note.pitchSt, pitchJitter, duration, durationJitter,
          envelopeIdx, panSpread, ySpread, reverseProbability,
          velocityToGainWorklet(note.velocity), note.channel,
        );
      }
      this.pendingNotes.length = 0;
    }

    let scanCursor = 0;
    while (scanCursor < N) {
      if (this.samplesUntilNextSpawn <= 0) {
        this.spawnGrain(
          scanCursor, mode, voiceCount,
          position, positionJitter, pitchSt, pitchJitter, duration, durationJitter,
          envelopeIdx, panSpread, ySpread, reverseProbability,
        );
        if (mode === MODE_CLOUD && distribution > 0) {
          this.masterSeed[0] = (Math.imul(this.masterSeed[0], 1664525) + 1013904223) >>> 0;
          const u = (this.masterSeed[0] >>> 0) / 0x100000000;
          const poissonSamples = -Math.log(Math.max(1e-9, u)) * meanSamplesPerGrain;
          const interval = (1 - distribution) * meanSamplesPerGrain + distribution * poissonSamples;
          this.samplesUntilNextSpawn = Math.max(1, interval | 0);
        } else {
          this.samplesUntilNextSpawn = meanSamplesPerGrain;
        }
      }
      const step = Math.min(this.samplesUntilNextSpawn, N - scanCursor);
      scanCursor += step;
      this.samplesUntilNextSpawn -= step;
    }

    if (mode === MODE_CLASSIC && this.srcLen > 0) {
      this.classicCursor += basePitchRatio * N;
      this.classicCursor = ((this.classicCursor % this.srcLen) + this.srcLen) % this.srcLen;
    }

    // Count active voices (incl. fading) for √N normalisation. Smooth toward
    // the target divisor with a single-pole filter so polyphony changes don't
    // cause zipper noise.
    let activeNow = 0;
    for (let i = 0; i < POOL_SIZE; i++) {
      if (this.vActive[i]) activeNow++;
    }
    const targetNormGain = 1.0 / Math.sqrt(activeNow > 0 ? activeNow : 1);
    const alpha = 1 - Math.exp(-N / (sampleRate * NORM_SMOOTH_TAU_S));
    this.vNormGain += (targetNormGain - this.vNormGain) * alpha;

    let pitchLoad = 0;
    for (let i = 0; i < POOL_SIZE; i++) {
      if (!this.vActive[i]) continue;
      const ratio = this.vRatio[i];
      pitchLoad += Math.max(1, ratio < 0 ? -ratio : ratio);
    }
    const nextInterpMode =
      pitchLoad * SINC_TAPS > INTERP_COST_BUDGET ? INTERP_HERMITE : INTERP_SINC;
    if (nextInterpMode !== this.interpMode) {
      this.interpMode = nextInterpMode;
      this.port.postMessage({
        type: 'interpMode',
        mode: nextInterpMode === INTERP_HERMITE ? 'hermite' : 'sinc',
      });
    }

    this.renderActiveVoices(outL, outR, N, gain * this.vNormGain, this.interpMode);

    if (outR !== outL) {
      const midGain = Math.cos((ySpread * Math.PI) / 2);
      const sideGain = Math.sin((ySpread * Math.PI) / 2);
      for (let n = 0; n < N; n++) {
        const L = outL[n];
        const R = outR[n];
        const mid = (L + R) * 0.5;
        const side = (L - R) * 0.5;
        outL[n] = mid * midGain + side * sideGain;
        outR[n] = mid * midGain - side * sideGain;
      }
    }

    return true;
  }

  renderActiveVoices(outL, outR, N, gain, interpMode) {
    const sincLut = SINC_LUT;
    const srcL = this.srcL;
    const srcR = this.srcR;
    const stereo = outR !== outL;
    const useHermite = interpMode === INTERP_HERMITE;
    const srcMinIdx = useHermite ? 1 : 3;
    const srcMaxIdx = useHermite ? this.srcLen - 3 : this.srcLen - 5;
    const envMaxIdx = ENV_TABLE_LEN - 1;

    for (let v = 0; v < POOL_SIZE; v++) {
      if (this.vActive[v] === 0) continue;

      const start = this.vStart[v];
      const ratio = this.vRatio[v];
      const dur = this.vDur[v];
      const vG = this.vGain[v];
      const panLgain = this.vPanL[v] * gain * vG;
      const panRgain = this.vPanR[v] * gain * vG;
      const envLut = ENV_LUTS[this.vEnv[v]];
      const aaAlpha = this.vAaAlpha[v];
      const aaActive = aaAlpha > 0 && aaAlpha < 1;
      const fading = this.vFading[v] === 1;
      const subStart = this.vSubStart[v];

      let elapsed = this.vElapsed[v];
      let aaL = this.vAaL[v];
      let aaR = this.vAaR[v];
      let fadeRem = this.vFadeRem[v];

      for (let n = subStart; n < N; n++) {
        if (elapsed >= dur) break;
        if (fading && fadeRem <= 0) break;

        const envPos = (elapsed / dur) * envMaxIdx;
        const ei = envPos | 0;
        const ef = envPos - ei;
        const e0 = envLut[ei];
        const e1 = ei < envMaxIdx ? envLut[ei + 1] : e0;
        let envVal = e0 + (e1 - e0) * ef;

        if (fading) {
          envVal *= fadeRem / STEAL_FADE_SAMPLES;
          fadeRem--;
        }

        const rp = start + elapsed * ratio;
        if (rp < srcMinIdx || rp > srcMaxIdx) {
          elapsed++;
          continue;
        }

        const i0Idx = rp | 0;
        const frac = rp - i0Idx;
        let sL;
        let sR;
        if (useHermite) {
          const base = i0Idx - 1;
          sL = hermite4(
            srcL[base],
            srcL[base + 1],
            srcL[base + 2],
            srcL[base + 3],
            frac,
          );
          if (srcR === srcL) {
            sR = sL;
          } else {
            sR = hermite4(
              srcR[base],
              srcR[base + 1],
              srcR[base + 2],
              srcR[base + 3],
              frac,
            );
          }
        } else {
          const phase = (frac * SINC_PHASES) | 0;
          const off = phase * SINC_TAPS;
          const base = i0Idx - 3;
          const c0 = sincLut[off];
          const c1 = sincLut[off + 1];
          const c2 = sincLut[off + 2];
          const c3 = sincLut[off + 3];
          const c4 = sincLut[off + 4];
          const c5 = sincLut[off + 5];
          const c6 = sincLut[off + 6];
          const c7 = sincLut[off + 7];

          sL =
            srcL[base]     * c0 + srcL[base + 1] * c1 +
            srcL[base + 2] * c2 + srcL[base + 3] * c3 +
            srcL[base + 4] * c4 + srcL[base + 5] * c5 +
            srcL[base + 6] * c6 + srcL[base + 7] * c7;
          if (srcR === srcL) {
            sR = sL;
          } else {
            sR =
              srcR[base]     * c0 + srcR[base + 1] * c1 +
              srcR[base + 2] * c2 + srcR[base + 3] * c3 +
              srcR[base + 4] * c4 + srcR[base + 5] * c5 +
              srcR[base + 6] * c6 + srcR[base + 7] * c7;
          }
        }

        if (aaActive) {
          aaL += aaAlpha * (sL - aaL);
          aaR += aaAlpha * (sR - aaR);
          sL = aaL;
          sR = aaR;
        }

        outL[n] += sL * envVal * panLgain;
        if (stereo) outR[n] += sR * envVal * panRgain;

        elapsed++;
      }

      this.vElapsed[v] = elapsed;
      this.vSubStart[v] = 0;
      this.vAaL[v] = aaL;
      this.vAaR[v] = aaR;
      this.vFadeRem[v] = fadeRem;

      if (elapsed >= dur || (fading && fadeRem <= 0)) {
        this.vActive[v] = 0;
        this.vFading[v] = 0;
      }
    }
  }
}

registerProcessor('granulator-v1', GranulatorV1Processor);
