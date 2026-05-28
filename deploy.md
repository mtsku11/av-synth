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

## Workflow

Use [deploy-cloudflare.yml](./.github/workflows/deploy-cloudflare.yml) through `workflow_dispatch`.

Inputs:

- `target`: `staging` or `production`
- `run_post_deploy_smoke`: whether to run `npm run qa:smoke:external` against the deployed URL

Behavior:

1. Installs dependencies
2. Runs `npm run build`
3. Deploys `dist/` to Cloudflare Pages with Wrangler
4. Optionally runs the external Playwright smoke suite against the deployed URL

The workflow is intentionally manual. Automatic public deployment is not enabled by default.

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

Staging is the place to complete the final local listening pass and to catch hosted-only regressions. Do not treat a staging deploy as the public release.
