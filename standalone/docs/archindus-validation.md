# Archindus execution validation

Updated 8 September 2026. The hosted inference work extends the previously deployed Ounumi release. The browser observations below describe that earlier release, not new browser QA.

## Hosted inference and cost controls

Added server-only text and image execution, fixed model/parameter limits, a D1 usage ledger, atomic spending reservations, request deduplication, UTC day/month limits, per-client limits and a global concurrency bound. Keys are deployment secrets and are excluded from source exports. Device-only mode excludes both hosted and private inference.

Clear tasks now avoid the second planning inference. Greetings and direct CSV statistics never invoke a hosted model. Ambiguous objectives retain a private structured planning step. Hosted failures fall back to browser text or browser diffusion when supported. Provider refusals and user cancellations stop execution.

New checks execute the production budget queries against SQLite using multiple simultaneous connections. They cover daily and monthly limits, calendar rollover, deduplication, request and concurrency limits, missing database/key, invalid and oversized input, cross-origin rejection, server-controlled models, usage settlement, retained timeout reservations, unexpected-usage shutdown, final-answer filtering, code artifacts, validated 1024px PNG delivery, hosted cooldown, local fallback, and cancellation/refusal handling.

The subsequent shared-cooldown repair persists provider unavailability in D1. Credit/credential failures pause hosted requests for five minutes; overload/server responses pause them for one minute. The status endpoint and atomic budget reservation both honor that pause. Regression checks confirm that another visitor and a reopened database connection cannot make a paid call or consume a reservation during the cooldown, shorter concurrent pauses cannot shorten it, expiry permits a new request, and content refusals do not disable unrelated work. The browser respects the server's `Retry-After` duration. The new migration only adds the provider-state table and preserves existing usage records.

Provider responses in automated tests are controlled fixtures. Successful real hosted generation must be established through the published endpoint; these tests alone do not establish model access, account balance or output quality. The local D1 emulator could not run under this environment's network restrictions, so the exact SQL was validated with SQLite and separate worker connections. A Node loader supplies an empty Cloudflare environment only for the unrelated homepage rendering test.

The last real hosted check after publication returned `credit_balance_exhausted`, and the failed attempt's conservative reservation was recorded. Successful real hosted text and image generation remains blocked pending API account credit. No further paid generation probe was made for the cooldown repair. Its new D1 migration and behavior are verified locally with the production SQL; successful production inference is not claimed.

## Preserved repairs

- Ounumi is the creative agent throughout the registry, planner, progress labels, image preview, and PNG filename. Plor and Angelu remain accepted commands and stored-ID aliases. Existing conversations are restored with the current agent identity.
- New writing tasks no longer inherit a failed image objective. The separation applies to private, WebGPU, and CPU execution; relevant follow-ups retain their context.
- Draw, paint, sketch, and illustrate requests invoke the image executor. Storyboards, poems, and media prompts remain writing tasks. Explicit specialist selections take precedence over the planner.
- Ounumi uses Qwen2.5 0.5B for CPU creative work instead of the previous 135M fallback. Short writing requests use a bounded response budget.
- Poem line breaks are preserved in the conversation. Indented code fences render correctly and produce downloadable source with the fence indentation removed, preserving nested code indentation.
- Image generation requests the high-performance GPU and checks the compiled model's buffer and workgroup limits before downloading model weights. It handles GPU errors/loss, Stop, cache failures, startup failures, and invalid output without claiming an image exists.
- Component tests now have a separate dependency cache so they do not invalidate the running development preview's document imports.

## Automated verification

The expanded suite contains 40 regression tests. The focused Archindus TypeScript check, lint, and Sites production build also passed. The build's large-chunk advisory concerns on-demand model and document dependencies.

Publication initially encountered an existing `inference_provider_state` table. Read-only production inspection confirmed its expected columns and the retained spending record. The failed new migration now uses `CREATE TABLE IF NOT EXISTS`; a regression check confirms repeat application preserves both usage and cooldown records. The earlier usage-table migration is unchanged.

The checks cover:

- Explicit routing, legacy aliases, contextual follow-ups, new creative tasks, and model-routing validation.
- Removal of private reasoning before rendering, history, copying, and artifacts; recovery from coding capability denials and incomplete output.
- Local CSV calculations, upload size/type validation, Unicode DOCX/PDF export and readback, isolated HTML previews, and indented code artifacts.
- Image message isolation, cancellation, startup recovery, rejection of unsupported devices before engine creation, PNG structure/checksums, corrupted output rejection, and unavailable/full cache handling.
- Real diffusion WASM allocation/copy operations and CLIP tokenizer execution. These execute actual runtime code, but do not perform GPU diffusion.
- Production homepage rendering, metadata, the directly served lazy WebP, same-site contact safeguards, and preservation of the safe Worker response path.

All nine vendored image-runtime assets match their recorded checksums. Both WASM modules initialize, and the image scheduler remains bounded to 20 diffusion steps.

## Earlier browser observations

- The existing design renders Ounumi in the agent chooser and responses.
- `Use Plor. Draw a red fox` selects Ounumi and invokes the image executor. With no working WebGPU adapter, it returns an explicit device error and Retry, with no image or PNG download claim.
- Immediately afterward, `Use Ounumi. Write a two-line poem about a quiet forest.` executes the real Qwen2.5 0.5B CPU model and returns exactly two lines about the forest, without importing the failed fox-image subject. The clipboard preserves both lines, and the repaired display shows both lines.
- DOCX preparation for that response succeeds and exposes a native Download DOCX link. The completed DOCX download event times out in this cloud browser.
- PDF preparation succeeds after refreshing the preview dependency cache and exposes a Download PDF link. The regression suite independently creates and reads back complete Unicode PDF content.

## Remaining verification limits

**Successful local GPU diffusion has not been verified in this environment.** This browser has no usable WebGPU adapter. Controlled image fixtures validate lifecycle and file handling; they do not establish diffusion quality or device compatibility. Ounumi remains labeled experimental for browser images. A capable device still needs to generate an actual PNG, save it, exercise Stop, and complete a second request.

**Completed in-site file transfers remain unverified in this browser.** File construction and download controls are verified. In the previous session, a plain same-origin static-file control with no Archindus code also timed out, so these observations do not establish a defect in the application's native download links.

Earlier validation recorded a real Qwen2.5 Coder 0.5B CPU response implementing Python addition. A larger Snake-game CPU request did not finish during the earlier observation window; this update does not claim that larger-code capability has been verified.

Adaptive Qwen WebGPU inference remains unverified here. The optional private Qwen service is not connected, and video generation is not connected. CPU compatibility remains slower and less capable than larger GPU or workstation models.

## Media provenance

The image model is MLC's published Stable Diffusion 1.5 export, pinned at Hugging Face revision `c33c5ec1cfc95401dd2930972998013e978e0821` under `web-sd-shards-v1-5`. Its previously inspected manifest describes 61 shards totaling 2,064,143,286 bytes. Model weights are downloaded on demand and are not bundled in the source ZIP. Runtime sources, local patch descriptions, checksums, and license texts are retained in `public/media`.

- https://github.com/mlc-ai/web-stable-diffusion
- https://websd.mlc.ai/
- https://huggingface.co/mlc-ai/web-sd/resolve/c33c5ec1cfc95401dd2930972998013e978e0821/web-sd-shards-v1-5/ndarray-cache.json
