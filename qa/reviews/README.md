# Manual Review Notes

These files are the durable human-review layer for the pre-deploy audit gate.

- One file per family.
- Update them after reviewing exported `.webm` / `.wav` artifacts from the current `audit-*` run.
- Keep them short: what looked/sounded right, what felt off, what still needs a local audible sign-off.
- If a metric is intentionally manual-only, call that out here instead of trying to force a brittle threshold into CI.
- The final audible sign-off must happen on a normal local machine with speakers or headphones; the automated QA stack can prepare artifacts and analyzer summaries, but it cannot replace listening.

Current family files:

- [`sources.md`](./sources.md)
- [`feedback-composition.md`](./feedback-composition.md)
- [`geometry-spatial.md`](./geometry-spatial.md)
- [`color-tonal.md`](./color-tonal.md)
