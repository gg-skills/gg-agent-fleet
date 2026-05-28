---
title: Agent Fleet Task Prompt Schema
---

# Agent Fleet Task Prompt Schema

Use this schema for every generated task prompt, whether generated manually, from
ESLint JSON, or from a generic manifest. Non-ESLint manifests should fill the same
sections with functional objectives, browser/test requirements, behavior-preservation
notes, and verification commands instead of lint diagnostics.

## Required Sections

```markdown
# <Action-oriented task title>

You are editing the `<repo-name>` repository. This is a bounded code-fixing task.

## Context

<Standalone context from the conversation, gate log, or user request. Include why
this task exists and the exact current failure or desired outcome.>

## Required local standards references

Before editing, read or consult:

- `AGENTS.md`
- package-local `AGENTS.md` when present
- `docs/TYPESCRIPT_STANDARDS_CODING_PATTERNS.md` when editing TypeScript
- `docs/TYPESCRIPT_STANDARDS_DOCUMENTATION_FILE_OVERVIEWS.md` when touching file overviews
- `docs/TYPESCRIPT_STANDARDS_DOCUMENTATION_JSDOC.md` when touching function or type comments
- relevant testing, README, architecture, or domain standards for the scoped package

Do not leave this section generic. Replace this list with exact repository-relative
paths that the worker should open or consult for the task.

## Objective

<Exact desired change. Include failing lint/test/typecheck line when available.>

## Documentation preservation

If this task touches comments, JSDoc, file overviews, README text, or domain docs:

- Preserve existing documentation that is thorough, truthful, and still relevant.
- Do not delete useful context just to make the file shorter.
- Improve stale, missing, misleading, or non-compliant documentation.
- Keep documentation aligned with the final code behavior.
- Add concise intent comments for non-obvious code paths.
- Ensure every function has a block comment when local standards require it.
- Add catch-block comments explaining the intended failure-handling behavior.
- If you extract new files, add required JSDoc and file-overview documentation
  for exported contracts, helpers, and non-obvious implementation seams.
- For documentation-only backfills, add `TODO(review): ...` when the symbol or surrounding code smells risky, ambiguous, dead, incorrectly typed, or behaviorally suspicious; state what should be reviewed and why.

## Refactor-derived file naming

If this task extracts new files, give every derived file a shared, domain-specific
prefix that ties it back to the original concern. Avoid bare generic names such
as `types.ts`, `helpers.ts`, `utils.ts`, `constants.ts`, `state.ts`, or
`schema.ts`. Prefer traceable families such as `<domain>-types.ts`,
`<domain>-helpers.ts`, and `<domain>-validation.ts`.

For huge ordered declarative files such as field matrices, config
tables, registries, route maps, or enum/value maps, split by stable semantic
groups and preserve ordering through a small aggregator. Avoid arbitrary
`base`, `tail`, `part-a`, or `part-b` files unless those words are already real
domain vocabulary; names should explain the slice contents, for example
`foundation`, `commerce-feedback`, `location`, `people-credentials`, or
`operations-structured-data`.

For overloaded clients or other mixed-responsibility implementation files, keep
any historical public entrypoint as a thin compatibility facade and extract
cohesive `domain-role` slices. Avoid `batch-01`, `segment-03`, `base`, `tail`,
and concern-list filenames that only concatenate everything the old file
contained.

## Delegated exploration

You may invoke available subagents or delegated read-only helpers when you need to:

- inspect callers or related files,
- compare nearby conventions,
- understand types or runtime behavior,
- check documentation standards,
- resolve uncertainty before editing.

Use delegated exploration for thoroughness when it improves confidence. Keep final
edits within the declared scope. If investigation shows broader edits are required,
stop and report the needed scope expansion instead of editing outside scope.

## Complex-refactor safety protocol

For cognitive-complexity findings, large functions, JSX/control-flow extraction,
async orchestration, or behavior-sensitive readability work, improve the code
safely instead of forcing the warning to disappear at any cost.

Before editing:

1. Use available read-only subagents or delegated helpers to assess the safest
   behavior-preserving simplifications when that capability exists.
2. If subagents are unavailable, write a brief pre-edit safety assessment yourself
   before changing code.
3. Prefer small pure-helper extraction, named predicates, early-return cleanup,
   and local data-shaping helpers over broad control-flow rewrites.
4. Stop and report the risk instead of making a speculative refactor when the
   safe path is unclear.

For `sonarjs/cognitive-complexity` and `max-lines` tasks, copy the current file
to the provided `.tmp/.../backups/<task-id>/...` path before editing even if the
change looks small. For any other large single-file refactor, make the same
backup before editing. Do not stage, commit, or edit the backup after
implementation starts. Use it for self-review or read-only subagent comparison
of the before/after behavior.

## Scope constraints

- Primary target: `<path>`
- For `max-lines` extraction, adjacent derived files may be added or edited only when they use the
  shared domain-specific prefix, stay in the same package/module family, and are needed to make the
  target smaller and safer to read. Do not touch unrelated files.
- For non-extraction tasks, edit `<adjacent path>` only if needed for `<specific reason>`.
- Do not commit.
- Do not push to any remote.
- Leave all successful changes unstaged/uncommitted for human review.
- Do not edit package manifests or lockfiles unless explicitly allowed.
- Do not edit generated files.
- Do not add eslint-disable comments unless explicitly requested.

## Expected approach

<Implementation hints, behavior-preservation constraints, documentation-preservation constraints, and non-obvious caveats.>

## Verification

When a verification command runs ESLint, it must use explicit single-process mode.
Do not use `npm run lint` for worker-scoped verification if that script expands to
`--concurrency auto`; replace it with a focused command such as
`npx eslint --concurrency off --format stylish <target-file>`.

Run:

```bash
<focused command>
<package typecheck/test command if relevant>
```

If the task extracts TypeScript/TSX files, the worker must lint every touched implementation file,
not just the original target. The focused command can be expanded to the extracted file family, but
must still use `--concurrency off`.

For TypeScript/TSX extraction, run package-local typecheck once when practical after import/export
wiring changes. If typecheck is too slow or unsafe in that worker, the final response must say
`lint-verified only`, list the exact deferred typecheck command, and avoid claiming the refactor is
type-safe or complete.

For `max-lines` work, use the configured ESLint `max-lines` diagnostic as acceptance evidence. Raw
`wc -l` may stay above the threshold when blank lines or comments are skipped; report that nuance
instead of claiming success or failure from physical line counts alone.

Do not introduce `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, or `as any` shortcuts to pass
verification. If the safe fix requires a broader refactor, report the partial result and deferred
work instead.

## Final response

Report:

1. files changed,
2. exact verification commands run and exit status,
3. any remaining issue if verification did not pass,
4. behavior-preservation notes for risky async/React/type changes,
5. whether you used subagents/delegated review or wrote your own pre-edit safety assessment,
6. whether every touched implementation file was linted and whether package typecheck was run or deferred,
7. backup path created for any large single-file refactor, or `not needed`,
8. whether new exported files/types/functions received required docs and no new suppressions/casts were introduced,
9. confirmation that you did not commit or push anything.
```

## Wording Rules

- Use direct instructions, not conversational framing.
- Do not mention the previous chat unless the relevant facts are restated.
- Prefer exact file paths over directory-level scopes.
- Include final verification commands in executable form.
- Include `--concurrency off` in generated ESLint verification commands; avoid
  worker prompts that run full package lint scripts with `--concurrency auto`.
- Include no-commit/no-push policy in every task, even if the runner does not commit.
- Include concrete standards file paths, not generic “follow standards” language.
- Include documentation-preservation instructions whenever comments/docs may be touched.
- Tell workers to improve documentation quality without deleting thorough truthful context.
- Include refactor-derived file naming instructions for file-splitting or `max-lines`
  work, with a shared domain prefix and no bare generic extracted filenames.
- For `max-lines` work, forbid parking most of the original file in one oversized extracted module.
  Every extracted implementation file should also stay under the active line threshold; otherwise
  report a partial improvement instead of claiming completion.
- For declarative matrices/registries and overloaded clients, instruct workers to use meaningful
  semantic slices plus an order-preserving aggregator or thin compatibility facade, not arbitrary
  `batch`/`segment`/`base`/`tail` or concern-list buckets.
- For TypeScript extraction, require workers to lint all touched implementation files and either run
  package-local typecheck or clearly mark the task `lint-verified only`.
- Remind workers that `export type { Foo } from "./bar"` does not create a local `Foo` binding;
  files that use a type or value must import it locally.
- Include a delegated exploration section allowing subagents/read-only helpers for callers, conventions, types, and uncertainty resolution.
- Keep delegated exploration read-only unless the prompt explicitly expands the edit scope.
- For cognitive-complexity, `max-lines`, or other large readability refactors,
  use “improve safely” language, request pre-edit safety assessment/subagent
  input, and provide a concrete backup command.
