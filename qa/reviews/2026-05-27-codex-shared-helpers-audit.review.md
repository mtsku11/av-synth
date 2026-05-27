# Codex shared-helpers passes — verdict

**Evidence:** `qa/reviews/2026-05-27-codex-shared-helpers-audit.factual.md`
**Scope:** the two uncommitted working-tree passes attributed to Codex on 2026-05-27, plus the user-supplied axis/selector follow-up checklist.

---

## 1. What the two passes actually did

Per `memory.md` entries dated 2026-05-27 and the diff against `HEAD`:

**Pass A — modulation helper layer + granulator quality modes.**
- Adds `src/ops/shared.ts` with `UniformVideoStage`, `samplerUniform` / `vec4Uniform` / `paramUniform` / `ctxUniform`, canonical uniform constants (`PRIMARY_SOURCE_UNIFORM`, `PREV_FRAME_UNIFORM`, `ROUTED_SOURCE_UNIFORM`, `TIME_UNIFORM`, `RATE_UNIFORM`), `passthroughParam`, and `createVideoOperatorDef`.
- Re-points every `modulate*` / `modulate*Routed` op at `createVideoOperatorDef`. No new op IDs, no default changes, no chain reshuffle.
- Adds explicit `eco` / `balanced` / `high` quality selector to the granulator (`balanced` preserves prior 8-tap sinc behaviour; `high` adds a 12-tap path with a larger Hermite budget).

**Pass B — granulator diagnostics + adaptive high + alias-op audit metadata.**
- Worklet writes requested/effective quality, budget-limited state, interp mode, pitch load and voice counts into the runtime-snapshot ring; `GranulatorCard.svelte` surfaces them in a read-only diagnostics panel.
- Adds opt-in adaptive step-down: when `quality=high` is overloaded, the worklet drops to the lower-tap sinc path *before* falling through to Hermite. `balanced` is untouched.
- Adds `audit` metadata (`shaderPath`, `neutralDefault`, `qaCaseIds`, `qaCoverage`) to the alias-family ops (`scrollX`/`scrollY`, `repeat`/`repeatX`/`repeatY`, `r`/`g`/`b`/`a`) and enforces it in `src/core/operators.test.ts` via a "keeps audited alias-family operators wired" assertion that requires both the shader file and each referenced QA case file to exist.
- Adds `qa/e2e/operator-registry-validation.spec.ts` — every registered op's video stage must compile in-browser via the QA bridge.

## 2. Pass-level verification

| Gate | Result |
|---|---|
| `npm run check` (svelte-check, full project) | 383 files, **0 errors, 0 warnings** |
| `npm test` (vitest, all 14 files) | **191 / 191 passed** |
| New unit coverage in `operators.test.ts` | "every operator ID registered", "groups product-surface operators", "keeps audited alias-family operators wired" — all green |
| `src/audio/worklets/granulator.test.ts` | 28 tests passing, including the new high-pitch alias-energy / grain-boundary click / level-stability / fixed-seed-determinism / SAB-mode-`parameterLookupCount===0` cases |
| Op-characterisation thorough bless (last night) | 50/50 baselines including `dataMosh.json`, `pixelSort.json`, `fieldSort.json` |

**Verdict:** both passes are structurally sound and the gates they themselves added are passing. The non-breaking claim holds — no operator ID, default, paramOrder, or chain entry was disturbed by the re-pointing.

## 3. Axis/selector follow-up checklist

> *"Small follow-up candidates for the axis/selector families…"*

| Item | Status | Notes |
|---|---|---|
| **`scrollX` / `scrollY`** shared axis-transform stage helper for `u_amount` / `u_speed` / `u_time`, axis-specific coupling text local | **Done — via the generic builder.** Both files now use `createVideoOperatorDef({ uniforms: [PRIMARY_SOURCE_UNIFORM, paramUniform('u_amount', …), paramUniform('u_speed', …), TIME_UNIFORM] })` and keep their own hint text. There is no dedicated `createAxisTransformStage`, so the abstraction is one level higher than the suggestion. The boilerplate is gone, which was the goal. |
| **`repeat` / `repeatX` / `repeatY`** shared repeat-stage helper | **Done — via the generic builder.** Same shape as above. Unary `reps/offset` vs dual-axis `repeatX/repeatY/offsetX/offsetY` names are preserved (factual scan §"Alias-family operators with audit metadata"). |
| **Channel selectors** moved onto the shared stage utility | **Done.** `channel.ts:13-33` defines all four via `makeChannelDef → createVideoOperatorDef` with `vec4Uniform('u_weights', weights)`. The whole file collapsed from a class-per-op to a single 33-line module. The new `vec4Uniform` helper in `shared.ts` is the small extension explicitly contemplated by the suggestion's "if more swizzle/select aliases are added" clause. |

All three follow-ups are effectively complete. The chosen shape is one generic `createVideoOperatorDef` rather than three family-specific helpers — same end result, fewer abstractions, consistent with the "no new abstractions until a third concrete caller appears" rule.

## 4. Defect found — channel-op audit metadata is mis-wired

`src/ops/channel.ts:21-27` carries:

```ts
audit: {
  shaderPath: 'src/video/shaders/channel.frag',
  neutralDefault: false,
  qaCaseIds: ['audit-modulateDisplace-osc-sweep', 'audit-modulateDisplace-video-cross-source'],
  qaCoverage: 'shared',
},
```

Those two case files exist in `qa/cases/`, so the "keeps audited alias-family operators wired" test passes — but they test **modulateDisplace**, not channel isolation. There are no `audit-channel-*` (or `audit-r-*` / `audit-g-*` …) case files in `qa/cases/`. By contrast `scrollX/Y` and `repeat/X/Y` each have dedicated case files matching their declared IDs.

`memory.md` 2026-05-27 explicitly justifies the audit metadata as "an authoring constraint so helper-driven aliases do not silently lose their … QA link" — but the link on the channel ops is silently pointing at the wrong operator. The unit test happily passes because it only checks file existence, not topical relevance.

**Suggested fix (your call — not applied):** one of
1. Author `audit-channel-{r,g,b,a}-*` cases and update the IDs, or
2. Drop the IDs to a neutral pair (e.g. the existing `audit-modulate-osc-baseline` if that covers `r`) and set `qaCoverage: 'shared'` honestly, or
3. Tighten the registry validator so `qaCoverage: 'shared'` requires the referenced case files to actually mention the op being audited (filename match) — would have caught the copy-paste at registration time.

No other issues found in either pass. Worklet tests, presets tests, and the new operator-registry validators are all green; the granulator runtime/UI integration is wired end-to-end through `App.svelte:1816-2143` and the QA bridge.
