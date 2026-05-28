---
title: Agent Fleet Task Splitting Rules
---

# Agent Fleet Task Splitting Rules

## Inputs

Choose the generation route by input type:

1. **ESLint JSON route** — when diagnostics are available as ESLint JSON, use:

   ```bash
   npx tsx skills/agent-fleet/scripts/generate-eslint-agent-fleet-pack.ts \
     --purpose <purpose-slug> \
     --input <package>=<eslint-json> \
     --parallel package
   ```

2. **ESLint inventory route** — when curated `.eslint-inventory/generated`
   markdown exists or should be refreshed, use:

   ```bash
   npm run eslint:inventory
   npx tsx skills/agent-fleet/scripts/generate-eslint-inventory-agent-fleet-pack.ts \
     --inventory-root .eslint-inventory/generated \
     --purpose eslint-inventory-cleanup \
     --severity all \
     --parallel package
   ```

3. **Generic manifest route** — when work is non-ESLint but can be written as a
   structured task list, create a small manifest and use:

   ```bash
   npx tsx skills/agent-fleet/scripts/generate-manifest-agent-fleet-pack.ts \
     --manifest .tmp/<purpose>-agent-fleet-pack-manifest.json
   ```

4. **Manual route** — use hand-written prompts/scripts only when the work is too
   custom for any generator.

A task pack may be generated from:

- a user request,
- conversation context,
- lint/typecheck/test logs,
- git diff or changed-file lists,
- a manually supplied inventory.

## Splitting Heuristics

| Work type | Split by | Notes |
|-----------|----------|-------|
| Lint errors | file | Prefer ESLint JSON generator for fresh raw reports; prefer ESLint inventory generator when curated fix-pattern context matters |
| TypeScript errors | file or symbol cluster | Use manifest route; group only when type definitions must move together |
| React hook/compiler errors | component/hook file | ESLint JSON route if emitted by lint; avoid parallel agents touching shared hook helpers |
| Cognitive complexity | file or function cluster | Ask workers to improve readability safely, not force complete resolution; include pre-edit safety assessment, optional read-only subagent consultation, and a `.tmp/.../backups/<task-id>/...` before-file copy for large single-file refactors |
| File length / `max-lines` | file | Ask workers to improve modularity safely, not split mechanically; require a before-file backup, preserve useful docs, name extracted files with shared domain-slice prefixes instead of `base`/`tail` halves, lint every touched implementation file, use ESLint diagnostics as acceptance evidence because raw `wc -l` is triage only, and mark the task partial unless TypeScript wiring is type-checked or explicitly deferred |
| Browser/functional smoke | route, flow, or component boundary | Use manifest route; include browser/curl commands and expected behavior |
| API behavior checks | endpoint or handler group | Use manifest route; preserve error semantics and include curl/test commands |
| Config crashes | config unit | Run sequentially before dependent lint tasks |
| Documentation policy | file | Include standards references, exact missing diagnostics, preservation guidance, and use bounded parallelism when target files are unique |
| Test failures | failing test file or fixture group | Include command that reproduces the failure |
| Migrations | migration file | Preserve data semantics; avoid broad config changes |

## Standards and Documentation Payload

For every generated code-editing task, attach the concrete standards paths the
worker needs. At minimum, TypeScript tasks usually include:

- `AGENTS.md`
- the nearest package-local `AGENTS.md`
- `docs/TYPESCRIPT_STANDARDS_CODING_PATTERNS.md`
- `docs/TYPESCRIPT_STANDARDS_DOCUMENTATION_FILE_OVERVIEWS.md` when file overviews may change
- `docs/TYPESCRIPT_STANDARDS_DOCUMENTATION_JSDOC.md` when JSDoc or function comments may change

Add package-specific README, architecture, testing, or domain docs when the target
file depends on those conventions.

Generated prompts should explicitly tell workers not to remove thorough truthful
documentation. Documentation edits should improve accuracy, completeness, and
standards compliance.

## Delegated Exploration

Generated prompts should allow Agent Fleet to use available subagents or
delegated read-only helpers for exploration before editing. This is especially
useful for:

- caller discovery,
- checking neighboring conventions,
- reading standards and package guidance,
- tracing types across modules,
- validating assumptions about runtime behavior.

Encourage delegated exploration when it increases confidence, but keep write
scope bounded. If exploration reveals that the original scope is insufficient,
the worker should stop and report the required scope expansion instead of editing
extra files.

For cognitive-complexity, `max-lines`, or large readability refactors, delegated exploration
should become part of the expected safety path instead of an optional nicety:
before editing, the worker should gather read-only subagent/delegated assessments
of the safest behavior-preserving simplifications when available. If no
subagent/delegation capability exists in the runtime, the worker should write a
brief pre-edit assessment itself and continue only when the safe path is clear.

`max-lines` and cognitive-complexity tasks should always create a backup of the
current file under the generated pack's `.tmp/.../backups/<task-id>/...`
directory before editing; other large single-file refactors should do the same
once large/risky scope is possible. That backup gives human reviewers or
read-only review subagents a stable before-file for behavior comparison after
implementation. The backup is an untracked artifact; do not stage or commit it.

When a task extracts new files, require a shared domain-specific prefix for the
derived family. Avoid generic leaves such as `types.ts`, `helpers.ts`,
`utils.ts`, `constants.ts`, `state.ts`, or `schema.ts`; prefer traceable names
like `<domain>-types.ts`, `<domain>-helpers.ts`, and `<domain>-validation.ts`.
For huge ordered declarative files such as field matrices, config
tables, registries, or route maps, avoid arbitrary `base`, `tail`, `part-a`, or
`part-b` labels. Split on stable semantic groups and preserve order with a small
aggregator; examples include `foundation`, `commerce-feedback`, `location`,
`people-credentials`, or `operations-structured-data`.
For overloaded clients or other mixed-responsibility implementation files, use
the same semantic-slice pattern: keep any historical public entrypoint as a thin
facade and move implementation into cohesive `domain-role` modules. Avoid
`batch-01`, `segment-03`, `base`, `tail`, and filenames that simply list every
concern that happened to share the old file.
Do not let workers clear the original file's warning by moving most of the
content into one oversized parking-lot module. Extracted implementation files
should stay under the same active line threshold; if the safe next step still
leaves an extracted file over threshold, the worker should report a partial
improvement and the remaining follow-up instead of claiming completion.

For TypeScript/TSX extraction, focused ESLint on the original target is not
enough. Workers must lint every touched implementation file and either run a
package-local typecheck once after import/export wiring changes or mark the task
`lint-verified only` with the exact deferred typecheck command. A common failure
mode is re-exporting a type from a barrel and then using that type locally without
importing it; prompts should explicitly remind workers that re-exports do not
create local bindings.

File-size review checklist:

- the configured ESLint `max-lines` diagnostic is clean for the original and
  extracted files, or the result is explicitly reported as partial;
- raw `wc -l` counts are treated as triage only because active `max-lines`
  settings may skip blank lines and comments;
- exported extracted types, functions, and helpers receive required JSDoc or
  file-overview documentation;
- extracted slices have meaningful domain names and sizes, not arbitrary
  `batch`, `segment`, `base`/`tail`, or `part-a`/`part-b` buckets;
- compatibility facades are thin and preserve existing public import paths
  without becoming new implementation parking lots;
- no new `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, or `as any`
  shortcuts were introduced;
- package typecheck and `git diff --check` are run by the operator when workers
  defer them.

## Parallel Safety

Safe to parallelize:

- unrelated files in the same package,
- docs-only files,
- independent tests,
- different submodules.

Run sequentially:

- package manager files,
- ESLint / TSConfig / build config,
- shared hooks/utilities used by many tasks,
- files already modified by a previous agent,
- tasks that may reformat or regenerate broad areas.

For overnight packs spanning several packages, use **package-level parallelism**:
one sequential runner per package, launched in parallel by `run-packs-parallel.sh`.
This gives useful concurrency while avoiding same-package collision patterns.

For documentation-only or similarly low-risk one-file-per-task packs, use
**bounded parallelism** instead:

```bash
--parallel bounded --max-total-agents 10 --max-package-agents 4 --agent-launch-delay-seconds 10
```

Bounded mode is appropriate when every task has a unique target file and agents do
not need cross-file coordination. The generator refuses duplicate target files in
bounded mode. Do not use it for config edits, package manifests, lockfiles, route
rewrites, migrations, cross-file refactors, or any task where one agent must
coordinate changes across multiple files.

After a failed or reverted `max-lines` pack, prefer package-sequential or fully
sequential execution before trying bounded parallelism again. The next pack should
ask for safest meaningful improvement plus explicit review notes, not forced
warning elimination at any cost.

## Task IDs

Use stable, sortable IDs:

- `CORE-001-short-slug`
- `UI-001-short-slug`
- `DOC-001-short-slug`
- `CONFIG-001-short-slug`

Do not encode timestamps in task IDs unless multiple sessions are expected to
coexist.

## Output Folder

Default session folder:

```text
.tmp/<timestamp>-agent-fleet-<purpose-slug>/
```

Use a UTC sortable timestamp first, then literal `agent-fleet`, then a short
purpose slug. Separate every segment with dashes, for example:

```text
.tmp/20260505T213000Z-agent-fleet-lint-gate-fixes/
```

Recommended layout:

```text
prompts/<TASK_ID>.md
backups/<TASK_ID>/<safe-target-name>.before
scripts/run-<TASK_ID>.sh
logs/<TASK_ID>.out
COMMANDS.md
run-<package>-sequentially.sh
run-all-sequentially.sh
run-packs-parallel.sh
```

All bundled generators create this layout automatically.
