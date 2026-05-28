# agent-fleet
Generator skill that turns the current conversation, a gate report, ESLint output, or a manual scope inventory into **ready-to-run Agent Fleet task packs** — scoped prompt files, executable Bash wrappers, timestamped log paths, and sequential or bounded-parallel runners. The output is not a prose plan; it is a durable handoff package that another operator can run directly against a headless agent runtime (currently Cursor's `agent -p` CLI, but the output folder and contracts use runner-agnostic vocabulary).

The full operating loop, 25 binding policy rules, prompt schema, and runner templates live in [`SKILL.md`](./SKILL.md) and the `references/` directory. The interface descriptor is in [`agents/openai.yaml`](./agents/openai.yaml).

## Install

The fastest cross-agent install path is the `skills` CLI:

```bash
npx skills add gg-skills/agent-fleet
```

Drop this skill into a workspace as a Git submodule for pinned versions, or as a plain clone for latest `main`:

```bash
# Project-local, version-pinned:
git submodule add git@github.com:gg-skills/agent-fleet.git .claude/skills/agent-fleet

# OR project-local, latest main:
mkdir -p .claude/skills
git -C .claude/skills clone git@github.com:gg-skills/agent-fleet.git

# OR user-level, available in every project on this machine:
mkdir -p ~/.claude/skills
git -C ~/.claude/skills clone git@github.com:gg-skills/agent-fleet.git
```

Restart your agent or reload skills after installation. See the parent [`skills` catalog repo](https://github.com/gg-skills/skills) for the full catalog.

## When to use

- The user asks to create Agent Fleet prompts, handoff tasks, or runnable
  agent task files.
- The user wants to split current lint, typecheck, test, migration, docs,
  audit, or cleanup work into bounded Agent Fleet jobs.
- The user wants Bash commands or scripts that run Agent Fleet tasks and save
  output logs under a timestamped `.tmp/` session folder.
- The user wants sequential or parallel Agent Fleet execution without using a
  formal orchestrator (e.g. Taskplane).
- The user asks for an agnostic template for generating Agent Fleet task
  packs from conversation context.

Skip when the user wants to run the agent CLI directly, wants full Taskplane
dependency waves with reviews and merge automation, or only needs generic
prose handoff prompts.

## How it operates

### Inputs

| Source | What is read |
|--------|-------------|
| Current conversation / gate logs | Task descriptions, file lists, failure summaries pulled from `.tmp/` or inline |
| ESLint JSON report (Route A) | `--input <pkg>=<path>.json` passed to `generate-eslint-agent-fleet-pack.ts` |
| ESLint inventory markdown (Route B) | `.eslint-inventory/generated/*.md` consumed by `generate-eslint-inventory-agent-fleet-pack.ts` |
| Generic JSON manifest (Route C) | `manifest.json` with task IDs, scopes, and verification commands, passed to `generate-manifest-agent-fleet-pack.ts` |
| `git status` / `git diff --name-only` | Used to infer changed-file scope when no structured input is provided |
| `references/*.md` | The skill loads these on-demand: `workflow-deep-dive.md`, `non-negotiable-policy.md`, `prompt-schema.md`, `runner-templates.md`, `task-splitting.md`, `quick-commands.md` |

No environment variables are required for pack generation. The generators use `npx tsx` and are dependency-free TypeScript; no install step beyond a Node.js toolchain is needed. The only external env concern at run time is `NO_COLOR=1` (disables ANSI in generated runners) and the Cursor CLI's own auth (verified with `agent --help` / `agent models`).

### Outputs

All output lands under a fresh timestamped session directory so runs never overwrite each other:

```
.tmp/<YYYYMMDDTHHMMSSZ>-agent-fleet-<purpose-slug>/
├── prompts/
│   └── <TASK_ID>.md          ← standalone agent prompt per task
├── scripts/
│   ├── run-<TASK_ID>.sh      ← per-task Bash runner (executable)
│   ├── run-sequential.sh     ← runs all tasks one at a time
│   ├── run-parallel.sh       ← package-grouped parallel runner (when generated)
│   ├── run-bounded.sh        ← rate-limited bounded-parallel runner (when --parallel bounded)
│   ├── pack-status.py        ← prints done/failed/pending counts
│   └── run-status.sh         ← wrapper that calls pack-status.py with examples
├── backups/
│   └── <TASK_ID>/            ← before-file copies for large refactors
├── logs/
│   ├── <TASK_ID>.out         ← captured stdout + stderr via tee
│   └── status/
│       └── <TASK_ID>.status.tsv
├── tasks.tsv                 ← machine-readable task manifest
└── COMMANDS.md               ← operator cheat-sheet for running and reviewing the pack
```

Every per-task prompt is self-contained: it embeds exact file scope, standards references, verification commands, and the "Do not commit. Do not push." policy. An operator can hand the folder to anyone — or another agent — and the pack runs without this conversation's context.

### External commands

| Command | When spawned |
|---------|-------------|
| `npx tsx scripts/generate-eslint-agent-fleet-pack.ts` | Route A: converts ESLint JSON to a pack |
| `npx tsx scripts/generate-eslint-inventory-agent-fleet-pack.ts` | Route B: converts inventory markdown to a pack |
| `npx tsx scripts/generate-manifest-agent-fleet-pack.ts` | Route C: converts a JSON manifest to a pack |
| `agent --help` / `agent models` | CLI flag and model-ID preflight before generating commands |
| `npm run eslint:inventory` | Route B preparation — generates `.eslint-inventory/generated/` |
| `npx eslint --concurrency off --format stylish <file>` | Per-task verification embedded inside each prompt |
| `npm run type-check` | Final-gate verification step (repo-wide) |
| `git status -sb` / `git diff --name-only` | Inventory gathering and post-run diff review |
| `vm_stat` / `ps` (top RSS) | Memory preflight before launching a pack |
| `caffeinate -ims` | Wraps bounded runners on macOS to prevent sleep |

The skill does **not** call `agent -p` itself during generation. Running the pack is an explicit operator opt-in step.

### Side effects

- **Writes to `.tmp/`** — the only filesystem mutation during generation. No source files are touched.
- **No commits, no pushes** — generated tasks include an explicit "Do not commit. Do not push." instruction; the skill itself never stages or commits.
- **No network calls** during pack generation. Network activity happens only when the operator later runs `agent -p` worker tasks, which may call the Cursor/AI model API.
- **Backups created at run time** — `backups/<TASK_ID>/` files are written by worker agents when they execute large-refactor tasks; they are never auto-cleaned.
- **Session folders accumulate** — `.tmp/<timestamp>-agent-fleet-*/` is never auto-deleted; sweep periodically.

### Mode toggles and safety defaults

| Setting | Default | Override |
|---------|---------|---------|
| Run mode | Generate only (inert pack) | User must explicitly ask to launch |
| Commit / push | Forbidden in every generated prompt | User must explicitly request and re-state in conversation |
| ESLint concurrency | `--concurrency off` always | Not overridable in worker prompts |
| Bounded parallelism | Off | Enable with `--parallel bounded --max-total-agents 10 --max-package-agents 4 --agent-launch-delay-seconds 10`; restricted to low-collision (typically docs-only) work |
| ANSI color | On | `NO_COLOR=1` before invoking a runner |
| macOS sleep prevention | On (caffeinate) | Remove `caffeinate -ims` prefix from runner if unwanted |

## Operational flow

```mermaid
flowchart TD
    A([User request / gate report / ESLint output]) --> B{Classify route}
    B -->|ESLint JSON available| C[Route A\ngenerate-eslint-agent-fleet-pack.ts]
    B -->|ESLint inventory markdown| D[Route B\ngenerate-eslint-inventory-agent-fleet-pack.ts]
    B -->|Non-ESLint structured work| E[Route C\ngenerate-manifest-agent-fleet-pack.ts]
    B -->|Unstructured context only| F[Infer inventory\nfrom conversation / git / logs]
    F --> E

    C --> G[Preflight: agent --help\nagent models]
    D --> G
    E --> G

    G --> H[Create session directory\n.tmp/YYYYMMDDTHHMMSSZ-agent-fleet-slug/]
    H --> I[Write per-task prompts\nprompts/TASK_ID.md\nembeds scope + policy + verification]
    I --> J[Write per-task runners\nscripts/run-TASK_ID.sh\nwith 2>&1 | tee log]
    J --> K{Batch runner needed?}
    K -->|Sequential| L[run-sequential.sh]
    K -->|Package-parallel| M[run-parallel.sh]
    K -->|Bounded docs-only| N[run-bounded.sh\n+ run-status.sh + pack-status.py]
    K -->|No batch| O[Single-task pack]

    L --> P[Write COMMANDS.md\ntasks.tsv]
    M --> P
    N --> P
    O --> P

    P --> Q([Inert pack delivered\noperator reviews])
    Q -->|Explicit run request| R[Preflight memory\nvm_stat + ps RSS]
    R --> S[Execute: agent -p\nper-task or via batch runner]
    S --> T[Monitor: run-status.sh\nwatch logs/]
    T --> U[Post-run diff review\ngit diff per changed file]
    U --> V[Final gate\nnpm run type-check\nnpx eslint --concurrency off]
    V --> W([Done — human reviews\nno commit without explicit approval])
```

## Layout

```
.
├── SKILL.md                                          ← entry point with 10-step workflow checklist
├── agents/
│   └── openai.yaml                                   ← IDE / agent descriptor
├── references/                                       ← load-on-demand long-form guidance
│   ├── quick-commands.md                             ← copy/paste catalog of session-dir, generator, runner, gate commands
│   ├── non-negotiable-policy.md                      ← full text of the 25 binding policy rules
│   ├── workflow-deep-dive.md                         ← full 10-step workflow (route classification → final verification)
│   ├── prompt-schema.md                              ← required sections and wording for every Agent Fleet task prompt
│   ├── runner-templates.md                           ← executable script, sequential runner, parallel batch templates
│   └── task-splitting.md                             ← how to convert raw context or gate output into bounded tasks
├── scripts/                                          ← dependency-free TypeScript generators
│   ├── generate-eslint-agent-fleet-pack.ts           ← Route A — convert ESLint JSON reports into a pack
│   ├── generate-eslint-inventory-agent-fleet-pack.ts ← Route B — convert `.eslint-inventory/generated` markdown into a pack
│   ├── generate-manifest-agent-fleet-pack.ts         ← Route C — convert a generic task manifest into a pack (non-ESLint work)
│   ├── agent-fleet-pack-lib.ts                       ← shared rendering library used by all three generators
│   └── agent-fleet-pack-bounded-templates.ts         ← bounded-parallel runner + `run-status.sh` templates
└── assets/                                           ← skill icons (large/small/master + prompt sources)
```

## Quick start

Read [`SKILL.md`](./SKILL.md) first — it carries the 10-step workflow
checklist, the 25-rule non-negotiable policy summary, and the prompt-generation
checklist that runs before every handoff.

When the input is structured (ESLint JSON, ESLint inventory markdown, or a
JSON task manifest), prefer the matching generator in [`scripts/`](./scripts/)
over hand-writing a pack:

```bash
# Route A — ESLint JSON
npx tsx scripts/generate-eslint-agent-fleet-pack.ts <eslint-report.json>

# Route B — ESLint inventory markdown
npx tsx scripts/generate-eslint-inventory-agent-fleet-pack.ts <inventory-page.md>

# Route C — generic manifest (non-ESLint work)
npx tsx scripts/generate-manifest-agent-fleet-pack.ts <manifest.json>
```

All three generators produce the same scaffolding under
`.tmp/<UTC-timestamp>-agent-fleet-<purpose-slug>/`: `prompts/`, `backups/`,
per-task `scripts/run-<TASK_ID>.sh`, sequential and bounded-parallel runners,
`tasks.tsv`, `scripts/pack-status.py`, `run-status.sh`, `logs/`, TSV
summaries, and a `COMMANDS.md` for the operator.

When no generator fits, fall back to the hand-written runner template in
[`references/runner-templates.md`](./references/runner-templates.md).

## Resources

- [SKILL.md](SKILL.md) — entry point with full 10-step workflow and policy checklist
- [agents/openai.yaml](agents/openai.yaml) — agent / IDE descriptor
- [references/](references/) — quick commands, policy, workflow deep dive, prompt schema, runner templates, task splitting
- [scripts/](scripts/) — Route A / B / C pack generators and the shared rendering library
- [assets/](assets/) — skill icons and icon-prompt sources

## Caveats

- **Generate by default; run only on explicit request.** Generated packs are
  inert until an operator (or the user) explicitly asks to launch them.
- **Default no commit / no push.** Every generated worker prompt must include
  an explicit "Do not commit. Do not push." line.
- **`--concurrency off` for every generated ESLint verification.** Do not
  pipe `npm run lint` (which forces `--concurrency auto`) into worker prompts;
  the deterministic per-file run is the contract.
- **Verify CLI flags live.** Run `agent --help` and `agent models` before
  emitting a pack — model IDs and flags drift between Cursor CLI releases.
- **Bounded mode is for low-collision work only** (typically docs-only). Do
  not use it for cross-file refactors, package-config edits, lockfile edits,
  route rewrites, or migrations. Standard caps: 10 total / 4 per package /
  10s launch gap.
- **A concurrency-1 retry that hits the same memory threshold is evidence of
  stale-process pressure, not safety** — pause and preflight (`vm_stat`, top
  RSS `ps`) before retrying.
- **Session folders accumulate.** `.tmp/<timestamp>-agent-fleet-*/` is never
  auto-cleaned; sweep periodically.
