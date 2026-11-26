# Measured learning loop — first release

## What is active

`operational-v1` is the existing production scoring policy, extracted unchanged
into a versioned pure function. It still combines validated-completion rate and
latency with the existing private account feedback, benchmark evidence and price
penalties. Capability eligibility, privacy, provider/model cooldowns, free-first
boundaries and spending controls remain outside this learned score.

`confidence-v2` runs in shadow mode on the same eligible candidates. It requires
20 operational attempts, uses a 95% Wilson lower confidence bound for validated
completion rate, and applies bounded latency and missing-usage penalties. Its
influence cannot move paid models ahead of eligible free models. It does not call
another model, duplicate prompts, train model weights or change the served route.
Cold starts receive neutral evidence. Metrics use a rolling seven-day window.

## Evidence and privacy

The existing operational table stores per-provider/model/task/day attempts,
validated completions, elapsed time, accounted microdollars and missing usage.
A validated completion is not an independently correct answer. Existing checks
cover completion structure, code fences/HTML completeness and JSON syntax, not
executed code or factual truth. OpenRouter free-pool statistics describe the pool,
not the model chosen behind it.

The new `routing_policy_shadow` table stores only day, task, champion/challenger
versions, ranking-comparison count and top-choice disagreement count. Counts are
updated atomically and retained for 30 days. There are no prompts, response text,
account IDs, memories or individual ratings in this table. Comparisons describe
recommendations before quota reservation and fallback, not counterfactual model
quality. A disagreement is not evidence that the challenger would have won.

Personal ratings and model preferences remain account-owned. They are used in
both ranking variants and are not pooled into a global feedback training set.
Run details expose active/shadow policy versions; saved receipts and exports
preserve them. Live-search routing remains a separate retrieval policy.

## Repeatable evaluation and promotion

Run `npm run eval:routing`. Eight fixed synthetic cases exercise free boundaries,
cold starts, sample size, reliability, latency, usage uncertainty, personal
influence and paid-only eligible sets. `outputs/routing-evaluation.json` records
versions, results, evidence type and promotion-block reasons. This check also
runs before every production build. It is deterministic and spends no API funds.

The current release has no independent quality dataset and no randomized canary.
Promotion is intentionally blocked. The gate requires zero invariant regressions,
at least 200 independently evaluated outcomes, an established non-negative
quality difference, cost ratio <=1.05 and latency ratio <=1.10. It also requires
positive quality improvement or a meaningful cost/latency improvement. These
thresholds are engineering defaults, not a statistical guarantee. The caller must
supply a defensible confidence bound, comparable task mix and credible provenance;
the utility does not infer causal improvement from observational router traffic.

There is no unattended weight optimizer, exploration traffic or automatic
production promotion. The build refuses activation of the challenger with the
current missing-evidence report. Promotion will require a reviewed evidence path
and version change; rollback preserves the known baseline. The next release
should add task-quality labels/holdout evaluations and a budgeted randomized
canary, with private-content handling established before collecting examples.
