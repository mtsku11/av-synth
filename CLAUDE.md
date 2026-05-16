# CLAUDE.md — av-synth project rules

This file is the contract Claude reads on every session in this repo. It overrides defaults. Keep it terse, factual, and updated when conventions change.

> **Personal global rules** at `~/.claude/CLAUDE.md` also apply (post-push verification, surgical changes, DeepSeek delegation protocol, surface-assumptions-don't-ask). They are not duplicated here.

---

## 1. What this project is

**av-synth** is a browser-based audio-visual synthesiser. It takes a video input (file, camera, screen, or procedurally generated source) and transforms it through a chain of operators **mathematically coupled to a parallel audio chain**. One parameter, one mathematical relationship, two domains — never two unrelated UIs glued together.

The reference is Hydra (https://hydra.ojack.xyz). The novel contribution is: every Hydra video primitive has a defined, derivable audio analogue, and the coupling is the product, not an afterthought.

Current state: single 999-line HTML prototype (`av-hydra-preview (1).html`). Target: a professional, productisable multi-file web app.

---

## 2. Authoritative project documents

Always read these *as files* — never reconstruct their contents from chat history.

| File | Purpose | When to read |
|---|---|---|
| `plan.md` | Full Hydra API ↔ audio-domain mapping. The mathematical spec for every operator. | Before implementing any operator. Before any AV-coupling decision. |
| `todo.md` | Staged build-out checklist (single-HTML → modular app). | Before starting work. Update as items close. |
| `memory.md` | Decision log + open questions + design tensions. | At start of session. Append when a non-obvious decision is made. |
| `av-hydra-preview (1).html` | The working prototype. Source of truth for currently-implemented behaviour. | When porting an existing feature to the modular codebase. |

The harness also has a separate per-session memory dir at `~/.claude/projects/-Users-marcscully-Projects-av-synth/memory/`. That holds cross-session preferences and feedback. The project-level `memory.md` is the human-readable engineering log — distinct from harness memory.

---

## 3. Architecture

```
av-synth/
├── index.html                      # Vite entry
├── package.json
├── vite.config.ts
├── tsconfig.json
├── src/
│   ├── main.ts                     # boot
│   ├── App.svelte                  # root
│   ├── core/
│   │   ├── graph.ts                # patch graph: nodes, edges, params
│   │   ├── params.ts               # ParamSpec types, ranges, units
│   │   ├── clock.ts                # transport, bpm, time, sequencer
│   │   ├── coupling.ts             # AV mapping table — executable form of plan.md
│   │   └── presets.ts
│   ├── video/
│   │   ├── renderer.ts             # WebGL2 context, FBO ping-pong, render loop
│   │   ├── shaders/                # one folder per operator family
│   │   │   ├── sources/            # osc, noise, voronoi, shape, gradient, solid
│   │   │   ├── geometry/           # rotate, scale, pixelate, repeat, kaleid, scroll
│   │   │   ├── color/              # posterize, contrast, hue, luma, thresh, …
│   │   │   ├── blend/              # add, sub, mult, diff, layer, blend, mask
│   │   │   ├── modulate/           # modulate, modulateRotate, modulateScale, …
│   │   │   └── copy.frag
│   │   ├── operators.ts            # operator registry, chainable Hydra-style API
│   │   └── sources.ts              # cam / image / video / screen init
│   ├── audio/
│   │   ├── engine.ts               # AudioContext, graph builder, routing
│   │   ├── worklets/               # AudioWorkletProcessor implementations
│   │   ├── operators.ts            # mirrors video operator API; same names, audio impl
│   │   ├── analyser.ts             # FFT + RMS + flux for video reactivity
│   │   └── sources.ts              # mic / file / line / system-audio
│   ├── ui/
│   │   ├── Patch.svelte            # patch editor
│   │   ├── Knob.svelte, Slider.svelte, Editor.svelte, Scope.svelte
│   │   └── styles/
│   └── lib/
│       ├── math.ts                 # lerp, smoothstep, easing, dB↔linear
│       └── glsl-loader.ts          # ?raw imports for shader strings
└── public/presets/
```

### Stack (fixed unless escalated)

- **Language**: TypeScript (strict). JS allowed only inside `worklets/*.js` because `AudioWorkletProcessor` is loaded as a raw module URL.
- **Build**: Vite.
- **UI**: Svelte (component model for patch UI, control surfaces, modal panels). Canvases and worklets are framework-agnostic.
- **Video**: raw WebGL2. No three.js, no regl yet — the operator set is hand-written GLSL and that's the whole point.
- **Audio**: Web Audio API + custom AudioWorklets for every non-trivial operator. Built-in nodes (`GainNode`, `DelayNode`, `BiquadFilterNode`, `AnalyserNode`) are fine where they're a perfect fit. Anything Hydra-shaped goes in a worklet.
- **State**: a single reactive graph object (`src/core/graph.ts`). Parameters are typed by `ParamSpec` (range, unit, default, automation source). Both renderers subscribe; neither owns the truth.
- **No backend** at this stage. Everything is static and runs in the browser.

### Coupling principle (non-negotiable)

Every user-facing parameter has **one canonical specification** in `src/core/coupling.ts`. That spec exposes:
- a *normalised* control value (the slider/knob),
- a *video mapping* (range, curve, unit) consumed by the video operator,
- an *audio mapping* (range, curve, unit) consumed by the audio operator,
- and a *coupling function* (often identity, sometimes a fixed mathematical relationship — e.g. spatial frequency in cycles-per-screen → temporal frequency in Hz via the chosen base mapping).

Renderers do not read raw slider values. They read mapped values from the coupling layer. This is the only way the AV stays in lockstep.

---

## 4. Engineering rules

### General

- **Read project files for context, not the chat scrollback.** If a fact lives in `plan.md`, re-read it before quoting it. Chat memory is lossy; files aren't.
- **Surgical changes only.** Touch what the task requires. No drive-by refactors. See global rules.
- **No silent reformatting.** Match existing style even if you wouldn't write it that way.
- **No new abstractions until a third concrete caller appears.** Rule of three.
- **No comments explaining what the code does.** Only comments for non-obvious *why* — hidden constraints, perf workarounds, browser quirks.
- **Surface assumptions, declare the choice, proceed.** Don't ask permission for default-shaped decisions. See `~/.claude/CLAUDE.md`.

### Hydra-fidelity rules

- Operator **names match Hydra exactly** (`modulateRotate`, not `modulate_rotate` or `rotateMod`). Parameter names and ordering also match Hydra where Hydra defines them. Deviations require a memory.md entry.
- Each operator has both a **video shader fragment** and an **audio worklet/node graph**, registered under the same key.
- Each operator declares its **coupling spec** (see §3). No video-only operators without an audio analogue — if one is genuinely uncoupled, mark it `coupling: 'visual-only'` and justify in `plan.md`.

### Audio rules

- **Sample-accurate timing matters.** Anything that schedules events uses the `AudioContext.currentTime` clock, not `setTimeout` or `requestAnimationFrame`.
- **k-rate vs a-rate parameter automation** is a deliberate choice per operator. Document which in the worklet header.
- **No clipping by default.** Master bus has a brick-wall limiter and a measurement tap. Loud presets must still measure under 0 dBFS true-peak.
- **AudioWorklet first.** Avoid `ScriptProcessorNode` (deprecated, main-thread).
- **All worklets ship a unit `process()` test** in `src/audio/worklets/__tests__/`.

### Video rules

- **WebGL2 only.** Use `EXT_color_buffer_float` for HDR FBOs where needed.
- **One operator = one fragment shader.** No mega-shaders. Composition happens via ping-pong FBOs.
- **Shaders are loaded as `?raw` imports from `.glsl` files.** No inline template strings except for trivial 1-liners.
- **Premultiplied alpha throughout.** Document any operator that breaks this invariant.
- **Render loop never allocates.** No `new` inside `requestAnimationFrame`.

### UI rules

- The control surface is a product, not a debug panel. Type everything, label everything in physical units (Hz, dB, ms, sides, %), show value next to control.
- Visual identity: dark, high-contrast, monospaced for numerics, generous spacing. Treat the UI like a hardware synth panel.

---

## 5. MCP servers & tools available

This project's `.mcp.json` is not yet configured (see `todo.md`). Tools currently available from the harness:

| Server | What it does | When to use |
|---|---|---|
| `github` | Repo, PR, issue, branch, commit operations. | Once we push this to a GitHub repo. For PR reviews use the pending-review workflow (`pull_request_review_write` → `add_comment_to_pending_review` → `submit_pending`). |
| `playwright` | Headless browser automation. Navigate, screenshot, click, evaluate JS. | **Mandatory post-deploy visual verification** per global rules. Also for end-to-end UI tests of the synth UI once it's hosted. |
| `claude_ai_Gmail` / `Google_Calendar` / `Google_Drive` | Personal Google account integrations. | Not relevant to product work; do not invoke without an explicit ask. |

CLI tools (always available, see `~/.claude/CLAUDE.md`):

- `ask-deepseek file1 file2 … -q "question"` — bulk file reading. **Mandatory** for ≥3 files, files >300 lines, or codebase exploration. The prototype HTML is 999 lines: read it via DeepSeek for any survey-shaped task; use `Read` only for line-targeted edits.
- `deepseek-write "spec" [-c files…] [-o out]` — boilerplate generation. **Mandatory** for test files, configs (Vite, TS, ESLint, Vitest), docstrings, fixture/preset JSON, README sections, CI workflows.

Never delegate to DeepSeek: debugging, architecture decisions, security-sensitive code, tight cross-file integration, the AV-coupling math (that's the product).

---

## 6. Post-change verification

Inherits the global Post-Push Verification Protocol. Plus, for this project specifically:

- **Any audio change** → load the app, play a video, listen for: clipping, denormals (CPU spike on silence), pops on parameter changes, DC drift. The AudioWorklet console must be clear.
- **Any video shader change** → load the app, run each preset, scrub each slider end-to-end. Capture screenshots via Playwright for regressions.
- **Any coupling change** → both renderers must reflect the same control input within one frame (~16 ms) and one audio block (~3 ms at 128-frame, 48 kHz).

---

## 7. Context-management policy

When you (Claude) need information:

1. **First**, re-read the relevant project file (`plan.md`, `todo.md`, `memory.md`, source file).
2. **Second**, if cross-file, use `ask-deepseek` per the global rule.
3. **Last**, fall back to chat-history recall. Treat it as the least authoritative source.

If a fact contradicts between chat history and a file, the file wins.

---

## 8. Things to do at the start of every session

1. Read `memory.md` for outstanding decisions and questions.
2. Read `todo.md` for the active milestone.
3. If the user is asking about behaviour: skim `plan.md` for the operator spec before guessing.
4. State the assumed task in one sentence, declare any assumption, then go.
