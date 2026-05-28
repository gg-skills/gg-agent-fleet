---
title: Agent Fleet Non-Negotiable Policy (Full Detail)
---

# Agent Fleet Non-Negotiable Policy — Full Detail

These are the hard rules that every generated Agent Fleet pack must follow. The
SKILL.md keeps a short summary; this file is the authoritative long form with
every nuance, rationale, and corner case.

1. **Generate by default; run only on explicit request.** Unless the user explicitly
   asks to run a generated command or asks for a monitored execution, create
   prompt files and run scripts only. When the user does explicitly ask to run,
   switch to the run-and-monitor path in workflow step 9 ("Run and monitor when
   requested").

2. **Default no commit/no push.** Every generated task prompt must say: do not
   commit, do not push, leave changes unstaged/uncommitted for human review.

3. **One bounded task per conflict unit.** Prefer one prompt per file. Group files
   only when they must change together.

4. **Make every task standalone.** Include enough context for Agent Fleet to work
   without reading the current chat.

5. **Use exact paths.** Include repository-relative paths, package-local commands,
   and verification commands. Do not use vague targets like "fix the lint".

6. **Preserve output logs.** Generated commands should pipe `2>&1 | tee <log>` so
   output is visible and recorded.

7. **Verify CLI flags live.** Before stating model names or flags with confidence,
   run or ask the operator to run `agent --help` and `agent models`.

8. **Avoid destructive automation.** Generated scripts must not remove branches,
   delete worktrees, reset repositories, push, or commit unless the user explicitly
   requests that behavior.

9. **Surface residual gates.** Include final verification commands that re-run the
   relevant lint/typecheck/test gate after all agents finish.

10. **Use timestamped session folders.** Default generated output paths should live
    under `.tmp/<timestamp>-agent-fleet-<purpose-slug>/`, where the timestamp
    comes first and all segments are dash-separated. Do not use a fixed reusable
    folder unless the user explicitly requests one.

11. **Provide standards files to the worker.** For code-editing tasks, every
    generated prompt must name the exact coding-pattern, documentation, testing,
    package `AGENTS.md`, and domain-standard files the worker should consult.
    Do not say "follow standards" without giving concrete paths.

12. **Preserve strong documentation.** Generated prompts must forbid removing,
    weakening, or replacing thorough truthful documentation just to reduce text.
    Workers should improve stale, missing, misleading, or non-compliant docs while
    preserving useful context and intent.

13. **Encourage delegated exploration.** Generated prompts should explicitly allow
    the worker agent to invoke available subagents or delegated read-only helpers
    when it needs to explore references, inspect callers, compare conventions, or
    resolve uncertainty before editing. Exploration should improve confidence while
    preserving the task's bounded edit scope.

14. **Use a complex-refactor safety protocol.** For cognitive-complexity or
    other readability refactors that may reshape control flow, generated prompts
    must tell workers to improve the code cautiously rather than "solve at any
    cost." Before editing, the worker should gather read-only subagent/delegated
    assessments of the safest behavior-preserving simplifications when available;
    if subagents are unavailable, it must write the same pre-edit safety
    assessment itself. For `sonarjs/cognitive-complexity` tasks, the prompt must
    require the exact `.tmp/.../backups/<task-id>/...` before-file copy
    unconditionally before any edit; do not let the worker decide "not needed"
    because the eventual diff size is not knowable up front. For non-cognitive
    large single-file refactors, the prompt must give the same exact backup path
    and tell the worker to copy the current file there before editing so review
    agents can compare the before/after implementation.

15. **Disable ESLint concurrency in generated verification.** Every generated
    prompt that asks a worker to run ESLint must use explicit single-process mode
    (`npx eslint --concurrency off ...`) for focused verification. Do not tell
    workers to use package lint scripts that expand to `--concurrency auto` for
    per-task verification; if a package script forces concurrent ESLint, replace it
    with an equivalent focused `npx eslint --concurrency off <target>` command and
    leave broad package lint for a human/operator final gate.

16. **Keep worker verification narrow for high-concurrency lint fleets.** For
    documentation-only or cognitive-complexity packs, generate prompts with
    `--worker-verification lint-only` so agents do not each run package-wide
    type-check/build gates in parallel. Put broad type-check/build commands in
    `COMMANDS.md` final verification for the operator instead.

17. **Review agent output before declaring success.** When you run an Agent Fleet
    pack, treat successful task exit codes as necessary but not sufficient. Before
    the final user summary, inspect the resulting diffs, check that each worker
    stayed inside its declared scope, identify unrelated pre-existing drift, and
    sanity-review behavior preservation claims against the actual code changes.

18. **Preflight stale local agents before reruns.** Before launching or rerunning a
    local Agent Fleet pack, sample free memory and large resident processes
    (`vm_stat`, top RSS `ps`, and current pack status). If stale MCP/LSP/agent
    processes are already consuming multi-GB RSS, do not keep retrying the same
    pack just because concurrency is low; pause, record the process evidence, ask
    the operator to clean up or authorize cleanup, then regenerate with lower caps
    or switch to manual single-file fallback.

19. **Keep refactor-derived filenames traceable.** Generated prompts for file
    splitting or large readability refactors must forbid bare generic extracted
    filenames such as `types.ts`, `helpers.ts`, `utils.ts`, `constants.ts`,
    `state.ts`, or `schema.ts`. If workers create new files, they must use a
    shared, domain-specific prefix that ties the extracted family back to the
    original concern (for example `<domain>-types.ts`, `<domain>-helpers.ts`, or
    `<domain>-validation.ts`) so reviewers and agents can find related files by
    prefix even inside a subfolder.

20. **Verify extracted TypeScript families, not just the original target.** For
    `max-lines` and other file-splitting tasks, generated prompts must require
    workers to lint every touched implementation file with `--concurrency off`.
    If TypeScript/TSX imports or exports changed, the worker should run the
    package-local typecheck once when practical. If it cannot, it must mark the
    result `lint-verified only`, list the deferred typecheck command, and avoid
    claiming the refactor is complete or type-safe.

21. **Forbid parking-lot modules.** A `max-lines` task is not complete when the
    worker merely moves most of the original file into one oversized extracted
    file. Each new implementation file should also stay below the active
    threshold; otherwise the worker should report a partial improvement and the
    remaining split seam.

22. **Prefer semantic slices over base/tail or concern-list splits.** For huge field
    matrices, config tables, route maps, registries, overloaded client modules,
    or other mixed-responsibility files, workers should split on durable
    domain/role boundaries while preserving public import paths through a small
    aggregator or compatibility facade. Avoid arbitrary `batch-01`, `segment-03`,
    `base`, `tail`, `part-a`, or `part-b` files unless those labels are already
    real domain vocabulary. Also avoid filenames that simply concatenate every
    concern the old file happened to contain. Name slices for what they own, and
    size them for the next stricter threshold when practical instead of only the
    current warning threshold.

23. **Treat import/export wiring as a first-class review risk.** Generated prompts
    for TypeScript extraction should remind workers that re-exporting a type or
    value from a barrel does not create a local binding. Any type or value used in
    a file must be imported by that file, and final review must check missing
    imports/exports before accepting the task.

24. **Use ESLint evidence, not raw line counts, for max-lines acceptance.** Raw
    `wc -l` output is useful triage, but this repo's active `max-lines`
    configuration may skip blank lines and comments. Workers and reviewers should
    treat the configured ESLint diagnostic as the acceptance source of truth. If
    raw line count remains high but ESLint is clean, report that nuance; if ESLint
    still warns, call the task partial instead of clean.

25. **Make extracted docs part of file-size work.** `max-lines` prompts must
    require JSDoc/file-overview compliance for new exported types, functions, and
    helpers. They must also forbid new `eslint-disable`, `@ts-ignore`,
    `@ts-expect-error`, or `as any` shortcuts as a way to pass lint or typecheck.
