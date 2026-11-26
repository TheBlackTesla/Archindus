# Initial live trial — November 16, 2026

Run c8a5bdb6-4f3b-4c7f-af21-bd1a1f27b631 used twelve fixed synthetic tasks and twelve shared free-model generations. Both policies selected Groq GPT-OSS 20B for chat/analysis and OpenRouter Cohere North Mini Code Free for code. No paid fallback was enabled.

Eleven generations completed; ten satisfied the strict deterministic grader. All four distinct held-out tasks passed. One coding generation was incomplete or refused. Both policies made identical choices, so this run provides no evidence of a challenger advantage. Shared observations are not independent comparative samples. Recorded generation charges were zero under the configured free plans; provider limits still apply.

## Benchmark limitation discovered

The development extraction prompt says Warehouse B but does not explicitly require only the letter B. The model returned warehouse: "Warehouse B" while the exact fixture expected "B". This is a strict fixture mismatch, not established semantic incorrectness. Preserve the original observation rather than retroactively changing its grade. A future suite version should make identifier normalization explicit before collecting new results. The affected development case must not support a model-quality claim or promotion decision.

## Decision

Keep operational-v1 serving users. The promotion gate remains blocked: only four distinct held-out cases, no comparative quality gain, and a benchmark ambiguity to resolve. This is a narrow diagnostic baseline, not reinforcement training or proof of production improvement. Do not infer a general model ranking from these twelve tasks. Trial observations do not alter production scores. Temporary operator evaluation access was removed after collection.
