// granulator-v1 — av-synth granulator AudioWorklet.
//
// Implements spec §15 steps 2 (skeleton) + 3 (sinc/anti-alias/reverse) + 4 (envelopes/modes/full
// parameter list/voice stealing) of references/granulator-port-spec.md. The shipped path is
// 8-tap windowed sinc by default, with a 4-point Hermite fallback selected automatically when
// active voice / pitch load crosses the current CPU budget.
//
// Granulator controls arrive through a shared control snapshot when SharedArrayBuffer is available,
// with a port-message fallback for non-isolated sessions. Per-grain randomisation: each voice
// carries its own xorshift32 seed advanced from a master PRNG.
// AV-coupling identical-statistics rule (spec §7) is honoured by exposing the master seed for
// future video-twin reuse — the same seed advance will drive the video grain pool.

const ENV_TABLE_LEN = 2048;
const SINC_PHASES = 256;
const SINC_TAPS = 8;
const KAISER_BETA = 8.6;
const POOL_SIZE = 64;
const MIDI_CHANNELS = 16;
const PENDING_NOTE_CAPACITY = 128;
const STEAL_FADE_SAMPLES = 64;
const INTERP_SINC = 0;
const INTERP_HERMITE = 1;
const INTERP_COST_BUDGET = 192;
const GRAIN_EVENT_RING_CAPACITY = 2048;
const GRAIN_EVENT_RING_FIELDS = 10;
const GRAIN_EVENT_WRITE_SEQ_IDX = 0;
const GRAIN_EVENT_F_VOICE_ID = 0;
const GRAIN_EVENT_F_SEED = 1;
const GRAIN_EVENT_F_SPAWN_TIME = 2;
const GRAIN_EVENT_F_DURATION_SEC = 3;
const GRAIN_EVENT_F_POSITION_SEC = 4;
const GRAIN_EVENT_F_PITCH_RATIO = 5;
const GRAIN_EVENT_F_PAN_X = 6;
const GRAIN_EVENT_F_PAN_Y = 7;
const GRAIN_EVENT_F_REVERSE = 8;
const GRAIN_EVENT_F_ENVELOPE_INDEX = 9;
const RUNTIME_DIAG_RING_FIELDS = 13;
const RUNTIME_DIAG_WRITE_SEQ_IDX = 0;
const RUNTIME_DIAG_SAMPLE_INTERVAL_SEC = 0.125;
const RUNTIME_DIAG_F_REL_TIME_SEC = 0;
const RUNTIME_DIAG_F_ACTIVE_VOICES = 1;
const RUNTIME_DIAG_F_FADING_VOICES = 2;
const RUNTIME_DIAG_F_PITCH_LOAD = 3;
const RUNTIME_DIAG_F_INTERP_MODE = 4;
const RUNTIME_DIAG_F_SAMPLES_UNTIL_NEXT_SPAWN = 5;
const RUNTIME_DIAG_F_NEXT_VOICE_ID = 6;
const RUNTIME_DIAG_F_SPAWN_COUNT = 7;
const RUNTIME_DIAG_F_STEAL_COUNT = 8;
const RUNTIME_DIAG_F_NORM_GAIN = 9;
const RUNTIME_DIAG_F_DENSITY = 10;
const RUNTIME_DIAG_F_VOICE_COUNT = 11;
const RUNTIME_DIAG_F_MEAN_SAMPLES_PER_GRAIN = 12;
// Voice-count-aware normalisation: divide output by √(active voices) to keep
// the sum of uncorrelated grains bounded (gate #6, spec §13). Smoothed over
// ~30 ms to avoid zipper noise as polyphony changes.
const NORM_SMOOTH_TAU_S = 0.03;

const ENV_HANN = 0;
const ENV_TUKEY25 = 1;
const ENV_GAUSSIAN = 2;
const ENV_EXPDEC = 3;
const ENV_REXPDEC = 4;
const ENV_COUNT = 5;
const CONTROL_PARAM_COUNT = 15;
const CONTROL_WRITE_SEQ_IDX = 0;
const CONTROL_POSITION = 0;
const CONTROL_POSITION_JITTER = 1;
const CONTROL_PITCH = 2;
const CONTROL_PITCH_JITTER = 3;
const CONTROL_DURATION = 4;
const CONTROL_DURATION_JITTER = 5;
const CONTROL_DENSITY = 6;
const CONTROL_DISTRIBUTION = 7;
const CONTROL_ENVELOPE = 8;
const CONTROL_PAN_SPREAD = 9;
const CONTROL_Y_SPREAD = 10;
const CONTROL_REVERSE_PROBABILITY = 11;
const CONTROL_VOICE_COUNT = 12;
const CONTROL_MODE = 13;
const CONTROL_GAIN = 14;
const DEFAULT_CONTROL_VALUES = new Float32Array([
  0.5, 0, 0, 0, 80, 0, 20, 0, 0, 0, 0, 0, 32, 0, 0.7,
]);

const MODE_CLASSIC = 0;
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
    return [];
  }

  constructor(options) {
    super();

    this.vActive = new Uint8Array(POOL_SIZE);
    this.vFading = new Uint8Array(POOL_SIZE);
    this.vFadeRem = new Int32Array(POOL_SIZE);
    this.vStart = new Float32Array(POOL_SIZE);
    this.vRatio = new Float32Array(POOL_SIZE);
    this.vPitchRand = new Float32Array(POOL_SIZE);
    this.vDur = new Int32Array(POOL_SIZE);
    this.vElapsed = new Int32Array(POOL_SIZE);
    this.vSubStart = new Int32Array(POOL_SIZE);
    this.vPanL = new Float32Array(POOL_SIZE);
    this.vPanR = new Float32Array(POOL_SIZE);
    this.vSeed = new Uint32Array(POOL_SIZE);
    this.vVoiceId = new Uint32Array(POOL_SIZE);
    this.vEnv = new Uint8Array(POOL_SIZE);
    this.vAaAlpha = new Float32Array(POOL_SIZE);
    this.vAaL = new Float32Array(POOL_SIZE);
    this.vAaR = new Float32Array(POOL_SIZE);
    this.vGain = new Float32Array(POOL_SIZE); // per-grain velocity attenuation (1.0 = unattenuated)
    this.vReverse = new Uint8Array(POOL_SIZE);
    this.vMidiCh = new Uint8Array(POOL_SIZE);

    // Pending note-on triggers from the main thread (spec §11). Kept in fixed-size typed
    // storage so note bursts do not allocate on the worklet thread.
    this.pendingNotePitch = new Float32Array(PENDING_NOTE_CAPACITY);
    this.pendingNoteVelocity = new Float32Array(PENDING_NOTE_CAPACITY);
    this.pendingNoteChannel = new Uint8Array(PENDING_NOTE_CAPACITY);
    this.pendingNoteRead = 0;
    this.pendingNoteWrite = 0;
    this.pendingNoteCount = 0;
    this.notePitch = new Float32Array(MIDI_CHANNELS);

    this.masterSeed = new Uint32Array(1);
    this.masterSeed[0] = 0xc0ffee13;

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
    this.controlHeader = null;
    this.controlData = null;
    this.controlSeq = -1;
    this.controlCache = new Float32Array(DEFAULT_CONTROL_VALUES);
    this.emitInterpModeMessages = true;
    this.emitDiagnosticMessages = false;

    this.grainRingHeader = null;
    this.grainRingData = null;
    this.grainRingWriteSeq = 0;
    this.runtimeDiagHeader = null;
    this.runtimeDiagData = null;
    this.runtimeDiagCapacity = 0;
    this.runtimeDiagWriteSeq = 0;
    this.runtimeDiagElapsedSec = 0;
    this.runtimeDiagNextSampleSec = 0;
    this.totalSpawnCount = 0;
    this.totalStealCount = 0;

    // TEMP DIAGNOSTIC (B2.3 allocation audit): reported from the first process() call
    // because the main-side handler isn't installed until after construction.
    this.diagSabReported = false;

    const processorOptions = options?.processorOptions;
    if (
      processorOptions?.controlHeader instanceof SharedArrayBuffer &&
      processorOptions?.controlData instanceof SharedArrayBuffer
    ) {
      this.controlHeader = new Int32Array(processorOptions.controlHeader);
      this.controlData = new Float32Array(processorOptions.controlData);
      this.controlSeq = Atomics.load(this.controlHeader, CONTROL_WRITE_SEQ_IDX);
      this.controlCache.set(this.controlData);
    }
    if (
      typeof processorOptions?.grainRingCapacity === 'number' &&
      processorOptions?.grainRingHeader instanceof SharedArrayBuffer &&
      processorOptions?.grainRingData instanceof SharedArrayBuffer
    ) {
      this.grainRingHeader = new Int32Array(processorOptions.grainRingHeader);
      this.grainRingData = new Float64Array(processorOptions.grainRingData);
    }
    if (
      typeof processorOptions?.runtimeDiagCapacity === 'number' &&
      processorOptions?.runtimeDiagHeader instanceof SharedArrayBuffer &&
      processorOptions?.runtimeDiagData instanceof SharedArrayBuffer
    ) {
      this.runtimeDiagCapacity = processorOptions.runtimeDiagCapacity | 0;
      this.runtimeDiagHeader = new Int32Array(processorOptions.runtimeDiagHeader);
      this.runtimeDiagData = new Float64Array(processorOptions.runtimeDiagData);
    }
    if (typeof processorOptions?.emitInterpModeMessages === 'boolean') {
      this.emitInterpModeMessages = processorOptions.emitInterpModeMessages;
    }
    if (typeof processorOptions?.emitDiagnosticMessages === 'boolean') {
      this.emitDiagnosticMessages = processorOptions.emitDiagnosticMessages;
    }

    this.port.onmessage = (ev) => this.handleMessage(ev.data);
  }

  applyLoadedSource(left, right) {
    this.srcL = left;
    this.srcR = right;
    this.srcLen = left.length;
    this.srcReady = this.srcLen >= SINC_TAPS;
    this.samplesUntilNextSpawn = 0;
    this.lastPositionK = -1;
    this.resetRuntimeDiagnostics();
    this.port.postMessage({
      type: 'loaded',
      samples: left.length,
      channels: right === left ? 1 : 2,
    });
  }

  handleMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'load': {
        const channels = msg.channels;
        if (!Array.isArray(channels) || channels.length === 0) return;
        const left = channels[0];
        if (!(left instanceof Float32Array) || left.length === 0) return;
        const right =
          channels.length > 1 && channels[1] instanceof Float32Array ? channels[1] : left;
        this.applyLoadedSource(left, right);
        break;
      }
      case 'loadShared': {
        const samples = msg.samples | 0;
        const channels = msg.channels | 0;
        const leftBuffer = msg.left;
        const rightBuffer = msg.right;
        if (!(leftBuffer instanceof SharedArrayBuffer) || samples <= 0) return;
        if (leftBuffer.byteLength < samples * Float32Array.BYTES_PER_ELEMENT) return;
        const left = new Float32Array(leftBuffer, 0, samples);
        let right = left;
        if (channels > 1) {
          if (!(rightBuffer instanceof SharedArrayBuffer)) return;
          if (rightBuffer.byteLength < samples * Float32Array.BYTES_PER_ELEMENT) return;
          right = new Float32Array(rightBuffer, 0, samples);
        }
        this.applyLoadedSource(left, right);
        break;
      }
      case 'enable':
        this.enabled = !!msg.value;
        if (!this.enabled) this.resetRuntimeDiagnostics();
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
        this.pendingNoteRead = 0;
        this.pendingNoteWrite = 0;
        this.pendingNoteCount = 0;
        this.resetRuntimeDiagnostics();
        break;
      case 'reseed':
        this.masterSeed[0] = (msg.seed | 0) >>> 0 || 0xc0ffee13;
        break;
      case 'setControl': {
        const index = msg.index | 0;
        const value = Number(msg.value);
        if (index < 0 || index >= CONTROL_PARAM_COUNT || !Number.isFinite(value)) break;
        this.controlCache[index] = value;
        break;
      }
      case 'setDiagnostics':
        if (typeof msg.emitInterpModeMessages === 'boolean') {
          this.emitInterpModeMessages = msg.emitInterpModeMessages;
        }
        if (typeof msg.emitDiagnosticMessages === 'boolean') {
          this.emitDiagnosticMessages = msg.emitDiagnosticMessages;
        }
        break;
      case 'noteOn': {
        // Validate at the boundary; ignore malformed triggers rather than crashing the audio thread.
        const pitchSt = Number(msg.pitch);
        const velocity = Number(msg.velocity);
        const channel = msg.channel | 0;
        if (!Number.isFinite(pitchSt) || !Number.isFinite(velocity)) break;
        if (channel >= 1 && channel <= MIDI_CHANNELS) this.notePitch[channel - 1] = pitchSt;
        this.enqueuePendingNote(pitchSt, velocity, channel);
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

  enqueuePendingNote(pitchSt, velocity, channel) {
    if (this.pendingNoteCount >= PENDING_NOTE_CAPACITY) {
      this.pendingNoteRead = (this.pendingNoteRead + 1) % PENDING_NOTE_CAPACITY;
      this.pendingNoteCount--;
    }
    const idx = this.pendingNoteWrite;
    this.pendingNotePitch[idx] = pitchSt;
    this.pendingNoteVelocity[idx] = velocity;
    this.pendingNoteChannel[idx] = channel >= 1 && channel <= MIDI_CHANNELS ? channel : 0;
    this.pendingNoteWrite = (idx + 1) % PENDING_NOTE_CAPACITY;
    this.pendingNoteCount++;
  }

  syncSharedControls() {
    const header = this.controlHeader;
    const data = this.controlData;
    if (!header || !data) return;
    const seq = Atomics.load(header, CONTROL_WRITE_SEQ_IDX);
    if (seq === this.controlSeq) return;
    this.controlSeq = seq;
    this.controlCache.set(data);
  }

  readControl(parameters, name, index) {
    const block = parameters[name];
    if (block && block.length > 0) {
      const value = block[0];
      if (Number.isFinite(value)) return value;
    }
    return this.controlCache[index];
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
        this.totalStealCount++;
      }
    }
    for (let i = 0; i < POOL_SIZE; i++) {
      if (this.vActive[i] === 0) return i;
    }
    return -1;
  }

  spawnGrain(
    subStartFrame,
    mode,
    voiceCount,
    position,
    positionJitter,
    basePitchSt,
    pitchJitter,
    duration,
    durationJitter,
    envelopeIdx,
    panSpread,
    ySpread,
    reverseProb,
    velocityGain = 1,
    midiChannel = 0,
  ) {
    if (!this.srcReady) return;
    const slot = this.pickSlot(voiceCount);
    if (slot < 0) return;

    // Advance master PRNG and seed this voice (spec §7 — unique-per-spawn seed).
    this.masterSeed[0] = (Math.imul(this.masterSeed[0], 1664525) + 1013904223) >>> 0;
    this.vSeed[slot] = this.masterSeed[0] || 1;
    this.vVoiceId[slot] = this.nextVoiceId++;

    const rPos = xorshift32(this.vSeed, slot) * 2 - 1;
    const rPitch = xorshift32(this.vSeed, slot) * 2 - 1;
    const rDur = xorshift32(this.vSeed, slot) * 2 - 1;
    const rPan = xorshift32(this.vSeed, slot) * 2 - 1;
    const rRev = xorshift32(this.vSeed, slot);
    // rY is appended after rRev to preserve audio-side seed reproducibility (§7
    // identical-statistics: video twin reuses the same per-grain seed and consumes
    // draws in this canonical order; do not reorder).
    const rY = xorshift32(this.vSeed, slot) * 2 - 1;

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

    this.vStart[slot] = startSample;
    this.vRatio[slot] = ratio;
    this.vPitchRand[slot] = pitchRand;
    this.vDur[slot] = durSamples;
    this.vElapsed[slot] = 0;
    this.vSubStart[slot] = subStartFrame;
    this.vPanL[slot] = Math.cos(theta);
    this.vPanR[slot] = Math.sin(theta);
    this.vEnv[slot] = envelopeIdx;
    this.vAaAlpha[slot] = aaAlpha;
    this.vAaL[slot] = 0;
    this.vAaR[slot] = 0;
    this.vGain[slot] = velocityGain;
    this.vReverse[slot] = reverseFlag;
    this.vMidiCh[slot] = midiChannel >= 1 && midiChannel <= MIDI_CHANNELS ? midiChannel : 0;
    this.vFading[slot] = 0;
    this.vFadeRem[slot] = 0;
    this.vActive[slot] = 1;
    this.totalSpawnCount++;

    this.emitGrainEvent(
      slot,
      subStartFrame,
      durSamples,
      startSample,
      ratio,
      panNorm,
      rY * ySpread,
      reverseFlag,
      envelopeIdx,
    );
  }

  emitGrainEvent(
    slot,
    subStartFrame,
    durSamples,
    startSample,
    ratio,
    panX,
    panY,
    reverseFlag,
    envelopeIdx,
  ) {
    // Voice-event channel for the video grain twin (spec §15 step 6). Resolved per-grain
    // values are baked into the event so the video side never needs its own PRNG — the
    // identical-statistics rule reduces to "consume the same draws in the same order".
    // spawnTime is the absolute AudioContext time at sub-block offset subStartFrame.
    const spawnTime = currentTime + subStartFrame / sampleRate;
    if (this.grainRingHeader && this.grainRingData) {
      const seq = this.grainRingWriteSeq;
      const off = (seq % GRAIN_EVENT_RING_CAPACITY) * GRAIN_EVENT_RING_FIELDS;
      const ring = this.grainRingData;
      ring[off + GRAIN_EVENT_F_VOICE_ID] = this.vVoiceId[slot];
      ring[off + GRAIN_EVENT_F_SEED] = this.vSeed[slot];
      ring[off + GRAIN_EVENT_F_SPAWN_TIME] = spawnTime;
      ring[off + GRAIN_EVENT_F_DURATION_SEC] = durSamples / sampleRate;
      ring[off + GRAIN_EVENT_F_POSITION_SEC] = startSample / sampleRate;
      ring[off + GRAIN_EVENT_F_PITCH_RATIO] = ratio;
      ring[off + GRAIN_EVENT_F_PAN_X] = panX;
      ring[off + GRAIN_EVENT_F_PAN_Y] = panY;
      ring[off + GRAIN_EVENT_F_REVERSE] = reverseFlag;
      ring[off + GRAIN_EVENT_F_ENVELOPE_INDEX] = envelopeIdx;
      this.grainRingWriteSeq = seq + 1;
      Atomics.store(this.grainRingHeader, GRAIN_EVENT_WRITE_SEQ_IDX, this.grainRingWriteSeq);
      return;
    }
    this.port.postMessage({
      type: 'grain',
      voiceId: this.vVoiceId[slot],
      seed: this.vSeed[slot],
      spawnTime,
      durationSec: durSamples / sampleRate,
      positionSec: startSample / sampleRate,
      pitchRatio: ratio,
      panX,
      panY,
      reverse: reverseFlag,
      envelopeIndex: envelopeIdx,
    });
  }

  resetRuntimeDiagnostics() {
    this.runtimeDiagWriteSeq = 0;
    this.runtimeDiagElapsedSec = 0;
    this.runtimeDiagNextSampleSec = 0;
    this.totalSpawnCount = 0;
    this.totalStealCount = 0;
    if (this.runtimeDiagHeader)
      Atomics.store(this.runtimeDiagHeader, RUNTIME_DIAG_WRITE_SEQ_IDX, 0);
  }

  writeRuntimeDiagnosticSnapshot(
    activeVoices,
    fadingVoices,
    pitchLoad,
    interpMode,
    samplesUntilNextSpawn,
    nextVoiceId,
    normGain,
    density,
    voiceCount,
    meanSamplesPerGrain,
  ) {
    if (!this.runtimeDiagHeader || !this.runtimeDiagData || this.runtimeDiagCapacity <= 0) return;
    const seq = this.runtimeDiagWriteSeq;
    const off = (seq % this.runtimeDiagCapacity) * RUNTIME_DIAG_RING_FIELDS;
    const ring = this.runtimeDiagData;
    ring[off + RUNTIME_DIAG_F_REL_TIME_SEC] = this.runtimeDiagElapsedSec;
    ring[off + RUNTIME_DIAG_F_ACTIVE_VOICES] = activeVoices;
    ring[off + RUNTIME_DIAG_F_FADING_VOICES] = fadingVoices;
    ring[off + RUNTIME_DIAG_F_PITCH_LOAD] = pitchLoad;
    ring[off + RUNTIME_DIAG_F_INTERP_MODE] = interpMode;
    ring[off + RUNTIME_DIAG_F_SAMPLES_UNTIL_NEXT_SPAWN] = samplesUntilNextSpawn;
    ring[off + RUNTIME_DIAG_F_NEXT_VOICE_ID] = nextVoiceId;
    ring[off + RUNTIME_DIAG_F_SPAWN_COUNT] = this.totalSpawnCount;
    ring[off + RUNTIME_DIAG_F_STEAL_COUNT] = this.totalStealCount;
    ring[off + RUNTIME_DIAG_F_NORM_GAIN] = normGain;
    ring[off + RUNTIME_DIAG_F_DENSITY] = density;
    ring[off + RUNTIME_DIAG_F_VOICE_COUNT] = voiceCount;
    ring[off + RUNTIME_DIAG_F_MEAN_SAMPLES_PER_GRAIN] = meanSamplesPerGrain;
    this.runtimeDiagWriteSeq = seq + 1;
    Atomics.store(this.runtimeDiagHeader, RUNTIME_DIAG_WRITE_SEQ_IDX, this.runtimeDiagWriteSeq);
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

    // TEMP DIAGNOSTIC (B2.3 allocation audit): one-time SAB-availability ping.
    if (this.emitDiagnosticMessages && !this.diagSabReported) {
      this.diagSabReported = true;
      this.port.postMessage({
        type: 'diag',
        kind: 'sab',
        avail: this.grainRingHeader ? 1 : 0,
      });
    }

    this.syncSharedControls();

    const position = this.readControl(parameters, 'position', CONTROL_POSITION);
    const positionJitter = this.readControl(parameters, 'positionJitter', CONTROL_POSITION_JITTER);
    const pitchSt = this.readControl(parameters, 'pitch', CONTROL_PITCH);
    const pitchJitter = this.readControl(parameters, 'pitchJitter', CONTROL_PITCH_JITTER);
    const duration = this.readControl(parameters, 'duration', CONTROL_DURATION);
    const durationJitter = this.readControl(parameters, 'durationJitter', CONTROL_DURATION_JITTER);
    const density = Math.max(0.1, this.readControl(parameters, 'density', CONTROL_DENSITY));
    const distribution = this.readControl(parameters, 'distribution', CONTROL_DISTRIBUTION);
    const envelopeIdx = Math.max(
      0,
      Math.min(ENV_COUNT - 1, this.readControl(parameters, 'envelope', CONTROL_ENVELOPE) | 0),
    );
    const panSpread = this.readControl(parameters, 'panSpread', CONTROL_PAN_SPREAD);
    const ySpread = this.readControl(parameters, 'ySpread', CONTROL_Y_SPREAD);
    const reverseProbability = this.readControl(
      parameters,
      'reverseProbability',
      CONTROL_REVERSE_PROBABILITY,
    );
    const voiceCount = Math.max(
      1,
      Math.min(POOL_SIZE, this.readControl(parameters, 'voiceCount', CONTROL_VOICE_COUNT) | 0),
    );
    const mode = Math.max(0, Math.min(2, this.readControl(parameters, 'mode', CONTROL_MODE) | 0));
    const gain = this.readControl(parameters, 'gain', CONTROL_GAIN);

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
    // control slot.
    if (this.pendingNoteCount > 0) {
      while (this.pendingNoteCount > 0) {
        const idx = this.pendingNoteRead;
        this.spawnGrain(
          0,
          mode,
          voiceCount,
          position,
          positionJitter,
          this.pendingNotePitch[idx],
          pitchJitter,
          duration,
          durationJitter,
          envelopeIdx,
          panSpread,
          ySpread,
          reverseProbability,
          velocityToGainWorklet(this.pendingNoteVelocity[idx]),
          this.pendingNoteChannel[idx],
        );
        this.pendingNoteRead = (idx + 1) % PENDING_NOTE_CAPACITY;
        this.pendingNoteCount--;
      }
    }

    let scanCursor = 0;
    while (scanCursor < N) {
      if (this.samplesUntilNextSpawn <= 0) {
        this.spawnGrain(
          scanCursor,
          mode,
          voiceCount,
          position,
          positionJitter,
          pitchSt,
          pitchJitter,
          duration,
          durationJitter,
          envelopeIdx,
          panSpread,
          ySpread,
          reverseProbability,
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
    let fadingNow = 0;
    for (let i = 0; i < POOL_SIZE; i++) {
      if (!this.vActive[i]) continue;
      activeNow++;
      if (this.vFading[i]) fadingNow++;
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
      if (this.emitDiagnosticMessages) {
        // TEMP DIAGNOSTIC (B2.3 allocation audit): dedicated diag channel for the toggle.
        this.port.postMessage({ type: 'diag', kind: 'toggle', mode: nextInterpMode });
      }
      if (this.emitInterpModeMessages) {
        this.port.postMessage({
          type: 'interpMode',
          mode: nextInterpMode === INTERP_HERMITE ? 'hermite' : 'sinc',
        });
      }
    }

    while (this.runtimeDiagElapsedSec >= this.runtimeDiagNextSampleSec) {
      this.writeRuntimeDiagnosticSnapshot(
        activeNow,
        fadingNow,
        pitchLoad,
        this.interpMode,
        this.samplesUntilNextSpawn,
        this.nextVoiceId,
        this.vNormGain,
        density,
        voiceCount,
        meanSamplesPerGrain,
      );
      this.runtimeDiagNextSampleSec += RUNTIME_DIAG_SAMPLE_INTERVAL_SEC;
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

    this.runtimeDiagElapsedSec += N / sampleRate;

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
          sL = hermite4(srcL[base], srcL[base + 1], srcL[base + 2], srcL[base + 3], frac);
          if (srcR === srcL) {
            sR = sL;
          } else {
            sR = hermite4(srcR[base], srcR[base + 1], srcR[base + 2], srcR[base + 3], frac);
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
            srcL[base] * c0 +
            srcL[base + 1] * c1 +
            srcL[base + 2] * c2 +
            srcL[base + 3] * c3 +
            srcL[base + 4] * c4 +
            srcL[base + 5] * c5 +
            srcL[base + 6] * c6 +
            srcL[base + 7] * c7;
          if (srcR === srcL) {
            sR = sL;
          } else {
            sR =
              srcR[base] * c0 +
              srcR[base + 1] * c1 +
              srcR[base + 2] * c2 +
              srcR[base + 3] * c3 +
              srcR[base + 4] * c4 +
              srcR[base + 5] * c5 +
              srcR[base + 6] * c6 +
              srcR[base + 7] * c7;
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
