# Shadertoy `lfscD7` Extraction Plan

Saved references:

- `references/shadertoy/lfscD7-common.frag`
- `references/shadertoy/lfscD7-buffer-a.frag`
- `references/shadertoy/lfscD7-buffer-b.frag`
- `references/shadertoy/lfscD7-image.frag`

Status:

- Step 1 landed on 2026-06-01 as experimental program `broadcastGhostBloom` in `public/presets.json`.
- That program intentionally uses only the existing operator/renderer surface and the new audit case `qa/cases/audit-program-broadcast-ghost-bloom-video.json`.
- It is the approximation baseline for the future `signalDamage` operator, not the completion of this plan.
- Step 2 landed on 2026-06-01 as native `signalDamage` plus a retuned `broadcastGhostBloom` program and dedicated `audit-signal-damage-video-sweep.json` coverage.
- `broadcastGhostBloom` now uses `signalDamage` directly instead of the earlier `turbulenceWarp` / `chromaFract` stand-ins.
- Step 3 landed on 2026-06-01 as a narrow `filmGrade.hueCurve` control carrying the shader's sinusoidal hue shaping into the existing finish operator.
- Step 4 landed on 2026-06-01 as a dedicated `ghostBloom` presentation look in `src/video/renderer.ts`, and `broadcastGhostBloom` now uses that renderer style plus `bloomMist` lens dirt for the final bounded lfscD7 bloom/composite tune.

## Intent

Extract the reusable ideas from Shadertoy `lfscD7` into AV Synth's existing video-first operator system without adding a second bloom pipeline, without creating a monolithic one-off "shader port" operator, and without expanding the public audio surface.

The visible shader structure is:

- `Common`: separable bloom helpers with burnout thresholding and configurable kernel shape
- `Buffer B`: first bloom downsample pass
- `Buffer A`: the distinctive look pass: low-resolution render, interference-driven coordinate distortion, block-hashed ordered dither, conditional colour quantisation, optional scanline treatment, and a small non-linear hue warp
- `Image`: bloom upsample/composite plus soft contrast remap and vignette

One important limit remains: the saved snippets do not include the bodies for `Interfere(...)`, `Render(...)`, `Overlay(...)`, or `OrderedDither(...)`. That means the extraction can be planned accurately at the effect-cluster level, but exact parity for those hidden kernels still requires either the missing helper code or local artistic approximation.

## Extraction Matrix

| Shader idea | Source reference | AV Synth status | Action |
| --- | --- | --- | --- |
| Separable bloom downsample / upsample | `lfscD7-common.frag`, `lfscD7-buffer-b.frag`, `lfscD7-image.frag` | already present in renderer presentation stack | do not add a new operator; tune presentation bloom only |
| Final composite bloom add, soft gamma / contrast lift | `lfscD7-image.frag` | mostly present in presentation pass and finish pack | reuse existing presentation + `filmGrade` |
| Vignette | `lfscD7-image.frag` | already present in `filmGrade` | reuse existing control |
| Optional scanlines / display shading | `lfscD7-buffer-a.frag` | already present in `retroDisplay` | reuse existing control |
| Ordered-dither damage / JPEG-style threshold stepping | `lfscD7-buffer-a.frag` | partially adjacent to `debandDither`, `posterize`, `chromaFract`; no direct match | net-new operator behavior |
| Conditional colour quantisation only under damaged/displaced regions | `lfscD7-buffer-a.frag` | no direct match | fold into net-new damage operator |
| Interference-driven coordinate displacement | `lfscD7-buffer-a.frag` | no direct match; adjacent to `chromaShift`, `flow`, `dataMosh` | fold into net-new damage operator |
| Tint / overlay blend coupled to damage | `lfscD7-buffer-a.frag` | no direct match | fold into net-new damage operator |
| Small non-linear HSV hue warp | `lfscD7-buffer-a.frag` | not a direct fit for plain `hue`; adjacent to `filmGrade` and `colorama` | extend `filmGrade` with a narrow `hueCurve` control if needed after first rebuild |

## Recommended Scope

Implement exactly four things:

1. One new operator: `signalDamage`
2. One small `filmGrade` extension: optional `hueCurve`
3. One new presentation look / post preset tuned toward the shader's bloom and contrast character
4. One authored program that reconstructs the full `lfscD7` look with the above plus existing finish ops

Do not implement:

- a monolithic `lfscD7` operator
- a second bloom stack inside the operator graph
- a new public procedural source based on the unknown `Render(...)` body
- any new public audio operators

## New Operator Proposal: `signalDamage`

Family: `Texture` or `Finish`

Placement goal:

- after geometry / feedback warps
- before final grading / display finish

Target behavior:

- local interference displacement driven by time and coarse block hashing
- ordered-dither threshold damage
- conditional quantisation that only engages in damaged/displaced regions
- tint / overlay blend to sell analogue-video / transmission damage instead of generic posterisation

Proposed params:

- `mix` — dry/wet
- `displace` — coordinate offset strength
- `block` — coarse region size / block-domain stability
- `damage` — ordered-dither / corruption threshold strength
- `quantize` — stepped colour reduction in damaged regions
- `tint` — damage tint / wash amount
- `overlay` — blend strength for the tinted overlay response
- `jitter` — time-varying instability / hash animation depth

Implementation notes:

- keep it single-pass
- do not use `ownedState`
- do not depend on motion analysis or temporal history
- build the distortion from deterministic UV/block hash math, not previous-frame feedback
- if the missing `Interfere(...)` helper later surfaces, adapt the displacement and gating math without widening the public UI

## Existing Systems To Reuse

Use AV Synth's existing systems instead of cloning the Shadertoy architecture:

- Renderer bloom pipeline in `src/video/renderer.ts` and `src/video/shaders/presentation.frag`
- `filmGrade` for vignette and tone finishing
- `retroDisplay` for any scanline flavour the final program needs
- `posterize`, `chromaFract`, and `debandDither` as references for stepped colour / chroma-damage behaviour

The plan is to move the Shadertoy's visible character into AV Synth-native surfaces, not to preserve its original pass graph one-for-one.

## Suggested Implementation Order

1. Rebuild the look as a program using only current operators and presentation controls.
2. Evaluate the gap against the saved shader snippets.
3. Implement `signalDamage` only for the missing core behavior.
4. Re-test the program.
5. Add `filmGrade.hueCurve` only if the final colour feel still needs the shader's sinusoidal hue shaping.
6. Tune a named presentation look / post preset instead of cloning bloom code into the operator graph.

All six steps above are now landed within the original product boundary.

## Likely File Touches

- `src/ops/signalDamage.ts`
- `src/video/shaders/signalDamage.frag`
- `src/ops/index.ts`
- `src/core/operators.ts`
- `src/core/operators.test.ts`
- `src/core/presets.ts` or the existing preset/program source
- `src/ops/filmGrade.ts`
- `src/video/shaders/filmGrade.frag`
- one or more `qa/cases/` manifests for the operator and the authored program

## QA Plan

- Add one dedicated operator sweep for `signalDamage`
- Add one authored-program recall / performance case for the `lfscD7`-inspired look
- Reuse existing finish-path coverage for bloom, vignette, and display treatment
- Judge success on source-preserving video treatment, not on procedural-scene parity with the unknown `Render(...)` body

## Product Boundary

This extraction is release-safe only if it stays video-first:

- the new work should enhance uploaded/demo footage
- the public UX should present this as a reusable damage / transmission treatment plus a curated program
- procedural scene-generation ideas from the missing `Render(...)` body are explicitly out of scope unless the product direction changes
