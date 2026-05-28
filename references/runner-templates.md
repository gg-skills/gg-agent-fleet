---
title: Agent Fleet Runner Templates
---

# Agent Fleet Runner Templates

## Preferred Generators

Use a generator whenever the task inventory is structured enough to avoid manually
rebuilding runner scaffolding.

### ESLint JSON route

```bash
npx tsx skills/agent-fleet/scripts/generate-eslint-agent-fleet-pack.ts \
  --purpose <purpose-slug> \
  --input <package>=<eslint-json> \
  --parallel package
```

For one-file-per-task documentation packs, use bounded parallelism:

```bash
npx tsx skills/agent-fleet/scripts/generate-eslint-agent-fleet-pack.ts \
  --purpose jsdoc-required-symbol-docs \
  --input <package>=<eslint-json> \
  --include-warnings \
  --parallel bounded \
  --max-total-agents 10 \
  --max-package-agents 4 \
  --agent-launch-delay-seconds 10
```

### ESLint inventory route

```bash
npm run eslint:inventory
npx tsx skills/agent-fleet/scripts/generate-eslint-inventory-agent-fleet-pack.ts \
  --inventory-root .eslint-inventory/generated \
  --purpose eslint-inventory-cleanup \
  --severity all \
  --parallel package
```

### Generic manifest route for non-ESLint work

```bash
npx tsx skills/agent-fleet/scripts/generate-manifest-agent-fleet-pack.ts \
  --manifest .tmp/<purpose>-agent-fleet-pack-manifest.json
```

All generators write the session directory, prompts, task scripts, package
sequential runners, `run-all-sequentially.sh`, optional `run-packs-parallel.sh`,
logs directory, `backups/` for optional before-file copies, TSV summaries, and
`COMMANDS.md`. With `--parallel bounded`, they also write `tasks.tsv`,
`scripts/bounded-scheduler.py`, `run-parallel-bounded.sh`, and
`run-<package>-parallel-bounded.sh` runners. Use the manual templates below when
the work does not fit a structured route or needs custom splitting.

Generated worker verification should keep ESLint single-process and focused. Use
commands like `npx eslint --concurrency off --format stylish <target-file>` rather
than package lint scripts that expand to `--concurrency auto`; repeated concurrent
ESLint verification across agents can multiply TypeScript/parser/plugin memory.

## Session Directory

Use a fresh timestamped `.tmp/` folder for each generated pack:

```bash
SESSION_DIR=".tmp/$(date -u +%Y%m%dT%H%M%SZ)-agent-fleet-<purpose-slug>"
mkdir -p "$SESSION_DIR/prompts" "$SESSION_DIR/scripts" "$SESSION_DIR/logs" "$SESSION_DIR/backups"
```

The folder name starts with the timestamp, then `agent-fleet`, then a short
purpose slug. All parts are dash-separated.

## Single Task Script

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
agent -p --trust --force --model composer-2 --workspace "$PWD" \
  "$(cat .tmp/<timestamp>-agent-fleet-<purpose-slug>/prompts/<TASK_ID>.md)"
```

## Single Task Command With Log

```bash
.tmp/<timestamp>-agent-fleet-<purpose-slug>/scripts/run-<TASK_ID>.sh \
  2>&1 | tee .tmp/<timestamp>-agent-fleet-<purpose-slug>/logs/<TASK_ID>.out
```

## Sequential Runner

```bash
#!/usr/bin/env bash
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

BASE_DIR=".tmp/<timestamp>-agent-fleet-<purpose-slug>"
LOG_DIR="$BASE_DIR/logs"
SUMMARY_FILE="$LOG_DIR/run-all-sequentially-summary.tsv"
mkdir -p "$LOG_DIR"
: > "$SUMMARY_FILE"
printf 'task\texit_code\tlog_file\n' >> "$SUMMARY_FILE"

run_task() {
  local task_id="$1"
  local script_path="$BASE_DIR/scripts/run-${task_id}.sh"
  local log_file="$LOG_DIR/${task_id}.out"

  set +e
  "$script_path" 2>&1 | tee "$log_file"
  local status=${PIPESTATUS[0]}
  set -e

  printf '%s\t%s\t%s\n' "$task_id" "$status" "$log_file" >> "$SUMMARY_FILE"
  return 0
}

TASKS=(
  "TASK-001-example"
  "TASK-002-example"
)

for task_id in "${TASKS[@]}"; do
  run_task "$task_id"
done

cat "$SUMMARY_FILE"
```

## Parallel Batch Template

Prefer package-level parallelism for overnight lint packs: run one sequential lane
per package in parallel so agents do not collide inside the same package.

```bash
#!/usr/bin/env bash
set -uo pipefail
pids=()
overall=0

.tmp/<timestamp>-agent-fleet-<purpose-slug>/run-core-package-sequentially.sh \
  > >(tee .tmp/<timestamp>-agent-fleet-<purpose-slug>/logs/core-package-runner.out) 2>&1 &
pids+=("$!:core-package")

.tmp/<timestamp>-agent-fleet-<purpose-slug>/run-ui-package-sequentially.sh \
  > >(tee .tmp/<timestamp>-agent-fleet-<purpose-slug>/logs/ui-package-runner.out) 2>&1 &
pids+=("$!:ui-package")

for item in "${pids[@]}"; do
  pid="${item%%:*}"
  name="${item#*:}"
  if ! wait "$pid"; then
    echo "runner failed: $name"
    overall=1
  fi
done

exit "$overall"
```

Use all-task parallelism only for carefully proven non-overlapping file scopes.

## Bounded Parallel Runner

Use generated bounded parallelism for documentation-only or similarly low-collision
packs where each task edits exactly one distinct target file. The generated pack
validates duplicate target files before writing bounded runners.

```bash
.tmp/<timestamp>-agent-fleet-<purpose-slug>/run-parallel-bounded.sh
```

Defaults:

- max 10 active agents globally,
- max 4 active agents per package,
- 10 seconds between launching agents by default,
- real `HOME` auth with a short serialized Cursor CLI startup lock to avoid `~/.cursor/cli-config.json` races,
- one log per task,
- colorized, clear `TASK LAUNCHED`, `PROMPT BEGIN/END`, and `TASK COMPLETED` banners for every task, including the exact `agent -p ...` command with prompt path and log pipe,
- colorized scheduler progress footers after task launch, prompt send, task completion, and final summary, including active lane/task labels,
- `logs/high-concurrency-summary.tsv` for the full run,
- `logs/<package>-parallel-bounded-summary.tsv` for package-limited runs,
- executable `run-status.sh` and `scripts/pack-status.py` helpers for done/failed/pending status checks.

Per-package bounded runners are also generated:

```bash
.tmp/<timestamp>-agent-fleet-<purpose-slug>/run-core-package-parallel-bounded.sh
```

## Command Defaults

Default model: `composer-2`.

Default flags for write-capable headless tasks:

```bash
-p --trust --force --model composer-2 --workspace "$PWD"
```

Use `--mode plan` only when generating analysis prompts that should not edit.

Color output is enabled by default even through `tee`; set `NO_COLOR=1` to disable ANSI colors. Generated bounded runners use `caffeinate -ims` on macOS when available, which prevents system sleep without preventing display sleep.

Bounded packs must include `run-status.sh`, which reports done/failed/pending counts by package, examples, and active scheduler/agent processes.

## Post-run Sanity Review

After any generated pack is run, do not treat zero exit codes as final proof that
the changes are safe. Inspect the working-tree diff before summarizing success:

```bash
git status --short
git diff -- <target-file-1> <target-file-2>
<session-dir>/run-status.sh --examples 3
```

Confirm each changed file stayed inside the task scope, flag unexpected adjacent
edits, and separate fleet-caused changes from pre-existing workspace drift. When
large-refactor workers created backup files under `<session-dir>/backups/`, use
those untracked before-file artifacts for behavior comparison and do not stage or
commit them.
