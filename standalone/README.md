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

## Living neural brain

The same neural volume stays mounted when expanded. Each point is a personality, an execution engine (or local tool runtime), a router, or one of 20 empty personality slots. Drag rotates the volume, scroll/controls zoom, and the keyboard-accessible finder selects any point. Details float beside the selected node instead of replacing the brain with a diagram or sidebar layout.

Personality nodes expose their actual base instructions, custom instructions, policy, usual text tier and last observed model from conversation metadata. Model nodes expose IDs, capability tiers, readiness and observed usage. Typical tiers are labeled separately from models actually used. Only reported requests illuminate a route; idle rotation shows structure without fabricated model activity. A model shared by multiple personalities remains one engine node.

Signed-in users can claim an empty node to create a private AI personality. The clicked slot is persisted per account, remains fixed on edits and is freed on deletion. The appended migration assigns existing personalities unique slots without losing their instructions. Atomic slot claims and the 20-personality cap prevent duplicate occupancy. Personalities remain specializations of Archindus, not separately trained models or new permissions. Temporary chats still honor explicitly selected personality instructions while excluding saved memories and global instructions. Existing export, deletion, budget and ownership controls apply.

## Main ElevenLabs voice

Voice `8FWNPj6rjBosEZ2EXARh` is the main Archindus voice across all personalities, using `eleven_flash_v2_5` and MP3 playback. Set `ELEVENLABS_API_KEY` as a production server secret with text-to-speech permission and access to this voice, then deploy to activate it. A voice ID is not an API credential. The key is never returned to the browser. The voice endpoint reports setup status without exposing secrets.

Enable Voice to read completed answers automatically; Listen replays the answer. Speech excludes code blocks, URLs, and private reasoning, and is bounded to the first 2,400 characters. The latest generated clip is cached in this tab only to avoid charging for identical replays. Stop, new requests, navigation, voice-off, and switching to device-only processing cancel pending speech and release playback resources. Browser autoplay restrictions may require tapping Listen.

ElevenLabs synthesis requires sign-in and same-origin requests. Atomic database quotas cap generation at 10,000 characters/day and 100,000/month across the site, with per-user rate and concurrency limits. Failed/ambiguous attempts retain reservations; character caps bound usage, not an exact dollar amount. The ledger stores no speech text or audio, and uses a daily keyed identity hash. Inference spending limits remain separate.

Voice starts off unless a user enabled it earlier. When enabled in Automatic mode, spoken answer text goes to ElevenLabs under its retention policy. Device-only processing uses local browser speech and sends no voice text to ElevenLabs. Until the secret is connected, the existing browser voice remains available and Settings explicitly reports setup pending. No separate ElevenLabs conversational agent replaces the Archindus router or identity.

### Browser voice preference

Browser speech now prefers recognized female English voices from South Africa, then Europe (including UK and Ireland), before other available voices. This uses provider labels and a small known-name list because Web Speech exposes no gender field; it is a preference, not a guaranteed gender detector. Settings → Runtime & voice shows the selected name/locale and allows an explicit, per-device choice. Voice lists refresh on `voiceschanged`, with a bounded initial wait, and pending speech cannot start after cancellation. Device-only processing filters out remote browser voices before matching or honoring an explicit selection. No voice is downloaded by this change.

The neural surface uses the original seeded 540-point (300 on mobile) dense mesh and cyan glow, with the semantic model/personality controls retained above it. Mesh junctions are visual structure; routing highlights still come from observed requests. The default brain and its stage are larger before zoom, with chat positioned below the reserved space.

### Hosted recovery

Automatic processing always allows one hosted attempt for an explicit user request, even if the last availability snapshot said unavailable. Status polling is advisory; the server still authorizes every generation against credentials, cooldown, rate and spending limits. Explicit new requests/retries clear only browser-local backoff. Device-only mode continues to exclude cloud inference. HTTP/malformed status failures remain unknown, rather than becoming a false definitive outage. This prevents recovered services from being silently excluded when no local model is installed.
