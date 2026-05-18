# Sources Review

Date: 2026-05-17
Audit run: `audit-*` green in Playwright and `qa:analyze` green for the current source-family cases.

Scope:

- `audit-source-osc-sweep`
- `audit-source-noise-sweep`
- `audit-source-voronoi-sweep`
- `audit-source-shape-sweep`
- `audit-source-gradient-sweep`
- `audit-source-solid-sweep`
- `audit-source-video-baseline`

Current notes:

- `solid` uncovered a real QA/runtime bug during this audit cycle: source-param updates were not being pushed explicitly into the runtime from the QA bridge. That is now fixed in `src/App.svelte`.
- `osc`, `solid`, and `video` now have stable automated coverage on the part of the behavior the current fixtures measure well.
- `noise`, `shape`, and `gradient` still rely more heavily on manual audio judgment because the current exported spectral metrics do not yet track the intended timbral law reliably enough across runs.

Manual review focus:

- `noise`: does the denser field read like a coherent timbral move rather than a dulling artifact?
- `shape`: does lowering smoothing feel like a usable timbral change, not just thinning?
- `gradient`: does the audible movement feel related to the visual sweep, not arbitrarily animated?
- `solid`: does the loud end remain clean enough for professional use?

Outstanding local sign-off:

- Do one audible pass on `noise`, `shape`, and `gradient` in a normal browser before deploy.
