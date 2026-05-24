const MODULES = [
  'worklets/pitch-shifter.js',
  'worklets/pixelate-windowed.js',
  'worklets/phase-modulator.js',
  'worklets/modulate-rotate.js',
  'worklets/modulate-scale.js',
  'worklets/modulate-scale-routed.js',
  'worklets/modulate-pixelate.js',
  'worklets/modulate-pixelate-routed.js',
  'worklets/modulate-repeat.js',
  'worklets/modulate-scrollx.js',
  'worklets/modulate-scrolly.js',
  'worklets/modulate-kaleid.js',
  'worklets/modulate-hue.js',
  'worklets/modulate-displace.js',
  'worklets/modulate-routed.js',
  'worklets/modulate-rotate-routed.js',
  'worklets/modulate-repeat-routed.js',
  'worklets/modulate-hue-routed.js',
  'worklets/modulate-scrolly-routed.js',
  'worklets/phase-offset.js',
  'worklets/fold-processor.js',
  'worklets/granular.js',
  'worklets/self-modulator.js',
  'worklets/feedback-freeze.js',
  'worklets/granulator.js',
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
