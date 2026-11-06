# Archindus model connections

Archindus owns the identity, persona instructions, conversation continuity, routing and data controls. A provider supplies inference. Personalities do not become a different product when the engine changes.

## Implementation and actual availability

| Connection | Implemented behavior | Required to use |
|---|---|---|
| OpenAI | Existing hosted chat, code and image path | Already configured and live verified |
| DeepSeek | OpenAI-compatible text, MoE presets, cost-aware routing | Your DeepSeek API key |
| Claude / Anthropic | Native Messages API and streaming translation; thinking excluded from public stream | Your Anthropic API key |
| Grok / xAI | OpenAI-compatible text | Your xAI API key |
| OpenRouter | Free-tier chat preset, zero price ceiling, data-collection deny preference | Your OpenRouter API key; free capacity is not guaranteed |
| Ollama | Installed-model discovery, small/large open-weight presets; no implicit pulls | Running authenticated HTTPS gateway and installed models |
| vLLM / llama.cpp / LM Studio | OpenAI-compatible discovery and chat | Gateway, installed model IDs, running server |
| Hugging Face / Groq / Together AI | OpenAI-compatible text adapter | Key plus administrator-approved model/pricing map |
| ComfyUI | Owned queued image/video jobs, polling, PNG/MP4 downloads | Running authenticated GPU worker and trusted exported workflow |

Only OpenAI is currently live-verified on this deployment. Other providers have protocol/regression tests using controlled upstream responses. Saving a credential marks a connection configured; it does not assert that its balance, entitlement, model or worker has been verified. Local GPU execution has not been tested on your physical workstation.

## Connect without accessing deployment secrets

Sign in to the deployed standalone Archindus site. Open **Settings → Runtime & voice → Model connections**, select a provider, enter its key directly into the password field, and save. Keys are encrypted with AES-GCM under a server-only master key, bound to account/provider/data version, and never returned by the API or included in account exports. Disconnect deletes the saved connection. Delete account data removes saved credentials and job records too. Do not place keys in chat, browser source, GitHub or a ZIP.

The server's `ARCHINDUS_CREDENTIALS_KEY` is already configured. Keep it stable; rotating or losing it requires reconnecting saved providers. Provider keys can alternatively be supplied by the operator as server environment variables. A personal connection overrides the same provider's operator setting for that user. Operator-provided connections remain available after a personal connection is removed.

## Routing and economics

Automatic mode ranks eligible profiles by estimated input/output price and required capability. Routine chat can use a small model or configured free capacity; code and analysis require stronger profiles. Quality mode requires a high-capability profile. These are explicit curated capability profiles, not benchmark guarantees. Equal-cost local models prefer the smallest eligible profile. A failed provider can fall back before public streaming starts; a refusal is terminal and does not trigger another provider. Provider cooldowns are isolated. History and persona context accompany text requests. Private reasoning is not displayed.

Shared hosted limits remain **$1/day and $10/month** with conservative reservations and usage settlement. They cover this router's estimated API charges, not an independent guarantee about a vendor invoice or external usage. Unknown-price paid models are not automatically enabled. Self-hosted inference has zero per-token API charge in the ledger, but hardware, electricity and cloud hosting still cost money. Local calls retain request/concurrency limits. Media is limited to five images or two videos per client per day, with short-term limits as well.

The browser's **This device only** mode excludes all these server-side connections, including a workstation reached through the server. Automatic mode can send conversation/persona/account context to the selected provider; review that provider's data terms. Media does not include saved memory; explicit creative personality instructions may be sent. Generated outputs remain on the GPU worker under its retention policy; download links expire after 24 hours. Canceled running jobs may finish on the worker.

## Extending the model list

`ARCHINDUS_PROVIDER_MODELS` is an operator-owned JSON object keyed by provider ID. Each record supplies a model ID, name, input/output USD per million token ceilings, level (1–4), capabilities, and optional architecture/license metadata. Example shape:

```json
{"groq":[{"id":"REPLACE_WITH_VERIFIED_MODEL_ID","name":"Verified model","input":1,"output":5,"level":3,"capabilities":["chat","code","analysis"],"openWeights":true,"license":"Check model card"}]}
```

The sample prices are illustrative ceilings, not vendor pricing. Verify the actual current model ID and rates first. Hosted records with both prices zero are rejected except explicit OpenRouter free models. Official provider defaults were checked on 2026-11-06; prices and aliases can change. Installed local tags are intersected with discovery results. The source includes Qwen, Gemma, GPT-OSS, DeepSeek distills, Llama, Mistral and older coder presets; licensing varies. Claude and Grok APIs are proprietary. Open weights do not automatically mean unrestricted open-source licensing.

## Images, video and the workstation

See [runtime setup](../runtime/README.md). The supplied gateway exposes only bounded model discovery/chat and ComfyUI prompt/history/output/owned-queue deletion routes. It does not expose global interrupt, uploads, model pulls or arbitrary proxy access. ComfyUI API graphs are operator-trusted configuration, never accepted as a chat request parameter. The first configured workflow for a media kind is used; there is no media quality/cost optimizer yet. Models must already work in ComfyUI and produce PNG/MP4 within the output size limit.

Higgsfield is connected inside ChatGPT and exposes Kling video generation here. That connection's session is not an API credential that can be copied into Archindus. No website-to-Higgsfield bridge is declared or deployed; native Sites integration eligibility could not be established with the currently available tools. This does not prevent the independent ComfyUI path or direct provider APIs.

## Primary references

- [Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)
- [DeepSeek API](https://api-docs.deepseek.com/)
- [Anthropic Messages](https://docs.anthropic.com/en/api/messages)
- [xAI API](https://docs.x.ai/)
- [OpenRouter provider preferences](https://openrouter.ai/docs/features/provider-routing)
- [Hugging Face inference providers](https://huggingface.co/docs/inference-providers/)
- [ComfyUI server routes](https://docs.comfy.org/development/comfyui-server/comms_routes)
