# Controlled routing evaluation

The synthetic-quality-v1 benchmark contains twelve fixed public tasks: eight development tasks and four held-out tasks. Deterministic graders compare structured answers and evaluate a restricted arithmetic grammar for small pure functions. Generated code is never executed. This measures narrow task correctness, not general intelligence or production answer quality.

The operator-only /api/archindus/evaluate endpoint is disabled unless a SHA-256 token hash and future expiration are configured. Supply a temporary 64-character hexadecimal token through the CLI's hidden standard input. Never commit the token. Remove both evaluation environment variables after the trial.

A run freezes champion and challenger choices and score evidence. Only configured zero-price Groq and OpenRouter candidates are eligible. Existing shared usage, rate, concurrency and budget controls apply. There is at most one run per UTC day, twelve tasks, and twenty-four generations. Identical choices share one generation and one observation. Requests are idempotent; an ambiguous interrupted pending generation is not automatically repeated.

Trial storage contains grades, output hashes and routing metadata, never user conversations or memories. The CLI report may include model outputs for these fixed synthetic prompts. Database trial records expire after thirty days on the next run. Trial observations do not update production serving metrics or user feedback.

Run npm run trial:routing -- https://archindus.stevenscadet.chatgpt.site after deployment, then npm run eval:routing. The serving champion remains operational-v1. The four distinct held-out cases cannot meet the promotion gate's minimum 200 independent outcomes. Repeated generations do not create new independent tasks. A blocked gate is expected; no automatic promotion or model-weight training occurs. A later representative evaluation and controlled real-traffic trial are needed before policy promotion.
