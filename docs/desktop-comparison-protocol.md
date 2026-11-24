# Real desktop comparison protocol

The comparison must include Agent HQ. Testing the underlying model alone is
not a test of Agent HQ's planning, context selection, delegation, review or
file application.

## Task and independent grading

Use a fresh clone of the same starter commit for every app. The Tier 2
tabsplit backlog contains database upgrades with rollback, CSV error locations,
performance requirements, foreign-currency accounting and two arithmetic bugs.
Its independent grader checks 54 new acceptance cases and 87 regression cases.
The reference solution passes all 141; the unchanged starter passes 86.

Keep the hidden tests and reference implementation outside the task workspace.
Run the grader only after the app finishes. Do not repair its output by hand
before grading. Archive the app output before trying a follow-up or changing
Agent HQ. A model's QA approval and Agent HQ's completed status are observations,
not evidence that the implementation passes.

Report both the new acceptance cases and regression cases. Reporting only the
total can hide the fact that most tests already passed before the task began.
Compare the hashes of all original test files and inspect the changed files,
not just a success message.

## Pin the engine and describe the workflow

Use the same exact model identifier, reasoning effort and subscription-backed
engine for every app in a comparison group. Historical Claude Code results and
new Codex results are separate groups; do not attribute a model change to an app
improvement. Do not silently substitute a model, provider or routing group when
quota is exhausted. Record the reading, then wait or begin a separate group.
The Codex runner accepts `openai:cli:<exact-model>`; its control runner is
`scripts/compare-codex-cli.mjs`. Pin the same model in the competitor's own
session settings. Record requested and observed model identities separately;
when the CLI does not report the served model, audit its native session against
the local gateway records rather than assuming the configured name proves it.

For Agent HQ:

- Build the actual desktop application from the recorded app commit.
- Launch Electron with a fresh desktop profile, separate configuration, and the
  task clone as its workspace. The user's normal configuration is not changed.
- Pin all roles and all complexity levels to the benchmark model. Record every
  requested model and the model identity returned by the provider.
- Keep the adaptive team workflow, three parallel tasks, automatic application
  after QA, and normal learning enabled.
- Attach `SPEC.md` and `ISSUES.md`, then send the unchanged `TASK.md` text through
  the chat UI. Automatically click the ordinary plan approval button.
- Record attachments and configuration as operator assistance. The competitors'
  coding sessions can read files with their tools; Agent HQ uses supplied
  context and complete-file proposals. From 0.24.0 workers can also request
  project listings and line-numbered reads through the host. These are different
  workflows using the same engine, not equivalent tool environments.
- If the first run reveals a context problem, a separate fresh-clone run may
  attach the source files too. Label that run as assisted, retain both outcomes,
  and do not replace the first result with the better one.

No network responses or model answers are mocked. The comparison driver changes
only initial settings in an isolated profile. It does not inject a plan,
implementation, QA verdict or test results.

Keep the existing independent hidden suite unchanged between apps, outside every
working directory. Save the starter commit, task/spec hashes and hidden-suite
hashes. Run the apps sequentially for comparable timings; record any overlap
instead of presenting overlapping runs as a speed ranking. A failing case is
fixed in the application, not removed from the grader.

Use `--unlimited` for a group with no token, cost or per-agent call caps, matching
the native control runners' lack of those caps. It preserves the same explicit
wall-time deadline. Record this choice; do not silently compare it as an
application-default configuration or change caps during a running attempt.

## Timing, usage and memory

Start the Agent HQ timer immediately before Send. Stop when its run history
records a terminal result. Count planning, reviews and rework. Save post-run
learning separately from the time to the terminal result. Record a timeout as a
timeout rather than a completed run.

Distinguish provider-reported duration from wall time. The original CLI artifacts
contain both; use the wall time from the runner metadata for end-to-end numbers.
State explicitly when an app only has a provider event duration or a polled
completion time available.

Keep the provider usage events, including cache reads and cache writes.
Distinguish an API-rate valuation from additional subscription charges. An
unpriced call is unknown, not free. Agent HQ's run total excludes the planning
conversation and post-run learning, so it must not stand in for the total cost
of the workflow. Sum all recorded calls when quoting workflow usage.

On Linux, sample `/proc/<pid>/smaps_rollup` for the Electron process and all its
descendants, including children started by non-main threads. Save process IDs,
commands, individual PSS/RSS, and inaccessible process entries. Use PSS to avoid
double-counting shared memory. This is a sampled peak, not a guaranteed maximum.
The benchmark driver and Xvfb are outside the application process tree.

Measure empty-app idle memory separately from idle memory with retained agent
sessions. Do not compare a fresh Agent HQ profile against an Orchestrator
session still holding its Claude process as though both were empty apps.
Older samples selected by executable path are approximate historical evidence,
not an equivalent process-tree comparison.

## Running Agent HQ

Install the repository dependencies and build the application:

```sh
npm ci
npm run build
npm run build:electron
```

Create a clean clone of the benchmark starter outside this repository, with its
`TASK.md`, `SPEC.md` and `ISSUES.md`. Put the evidence directory outside that
clone. First check the UI setup without making a model request:

```sh
node scripts/compare-desktop.mjs \
  --workspace /absolute/path/to/fresh-task-clone \
  --output /absolute/path/to/new-preflight-evidence
```

Then use a new clean task clone and a new output directory for the real run:

```sh
node scripts/compare-desktop.mjs \
  --workspace /absolute/path/to/fresh-task-clone \
  --output /absolute/path/to/new-run-evidence \
  --model anthropic:cli:claude-haiku-5-5 \
  --run --wait-quota
```

The `claude` executable must be on `PATH` and already signed in. `--wait-quota`
reads the local `magpie quota --json` output and refuses to infer headroom from
missing readings. On a machine without a display, prefix the command with
`xvfb-run -a`. Xvfb supplies a virtual display; the app and provider are real.

For the Codex comparison group, use `--model openai:cli:gpt-6-sol` (or another
exact model offered by the installed CLI), with the signed-in `codex` executable
on `PATH`. Run the same clone independently with
`scripts/compare-codex-cli.mjs --workspace ... --output ... --model gpt-6-sol`.
The bare control uses medium reasoning effort; pin that effort in the apps too.
`scripts/compare-maestro.mjs` dispatches the unchanged task to an existing
Maestro research agent and saves its native tab transcript and process-tree
samples. It requires the CLI path, profile, agent, workspace, output, process ID
and pinned model as explicit arguments. Its terminal observation is “idle
reported”, which must still be checked against the native events and grader.

Use `--attach` with a comma-separated list for a separately labelled assisted
run. Use `--strategy fixed` to study the existing-team workflow separately.
The default timeout is 30 minutes.

The driver saves metadata, initial settings, plan and final state, screenshots,
raw chat requests and response events, and process-tree memory samples. These
files can contain local paths and project source. Review them before sharing;
do not commit desktop profiles, authentication data or large recordings.

An individual process tree can also be sampled without launching anything:

```sh
node scripts/process-memory.mjs 12345
```

## Interpretation

One successful run cannot establish that an app is better, and a small saturated
test suite cannot establish that orchestration is useless. Repeat measurements
and add larger, parallel, interrupted and conflicting-edit scenarios before
claiming a general ranking. Report cold-start/setup friction separately.

Turn a measured failure into a specific engineering task. Preserve the failing
baseline, implement the correction, and repeat against the same starter and
grader. Passing a real retry is stronger evidence than adding a feature that
only resembles a competitor's screen.
