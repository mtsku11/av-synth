const MODULES = [
  'worklets/pitch-shifter.js',
  'worklets/pixelate-decimator.js',
  'worklets/phase-modulator.js',
] as const;

const loadPromises = new WeakMap<AudioContext, Promise<void>>();

function resolveWorkletUrl(path: string): string {
  const base = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  return new URL(path, new URL(base, window.location.href)).href;
}

export function ensureAudioWorklets(ctx: AudioContext): Promise<void> {
  const cached = loadPromises.get(ctx);
  if (cached) return cached;

  const load = Promise.all(
    MODULES.map((path) => {
      return ctx.audioWorklet.addModule(resolveWorkletUrl(path));
    }),
  ).then(() => undefined);

  loadPromises.set(ctx, load);
  return load;
}
