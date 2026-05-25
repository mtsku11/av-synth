# CLAUDE.md — av-synth project rules

This file is the contract Claude reads on every session in this repo. It overrides defaults. Keep it terse, factual, and updated when conventions change.

> **Personal global rules** at `~/.claude/CLAUDE.md` also apply (post-push verification, surgical changes, DeepSeek delegation protocol, surface-assumptions-don't-ask). They are not duplicated here.

---

## 1. What this project is

**av-synth** is a browser-based **video-first audio/visual effects tool**. It takes a video input and its attached audio, then transforms both through a shared control/motion language. The public product is not "all of Hydra, but with sound" and not a general-purpose audio rack.

Hydra remains the reference for the **video** operator grammar and compositional feel. The novel contribution is now narrower and clearer: a Hydra-shaped video FX rack paired with a **single serious dual-domain granulator**, one shared feedback delay, and one shared modulation fabric (six LFOs first, MIDI/MPE next, selected video-derived features through the same routing model).

Current state: the video-first correction is largely done, the public shell already has `Video` / `Audio` tabs, the six-LFO bank exists, and the repo still contains older rack/worklet experiments from the superseded multi-engine phase. Those older engines are now **internal/historical context only**. The active public goal is: ship the granulator described in `references/granulator-port-spec.md`, collapse the `Audio` tab to `granulator + feedback delay + limiter`, and keep the video rack strong and simple.

---

## 2. Authoritative project documents

Always read these *as files* — never reconstruct their contents from chat history.

| File | Purpose | When to read |
|---|---|---|
| `plan.md` | Product direction, video-operator math, release policy, and the summary wrapper around the granulator contract. | Before implementing any operator or making scope/release decisions. |
| `todo.md` | Live backlog and milestone status. | Before starting work. Update as items close. |
| `memory.md` | Decision log + open questions + design tensions. | At start of session. Append when a non-obvious decision is made. |
| `references/granulator-port-spec.md` | The authoritative engineering contract for the new audio core. | **Mandatory before any audio, MIDI, modulation-routing, or `Audio` tab work.** |
| `references/README.md` | Provenance and license boundary for the granulator references. | Before implementing DSP details or borrowing ideas from the references. |
| `qa/README.md` | QA policy, especially the distinction between legacy operator-audio coverage and the future granulator release gate. | Before changing tests or claiming release readiness. |

The harness also has a separate per-session memory dir at `~/.claude/projects/-Users-marcscully-Projects-av-synth/memory/`. That holds cross-session preferences and feedback. The project-level `memory.md` is the human-readable engineering log — distinct from harness memory.

### Release policy (do not drift)

- A **staging/private deploy** is allowed for manual evaluation once the public shell matches the intended product shape and the current QA stack is green enough for environment testing.
- A **public/professional deploy** is **not** allowed just because the legacy operator matrix or current subset looks green.
- Public/professional release stays blocked until the following are true:
  1. the granulator contract in `references/granulator-port-spec.md` is approved and implemented at release quality,
  2. the public audio surface is honestly collapsed to `granulator + feedback delay + limiter`,
  3. the final human audible/visual sign-off in `qa/reviews/` is complete,
  4. the release copy and QA docs no longer imply that the old many-engine rack or per-video-op audio twins are the product.
- If you are choosing between "ship the old rack because it exists" and "finish the granulator-first core," the correct interpretation is: finish the granulator-first core.

---

## 3. Architecture

Think about the runtime in three public layers:

1. **Video rack** — the Hydra-shaped operator chain in `src/ui/Patch.svelte`, compiled by `src/core/patch-graph.ts`, rendered by `src/video/renderer.ts`.
2. **Audio core** — the public `Audio` tab in `src/ui/AudioRack.svelte`, which should collapse to one granulator card plus one feedback-delay card, both driven by `src/audio/engine.ts`.
3. **Shared modulation** — `src/core/mod-bank.ts`, MIDI input, and selected video-derived features feeding both domains through one routing model.

Important implementation consequence: the older rack engines and older per-operator audio worklets may stay in-repo as scaffolding or internal blocks, but they are no longer the public architecture target.

### Stack (fixed unless escalated)

- **Language**: TypeScript (strict). JS allowed only inside `worklets/*.js` because `AudioWorkletProcessor` is loaded as a raw module URL.
- **Build**: Vite.
- **UI**: Svelte (component model for patch UI, control surfaces, modal panels). Canvases and worklets are framework-agnostic.
- **Video**: raw WebGL2. No three.js, no regl yet — the operator set is hand-written GLSL and that's the whole point.
- **Audio**: Web Audio API + custom AudioWorklets for the granulator core and any genuinely non-trivial DSP blocks. Built-in nodes (`GainNode`, `DelayNode`, `BiquadFilterNode`, `AnalyserNode`) are fine where they're a perfect fit. Do not treat "Hydra-shaped audio twin" as an architecture requirement anymore.
- **State**: a single reactive graph object (`src/core/graph.ts`). Parameters are typed by `ParamSpec` (range, unit, default, automation source). Both renderers subscribe; neither owns the truth.
- **No backend** at this stage. Everything is static and runs in the browser.

### Coupling principle (non-negotiable)

Every user-facing parameter still has **one canonical specification** at the coupling/modulation layer. For the video rack, that means mapped values consumed by the video operators. For the new audio direction, that means shared modulation/control data feeding the granulator and feedback core, not a requirement that every video operator still owns its own public audio twin.

Do not reintroduce the old assumption that "coupled" means "every Hydra operator must ship as a parallel public audio effect." In the current product, coupling mainly means:
- one shared time base,
- one shared modulation language,
- one shared grain-event law across audio and video,
- one honest relationship between visible motion/texture and audible motion/texture.

---

## 4. Engineering rules

### General

- **Read project files for context, not the chat scrollback.** If a fact lives in `plan.md`, re-read it before quoting it. Chat memory is lossy; files aren't.
- **Surgical changes only.** Touch what the task requires. No drive-by refactors. See global rules.
- **No silent reformatting.** Match existing style even if you wouldn't write it that way.
- **No new abstractions until a third concrete caller appears.** Rule of three.
- **No comments explaining what the code does.** Only comments for non-obvious *why* — hidden constraints, perf workarounds, browser quirks.
- **Surface assumptions, declare the choice, proceed.** Don't ask permission for default-shaped decisions. See `~/.claude/CLAUDE.md`.
- **Documentation sync is mandatory.** If implementation changes project state, update the relevant Markdown files in the same task before stopping:
  - `todo.md` when milestone status, backlog, blockers, or next steps change
  - `plan.md` when operator scope, release policy, acceptance criteria, or QA/deploy gates change
  - `memory.md` when a non-obvious decision, reversal, or design tension appears
  - `CLAUDE.md` when repo operating rules, handoff rules, or anti-drift instructions change
- **Do not leave repo docs stale on purpose.** If code and docs disagree, treat the code as truth and update the docs immediately.
- **Git writes require explicit user approval.** Do not `git commit`, `git push`, amend commits, rebase, or rewrite history unless the user explicitly asks for that action after review.
- **Default stopping point:** implement, update docs, run verification, and stop for review. Do not decide on your own that work should be committed or pushed.

### Video/Hydra-fidelity rules

- Operator **names match Hydra exactly** (`modulateRotate`, not `modulate_rotate` or `rotateMod`). Parameter names and ordering also match Hydra where Hydra defines them. Deviations require a memory.md entry.
- Hydra parity is a **video** concern first. Do not port Hydra operators just to recreate the superseded one-audio-twin-per-video-op model.
- Two-input/routed `modulate*` work is still valuable on the video side when it produces stronger composition and abstraction. Treat those as product-shaping video features, not as an excuse to expand the public audio engine list.

### Audio rules

- The shipped public audio surface is: **granulator + feedback delay + master limiter**. This is now structurally enforced — `OperatorDef` has no `createAudioStage`, every per-op `AudioStage` class has been deleted, and `OperatorCoupling` has no audio side. See `plan.md §10.4.9` for the 2026-05-25 strip.
- Before touching audio, MIDI, or modulation routing, read `references/granulator-port-spec.md`.
- Do **not** add new public audio-engine families (`FM`, `fold`, `freeze`, `tone`, `space`, etc.) unless the user explicitly changes scope and the docs are updated first. Reintroducing the `AudioStage` interface or any per-op audio worklet is a scope change, not a cleanup; require an explicit decision before doing it.
- The legacy AudioRack (`src/core/audio-rack.ts`, `src/ui/AudioRack.svelte`) and 24 video-op worklets (`feedback-freeze.js`, `modulate-*.js`, `phase-*.js`, `pitch-shifter.js`, `pixelate-*.js`, `self-modulator.js`, etc.) are deleted, not commented out. Do not resurrect them by reading git history without re-justifying scope.
- **Sample-accurate timing matters.** Anything that schedules events uses the `AudioContext.currentTime` clock, not `setTimeout` or `requestAnimationFrame`.
- **k-rate vs a-rate parameter automation** is a deliberate choice per operator. Document which in the worklet header.
- **No clipping by default.** Master bus has a brick-wall limiter and a measurement tap. Loud presets must still measure under 0 dBFS true-peak.
- **AudioWorklet first.** Avoid `ScriptProcessorNode` (deprecated, main-thread).
- **Granulator/feedback and any retained internal worklets ship worklet-level `process()` coverage.**

### Video rules

- **WebGL2 only.** Use `EXT_color_buffer_float` for HDR FBOs where needed.
- **One operator = one fragment shader.** No mega-shaders. Composition happens via ping-pong FBOs.
- **Shaders are loaded as `?raw` imports from `.glsl` files.** No inline template strings except for trivial 1-liners.
- **Premultiplied alpha throughout.** Document any operator that breaks this invariant.
- **Render loop never allocates.** No `new` inside `requestAnimationFrame`.

### UI rules

- The control surface is a product, not a debug panel. Type everything, label everything in physical units (Hz, dB, ms, sides, %), show value next to control.
- Keep the public split clear: `Video` tab for the Hydra-shaped video rack, `Audio` tab for the collapsed granulator-first audio core, shared modulation surfaced once rather than duplicated everywhere.
- Prefer compact family pickers and a small number of high-value controls over wide technical panels or monitor-heavy global chrome.
- Visual identity: dark, high-contrast, monospaced for numerics, generous spacing. Treat the UI like a hardware synth panel.

---

## 5. MCP servers & tools available

This project's `.mcp.json` registers `chrome-devtools`. Available tools:

| Server | What it does | When to use |
|---|---|---|
| `github` | Repo, PR, issue, branch, commit operations. | For PR reviews use the pending-review workflow (`pull_request_review_write` → `add_comment_to_pending_review` → `submit_pending`). |
| `playwright` | Headless browser automation. Navigate, screenshot, click, evaluate JS. | **Mandatory post-deploy visual verification** per global rules. Also for end-to-end UI tests of the synth UI. |
| `chrome-devtools` | Drives a real Chrome over the DevTools Protocol — Performance profiler, allocation timeline, console, AudioContext inspection, network throttling. | **Manual** perf / audio verification on this app: profiling worklet GC, listening to granulator output, watching the AudioContext graph. Use it where Playwright is weakest (real-time perf and audio). |
| `claude_ai_Gmail` / `Google_Calendar` / `Google_Drive` | Personal Google account integrations. | Not relevant to product work; do not invoke without an explicit ask. |

Project-local Claude Code skills (in `.claude/skills/`):

- `/granulator-soak` — run the B2.3 soak gate (canary, full 4h, `--no-spawn`, `--cold`) and print a parsed verdict. See `.claude/skills/granulator-soak/SKILL.md`.
- `/verify` — diff-driven gate runner. Classifies changed files, runs only the matching gates (check, worklet-unit, audit-case, soak-canary, screenshot), and prints one verdict block. Shadows the built-in `/verify` in this repo.

CLI tools (always available, see `~/.claude/CLAUDE.md`):

- `ask-deepseek file1 file2 … -q "question"` — bulk file reading. **Mandatory** for ≥3 files, files >300 lines, or codebase exploration. The prototype HTML is 999 lines: read it via DeepSeek for any survey-shaped task; use `Read` only for line-targeted edits.
- `deepseek-write "spec" [-c files…] [-o out]` — boilerplate generation. **Mandatory** for test files, configs (Vite, TS, ESLint, Vitest), docstrings, fixture/preset JSON, README sections, CI workflows.

Never delegate to DeepSeek: debugging, architecture decisions, security-sensitive code, tight cross-file integration, the AV-coupling math (that's the product).

---

## 6. Post-change verification

Inherits the global Post-Push Verification Protocol. Plus, for this project specifically:

- **Any audio or modulation change** → load the app, play a video, and listen for: clipping, denormals (CPU spike on silence), pops on parameter changes, DC drift, stuck voices, or modulation steps that read like zipper noise. The AudioWorklet console must be clear.
- **Any video shader change** → load the app, run each preset, scrub each slider end-to-end. Capture screenshots via Playwright for regressions.
- **Any coupling or LFO-routing change** → both domains must reflect the same source assignment and depth, and no bespoke per-operator modulation UI should appear unless the user explicitly asks for it.
- **Any granulator implementation step** → verify against `references/granulator-port-spec.md` instead of the old rack behavior. Legacy operator-audio tests are not enough to claim success on the new audio direction.

### Automated gates

- **Pre-push hook** (`scripts/hooks/pre-push`) runs `svelte-check` and worklet/core unit tests locally before every push. Enable once per clone with `git config core.hooksPath scripts/hooks`. Do not bypass with `--no-verify` except in a declared emergency.
- **CI: `qa.yml`** runs the full audit matrix on every push/PR to `main`.
- **CI: `granulator-soak.yml`** runs the 60s warmed B2.3 canary on push/PR to `main` when the diff touches `src/audio/**`, `public/worklets/**`, `src/core/mod-bank.ts`, `src/core/grain-scheduler.ts`, the soak spec, or the Playwright config. This is the path-filtered release gate for the granulator hot path — the honest 4-hour soak (`/granulator-soak --full`) stays local.

---

## 7. Context-management policy

When you (Claude) need information:

1. **First**, re-read the relevant project file (`plan.md`, `todo.md`, `memory.md`, source file).
2. **Second**, if the task touches audio, granulation, MIDI, or modulation, read `references/granulator-port-spec.md` and `references/README.md` before writing code.
3. **Third**, if cross-file, use `ask-deepseek` per the global rule.
4. **Last**, fall back to chat-history recall. Treat it as the least authoritative source.

If a fact contradicts between chat history and a file, the file wins.

---

## 8. Things to do at the start of every session

1. Read `memory.md` for outstanding decisions and questions.
2. Read `todo.md` for the active milestone.
3. Skim `plan.md` for the current product/release direction before guessing.
4. If the task touches audio, modulation, MIDI, or the `Audio` tab, read `references/granulator-port-spec.md` before touching code.
5. Check whether the task is for **staging/manual testing** or **public/professional release**; do not conflate them.
6. Before ending the session, sync any affected Markdown files (`todo.md`, `plan.md`, `memory.md`, `CLAUDE.md`) to match the implementation and policy state.
7. State the assumed task in one sentence, declare any assumption, then go.
