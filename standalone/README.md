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
node scripts/restore-assets.mjs
npm run dev
```

```sh
npx tsc --noEmit -p tsconfig.archindus.json
npm run build
node --test tests/*.test.mjs
```

The Site source includes all bundled runtime assets. The GitHub source copy
restores four large runtime/font assets using `scripts/restore-assets.mjs`.
Their exact SHA-256 hashes, lengths and owner-operated URLs are committed in
`scripts/runtime-assets.json`. Valid existing files make no network request.
These are runtime files, not model weights. Licenses and provenance remain
in `public/media/` and `public/fonts/`.

## Connected inference

The default `ARCHINDUS_RUNTIME_MODE=shared` forwards the three fixed Archindus
API routes to the existing Architect Industries Site. Streaming responses,
errors and cooldowns pass through. No API key is copied. Browser cookies and
Authorization headers are never forwarded. Same-origin POSTs, a 150,000-byte
input limit, fixed destinations, bounded timeouts and rejected redirects keep
this a narrow service connection. Automatic-mode prompts, relevant file
excerpts and conversation context use the same disclosure shown in Settings.

Both sites share the original service's availability, model configuration,
cost ledger and spending limits. Relayed traffic may share an upstream
per-client quota and can be more restrictive than direct traffic. An outage
or exhausted upstream budget does not become a fabricated successful answer.

For independent inference, configure server-side values from `.env.example`
and set `ARCHINDUS_RUNTIME_MODE=independent`. Hosted inference needs the `DB`
D1 binding, committed migrations, server-only `OPENAI_API_KEY`, and
`ARCHINDUS_HOSTED_ENABLED=true`. Enter secrets in hosting settings, never in
source or browser storage. Original handlers and budget controls are retained.
Redeploy after environment changes.

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
