# references/ — granulator design references

External material consulted for the av-synth granulator engine spec. Read-only. **No code from any source listed here is copied into the av-synth codebase.** This directory exists for design synthesis only; the av-synth implementation is written from scratch in TypeScript / AudioWorklet so the project carries its own license.

## Source code

| Path | Source | License | Why we read it |
|---|---|---|---|
| `borderlands/` | [Lyptik/Borderlands](https://github.com/Lyptik/Borderlands) — Chris Carlson, Stanford CCRMA, 2011–2012 | GPLv3 | Spatial-grain instrument architecture (GrainCluster → GrainVoice). Closest existing analogue to av-synth's grains-on-canvas model. |
| `csound-partikkel/` | partikkel opcode from [csound/csound](https://github.com/csound/csound) — Brandtsegg / Johansen / Henriksen | LGPL | DSP feature taxonomy. The "unified model" — every published granular technique exposed under one parameter set. |

## Papers

| File | Citation | Why |
|---|---|---|
| `bencina-implementing-realtime-granular.pdf` | Bencina, R. *Implementing Real-Time Granular Synthesis*. Audio Anecdotes III, 2001. | Canonical implementation architecture (scheduling / voice-management / rendering layers). Skeleton we write code against. |
| `brandtsegg-particle-synthesis-lac2011.pdf` | Brandtsegg, Ø.; Johansen, T.; Saue, S. *Particle synthesis — a unified model for granular synthesis*. LAC 2011. | Theoretical taxonomy. Tells us what techniques exist so we can ship a confidently chosen subset. |
| `carlson-borderlands-nime2012.pdf` | Carlson, C.; Wang, G. *Borderlands: An Audiovisual Interface for Granular Synthesis*. NIME 2012. | The instrument-feel / spatial-interface reference. The cloud-of-voices-on-a-2D-field metaphor we adapt to a video frame field. |

## Closed-source calibration benchmark

| File | Purpose |
|---|---|
| `granulator-ii-monolake-r57382-v1.3.alp` | Robert Henke's Monolake Granulator II (free, 2013). Ableton Live Pack format. We use it as a **listening reference** — load the same source material in Granulator II and in av-synth's granulator and tune our implementation until parity. Not a source to read. Free download from [roberthenke.com](https://roberthenke.com/technology/granulator.html). |
| (Granulator III — not included) | Henke's 2023 successor; requires Ableton Live 12 Suite (paid). Useful conceptually for its three-mode UX (Classic / Loop / Cloud) and MPE-first design; we copy nothing from it. |

## Synthesised spec

| File | Purpose |
|---|---|
| `granulator-port-spec.md` | The synthesis of all four references above into a concrete av-synth engineering spec. This is the document the granulator implementation builds against. |

## License hygiene rule

If you are about to write granulator code in `src/`, the boundary is: **read** the references in this directory, **synthesise** insight in `granulator-port-spec.md`, then **write your own implementation** in `src/audio/worklets/granulator.js` (and friends). Do not paste functions, structs, or DSP loops from `borderlands/` or `csound-partikkel/` into the av-synth source tree. Those repos are GPL / LGPL and pasting their code would propagate that license to av-synth.

If implementation needs a specific algorithm verbatim (e.g. a windowed-sinc kernel), use a textbook / public-domain reference and write it from that.
