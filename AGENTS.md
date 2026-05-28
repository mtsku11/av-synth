# av-synth

Browser-based video-first audio/visual effects app with Hydra-inspired video operators and mathematically coupled AV control laws. The intended public product is not a general procedural synth and not a many-engine audio playground: uploaded video is the main signal path, the video side remains a Hydra-shaped post-processing rack, and the audio side is being narrowed to one benchmark-grade granulator plus one shared feedback delay and the existing master limiter. Current phase: the repo already has Blend-family convergence, `src(oN)` bus returns, compact bus preview, routed modulate variants, a shared six-LFO bank, hardened QA/audit plumbing, and a first-pass Cloudflare Pages path. The active priority is now a **granulator-first quality sprint before public release**: ship the dual-domain granulator from `references/granulator-port-spec.md`, collapse the public `Audio` tab to granulator + feedback, keep legacy rack/worklet experiments internal only, and tune the video look engine and QA around that narrower product honestly.

## Key Commands

- `npm run dev` — start the Vite dev server
- `npm run dev:http` — start the app on the fixed Playwright URL `http://127.0.0.1:4173`
- `npm run check` — run `svelte-check`
- `npm run test:run` — run the Vitest suite once
- `npm run lint` — run ESLint and Prettier check
- `npm run build` — typecheck and produce a production build
- `npm run qa:smoke` — run the Playwright-driven live QA smoke/regression cases
- `npm run qa:smoke:preview` — build first, then run Playwright against `vite preview`
- `npm run qa:smoke:external` — run Playwright against an already-running URL; set `PLAYWRIGHT_BASE_URL` when needed
- `npm run qa:cases` — run all manifest-driven QA browser cases
- `npm run qa:analyze` — extract `.wav`, probe artifacts, and write `analysis.json` summaries
- `npm run qa:full` — run browser QA and analysis back-to-back
- `npm run qa:ci` — run the full local CI-equivalent QA pipeline
- `npm run qa:report` — open the Playwright HTML report
- `npm run format` — apply Prettier formatting

## Important Paths

- `plan.md` — authoritative Hydra-to-audio mapping and status notes
- `todo.md` — milestone checklist and current implementation backlog
- `memory.md` — append-only design decisions and tensions
- `references/granulator-port-spec.md` — authoritative granulator engineering contract; mandatory before audio/granulator/modulation work
- `references/README.md` — reference provenance, license boundary, and anti-drift notes for the granulator work
- `src/core/coupling.ts` — runtime control-law evaluation for both domains
- `src/core/mod-bank.ts` — shared six-LFO modulation bank used by both video and audio
- `src/core/patch-graph.ts` — compiles the graph store into executable runtime steps for video/audio
- `src/video/renderer.ts` — WebGL pipeline, neutral-op bypass, DPR resizing
- `src/audio/engine.ts` — audio graph wiring, source routing, param polling
- `src/ui/AudioRack.svelte` — public audio surface; should collapse toward one granulator card + one feedback card
- `src/core/operators.ts` — operator registry, instancing, neutral detection
- `src/core/sources.ts` — procedural source registry and lifecycle; now an internal/exploratory layer, not the public product centre
- `src/App.svelte` — shell UI, source selection, transport, control wiring; primary place to pivot the product to video-first
- `qa/README.md` — QA stack, artifact flow, and recommended MCP analyzer usage
- `deploy.md` — staging/public deploy policy, Cloudflare inputs, and manual fallback commands
- `qa/analyze.js` — post-Playwright artifact extraction and `analysis.json` generation
- `.github/workflows/qa.yml` — GitHub Actions entrypoint for the QA pipeline
- `.github/workflows/deploy-cloudflare.yml` — manual Cloudflare Pages staging/production deploy workflow (SAB-capable release target)
- `.github/workflows/deploy-gh-pages.yml` — auto GitHub Pages deploy on push to main; SAB unavailable (fast staging / Remote-Desktop testing only)
- `qa/cases/` — manifest-driven browser QA cases and parameter sweeps
- `src/ops/` and `src/sources/` — per-operator and per-source AV implementations

## Engineering Rules

- Raw UI values are canonical; renderer/audio runtime must evaluate domain-specific params through `src/core/coupling.ts`.
- Keep the default chain neutral on cold boot. If an operator’s audio analogue cannot be identity at its visual default, bypass it until the user moves it off default.
- `CouplingContext.time` should come from `AudioContext.currentTime` whenever audio is initialized. Do not introduce independent clocks inside stages.
- QA manifests should use raw operator/source values, not normalized slider values.
- Do not add broad fallback/error-handling branches for impossible cases. Prefer tight, explicit invariants.
- Preserve the split between procedural sources and downstream operators; they share coupling math, not lifecycle shape.
- Product-direction rule: treat uploaded video plus its attached audio as the primary signal path. Procedural sources may remain in-repo for testing or future advanced modes, but do not let them dominate the default UX, release copy, or backlog ordering.
- Do not describe the app as a general AV synth in product-facing docs unless the user explicitly asks for that positioning. The current public target is a video-effects tool with a granulator-first audio companion.
- Public audio-direction rule: the shipped audio surface is `granulator + feedback delay + master limiter`. Do not add or revive new public audio-engine families (`FM`, `fold`, `freeze`, `tone`, `space`, etc.) unless the user explicitly changes scope and the docs are updated first.
- Legacy rack engines and per-video-op audio analogues may remain in-repo as internal scaffolding, regression coverage, or implementation building blocks, but they are not release-track product goals and should not shape public UX decisions.
- If a task touches the audio engine, modulation routing, MIDI, or the `Audio` tab, read `references/granulator-port-spec.md` first and follow it over older rack-era assumptions.
- Keep the modulation story unified. Prefer the shared LFO/MIDI/video-feature routing model over bespoke per-operator automation panels or standalone monitor-heavy UI.
- Documentation must stay in sync with implementation in the same change. If code changes project state, update the relevant Markdown files before ending the task:
  - `todo.md` for milestone/backlog/progress changes
  - `plan.md` for release policy, operator status, or acceptance-criteria changes
  - `memory.md` for non-obvious decisions, tensions, or policy changes
  - `CLAUDE.md` only when repo operating rules or handoff-critical instructions change
- If Markdown and code disagree, code wins; then fix the Markdown immediately.
- Claude must not create commits, push branches, amend commits, or rewrite git history unless the user explicitly asks for that action after review.
- Default workflow for Claude: implement changes, update docs, run verification, stop for review. Do not self-approve git writes.

## Context-Loading Order

1. `AGENTS.md`
2. `plan.md`
3. `todo.md`
4. `memory.md`
5. `references/granulator-port-spec.md` for any audio/granulator/modulation task
6. `qa/README.md`
