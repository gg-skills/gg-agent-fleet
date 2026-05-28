---
title: Agent Fleet Quick Commands
---

# Agent Fleet Quick Commands

Common commands for building, inspecting, and running Agent Fleet packs. Load
this file when you need the exact invocation syntax for one of the generators or
a runner.

## Session directory and CLI surface check

```bash
# Build a timestamped output directory name for a task pack
SESSION_DIR=".tmp/$(date -u +%Y%m%dT%H%M%SZ)-agent-fleet-<purpose-slug>"
mkdir -p "$SESSION_DIR/prompts" "$SESSION_DIR/scripts" "$SESSION_DIR/logs"

# Verify the current configured agent CLI surface before generating commands
which agent
agent --help
agent models | grep -E '^composer-2($|[[:space:]])'
```

## Canonical headless edit invocation

```bash
agent -p --trust --force --model composer-2 --workspace "$PWD" \
  "$(cat .tmp/<timestamp>-agent-fleet-<purpose-slug>/prompts/<TASK_ID>.md)" \
  2>&1 | tee .tmp/<timestamp>-agent-fleet-<purpose-slug>/logs/<TASK_ID>.out
```

## Route A — ESLint JSON, package-parallel

```bash
npx tsx skills/agent-fleet/scripts/generate-eslint-agent-fleet-pack.ts \
  --purpose overnight-lint-react-ts-cleanup \
  --input core-package=.tmp/gate-reports/lint-json/core-package-current.json \
  --input ui-package=.tmp/gate-reports/lint-json/ui-package-current.json \
  --exclude-rule @typescript-eslint/no-empty-object-type \
  --excluded-rule-note '@typescript-eslint/no-empty-object-type remains intentionally off for explicit placeholder/extension-point types.'
```

## Route B — Generated ESLint inventory markdown

```bash
npm run eslint:inventory
npx tsx skills/agent-fleet/scripts/generate-eslint-inventory-agent-fleet-pack.ts \
  --inventory-root .eslint-inventory/generated \
  --purpose eslint-inventory-cleanup \
  --severity all
```

## High-concurrency documentation-only variant

One file per task, bounded at 10 total / 4 per package / 10s launch gap.

```bash
npx tsx skills/agent-fleet/scripts/generate-eslint-agent-fleet-pack.ts \
  --purpose jsdoc-required-symbol-docs \
  --input root=.tmp/gate-reports/lint-json/root-jsdoc.json \
  --package-path root=. \
  --include-warnings \
  --parallel bounded \
  --max-total-agents 10 \
  --max-package-agents 4 \
  --agent-launch-delay-seconds 10 \
  --worker-verification lint-only
```

## Route C — Generic manifest for non-ESLint packs

```bash
npx tsx skills/agent-fleet/scripts/generate-manifest-agent-fleet-pack.ts \
  --manifest .tmp/agent-fleet-pack-manifest.json
```

## Review generated run pack

```bash
find .tmp/<timestamp>-agent-fleet-<purpose-slug> -maxdepth 2 -type f | sort
cat .tmp/<timestamp>-agent-fleet-<purpose-slug>/COMMANDS.md
```

## Final verification commands

```bash
git status -sb
npm run type-check
npx eslint --concurrency off --format stylish <package-or-target>
```

For root-owned platform packs that should avoid research/sandbox trees:

```bash
npx eslint --config eslint.config.ts --report-unused-disable-directives \
  --concurrency off --format stylish \
  scripts .pi/extensions skills eslint.config.ts jest.config.ts \
  .mcp.json .cursor/mcp.json .windsurf/mcp.json .vscode/mcp.json opencode.json
```
