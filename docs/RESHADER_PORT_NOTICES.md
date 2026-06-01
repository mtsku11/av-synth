# ReShade-Inspired Port Notices

This pack is a native AV Synth implementation. It does not include the ReShade runtime, injector, effect compiler, add-on system, `.ini` preset system, or depth-buffer feature stack.

## Actual sources used

| AV Synth operator | Status | Source repo / file | Commit | License | Notes |
| --- | --- | --- | --- | --- | --- |
| `filmGrade` | clean-room adaptation informed by permissive sources | `CeeJayDK/SweetFX/Shaders/SweetFX/Tonemap.fx` | `16d1a42247cb5baaf660120ee35c9a33bb94649c` | MIT | Used as tonal-feature reference only. AV Synth code is handwritten and consolidated into one pass. |
| `filmGrade` | clean-room adaptation informed by permissive sources | `CeeJayDK/SweetFX/Shaders/SweetFX/Curves.fx` | `16d1a42247cb5baaf660120ee35c9a33bb94649c` | MIT | Used for contrast-curve/reference ideas only. |
| `filmGrade` | clean-room adaptation informed by permissive sources | `CeeJayDK/SweetFX/Shaders/SweetFX/Vibrance.fx` | `16d1a42247cb5baaf660120ee35c9a33bb94649c` | MIT | Used for saturation/vibrance behaviour ideas only. |
| `filmGrade` | clean-room adaptation informed by permissive sources | `prod80/prod80-ReShade-Repository/Shaders/PD80_03_Filmic_Adaptation.fx` | `1c2ed5b093b03c558bfa6aea45c2087052e99554` | MIT | Source is multipass; AV Synth deliberately reduced this to a single-pass finish operator. |
| `clarity` | clean-room adaptation informed by permissive sources | `CeeJayDK/SweetFX/Shaders/SweetFX/LumaSharpen.fx` | `16d1a42247cb5baaf660120ee35c9a33bb94649c` | MIT | Luma-domain sharpen and halo-limiting ideas informed the design; code is handwritten. |
| `clarity` | clean-room adaptation informed by permissive sources | `CeeJayDK/SweetFX/Shaders/SweetFX/CAS.fx` | `16d1a42247cb5baaf660120ee35c9a33bb94649c` | MIT | Adaptive sharpening heuristics informed the edge-protection behaviour; code is handwritten. |
| `clarity` | clean-room adaptation informed by permissive sources | `prod80/prod80-ReShade-Repository/Shaders/PD80_05_Sharpening.fx` | `1c2ed5b093b03c558bfa6aea45c2087052e99554` | MIT | Source is multipass and optionally depth-aware; AV Synth uses a smaller single-pass kernel. |
| `debandDither` | clean-room adaptation informed by permissive source | `crosire/reshade-shaders/Shaders/Deband.fx` | `6db142b4b1a05c764222e5b0bd9a644b7ccfe1dc` | MIT notice in file header | AV Synth keeps the bounded flat-region averaging / dither idea but omits depth and the larger analysis surface. |
| `gradeLUT` | native reuse of AV Synth LUT path | local `src/video/presentation-luts.ts` | local | project license | Uses AV Synth’s bundled procedural LUT recipes; no third-party LUT textures are shipped. |
| `retroDisplay` | clean-room inspiration only | `CeeJayDK/SweetFX/Shaders/SweetFX/CRT.fx` | `16d1a42247cb5baaf660120ee35c9a33bb94649c` | GPL-2.0-or-later | No code copied. The AV Synth pass is handwritten because GPL code is not acceptable for direct reuse here. |

## Sources inspected but not copied

| Source | Reason |
| --- | --- |
| `crosire/reshade` runtime / FX compiler | Out of scope by product constraint. |
| `crosire/reshade-shaders/Shaders/LUT.fx` | Useful LUT control concept, but no clear permissive grant in the inspected file/repo path. |
| `crosire/reshade-shaders/Shaders/DisplayDepth.fx` | Depth-buffer dependent and not a release-track AV Synth operator. |
| `prod80` bundled LUT texture packs | Code is MIT, but shipping third-party LUT image assets was intentionally avoided in this pass. |
