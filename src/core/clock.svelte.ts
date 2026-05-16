// Transport singleton. Owns AudioContext binding and the global musical clock.
// Reactive via Svelte 5 runes — import `clock` from any component to read state.

class Clock {
  bpm = $state(120);
  // baseFreq: Hz per "cycle per screen" unit for spatial→temporal frequency
  // mapping. See plan.md §0 and memory.md (decision: 1 Hz/cps default).
  baseFreq = $state(1);
  // Global LFO frequency in Hz. Operators read this via CouplingContext.rate.
  // See memory.md (2026-05-16: rate lives on clock).
  rate = $state(0.3);
  running = $state(false);
  // Mirrored AudioContext currentTime, ticked on rAF for UI display.
  displayTime = $state(0);

  #ctx: AudioContext | null = null;
  #rafId = 0;

  get audioContext(): AudioContext | null {
    return this.#ctx;
  }

  bindAudioContext(ctx: AudioContext): void {
    if (this.#ctx && this.#ctx !== ctx) {
      throw new Error('Clock already bound to a different AudioContext');
    }
    this.#ctx = ctx;
  }

  // Bar/beat helpers — useful as soon as the sequencer lands.
  get secondsPerBeat(): number {
    return 60 / this.bpm;
  }

  async start(): Promise<void> {
    if (this.#ctx?.state === 'suspended') await this.#ctx.resume();
    this.running = true;
    if (!this.#rafId) this.#rafId = requestAnimationFrame(this.#tick);
  }

  async stop(): Promise<void> {
    if (this.#ctx?.state === 'running') await this.#ctx.suspend();
    this.running = false;
    if (this.#rafId) {
      cancelAnimationFrame(this.#rafId);
      this.#rafId = 0;
    }
  }

  #tick = (): void => {
    if (this.#ctx) this.displayTime = this.#ctx.currentTime;
    if (this.running) this.#rafId = requestAnimationFrame(this.#tick);
    else this.#rafId = 0;
  };
}

export const clock = new Clock();
