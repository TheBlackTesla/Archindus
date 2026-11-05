# Archindus Oracle interface

**Current behavior, November 2026:** Model acquisition is opt-in in Settings. Local tools, installed browser AI and saved models can run independently of hosted inference. Run details report the engine and timings. See the README for the current runtime contract; dated milestones below describe their respective releases.

The `/archindus` route now opens on a pure black canvas with a live neural network and a bottom-centered composer. Architect remains the default central router. Settings contain specialist overrides, local-model preferences, and the existing processing controls. The company homepage and its current slogan are preserved.

## Interaction

- Type in the composer. Enter sends; Shift+Enter adds a line. Stop cancels the current request.
- The procedural graph floats at rest, pulses during work, and responds to speech playback events. It uses Canvas 2D, capped pixel density and frame rate; it requires neither a model download nor WebGPU. Reduced-motion preferences stop movement, and background tabs skip drawing.
- The network, final-answer panel and composer occupy separate grid rows. The network remains horizontally centered; long answers scroll in their own panel, and short viewports can scroll the page without overlapping the network or composer. Private model reasoning is stripped before display, storage, copying, speech, and exports. Routing details are available separately.
- Voice is optional and off by default. The browser speech service reads final answers in bounded chunks, excluding code and raw markup. Turning Voice off, starting a new request, or changing processing stops speech. Only new answers or an explicit Listen action are spoken; restored history does not autoplay.
- Local speech voices are preferred. This-device-only mode refuses remote speech voices. A device without a compatible local voice continues with text and an explicit notice. Voice selection follows the browser/device and requires no additional Archindus API key.
- Images open directly in the workspace. The gallery has previous/next buttons, keyboard arrows, swipe navigation, a per-item filename and a native Save image link. Creations opens the session-wide gallery.
- Explicit plural image requests can create up to four images sequentially. Each image goes through the existing generation and budget controls. The per-client minute limit now admits one four-image batch; the five-image daily cap and monetary limits remain unchanged. Failed later generations preserve completed images. The viewer also renders video artifacts with native playback controls; the current execution system has no video-generation provider connected.
- Code artifacts expose source downloads and isolated HTML previews. Other responses offer Markdown, DOCX, and PDF exports under Save response. Attachments and history retain their existing behavior.
- Generated media and uploaded file bytes remain local to the current tab. Save generated media before refreshing or starting a new conversation. Text history and preferences persist in browser storage when available.

## Service configuration

The existing server-only credentials, private Qwen endpoint, hosted OpenAI text/image adapters, optional device-only inference, shared cooldown, and $1/day and $10/month application limits are preserved. Model selection and billable parameters remain server-controlled. No additional paid provider was added. A live hosted Ounumi two-line poem succeeded on 9 September 2026 during the performance update. The earlier exhausted-credit result is historical; account availability can still change.

See `README.md` and `.env.example` for runtime setup. Model weights download on demand and are not part of the source ZIP. Never put API keys into frontend source.

## Initial interface validation — 9 September 2026

The production build, focused TypeScript check, and all 45 regression tests passed. No public deployment was requested for this interface update.

- Desktop browser rendering and first greeting/agent-capability responses verified in the actual app.
- Mobile layout checked at a 390 × 844 CSS-pixel iframe viewport, including composer and response controls; this is viewport testing, not a physical iPhone/Android-device test.
- Settings, privacy-mode selection, voice on/off, history drawer and text fallback when no local speech voice exists verified.
- An isolated test surface rendered the real media gallery and artifact components with clearly labeled image fixtures. Previous/next, keyboard navigation, wraparound and per-item download filenames passed. These fixture checks do not establish successful model-generated imagery.
- Native file links are present, but the browser still does not report completed downloads. File-byte integrity and export content are covered by the regression suite; real user-device transfer remains unverified here.
- This test browser has no installed local speech voice. Audible playback remains to be checked on a compatible device. The speaking animation is driven by speech start/end events.
- Added behavioral tests for plural routing, sequential bounded generation, preservation of partial batches after provider failure or cancellation, and sanitization of spoken answers.
- Successful local diffusion still requires a compatible WebGPU device. No real paid generation probe was made for this interface work. Video generation remains unconnected.

Speech API references: https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/speak and https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisVoice/localService


## Performance update — 9 September 2026

The production build, focused TypeScript check, and all 50 regression tests pass. New checks cover incremental poems before completion, fragmented UTF-8 and reasoning tags, stream cancellation and truncation, reservation settlement, and online requests that never start a local download.

- The network stays at the viewport midpoint while responding. Canvas dimensions are capped to the viewport; the drawing is substantially larger than the original. Connected electron paths and waves are driven by request transitions, arriving answer text, and speech word boundaries where supported. The animation is a visualization of activity, not a rendering of model internals or captured audio amplitude.
- Online mode tries the hosted endpoint immediately, without waiting for the status poll. Failed online calls never start a local model download. Local inference is an explicit device-only choice; existing privacy preferences remain honored.
- The WebGPU default is Qwen3 0.6B, with 1.7B/4B only when selected. Browser inference skips a separate planning pass. Models remain in their worker between successful requests and WebLLM reuses its persistent cache.
- Hosted and WebGPU final-answer text streams. Both filter split reasoning tags. Stream failure or token-limit truncation produces an error, never a completed downloadable artifact. Private Qwen and CPU paths retain their existing complete-answer behavior.
- Hosted usage is settled after the stream ends. Cancelled or incomplete streams without verified usage retain their entire reservation. The $1 daily / $10 monthly ceiling is unchanged.
- Desktop and 390 × 844 iframe viewport checks confirm the larger network remains centered with an answer open, and the composer stays usable. A real hosted two-line poem completed successfully; GPU inference and audible speech remain hardware-dependent and are not newly verified on this test browser.

Implementation references: [WebLLM runtime and model requirements](https://llm.mlc.ai/docs/deploy/webllm.html), [OpenAI streaming events and usage](https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events).


## Conversation and recovery update — 12 September 2026

- Completed user/assistant pairs and a bounded opening brief remain in model context. Failed and stopped tasks do not contaminate later tasks. Hosted transport accepts up to 40 bounded messages, fixing failures beyond four exchanges.
- GPU initialization/execution failures recover to CPU. General local chat uses Qwen2.5 0.5B with compact instructions and streamed final text. CPU workers are reused; a crashed worker gets one recovery attempt with retained context.
- Stop waits for cancellation acknowledgement before another request reuses the model. Each CPU forward pass yields to worker messages; an unresponsive worker is discarded after eight seconds.
- Network, answer and composer use separate grid rows. The canvas fills a bounded container without an intrinsic-size feedback loop. Prior desktop, 390 × 844, 320 × 640 and 844 × 390 viewport checks found no overlap or horizontal overflow. Short landscape layouts permit vertical page scrolling.

Validation: all 60 regression tests, focused TypeScript and the production build pass. Lint exits successfully with four warnings (an existing speech cleanup warning and warnings in generated test outputs). The real CPU model completed the opening memory prompt, then correctly recalled Cedar and teal after an intervening story request was stopped. The follow-up completed without a model-loading notice or engine error. Earlier real multi-turn checks also recalled project details; occasional formatting failures remain a limitation of the compact model.

Browser inference still requires initial model files and varies with device performance; it is not equivalent to hosted inference. Online mode remains the download-free default and device-only preferences persist. Successful WebGPU text/image inference, audible speech and completed native file transfers remain unverified in this cloud test browser. Video generation remains unconnected.


## Saved-model fallback — 12 September 2026

Automatic mode now tries hosted/private text service first, followed by saved WebGPU and CPU models. Both workers receive a cache-only flag. A fetch guard rejects missing external model resources rather than downloading them; CPU preparation additionally uses `local_files_only`. Application runtime code can load normally, including the pinned CPU WASM runtime. Model weights cannot download in automatic fallback. Explicit browser mode permits the initial download. A cache-only GPU miss does not prevent a later explicitly authorized GPU download.

The same completed conversation turns reach the fallback. Already-loaded models can be reused across processing-mode changes. Provider refusals and cancellation remain terminal; monetary limits are unchanged. Images retain the existing explicit local-download choice.

All 63 tests passed, including missing/inaccessible cache rejection without network access, cache hits, explicit download permission, and hosted-to-CPU fallback with retained history. The final focused recovery tests, TypeScript and production build passed; lint has no errors and retains existing warnings. The initial browser check showed the unavailable-cache message without silently starting a model download. A subsequent source check found that Transformers also requires local access enabled for cache-only reads; the correction is covered by a test exercising the installed library with saved bytes. A subsequent explicit local-model verification was blocked by Hugging Face HTTP 429 on the weights file. Successful cold cached-model inference and real mode-switch inference were therefore not established in this session; previous real CPU conversation and Stop/recall checks remain documented above.
