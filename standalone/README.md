# Archindus — standalone Oracle workspace

Standalone site: https://archindus.stevenscadet.chatgpt.site/

Extracted November 5, 2026 from Architect Industries Site version 29,
source commit `2809399c11adfbdbfce825bd46b44eb4eebc18a2`.

The Oracle CSS, neural animation, chat controls, settings, voice playback,
file tools, specialist routing, model caches, history and media gallery use
the original source. The workspace now opens at `/`; `/archindus` remains an
alias. The brand link returns to https://architectindustries.com. The company
homepage and contact form are not included as routes on this standalone site.
This is the website's experimental runtime, separate from the full Archindus
backend in the parent GitHub repository.

## Run and verify

Use Node 22.13+ on Linux or WSL with Bash, GNU timeout, curl and flock.

```sh
npm ci
node scripts/verify-assets.mjs
npm run dev
```

```sh
npx tsc --noEmit -p tsconfig.archindus.json
npm run build
node --test tests/*.test.mjs
```

The Site and GitHub source include all bundled runtime and font assets.
`scripts/verify-assets.mjs` checks their SHA-256 hashes and lengths before
development and production builds, without a network request. The URLs in
`scripts/runtime-assets.json` record provenance only. These are runtime files,
not model weights. Licenses and provenance remain in `public/media/` and
`public/fonts/`.

## Independent inference

This site retains the original private Qwen and hosted inference handlers.
Runtime secrets from Architect Industries are not copied. Local file tools,
route inspection, JSON inspection and explicit optional model setup work
without server credentials. General chat requires a configured hosted/private
service or a compatible already-installed browser model.

To enable hosted cloud chat, add `OPENAI_API_KEY` as a Secret in the standalone
Site's Settings → Environment variables, set `ARCHINDUS_HOSTED_ENABLED=true`,
and redeploy. The `DB` D1 binding and committed migrations provide the original
durable budget controls. Defaults are capped at $1 per UTC day and $10 per UTC
month; `ARCHINDUS_DAILY_USD` and `ARCHINDUS_MONTHLY_USD` can lower those ceilings.
The original Site's usage and this independent Site's usage have separate
ledgers. Never put API keys in source, browser storage, or chat messages.

An optional private OpenAI-compatible runtime uses `ARCHINDUS_QWEN_ENDPOINT`,
`ARCHINDUS_QWEN_MODEL`, and optionally `ARCHINDUS_QWEN_API_KEY`, as documented
in `.env.example` and `docs/oracle-interface.md`.

A shared-service connection was tested during extraction but was not reachable
from the standalone deployment. The final source uses the independent original
handlers. Cloud chat is not claimed verified until its credentials are configured
and real multi-turn requests succeed.

## Browser data

History and optional model caches are scoped to origin, browser profile and
device. Data from Architect Industries does not transfer to this new origin.
Chat never starts a model download. Explicit optional local setup may need to
download missing files for this origin. Uploaded file contents and generated
image previews live in the current tab; download before closing it. Voice
availability depends on the browser.

## Deployment

Deploy the Worker build using `.openai/hosting.json`, not a static-only export.
The new Site starts owner-private. Neither Archindus.AI nor Archindus.App has
been reassigned. The GitHub source is isolated in `standalone/` on
`codex/archindus-standalone-site`; it does not replace the existing application.
