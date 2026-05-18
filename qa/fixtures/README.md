# Fixtures

`ci-smoke.mp4` is the committed deterministic video/audio fixture used by the
Playwright QA pipeline and CI entrypoint.

The manifest loader resolves fixture paths relative to the repo root, so local
ad hoc media like `cello2.mp4` can still be used without duplication. CI should
only depend on committed files under stable repo-relative paths.
