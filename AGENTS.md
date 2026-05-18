# av-synth

Browser-based audio-visual synthesizer with Hydra-inspired operators and mathematically coupled audio/video control laws. Current phase: the implemented operator subset has a hardened AV QA/audit stack and is ready for a staging deploy for real-world manual testing, but public/professional deployment remains blocked on the final human audible sign-off plus the essential unfinished `M3` surface area: the remaining Color operators and the entire Blend family.

## Key Commands

- `npm run dev` — start the Vite dev server
- `npm run check` — run `svelte-check`
- `npm run test:run` — run the Vitest suite once
- `npm run lint` — run ESLint and Prettier check
- `npm run build` — typecheck and produce a production build
- `npm run qa:smoke` — run the Playwright-driven live QA smoke/regression cases
- `npm run qa:cases` — run all manifest-driven QA browser cases
- `npm run qa:analyze` — extract `.wav`, probe artifacts, and write `analysis.json` summaries
- `npm run qa:full` — run browser QA and analysis back-to-back
- `npm run qa:ci` — run the full local CI-equivalent QA pipeline
- `npm run format` — apply Prettier formatting

## Important Paths

- `plan.md` — authoritative Hydra-to-audio mapping and status notes
- `todo.md` — milestone checklist and current implementation backlog
- `memory.md` — append-only design decisions and tensions
- `src/core/coupling.ts` — runtime control-law evaluation for both domains
- `src/video/renderer.ts` — WebGL pipeline, neutral-op bypass, DPR resizing
- `src/audio/engine.ts` — audio graph wiring, source routing, param polling
- `src/core/operators.ts` — operator registry, instancing, neutral detection
- `src/core/sources.ts` — procedural source registry and lifecycle
- `src/App.svelte` — shell UI, source selection, transport, control wiring
- `qa/README.md` — QA stack, artifact flow, and recommended MCP analyzer usage
- `qa/analyze.js` — post-Playwright artifact extraction and `analysis.json` generation
- `.github/workflows/qa.yml` — GitHub Actions entrypoint for the QA pipeline
- `qa/cases/` — manifest-driven browser QA cases and parameter sweeps
- `src/ops/` and `src/sources/` — per-operator and per-source AV implementations

## Engineering Rules

- Raw UI values are canonical; renderer/audio runtime must evaluate domain-specific params through `src/core/coupling.ts`.
- Keep the default chain neutral on cold boot. If an operator’s audio analogue cannot be identity at its visual default, bypass it until the user moves it off default.
- `CouplingContext.time` should come from `AudioContext.currentTime` whenever audio is initialized. Do not introduce independent clocks inside stages.
- QA manifests should use raw operator/source values, not normalized slider values.
- Do not add broad fallback/error-handling branches for impossible cases. Prefer tight, explicit invariants.
- Preserve the split between procedural sources and downstream operators; they share coupling math, not lifecycle shape.
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
5. `qa/README.md`
