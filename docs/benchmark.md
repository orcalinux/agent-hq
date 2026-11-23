# Benchmark

`scripts/benchmark.mjs` is a small, reproducible check that a connected model can write working code. It is a smoke test for provider connections, **not a ranking of models**.

## Method

- Ten JavaScript tasks: six easy (slugify, merging ranges, Roman numerals, grouping anagrams, parsing durations, an LRU cache simulation) and four harder (an expression evaluator with precedence and malformed input, word wrapping with long-word splitting, a deterministic dependency order with cycle detection, minimum window substring).
- Each model gets the same prompt and must reply with one code block. Hidden tests run in a Node `vm` sandbox with a 2 second timeout; a task passes only if every test passes.
- Any OpenAI-compatible endpoint works. Run it yourself:

```bash
node scripts/benchmark.mjs --base http://127.0.0.1:3425/v1 --models claude/claude-haiku-5-5,codex/gpt-6-luna --runs 2
```

Raw per-attempt results are written to `docs/benchmark-results.json`.

## Results (2026-11-22, 2 runs per task, 10 tasks, through a local Magpie gateway)

| Model | Passed | Median latency | Completion tokens |
| --- | --- | --- | --- |
| claude/claude-haiku-5-5 | 20 / 20 | 4.0 s | 15,721 |
| claude/claude-sonnet-5-5 | 20 / 20 | 3.2 s | 7,803 |
| codex/gpt-6-luna | 20 / 20 | 4.6 s | 4,129 |
| codex/gpt-6.1-terra | 20 / 20 | 4.5 s | 4,415 |

## What this does and does not show

- Every model passed every task, even the harder four, so the suite still cannot separate them. Token counts differ a lot (Haiku used about 3.5 times more than the Codex models for the same passes), but the gateway may count reasoning differently per provider, so treat that as a cost hint, not a finding. Latency includes the gateway, so do not compare it across providers.
- It does show that both Claude and Codex models connect through the same path and produce working code.
- It does not cover multi-file edits, long tasks, other operating systems or Agent HQ's orchestration. A harder suite and a second operating system are still open (see [ROADMAP.md](../ROADMAP.md) item 6), and until they exist the README makes no "best" or "fastest" claims.
