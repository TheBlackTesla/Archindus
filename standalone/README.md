# Archindus — standalone intelligence workspace

Live site: https://archindus.stevenscadet.chatgpt.site/

The original Oracle interface was extracted from Architect Industries Site version
29, source `2809399c11adfbdbfce825bd46b44eb4eebc18a2`. This standalone version
adds task-based API model selection and private account data controls. Archindus
is the assistant identity across every specialist and engine. `/archindus` is
an alias of `/`.

## Models and cost controls

The server-owned catalog is in `lib/inference/models.ts`. Standard API prices
were verified against official OpenAI documentation on November 6, 2026:
https://developers.openai.com/api/docs/pricing

| Task | Default API model | Input / output USD per million tokens |
| --- | --- | --- |
| Everyday conversation | GPT-6 Luna | $0.10 / $0.50 |
| Writing and analysis | GPT-6.1 Terra | $1 / $5 |
| Software implementation | GPT-6.1 Sol | $2 / $10 |
| Demanding reasoning / explicit highest capability | GPT-6 Astra | $10 / $50 |

Local tools, greetings, document parsing, CSV calculations, and ready local models
can run without API charges. Chat never downloads model weights automatically.
All four text tiers were verified with live API requests. Hosted images retain
GPT Image 1 mini with fixed low quality and bounded size. Video is not connected.

Account settings offer Automatic, Economy, and Highest capability policies.
Temporary chats retain the cost policy but exclude saved memories and custom
instructions. Prices and model access can change; update and re-verify the
server catalog when upgrading. A user cannot submit arbitrary model IDs.

D1 enforces a shared $1 UTC-day / $10 UTC-month ceiling by default, plus request,
concurrency and per-user limits. Environment values can lower those ceilings.
Each call reserves its bounded worst-case cost before provider access; usage
settles after successful completion. Missing usage or interrupted calls retain
the reservation. Cache discounts and write charges are accounted for when
reported. The ledger is conservative; provider billing is authoritative.

## Accounts and privacy

Sign in or create an account through ChatGPT using the platform-owned sign-in
flow. The first authenticated visit creates an Archindus profile. This hosting
integration does not provide separate email/password authentication.

Settings include display name, custom instructions, model policy, editable saved
memories, history controls, JSON export, chat/memory deletion, and deletion of all
Archindus profile data. Deleting Archindus data does not delete a ChatGPT account.
Signing in afterward creates a new Archindus profile. Site access remains
owner-private; inviting additional users or public launch is a separate audience
configuration.

Every saved-data API derives ownership from platform identity headers and scopes
queries to that identity. Same-origin JSON requests are required for mutations.
Saved memory is explicit: use Settings or say “Remember that…” in a signed-in
cloud chat. It is never silently inferred. Temporary chats do not save or use
memory or cloud history. Device-only processing disables cloud history sync.

Saved text history is bounded to 100 conversations with up to 40 messages each.
Guests keep a device-local current conversation. File contents and generated
media remain in the current tab; download before leaving. A new origin has its
own browser model cache. Deleted media and file contents are not restored from
text history.

Archindus does not train models on chats. Cloud inference sends the request,
relevant history, file excerpts, and enabled personalization to the provider.
Requests use `store: false`; provider retention policies still apply. Turning off
history does not change provider retention.

## Run and verify

Use Node 22.13+ on Linux or WSL with Bash, GNU timeout, curl, and flock.

```sh
npm ci
npm run dev
```

```sh
npx tsc --noEmit -p tsconfig.json
npm run build
node --test tests/*.test.mjs
```

All runtime/font assets are bundled. `scripts/verify-assets.mjs` checks their
hashes locally before builds without downloading from the corporate website.
Licenses and provenance remain in `public/media/` and `public/fonts/`.

## Deployment

Deploy the Worker using `.openai/hosting.json`, with D1 `DB`. Commit and apply all
Drizzle migrations in order; do not rewrite applied migrations. Hosted runtime
secrets are configured through Sites. `OPENAI_API_KEY` must be a Secret;
`ARCHINDUS_HOSTED_ENABLED=true` enables the service. Local `.env.local` and
`.dev.vars` are ignored. The source ZIP contains no credentials, user records,
installed dependencies, or build cache. Supply your own hosting secrets when
moving the application to another service.

This frontend runtime is isolated in `standalone/` within GitHub and does not
replace the repository's full Archindus backend. Archindus.AI and Archindus.App
have not been reassigned.
