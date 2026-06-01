# ReShade-Inspired Port Candidates

These are native AV Synth operators. They are not ReShade compatibility, not ReShade FX support, and not a runtime/injector integration layer.

| Source repo | Source shader / file | Source license | Use status | AV Synth operator | Passes | Perf cost | Needs depth | Decision | Reason |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `crosire/reshade` @ `c6a191b7592908791bfb1feae88b5e3b18bfe53e` | `REFERENCE.md`, FX conventions | BSD-3-Clause | inspiration only | none | n/a | n/a | no | implement conventions only | Useful for syntax/runtime conventions; runtime/compiler/injector explicitly out of scope. |
| `crosire/reshade-shaders` @ `6db142b4b1a05c764222e5b0bd9a644b7ccfe1dc` | `Shaders/LUT.fx` | no repo-wide license found; file header has copyright but no permissive grant | inspiration only | `gradeLUT` | 1 | low | no | defer copying / implement native | The chroma-vs-luma split is useful, but the file is not a safe copy source. AV Synth reuses its own built-in LUT path instead. |
| `crosire/reshade-shaders` @ `6db142b4b1a05c764222e5b0bd9a644b7ccfe1dc` | `Shaders/Deband.fx` | MIT in file header | hand-port allowed | `debandDither` | 1 | medium | optional depth path in source; omitted here | implement | Good fit for a bounded single-pass deband + dither finish. AV Synth omits depth, Weber/deviation UI sprawl, and heavier branches. |
| `crosire/reshade-shaders` @ `6db142b4b1a05c764222e5b0bd9a644b7ccfe1dc` | `Shaders/DisplayDepth.fx` | unclear repo-wide; depth effect | reject | none | multi | medium | yes | reject | Game-depth visualization has no release-track value for AV Synth and violates the no-depth-effect constraint. |
| `CeeJayDK/SweetFX` @ `16d1a42247cb5baaf660120ee35c9a33bb94649c` | `Shaders/SweetFX/Tonemap.fx` | MIT | hand-port allowed | `filmGrade` | 1 | low | no | implement | Exposure, gamma, bleach/tonemap shaping, and saturation ideas fit a consolidated finish op. |
| `CeeJayDK/SweetFX` @ `16d1a42247cb5baaf660120ee35c9a33bb94649c` | `Shaders/SweetFX/Curves.fx` | MIT | hand-port allowed | `filmGrade` | 1 | low | no | implement | Supplies practical single-pass contrast-curve ideas without needing a separate operator. |
| `CeeJayDK/SweetFX` @ `16d1a42247cb5baaf660120ee35c9a33bb94649c` | `Shaders/SweetFX/Vibrance.fx` | MIT | hand-port allowed | `filmGrade` | 1 | low | no | implement | Good source for restrained saturation/vibrance behaviour inside the consolidated grade pass. |
| `CeeJayDK/SweetFX` @ `16d1a42247cb5baaf660120ee35c9a33bb94649c` | `Shaders/SweetFX/LumaSharpen.fx` | MIT | hand-port allowed | `clarity` | 1 | low | no | implement | Small-kernel luma-domain sharpening is a direct fit for the requested restrained clarity op. |
| `CeeJayDK/SweetFX` @ `16d1a42247cb5baaf660120ee35c9a33bb94649c` | `Shaders/SweetFX/CAS.fx` | MIT header from AMD in file | hand-port allowed | `clarity` | 1 | low | no | implement | Adaptive sharpening and halo control are useful references for edge protection. |
| `CeeJayDK/SweetFX` @ `16d1a42247cb5baaf660120ee35c9a33bb94649c` | `Shaders/SweetFX/CRT.fx` | GPL-2.0-or-later in file header | inspiration only | `retroDisplay` | 1 | medium | no | implement clean-room only | The look is useful, but the file is not copy-safe for this repo. AV Synth uses a handwritten display pass instead. |
| `prod80/prod80-ReShade-Repository` @ `1c2ed5b093b03c558bfa6aea45c2087052e99554` | `Shaders/PD80_03_Filmic_Adaptation.fx` | MIT | hand-port allowed | `filmGrade` | 4 in source | medium | no | partially adapt / reduce | Useful tone-curve reference, but the source uses extra luminance passes. AV Synth keeps a single-pass version only. |
| `prod80/prod80-ReShade-Repository` @ `1c2ed5b093b03c558bfa6aea45c2087052e99554` | `Shaders/PD80_05_Sharpening.fx` | MIT | hand-port allowed | `clarity` | 3 in source | medium | optional depth path in source | partially adapt / reduce | Helpful sharpening heuristics, but the source is wider and multipass. AV Synth keeps a small single-pass kernel and drops depth. |
| `prod80/prod80-ReShade-Repository` @ `1c2ed5b093b03c558bfa6aea45c2087052e99554` | `Shaders/PD80_02_Cinetools_LUT.fx`, `Shaders/PD80_LUT_v2.fxh` | MIT | hand-port allowed for code, not bundled textures without separate review | `gradeLUT` | 1 | low | no | defer external textures | LUT indexing ideas are useful, but AV Synth should not pull third-party LUT textures into the release path. |

## Scope decisions

- Implemented: `filmGrade`, `clarity`, `gradeLUT`, `debandDither`, `retroDisplay`
- Deferred: depth-buffer effects, bloom-heavy multipass ports, external LUT textures, ReShade preset/runtime/compiler support
- Rejected: direct CRT shader copying from GPL sources, direct copying from unclear-license LUT sources
