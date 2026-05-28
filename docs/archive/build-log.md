# Archived build log

Condensed provenance index. On 2026-05-28 the verbose dated "what landed + verification log" entries were removed from `todo.md` and `plan.md` to keep those living docs current-facing. **Nothing is lost** — the full verbose text (per-item verification counts, exact run timings, soak-trace dumps) is in git history prior to the 2026-05-28 trim commit. `memory.md` remains the authoritative append-only rationale log and was **not** trimmed.

This file is a human-readable map of when major work shipped, one line per item. Use `git log -p -- todo.md plan.md` for the full original entries.

## Milestones (M0–M6) — historical provenance

- **M0** — Repo & tooling bootstrap (Vite + TS + Svelte). Complete in practice.
- **M1** — Architectural skeleton (reactive graph, coupling registry, dual renderers).
- **M2** — Ported the prototype's operators into the new architecture.
- **M3** — Filled the rest of the Hydra surface area (geometry, color, blend, modulate families).
- **M4** — Chainable live-coding API. Demoted to advanced/post-v1.
- **M5 / M5.5–M5.9** — Polish & product surface; QA & regression harness; pre-deploy operator-family audit; video-first product correction; TouchDesigner-style look engine; musical DSP palette.
- **M6** — Deploy track (staging RC + public v1 gates). Live form lives in `todo.md` "Live release blockers" + `plan.md §10.7`.

## Audio mapping reassignments (2026-05-19)

- `saturate` audio reassigned from M/S stereo width to a harmonic soft-saturator (asymmetric tanh + k-rate drive).
- `chromaShift` Haas-delay audio mapping ratified canonical; per-band SSB shift tried and rejected (destroys harmonic structure).

## Pitch-shifter-investigation bug fixes (2026-05-18)

- Transport stop+restart silence — `VideoElementAudioSource.dispose()` double-disconnect; dispose made a no-op.
- QA bridge `setOperatorParam`/`setSourceParam` now validate paramId against `def.paramOrder`.
- Manual test path was hearing dry `<video>` audio instead of the Web Audio graph; upload path/transport ownership fixed.

## Granulator-first build-out (2026-05-21 → 2026-05-24)

Spec: `references/granulator-port-spec.md` + `plan.md §14`. Reference stack (Borderlands GPLv3, Csound partikkel LGPL, Bencina/Brandtsegg/Carlson papers, Monolake Granulator II listening benchmark) cloned read-only; license boundary in `references/README.md`.

- `src/video/grain-buffer.ts` — 720p-clamped RGBA8 `TEXTURE_2D_ARRAY` ring, 1.5 GB hard cap, over-cap refusal. `decodeFromVideo` seek+upload path.
- `public/worklets/granulator.js` — 64-slot SoA voice pool, 8-tap Kaiser sinc, one-pole AA LP on pitch>1, reverse playback, 5 envelope LUTs, 3 scheduling modes, 14-control surface, voice stealing, √N gain normalisation, SAB shared-control ingestion.
- `src/core/grain-scheduler.ts` + `src/video/grain-composite.{vert,frag,ts}` — shared AudioContext-clock scheduler, MessagePort voice events, premultiplied-alpha video grain compositor.
- `src/core/midi.ts` — Web MIDI + MPE (per-note bend, pressure, CC74), CC-learn, note-on→grain one-shot path.
- `src/audio/feedback-delay.ts` + `FeedbackDelayCard.svelte` — stereo cross-coupled delay, 5-control public surface; shared-feedback law synced with video `feedback` ops.
- Audio tab collapsed to `MasterMeter` + `GranulatorCard` + `FeedbackDelayCard`; legacy multi-engine rack unmounted.
- D1 per-channel pitch voices; D2 4-pt Hermite + CPU auto-dispatch; D5 clip-derived grain fps; D7 mode/envelope app-owned + preset-addressable.

## Quality-sprint dated passes (2026-05-24 → 2026-05-28)

- **Audio strip (2026-05-25)** — `AudioStage` interface, `OperatorDef.createAudioStage`, `ParamCoupling.toAudio`, `evaluateAudioParams`, legacy AudioRack, and 24 video-op worklets deleted. Public audio surface permanently granulator + feedback delay + limiter.
- **Authored vector fields (2026-05-25)** — `history.frag` reduced to identity copy (was darkening `#prevFrame`). `vortex` (Biot-Savart), then `curlNoise`, `vortexPacket`, `saddleField`.
- **Second field-op pack (2026-05-26)** — `pinchBulge`, `polarRipple`, `sinkSourceField`, `spiralField`, `domainFold`, `gyreField`, `turbulenceWarp`, `magneticDipole` (all wet/dry `mix`, added `drift`).
- **Operator characterisation sweep (2026-05-26)** — `readFrameStats` + QA bridge `setChain`/`listRegisteredOps`; `op-characterisation.spec.ts` (40 ops, dead-param gate). Caught `selfMod.frag` missing `#version 300 es`. Thorough variant + CI workflows path-filtered.
- **slitScan (2026-05-26)** — split from `timeDisplace`; discrete `orientation` enum via `ParamSpec.choices` + segmented `Slider.svelte` picker; probe on `frame-ramp.mp4`.
- **dataMosh + per-op ownedState FBO (2026-05-26)** — new `OperatorDef.ownedState` ping-pong primitive; real held-keyframe datamosh; `datamoshHold` flagship preset.
- **Grain composite fixes (2026-05-26)** — upside-down frag flip, `texSubImage3D` rebind race, density "crash" diagnosed (not crashing). Canvas-truth probe (PNG decode, not internal FBO). Default `panSpread`/`ySpread` 0 → 0.7.
- **B2.3 4-hour soak (2026-05-25, PASS)** — warmed steady-state worklet-GC gate; major=0 in warmed windows. SAB control-ingestion refactor.
- **V1–V5 / C1–C3 / B1–B3 / D1–D8** — temporal-history ring, structure-analysis texture, motion field, flagship preset bank + macros, modulation helper layer, granulator quality tiers, feedback-delay public card, master meter, curated demo program.
- **Source B as graph node (2026-05-28)** — `SOURCE_B_NODE_ID` sibling to `SOURCE_NODE_ID`; picked up by every two-input operator's input picker; bus-1 chain-start defaults to sourceB. Rationale in `memory.md` 2026-05-28.
