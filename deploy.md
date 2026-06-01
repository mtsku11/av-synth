# Deploy

This repo now treats deployment as two tracks:

- **Staging RC**: the current target. Deploy the existing video-first product to a private/staging URL for real device, browser, and listening validation.
- **Public v1**: only after staging is healthy and the remaining public-surface Color work (`sum`, `.r .g .b .a`) is complete.

## Required GitHub configuration

Secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Repository variables:

- `CLOUDFLARE_PAGES_PROJECT`

Optional repository variables:

- `CLOUDFLARE_PAGES_STAGING_BRANCH`
  Default if omitted: `staging`
- `CLOUDFLARE_PAGES_PRODUCTION_BRANCH`
  Default if omitted: `main`

The Cloudflare Pages project must already exist. The workflow uses Wrangler direct upload against that project.

Cloudflare Pages branch deployments are **not access-controlled by default**. A `staging` branch alias is
appropriate for release-candidate validation, but it is only private when the Pages project is protected
with Cloudflare Access or another explicit access layer.

## Workflow

Use [deploy-cloudflare.yml](./.github/workflows/deploy-cloudflare.yml) through `workflow_dispatch`.

Inputs:

- `target`: `staging` or `production`
- `run_post_deploy_smoke`: whether to run `npm run qa:smoke:external` against the deployed URL

Behavior:

1. Installs dependencies
2. Runs `npm run build`
3. Verifies that `dist/_headers` contains the required cross-origin isolation policy
4. Deploys `dist/` to Cloudflare Pages with Wrangler
5. Optionally runs the external Playwright smoke suite against the deployed URL

The workflow is intentionally manual. Automatic public deployment is not enabled by default.

## First staging deployment plan

Treat the first Cloudflare deployment as a controlled release-candidate pass, not a publicity event.

1. Confirm local readiness:
   - `npm run check`
   - `npm run lint`
   - `npm run test:run`
   - `npm run build`
2. Confirm release blockers and manual gates:
   - verify the current state in `RELEASE_VERDICT.md`
   - review open blockers in `todo.md`
   - keep D3 listening, D4 hardware latency, showcase review, and reference-hardware CPU measurement visible as explicit remaining work
3. Deploy to Cloudflare Pages staging through the workflow.
4. Record the canonical staging URL in this file.
5. Run `npm run qa:smoke:external` against that URL.
6. Review:
   - COOP / COEP / CORP headers
   - boot and media-load behavior
   - audio start / grain behavior
   - real-browser performance
   - 6–12 showcase captures from the hosted build
7. Only after the hosted pass is stable should public-release packaging or announcement work proceed.

## Cross-origin isolation headers

[`public/_headers`](./public/_headers) is copied into `dist/` by Vite and interpreted by Cloudflare Pages
for static responses. This follows the
[Cloudflare Pages `_headers` contract](https://developers.cloudflare.com/pages/configuration/headers/).
If Pages Functions are introduced later, attach the same headers in function responses because `_headers`
does not cover them.

```text
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  Cross-Origin-Resource-Policy: same-origin
```

These headers are required for the isolated SharedArrayBuffer path. The runtime footer reports
`crossOriginIsolated`, `SharedArrayBuffer`, `AudioWorklet`, `WebGL2`, `Web MIDI`, and recording support.

## Manual local fallback

If you need to deploy from a normal local shell instead of GitHub Actions:

```bash
npm run build
npx wrangler pages deploy dist --project-name "$CLOUDFLARE_PAGES_PROJECT" --branch staging
```

For a production deployment, use your configured production branch instead of `staging`.

## Post-deploy verification

Run the smoke suite against the deployed URL:

```bash
PLAYWRIGHT_BASE_URL=https://<your-deployment-url> npm run qa:smoke:external
```

Confirm the hosted response and runtime before sign-off:

```bash
curl -sI https://<your-deployment-url>/
```

Expected response headers:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
```

Canonical private staging URL: **PENDING first Cloudflare deploy**.

Staging is the place to complete the final local listening pass and to catch hosted-only regressions. Do not treat a staging deploy as the public release.
