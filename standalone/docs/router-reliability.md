# Router reliability update

The multi-provider router isolates model failures from provider-account failures.
401 and 402 pause the provider account for five minutes. Model permission, missing
model, invalid request, server failure, and invalid output pause only the model.
429 obeys Retry-After seconds or dates, capped at one hour, and pauses that model.
Each reservation still checks the provider account state atomically. Refusals do
not trigger fallback and are excluded from operational reliability scores.

Operational evidence is aggregated per provider, configured model, task and day.
It contains attempts, validated completions, elapsed time, confirmed microdollars,
and unknown-usage count. It contains no prompts, responses or user identifiers.
Retention is 30 days; ranking uses seven days with a five-attempt minimum and a
bounded reliability/latency influence. Cold-start models have neutral evidence.
Existing task eligibility, free-first boundaries, personal preferences, benchmark
signals, conservative price ceilings and spending controls remain authoritative.
OpenRouter free-pool evidence describes the pool, not each randomly chosen model.

Run details include actual upstream model identifiers when returned, all model
calls made by this router, outcomes, elapsed time and confirmed costs. Missing
usage is displayed as unconfirmed and retains the quota reservation. The brain
inspector displays recorded attempts, including failed models. Receipt data is
saved with account conversation history and included in account export/deletion.
It does not claim that a user-provided saved receipt is a verified billing record.

Validation checks final text, code fences, complete HTML documents, capability
denials and explicitly JSON-tagged code-block syntax. These checks do not execute
code, establish factual correctness or verify citations. Interrupted streams
remain errors and require retry; this update does not automatically replace an
answer after visible streaming has begun.

Regression command: npm test. Focused production-handler tests use SQLite, mocked
provider transports, production quota SQL, SSE parsing and real migrations.
Durable autonomous Missions, sandbox code execution and citation verification
are not implemented by this update. Existing generated media access/credit
restrictions are unchanged.

## Longer conversations and free quota fallback

Saved history now accepts 500 messages and 1,500,000 UTF-8 request bytes per
conversation. Autosave preserves all messages instead of dropping middle turns.
Oversize writes are rejected without replacing the existing saved conversation.
The interface stops new turns at the message boundary and offers New chat. Model
context remains bounded separately, retaining the opening brief and recent turns.

A model-specific 429 pauses that model and tries the next eligible candidate.
OpenRouter platform free-quota responses with exhausted X-RateLimit headers pause
all its free models until the reported reset (up to one day); other providers and
paid models are governed by their own eligibility and existing spending limits.
Skipped candidates do not consume the six-call recovery allowance. This does not
increase any upstream quota or make unconfigured providers available.

## Groq Free Plan

The default Groq chat catalog contains GPT-OSS 20B, GPT-OSS 120B and Qwen 3.8
27B (preview). Each request intersects this allowlist with the key-authenticated
Groq model list, cached for five minutes per key with at most eight cache entries.
No unknown, speech-only, guardrail-only or enterprise-only model is auto-enabled.

ARCHINDUS_GROQ_FREE_TIER=true is an operator declaration that the hosted key is
on Groq's Free Plan, not automatic billing-plan detection. It sets the known
models' token charges to zero for free-first ordering and quota accounting.
Reset it to false before upgrading the account to a paid plan. Without the flag,
the published paid price ceilings apply. Per-account keys do not inherit the
operator's declaration. Existing global request, concurrency and safety controls
still apply; Groq quotas are not enlarged or bypassed.

GPT-OSS uses include_reasoning=false and low/high effort; Qwen uses hidden
reasoning and instruct mode for standard tasks. Output caps are bounded for free
quota efficiency. Groq's request/token reset duration headers extend a specific
model's 429 cooldown. Another eligible free candidate is tried before paid ones.

The public inventory records whether Groq lists the model; that is credential
and catalog verification, not proof of successful generation for each model.

## Live web verification

Freshness routing recognizes explicit /search requests, news, current office
holders, weather, prices, schedules, model/software recommendations and related
followups. It bypasses device models and calls Gemini 3.8 Flash with Google
Search using the existing Gemini credential. Saved memories and profile data
are not sent to search. At most one prior user question is supplied to resolve
short dependent followups. Retrieved pages remain untrusted reference material.

The response must contain executed search queries, valid HTTPS grounding sources,
supported text segments and a completed final answer. Supported segments receive
inline source links and a retrieved-at timestamp. Google Search suggestions are
shown in a script-disabled, opaque-origin sandbox iframe with restrictive CSP.
Sources, timestamps and suggestions survive saved text history and export.

Search calls reserve a conservative $0.25 against existing shared controls.
Reported token usage and returned search queries settle a conservative cost
estimate including tool charges; free allowances are not assumed. Missing or
ambiguous usage retains the reservation. The model is instructed to use at most
two focused queries, but that instruction is not a provider-enforced hard query
cap. Provider-side spending limits remain the strongest independent safeguard.
No search connection, quota denial, unsupported output or provider outage yields
a verification-unavailable reply, never silent offline model fallback. Device-only
mode makes no live request. The existing fixed official USAGov lookup remains
preferred for narrowly recognized current U.S. president questions.

This is source-grounded generation, not a guarantee of complete web coverage,
perfect citations or tick-by-tick financial data. Detection is heuristic; /search
provides an explicit route when a question is missed. Conflicting/dated sources
must be reported by the answering model. No background crawl or shared prompt
cache is created by this implementation.

### Independent live-search fallback

Gemini quota/connection failures can fall back to GPT-6 Luna with OpenAI's hosted
web_search tool using the already configured OpenAI key. This branch requires a
completed web_search_call and valid URL citation annotations. It requires search,
allows at most one built-in tool call, sets a bounded output allowance, and uses
store:false. A separate $0.05 reservation covers inference and the search tool;
reported tokens and completed tool calls settle its conservative estimate. Failed
provider safety checks do not fall through. Duplicate fallback request IDs cannot
create another charge. Gemini quota failures use a five-minute search-specific
cooldown instead of repeatedly exhausting the same connection. Receipts show both
attempts and the engine actually used. Stable prompts retain normal free-first
model routing. No new credential is required for this fallback.
