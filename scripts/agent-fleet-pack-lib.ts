#!/usr/bin/env -S npx tsx
/**
 * @fileoverview Shared utilities for generating runnable Agent Fleet task packs from structured gate output.
 *
 * @remarks
 * The helpers in this file are dependency-free so the skill can be copied into projects without requiring a
 * package install. They create prompt files, per-task runners, per-package sequential runners, a parallel runner,
 * and a COMMANDS.md handoff document. The generated runners never commit or push; they leave changes for human
 * review. Generated ESLint verification commands intentionally use `--concurrency off` so parallel fleets do not
 * multiply TypeScript parser/plugin memory through concurrent ESLint worker pools. Prompts also include a
 * complex-refactor safety protocol with task-local `.tmp/.../backups/<task-id>/...` paths for before/after review.
 * When readability work extracts new modules, prompts require semantic, domain-specific filenames and thin
 * compatibility facades instead of generic `helpers.ts`, `batch-01`, `segment-03`, or concern-list parking lots.
 *
 * @testing CLI: npx tsx skills/agent-fleet/scripts/generate-eslint-agent-fleet-pack.ts --help
 * @see skills/agent-fleet/SKILL.md - Skill guidance that directs agents to these scripts.
 * @see skills/agent-fleet/references/runner-templates.md - Shell runner conventions mirrored by this generator.
 * @documentation reviewed=2026-05-13 standard=FILE_OVERVIEW_STANDARDS_TYPESCRIPT@3
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  renderBoundedParallelScheduler,
  renderBoundedStatusReporter,
} from "./agent-fleet-pack-bounded-templates";

/** Counts how many diagnostics each ESLint rule id contributed for pack-level rollups. */
export type AgentFleetPackRuleCounts = Record<string, number>;

/**
 * One agent-facing task: target file, localized diagnostics, and optional verification metadata.
 *
 * @remarks
 * Paths are normalized for prompt copy (`repoRelativePath`) and package-local commands (`packageRelativePath`).
 */
export type AgentFleetPackTask = {
  readonly id: string;
  readonly packageName: string;
  readonly packagePath: string;
  readonly repoRelativePath: string;
  readonly packageRelativePath: string;
  readonly title: string;
  readonly diagnostics: readonly AgentFleetPackDiagnostic[];
  readonly ruleCounts: AgentFleetPackRuleCounts;
  readonly objective?: string;
  readonly expectedApproach?: string;
  readonly allowedAdjacentFiles?: readonly string[];
  readonly verificationCommands?: readonly string[];
  readonly standards?: readonly string[];
  readonly taskKind?: string;
};

/** A single ESLint diagnostic row captured from the originating gate output. */
export type AgentFleetPackDiagnostic = {
  readonly line?: number;
  readonly column?: number;
  readonly ruleId: string;
  readonly message: string;
};

/** Per-package defaults used when individual tasks omit standards or verification commands. */
export type AgentFleetPackPackageConfig = {
  readonly packageName: string;
  readonly packagePath: string;
  readonly taskIdPrefix?: string;
  readonly standards?: readonly string[];
  readonly verificationCommands?: readonly string[];
  readonly finalVerificationCommands?: readonly string[];
};

/**
 * Selects how generated runners may overlap agent processes across packages or files.
 *
 * @remarks
 * `bounded` requires unique `repoRelativePath` values and emits Python-backed scheduling helpers.
 */
export type AgentFleetPackParallelStrategy = "package" | "none" | "bounded";

/** Full inputs for rendering prompts and writing a timestamped session directory tree. */
export type AgentFleetPackOptions = {
  readonly workspaceRoot: string;
  readonly sessionDir: string;
  readonly model: string;
  readonly purposeSlug: string;
  readonly packageConfigs: ReadonlyMap<string, AgentFleetPackPackageConfig>;
  readonly tasks: readonly AgentFleetPackTask[];
  readonly contextNote?: string;
  readonly excludedRuleNotes?: readonly string[];
  readonly parallelStrategy: AgentFleetPackParallelStrategy;
  readonly maxConcurrentTasks?: number;
  readonly maxConcurrentTasksPerPackage?: number;
  readonly agentLaunchDelaySeconds?: number;
};

/** Summary of what `agentFleetPackWrite` materialized: session path and per-package task counts. */
export type GeneratedAgentFleetPack = {
  readonly sessionDir: string;
  readonly taskCount: number;
  readonly packageTaskCounts: ReadonlyMap<string, number>;
};

const EXECUTABLE_MODE_MASK = 0o111;
const DEFAULT_MAX_CONCURRENT_TASKS = 10;
const DEFAULT_MAX_CONCURRENT_TASKS_PER_PACKAGE = 4;
const DEFAULT_AGENT_LAUNCH_DELAY_SECONDS = 10;
const LARGE_REFACTOR_CHANGED_LINE_HINT = 80;

/**
 * Normalizes arbitrary user text into a dash-separated slug suitable for file and task IDs.
 *
 * @param value - Text to normalize.
 * @param maxLength - Maximum output length.
 * @returns A stable lowercase slug, or `task` when the input has no slug-safe characters.
 */
export function agentFleetPackSlugify(value: string, maxLength = 80): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  return slug || "task";
}

/**
 * Produces a review-artifact path for a worker to copy the target file before a large single-file refactor.
 *
 * @param options - Current pack options with session-directory ownership.
 * @param task - Target file task whose before-image should be saved.
 */
export function agentFleetPackBackupPath(
  options: AgentFleetPackOptions,
  task: AgentFleetPackTask,
): string {
  const backupFileName = task.repoRelativePath.replace(
    /[^a-zA-Z0-9._-]+/g,
    "__",
  );
  return path.join(
    options.sessionDir,
    "backups",
    task.id,
    `${backupFileName}.before`,
  );
}

/**
 * Returns a sortable UTC timestamp for generated `.tmp/` session directories.
 */
export function agentFleetPackUtcTimestamp(): string {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

/**
 * Creates the canonical timestamped Agent Fleet session directory path.
 *
 * @param outRoot - Output root, usually `.tmp`.
 * @param purposeSlug - Short dash-separated purpose slug.
 * @param timestamp - Optional UTC timestamp override for reproducibility.
 */
export function agentFleetPackSessionDir(
  outRoot: string,
  purposeSlug: string,
  timestamp = agentFleetPackUtcTimestamp(),
): string {
  return path.join(
    outRoot,
    `${timestamp}-agent-fleet-${agentFleetPackSlugify(purposeSlug, 96)}`,
  );
}

/**
 * Converts an absolute or package-relative path into a repository-relative path.
 *
 * @param workspaceRoot - Repository root.
 * @param filePath - File path from a diagnostic source.
 */
export function agentFleetPackRepoRelativePath(
  workspaceRoot: string,
  filePath: string,
): string {
  const absolute = path.isAbsolute(filePath)
    ? filePath
    : path.join(workspaceRoot, filePath);
  return path.relative(workspaceRoot, absolute).split(path.sep).join("/");
}

/**
 * Marks a generated shell script executable, preserving existing mode bits when possible.
 *
 * @param scriptPath - Script path to update.
 */
export function agentFleetPackMakeExecutable(scriptPath: string): void {
  const currentMode = statSync(scriptPath).mode;
  chmodSync(scriptPath, currentMode | EXECUTABLE_MODE_MASK);
}

/**
 * Returns default standards references that exist in the target workspace.
 *
 * @param workspaceRoot - Repository root.
 * @param packagePath - Package directory relative to the workspace root.
 */
export function agentFleetPackDetectStandards(
  workspaceRoot: string,
  packagePath: string,
): readonly string[] {
  const candidates = [
    "AGENTS.md",
    path.join(packagePath, "AGENTS.md"),
    path.join(packagePath, "source/AGENTS.md"),
    path.join(packagePath, "docs/AGENTS.md"),
    "docs/TYPESCRIPT_STANDARDS_CODING_PATTERNS.md",
    "docs/TYPESCRIPT_STANDARDS_DOCUMENTATION_FILE_OVERVIEWS.md",
    "docs/TYPESCRIPT_STANDARDS_DOCUMENTATION_JSDOC.md",
  ];
  return candidates
    .map((candidate) => candidate.split(path.sep).join("/"))
    .filter((candidate, index, all) => all.indexOf(candidate) === index)
    .filter((candidate) => existsSync(path.join(workspaceRoot, candidate)));
}

/**
 * Infers focused verification commands for a package task by inspecting package scripts.
 *
 * @param workspaceRoot - Repository root.
 * @param packagePath - Package path relative to the workspace root.
 * @param packageRelativeFile - Target file path relative to the package.
 */
export function agentFleetPackInferVerificationCommands(
  workspaceRoot: string,
  packagePath: string,
  packageRelativeFile: string,
): readonly string[] {
  const commands = [
    `(cd ${shellQuote(packagePath)} && npx eslint --concurrency off --format stylish ${shellQuote(packageRelativeFile)})`,
  ];
  const packageJsonPath = path.join(workspaceRoot, packagePath, "package.json");
  if (!existsSync(packageJsonPath)) {
    return commands;
  }
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    scripts?: Record<string, string>;
  };
  const scripts = packageJson.scripts ?? {};
  if (scripts["type-check"]) {
    commands.push(`(cd ${shellQuote(packagePath)} && npm run type-check)`);
  } else if (scripts["ts:check"]) {
    commands.push(`(cd ${shellQuote(packagePath)} && npm run ts:check)`);
  } else if (scripts.typecheck) {
    commands.push(`(cd ${shellQuote(packagePath)} && npm run typecheck)`);
  }
  return commands;
}

/**
 * Builds a prompt text for a single bounded Agent Fleet task.
 *
 * @param options - Workspace root, session layout, model name, and scheduling strategy that shape markdown sections.
 * @param task - Target file metadata and diagnostics list that populate the bounded-task template body.
 */
export function agentFleetPackRenderPrompt(
  options: AgentFleetPackOptions,
  task: AgentFleetPackTask,
): string {
  const packageConfig = options.packageConfigs.get(task.packageName);
  const standards = task.standards?.length
    ? task.standards
    : packageConfig?.standards?.length
      ? packageConfig.standards
      : agentFleetPackDetectStandards(options.workspaceRoot, task.packagePath);
  const verificationCommands = task.verificationCommands?.length
    ? task.verificationCommands.map((command) =>
        interpolateCommand(command, task),
      )
    : packageConfig?.verificationCommands?.length
      ? packageConfig.verificationCommands.map((command) =>
          interpolateCommand(command, task),
        )
      : agentFleetPackInferVerificationCommands(
          options.workspaceRoot,
          task.packagePath,
          task.packageRelativePath,
        );

  const diagnostics = task.diagnostics
    .map((diagnostic) => {
      const location =
        diagnostic.line === undefined
          ? "unknown"
          : `${diagnostic.line}:${diagnostic.column ?? 1}`;
      return `- line ${location} \`${diagnostic.ruleId}\` — ${singleLine(diagnostic.message)}`;
    })
    .join("\n");

  const excludedRuleLines =
    options.excludedRuleNotes?.map((note) => `- ${note}`).join("\n") ?? "";
  const excludedRules = excludedRuleLines
    ? `\n\nImportant intentionally excluded rules:\n\n${excludedRuleLines}`
    : "";
  const eslintVerificationGuidance = verificationCommands.some((command) =>
    /\beslint\b/.test(command),
  )
    ? `\nESLint verification must run with explicit single-process mode. Do not use package lint scripts
that expand to \`--concurrency auto\` for per-task verification; replace them with focused
\`npx eslint --concurrency off ...\` commands for the scoped file or package.
`
    : "";

  const preApprovedAdjacentFiles =
    task.allowedAdjacentFiles?.map((file) => `\`${file}\``).join(", ") ?? "";
  const preApprovedAdjacentLine = preApprovedAdjacentFiles
    ? `\n- Pre-approved adjacent files, if strictly required: ${preApprovedAdjacentFiles}.`
    : "";
  const backupPath = agentFleetPackBackupPath(options, task);
  const backupDirectory = path.dirname(backupPath);
  const isCognitiveComplexityTask = Object.hasOwn(
    task.ruleCounts,
    "sonarjs/cognitive-complexity",
  );
  const isFileLengthTask = Object.hasOwn(task.ruleCounts, "max-lines");
  const requiresUnconditionalBackup =
    isCognitiveComplexityTask || isFileLengthTask;
  const scopeConstraintTargetLine = isFileLengthTask
    ? `- Primary target: \`${task.repoRelativePath}\`.
- You may add or edit adjacent derived files only when needed to make the target smaller and safer to read. Derived files must use the shared domain-specific prefix described above, stay in the same package/module family, and be reported explicitly.`
    : `- Edit only: \`${task.repoRelativePath}\`.
- You may edit adjacent files only if verification proves it is strictly required; explain any adjacent edit in the final response.${preApprovedAdjacentLine}`;
  const extractionVerificationGuidance = isFileLengthTask
    ? `
If you create or modify derived files, verification must cover every touched implementation file,
not only the original target. Extend the focused ESLint command with all new/changed sibling files
or run an equivalent narrow glob for the extracted family, still with \`--concurrency off\`.

For TypeScript/TSX extraction, run the package-local typecheck once when practical after import/export
wiring changes. If the package typecheck is too slow or unsafe in this worker, do not claim the
refactor is type-safe or fully complete; report it as lint-verified only and list the exact
typecheck command the operator must run.

Use the configured ESLint \`max-lines\` diagnostic as acceptance evidence. Raw \`wc -l\` is useful
triage, but active rule settings may skip blank lines and comments. If raw counts remain high while
ESLint is clean, report that nuance; if ESLint still reports \`max-lines\`, report a partial result.

Before claiming the file-size refactor is pristine, confirm new exported types/functions/helpers have
required JSDoc or file-overview documentation and that you did not introduce \`eslint-disable\`,
\`@ts-ignore\`, \`@ts-expect-error\`, or \`as any\` shortcuts.
`
    : "";
  const unconditionalBackupReason = isCognitiveComplexityTask
    ? "cognitive-complexity refactor"
    : "file-length refactor";
  const backupProtocol = requiresUnconditionalBackup
    ? `Because this is a ${unconditionalBackupReason}, create the before-file backup now, before any edit, even if you expect a small change:

\`\`\`bash
mkdir -p ${shellQuote(backupDirectory)}
cp ${shellQuote(task.repoRelativePath)} ${shellQuote(backupPath)}
\`\`\`

Use the backup only as a review artifact. Do not stage it, commit it, push it, or edit it after implementation starts. Do not report “not needed” for this task's backup; the operator uses this artifact for before/after review when the eventual diff turns out larger than expected.`
    : `For any large single-file refactor, copy the current file to this untracked backup path before editing so reviewers or read-only subagents can compare the before/after implementation:

\`\`\`bash
mkdir -p ${shellQuote(backupDirectory)}
cp ${shellQuote(task.repoRelativePath)} ${shellQuote(backupPath)}
\`\`\`

Use the backup only as a review artifact. Do not stage it, commit it, push it, or edit it after implementation starts. A large refactor includes more than about ${LARGE_REFACTOR_CHANGED_LINE_HINT} changed lines, extraction of event/key dispatch paths, async/control-flow rewrites, or splitting a function with multiple side effects.`;
  const finalBackupReport = requiresUnconditionalBackup
    ? `7. backup path created before editing: \`${backupPath}\`,`
    : "7. backup path created for any large single-file refactor, or “not needed”,";

  return `# ${task.title}

You are editing the \`${task.packageName}\` package inside \`${options.workspaceRoot}\`. This is a bounded code-fixing task.

## Context

${options.contextNote ?? "A gate report has been converted into bounded Agent Fleet tasks. Fix this file's diagnostics without weakening project standards."}${excludedRules}

Target file:

\`\`\`text
${task.repoRelativePath}
\`\`\`

Current task inputs for this file:

${diagnostics}

Task counts/categories: \`${JSON.stringify(task.ruleCounts)}\`.

## Required local standards references

Before editing, consult:

${standards.map((standard) => `- \`${standard}\``).join("\n") || "- `AGENTS.md` if present"}

## Objective

${task.objective ?? agentFleetPackDefaultObjective(task)}

## Documentation preservation

Preserve existing documentation that is thorough, truthful, and still relevant. Do not delete useful context just to make the file shorter. Improve stale, missing, misleading, or non-compliant comments/JSDoc if your change affects documented behavior.

If you extract new files, add required JSDoc and file-overview documentation for exported contracts, helpers, and non-obvious implementation seams.

## Refactor-derived file naming

If you extract new files, give every derived file a shared, domain-specific prefix that ties it back to the original concern. Avoid bare generic names such as \`types.ts\`, \`helpers.ts\`, \`utils.ts\`, \`constants.ts\`, \`state.ts\`, or \`schema.ts\`; prefer names like \`<domain>-types.ts\`, \`<domain>-helpers.ts\`, or \`<domain>-validation.ts\` so reviewers and agents can trace the extracted family by prefix even in a subfolder.

For huge ordered declarative files such as field matrices, config tables, registries, route maps, or enum/value maps, split by stable semantic groups and preserve ordering through a small aggregator. Avoid arbitrary \`base\`, \`tail\`, \`part-a\`, or \`part-b\` files unless those words are already real domain vocabulary; names should explain the slice contents, for example \`foundation\`, \`commerce-feedback\`, \`location\`, \`people-credentials\`, or \`operations-structured-data\`.

For overloaded clients or other mixed-responsibility implementation files, keep any historical public entrypoint as a thin compatibility facade and extract cohesive \`domain-role\` slices. Avoid \`batch-01\`, \`segment-03\`, \`base\`, \`tail\`, and concern-list filenames that only concatenate everything the old file contained.

## Delegated exploration

You may invoke available subagents or delegated read-only helpers when you need to inspect callers, compare nearby conventions, understand types or runtime behavior, check documentation standards, or resolve uncertainty before editing. Keep final edits within the declared scope. If investigation shows broader edits are required, stop and report the needed scope expansion instead of editing outside scope.

## Complex-refactor safety protocol

If this task involves cognitive-complexity reduction, large functions, JSX/control-flow extraction, async orchestration, error handling, or any behavior-sensitive readability refactor, improve the code safely rather than forcing the diagnostic to disappear at any cost.

Before editing risky code:

1. Use available read-only subagents or delegated helpers to assess the safest behavior-preserving simplifications. Ask them what changes are least likely to regress runtime behavior while still improving readability/cognitive complexity.
2. If subagents/delegation are unavailable in your runtime, write a short pre-edit safety assessment yourself before changing code.
3. Prefer small pure-helper extraction, named predicates, early-return cleanup, and local data-shaping helpers over broad control-flow rewrites.
4. Stop and report the risk instead of making a speculative refactor when the safe path is unclear.

${backupProtocol}

## Scope constraints

${scopeConstraintTargetLine}
- You may inspect any file.
- Do not edit ESLint config, package manifests, lockfiles, generated files, or unrelated files.
- Do not add \`eslint-disable\` comments unless explicitly requested by the operator.
- Do not add \`@ts-ignore\`, \`@ts-expect-error\`, \`as any\`, or broad casts as shortcuts to make verification pass.
- Do not commit.
- Do not push to any remote.
- Leave all successful changes unstaged/uncommitted for human review.

## Expected approach

${task.expectedApproach ?? agentFleetPackRuleGuidance(Object.keys(task.ruleCounts))}

Prefer minimal, behavior-preserving changes. Preserve async ordering, React behavior, routing behavior, data semantics, public type/API contracts, and tests' intended assertions.

## Verification
${eslintVerificationGuidance}
${extractionVerificationGuidance}

Run:

\`\`\`bash
${verificationCommands.join("\n")}
\`\`\`

The focused verification command for the target file/scope must pass before claiming success. If package-level typecheck or tests are too slow, still run the focused command and explain why broader verification was deferred. Do not describe a TypeScript extraction as complete when import/export wiring has not been type-checked.

## Final response

Report:

1. files changed,
2. exact verification commands run and exit status,
3. any remaining issue if verification did not pass,
4. behavior-preservation notes for risky async/React/type changes,
5. whether you used subagents/delegated review or wrote your own pre-edit safety assessment,
6. whether every touched implementation file was linted and whether package typecheck was run or deferred,
${finalBackupReport}
8. whether new exported files/types/functions received required docs and no new suppressions/casts were introduced,
9. confirmation that you did not commit or push anything.
`;
}

/**
 * Returns rule-specific implementation guidance for common lint cleanup packs.
 *
 * @param ruleIds - Rule IDs found in the task.
 */
export function agentFleetPackRuleGuidance(ruleIds: readonly string[]): string {
  const rules = new Set(ruleIds);
  const guidance: string[] = [];
  if (rules.has("@typescript-eslint/no-misused-promises")) {
    guidance.push(
      "For `@typescript-eslint/no-misused-promises`, preserve async error propagation. If a framework callback expects `void`, wrap async work and forward rejections to the framework error path; do not silently swallow errors.",
    );
  }
  if (rules.has("@typescript-eslint/ban-ts-comment")) {
    guidance.push(
      "For `@typescript-eslint/ban-ts-comment`, remove `@ts-nocheck` by fixing real type issues. Replace `@ts-ignore` with narrow, justified `@ts-expect-error` only when the error is intentional; prefer eliminating the suppression entirely.",
    );
  }
  if (rules.has("@typescript-eslint/no-this-alias")) {
    guidance.push(
      "For `@typescript-eslint/no-this-alias`, preserve runtime receiver binding. Prefer direct `this`, arrow functions, or a locally allowed receiver name only when a stable captured receiver is genuinely required.",
    );
  }
  if (rules.has("@typescript-eslint/no-unsafe-assignment")) {
    guidance.push(
      "For `@typescript-eslint/no-unsafe-assignment`, validate or narrow `unknown`/JSON/any values at boundaries with guards or schemas; avoid unsafe casts.",
    );
  }
  if (rules.has("@typescript-eslint/no-unnecessary-condition")) {
    guidance.push(
      "For `@typescript-eslint/no-unnecessary-condition`, remove impossible branches only after confirming the runtime contract. If external data can violate the static type, strengthen boundary validation instead of deleting necessary runtime protection.",
    );
  }
  if (rules.has("react-hooks/exhaustive-deps")) {
    guidance.push(
      "For `react-hooks/exhaustive-deps`, fix the dependency model honestly by moving unstable expressions inside hooks or memoizing them; do not suppress dependencies.",
    );
  }
  if (rules.has("react-hooks/refs")) {
    guidance.push(
      "For `react-hooks/refs`, refs must not be read during render. Determine whether the value should be state, props, or a non-ref local; preserve UI behavior.",
    );
  }
  if (rules.has("react-hooks/set-state-in-effect")) {
    guidance.push(
      "For `react-hooks/set-state-in-effect`, avoid synchronous state writes in effects. Prefer derived state, lazy initial state, or event/subscription callbacks without render loops or hydration mismatches.",
    );
  }
  if (rules.has("react-hooks/error-boundaries")) {
    guidance.push(
      "For `react-hooks/error-boundaries`, keep data reads and error normalization in `try/catch`, then construct JSX after the `try/catch` completes.",
    );
  }
  if (rules.has("sonarjs/cognitive-complexity")) {
    guidance.push(
      "For `sonarjs/cognitive-complexity`, improve readability safely rather than forcing a full warning resolution. Use the complex-refactor safety protocol first, prefer small pure helpers/named predicates/early returns, preserve side-effect ordering, and stop if the safest path is unclear.",
    );
  }
  if (rules.has("max-lines")) {
    guidance.push(
      "For `max-lines`, treat file length as a modularity/readability signal, not a mandate to split at all costs. Prefer extracting cohesive types, constants, pure helpers, validators, hooks, or subcomponents behind a stable public boundary. Preserve truthful documentation and behavior; do not delete comments or tests just to reduce line count.",
    );
    guidance.push(
      "Use the configured ESLint `max-lines` diagnostic as acceptance evidence. Raw `wc -l` is triage only because blank/comment skipping can make physical line counts misleading.",
    );
    guidance.push(
      "When extracting files for `max-lines`, use a shared domain-specific filename prefix for the extracted family (for example `<domain>-types.ts`, `<domain>-helpers.ts`, `<domain>-validation.ts`) instead of bare `types.ts`, `helpers.ts`, or `utils.ts`.",
    );
    guidance.push(
      "For huge declarative matrices, config tables, registries, or route maps, split along semantic group boundaries and preserve the original order with a small aggregator. Avoid arbitrary `base`/`tail` or `part-a`/`part-b` buckets; name slices for their contents, such as `foundation`, `commerce-feedback`, `location`, or `operations-structured-data`.",
    );
    guidance.push(
      "For overloaded clients or mixed-responsibility implementation files, keep the historical public entrypoint as a thin facade when needed and extract cohesive `domain-role` slices. Avoid `batch`, `segment`, `base`, `tail`, and concern-list filenames that simply concatenate the old file's responsibilities.",
    );
    guidance.push(
      "Do not move most of the original file into one oversized parking-lot module. Each extracted implementation file should also stay below the active `max-lines` threshold; if a safe split would leave an extracted file over the threshold, report a partial improvement instead of claiming the task is complete.",
    );
    guidance.push(
      "After extraction, audit imports and exports in every touched file. Re-exporting a type from a barrel does not create a local type binding; import any type or value used by the file itself.",
    );
    guidance.push(
      "Add required JSDoc/file-overview documentation for new exported types, functions, and helpers; do not introduce new `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, or `as any` shortcuts to make verification pass.",
    );
  }
  if (guidance.length === 0) {
    guidance.push(
      "Make the minimal behavior-preserving change required by the diagnostics.",
    );
  }
  return guidance.map((item) => `- ${item}`).join("\n");
}

/**
 * Returns a safe default objective for a generated task when callers did not provide one.
 *
 * @param task - Task metadata and rule counts that determine whether the worker should fully fix a
 * diagnostic or make a measured readability improvement.
 */
export function agentFleetPackDefaultObjective(
  task: AgentFleetPackTask,
): string {
  const ruleIds = new Set(Object.keys(task.ruleCounts));
  if (ruleIds.has("max-lines")) {
    return `Make the safest meaningful modularity/readability improvement in \`${task.repoRelativePath}\` for the listed \`max-lines\` finding. Reducing the file below the threshold is welcome, but do not force a risky split, delete useful documentation, or change behavior just to make the warning disappear.`;
  }
  if (ruleIds.has("sonarjs/cognitive-complexity")) {
    return `Make the safest meaningful readability improvement in \`${task.repoRelativePath}\` for the listed cognitive-complexity finding. Eliminating the warning is welcome, but do not force a behavior-sensitive rewrite when a smaller improvement is safer.`;
  }
  return `Fix the listed diagnostics in \`${task.repoRelativePath}\` without weakening lint rules, adding broad suppressions, or changing unrelated behavior.`;
}

/**
 * Writes a complete Agent Fleet task pack to disk.
 *
 * @param options - Pack-generation options and task inventory.
 */
export function agentFleetPackWrite(
  options: AgentFleetPackOptions,
): GeneratedAgentFleetPack {
  mkdirSync(path.join(options.sessionDir, "prompts"), { recursive: true });
  mkdirSync(path.join(options.sessionDir, "scripts"), { recursive: true });
  mkdirSync(path.join(options.sessionDir, "logs"), { recursive: true });
  mkdirSync(path.join(options.sessionDir, "backups"), { recursive: true });

  for (const task of options.tasks) {
    const promptPath = path.join(
      options.sessionDir,
      "prompts",
      `${task.id}.md`,
    );
    writeFileSync(promptPath, agentFleetPackRenderPrompt(options, task));

    const scriptPath = path.join(
      options.sessionDir,
      "scripts",
      `run-${task.id}.sh`,
    );
    writeFileSync(scriptPath, renderTaskRunner(options, task));
    agentFleetPackMakeExecutable(scriptPath);
  }

  const packageGroups = groupTasksByPackage(options.tasks);
  for (const [packageName, tasks] of packageGroups) {
    const runnerPath = path.join(
      options.sessionDir,
      `run-${packageName}-sequentially.sh`,
    );
    writeFileSync(
      runnerPath,
      renderPackageSequentialRunner(options, packageName, tasks),
    );
    agentFleetPackMakeExecutable(runnerPath);
  }

  const allRunnerPath = path.join(
    options.sessionDir,
    "run-all-sequentially.sh",
  );
  writeFileSync(allRunnerPath, renderAllSequentialRunner(options));
  agentFleetPackMakeExecutable(allRunnerPath);

  if (options.parallelStrategy === "package") {
    const parallelRunnerPath = path.join(
      options.sessionDir,
      "run-packs-parallel.sh",
    );
    writeFileSync(
      parallelRunnerPath,
      renderPackageParallelRunner(options, Array.from(packageGroups.keys())),
    );
    agentFleetPackMakeExecutable(parallelRunnerPath);
  }

  if (options.parallelStrategy === "bounded") {
    assertUniqueTargetsForBoundedParallel(options.tasks);
    writeFileSync(
      path.join(options.sessionDir, "tasks.tsv"),
      renderBoundedParallelTaskIndex(options.tasks, options),
    );
    const schedulerPath = path.join(
      options.sessionDir,
      "scripts",
      "bounded-scheduler.py",
    );
    writeFileSync(schedulerPath, renderBoundedParallelScheduler());
    agentFleetPackMakeExecutable(schedulerPath);

    const statusReporterPath = path.join(
      options.sessionDir,
      "scripts",
      "pack-status.py",
    );
    writeFileSync(statusReporterPath, renderBoundedStatusReporter());
    agentFleetPackMakeExecutable(statusReporterPath);

    const statusRunnerPath = path.join(options.sessionDir, "run-status.sh");
    writeFileSync(statusRunnerPath, renderStatusRunner(options));
    agentFleetPackMakeExecutable(statusRunnerPath);

    const boundedRunnerPath = path.join(
      options.sessionDir,
      "run-parallel-bounded.sh",
    );
    writeFileSync(boundedRunnerPath, renderBoundedParallelRunner(options));
    agentFleetPackMakeExecutable(boundedRunnerPath);

    for (const packageName of packageGroups.keys()) {
      const boundedPackageRunnerPath = path.join(
        options.sessionDir,
        `run-${packageName}-parallel-bounded.sh`,
      );
      writeFileSync(
        boundedPackageRunnerPath,
        renderBoundedPackageRunner(options, packageName),
      );
      agentFleetPackMakeExecutable(boundedPackageRunnerPath);
    }
  }

  writeFileSync(
    path.join(options.sessionDir, "COMMANDS.md"),
    renderCommandsDocument(options, packageGroups),
  );

  return {
    sessionDir: options.sessionDir,
    taskCount: options.tasks.length,
    packageTaskCounts: new Map(
      Array.from(packageGroups, ([packageName, tasks]) => [
        packageName,
        tasks.length,
      ]),
    ),
  };
}

/**
 * Produces the bash body for `run-<task>.sh`: launches `agent` with the task prompt, tee logging, and status lines.
 *
 * @remarks
 * PURITY: returns only generated script text; does not touch the filesystem.
 */
function renderTaskRunner(
  options: AgentFleetPackOptions,
  task: AgentFleetPackTask,
): string {
  const logDirectory = path.join(options.sessionDir, "logs");
  const promptPath = path.join(options.sessionDir, "prompts", `${task.id}.md`);
  const logPath = path.join(logDirectory, `${task.id}.out`);
  const lockDirectory = path.join(
    options.sessionDir,
    ".agent-cli-startup.lock",
  );
  const statusDirectory = path.join(options.sessionDir, "logs", "status");
  const statusPath = path.join(statusDirectory, `${task.id}.status.tsv`);
  return `#!/usr/bin/env bash
set -uo pipefail
ROOT_DIR="\${AGENT_FLEET_WORKSPACE:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$ROOT_DIR"
mkdir -p ${shellQuote(logDirectory)} ${shellQuote(statusDirectory)}
TASK_ID=${shellQuote(task.id)}
TASK_PACKAGE=${shellQuote(task.packageName)}
TASK_TARGET=${shellQuote(task.repoRelativePath)}
PROMPT_PATH=${shellQuote(promptPath)}
LOG_PATH=${shellQuote(logPath)}
STATUS_PATH=${shellQuote(statusPath)}
MODEL_NAME=${shellQuote(options.model)}
LOCK_DIR=${shellQuote(lockDirectory)}
STARTUP_LOCK_SECONDS="\${AGENT_FLEET_AGENT_STARTUP_LOCK_SECONDS:-5}"
LOCK_ACQUIRED=0
if [ -z "\${NO_COLOR:-}" ]; then
  COLOR_BLUE="$(printf '\\033[1;34m')"
  COLOR_CYAN="$(printf '\\033[1;36m')"
  COLOR_GREEN="$(printf '\\033[1;32m')"
  COLOR_RED="$(printf '\\033[1;31m')"
  COLOR_YELLOW="$(printf '\\033[1;33m')"
  COLOR_DIM="$(printf '\\033[2m')"
  COLOR_RESET="$(printf '\\033[0m')"
else
  COLOR_BLUE=""; COLOR_CYAN=""; COLOR_GREEN=""; COLOR_RED=""; COLOR_YELLOW=""; COLOR_DIM=""; COLOR_RESET=""
fi
release_startup_lock() {
  if [ "$LOCK_ACQUIRED" = "1" ]; then
    rmdir "$LOCK_DIR" 2>/dev/null || true
    LOCK_ACQUIRED=0
  fi
}
print_launch_banner() {
  printf '\n'
  printf '%s####################################################################################################%s\n' "$COLOR_BLUE" "$COLOR_RESET"
  printf '%s# TASK LAUNCHED                                                                                    #%s\n' "$COLOR_BLUE" "$COLOR_RESET"
  printf '%s####################################################################################################%s\n' "$COLOR_BLUE" "$COLOR_RESET"
  printf '%s# task_id:%s %s\n' "$COLOR_YELLOW" "$COLOR_RESET" "$TASK_ID"
  printf '%s# package:%s %s\n' "$COLOR_YELLOW" "$COLOR_RESET" "$TASK_PACKAGE"
  printf '%s# target:%s %s\n' "$COLOR_YELLOW" "$COLOR_RESET" "$TASK_TARGET"
  printf '%s# prompt_path:%s %s\n' "$COLOR_YELLOW" "$COLOR_RESET" "$PROMPT_PATH"
  printf '%s# log_path:%s %s\n' "$COLOR_YELLOW" "$COLOR_RESET" "$LOG_PATH"
  printf '%s# status_path:%s %s\n' "$COLOR_YELLOW" "$COLOR_RESET" "$STATUS_PATH"
  printf '%s# model:%s %s\n' "$COLOR_YELLOW" "$COLOR_RESET" "$MODEL_NAME"
  printf '%s# workspace:%s %s\n' "$COLOR_YELLOW" "$COLOR_RESET" "$PWD"
  printf '%s# agent_command:%s ' "$COLOR_YELLOW" "$COLOR_RESET"
  printf 'agent -p --trust --force --model %q --workspace %q "$(cat %q)" 2>&1 | tee %q\n' "$MODEL_NAME" "$PWD" "$PROMPT_PATH" "$LOG_PATH"
  printf '%s####################################################################################################%s\n' "$COLOR_CYAN" "$COLOR_RESET"
  printf '%s# PROMPT BEGIN: %s%s\n' "$COLOR_CYAN" "$TASK_ID" "$COLOR_RESET"
  printf '%s####################################################################################################%s\n' "$COLOR_CYAN" "$COLOR_RESET"
  cat "$PROMPT_PATH"
  printf '\n%s####################################################################################################%s\n' "$COLOR_CYAN" "$COLOR_RESET"
  printf '%s# PROMPT END: %s%s\n' "$COLOR_CYAN" "$TASK_ID" "$COLOR_RESET"
  printf '%s####################################################################################################%s\n' "$COLOR_CYAN" "$COLOR_RESET"
  printf '%s# PROMPT SENT: %s%s\n' "$COLOR_GREEN" "$TASK_ID" "$COLOR_RESET"
}
print_completion_banner() {
  local status="$1"
  local status_color="$COLOR_GREEN"
  if [ "$status" != "0" ]; then
    status_color="$COLOR_RED"
  fi
  printf '\n'
  printf '%s####################################################################################################%s\n' "$status_color" "$COLOR_RESET"
  printf '%s# TASK COMPLETED                                                                                   #%s\n' "$status_color" "$COLOR_RESET"
  printf '%s####################################################################################################%s\n' "$status_color" "$COLOR_RESET"
  printf '%s# task_id:%s %s\n' "$COLOR_YELLOW" "$COLOR_RESET" "$TASK_ID"
  printf '%s# package:%s %s\n' "$COLOR_YELLOW" "$COLOR_RESET" "$TASK_PACKAGE"
  printf '%s# target:%s %s\n' "$COLOR_YELLOW" "$COLOR_RESET" "$TASK_TARGET"
  printf '%s# exit_code:%s %s%s%s\n' "$COLOR_YELLOW" "$COLOR_RESET" "$status_color" "$status" "$COLOR_RESET"
  printf '%s# log_path:%s %s\n' "$COLOR_YELLOW" "$COLOR_RESET" "$LOG_PATH"
  printf '%s# status_path:%s %s\n' "$COLOR_YELLOW" "$COLOR_RESET" "$STATUS_PATH"
  printf '%s####################################################################################################%s\n' "$status_color" "$COLOR_RESET"
}
trap release_startup_lock EXIT INT TERM
print_launch_banner
until mkdir "$LOCK_DIR" 2>/dev/null; do
  sleep 0.25
done
LOCK_ACQUIRED=1
(
  set -o pipefail
  agent -p --trust --force --model "$MODEL_NAME" --workspace "$PWD" "$(cat "$PROMPT_PATH")" 2>&1 | tee "$LOG_PATH"
) &
AGENT_PIPELINE_PID="$!"
STARTUP_DEADLINE=$((SECONDS + STARTUP_LOCK_SECONDS))
while kill -0 "$AGENT_PIPELINE_PID" 2>/dev/null && [ "$SECONDS" -lt "$STARTUP_DEADLINE" ]; do
  sleep 0.25
done
release_startup_lock
wait "$AGENT_PIPELINE_PID"
STATUS="$?"
printf 'task\texit_code\tlog_file\ttarget\n' > "$STATUS_PATH"
printf '%s\t%s\t%s\t%s\n' "$TASK_ID" "$STATUS" "$LOG_PATH" "$TASK_TARGET" >> "$STATUS_PATH"
print_completion_banner "$STATUS"
exit "$STATUS"
`;
}

/**
 * Assembles a sequential bash runner for every task belonging to one package and appends a summary cat.
 *
 * @remarks
 * PURITY: returns only generated script text.
 */
function renderPackageSequentialRunner(
  options: AgentFleetPackOptions,
  packageName: string,
  tasks: readonly AgentFleetPackTask[],
): string {
  const lines = runnerHeader(options, `${packageName}-summary.tsv`);
  for (const task of tasks) {
    lines.push(...runnerTaskLines(options, task));
  }
  lines.push('cat "$SUMMARY_FILE"', 'exit "$overall"', "");
  return lines.join("\n");
}

/**
 * Assembles a sequential bash runner that executes the full task list in pack order.
 *
 * @remarks
 * PURITY: returns only generated script text.
 */
function renderAllSequentialRunner(options: AgentFleetPackOptions): string {
  const lines = runnerHeader(options, "run-all-sequentially-summary.tsv");
  for (const task of options.tasks) {
    lines.push(...runnerTaskLines(options, task));
  }
  lines.push('cat "$SUMMARY_FILE"', 'exit "$overall"', "");
  return lines.join("\n");
}

/**
 * Builds a bash driver that backgrounds each package's sequential runner and waits for all PIDs.
 *
 * @remarks
 * PURITY: returns only generated script text.
 */
function renderPackageParallelRunner(
  options: AgentFleetPackOptions,
  packageNames: readonly string[],
): string {
  const lines = [
    "#!/usr/bin/env bash",
    "set -uo pipefail",
    'ROOT_DIR="${AGENT_FLEET_WORKSPACE:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"',
    'cd "$ROOT_DIR"',
    "pids=()",
    "overall=0",
  ];
  for (const packageName of packageNames) {
    const runnerPath = path.join(
      options.sessionDir,
      `run-${packageName}-sequentially.sh`,
    );
    const runnerLogPath = path.join(
      options.sessionDir,
      "logs",
      `${packageName}-runner.out`,
    );
    lines.push(
      `${shellQuote(runnerPath)} > >(tee ${shellQuote(runnerLogPath)}) 2>&1 &`,
      `pids+=("$!:${packageName}")`,
    );
  }
  lines.push(
    'for item in "${pids[@]}"; do',
    '  pid="${item%%:*}"',
    '  name="${item#*:}"',
    '  if ! wait "$pid"; then',
    '    echo "runner failed: $name"',
    "    overall=1",
    "  fi",
    "done",
    'exit "$overall"',
    "",
  );
  return lines.join("\n");
}

/**
 * Ensures bounded-parallel packs never schedule two tasks for the same repository-relative target path.
 *
 * @throws {Error} When duplicate `repoRelativePath` values appear across tasks.
 */
function assertUniqueTargetsForBoundedParallel(
  tasks: readonly AgentFleetPackTask[],
): void {
  const taskIdByTarget = new Map<string, string>();
  for (const task of tasks) {
    const existingTaskId = taskIdByTarget.get(task.repoRelativePath);
    if (existingTaskId) {
      throw new Error(
        [
          "Bounded parallel runner requires one task per target file.",
          `Duplicate target: ${task.repoRelativePath}`,
          `Tasks: ${existingTaskId}, ${task.id}`,
        ].join(" "),
      );
    }
    taskIdByTarget.set(task.repoRelativePath, task.id);
  }
}

/**
 * Renders the `tasks.tsv` index consumed by `bounded-scheduler.py`, one row per scheduled task.
 *
 * @remarks
 * PURITY: returns only generated TSV text.
 */
function renderBoundedParallelTaskIndex(
  tasks: readonly AgentFleetPackTask[],
  options: AgentFleetPackOptions,
): string {
  const rows = tasks.map((task) =>
    [
      task.id,
      task.packageName,
      path.join(options.sessionDir, "scripts", `run-${task.id}.sh`),
      path.join(options.sessionDir, "logs", `${task.id}.out`),
      task.repoRelativePath,
    ]
      .map(tsvCell)
      .join("\t"),
  );
  return ["task\tpackage\tscript\tlog\ttarget", ...rows, ""].join("\n");
}

/**
 * Builds the thin bash wrapper that forwards argv to `pack-status.py` from the repository root.
 *
 * @remarks
 * PURITY: returns only generated bash text.
 */
function renderStatusRunner(options: AgentFleetPackOptions): string {
  return `#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="\${AGENT_FLEET_WORKSPACE:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$ROOT_DIR"
python3 ${shellQuote(path.join(options.sessionDir, "scripts", "pack-status.py"))} "$@"
`;
}

/**
 * Builds the global bounded-parallel bash entry that tees scheduler output and preserves pipeline status.
 *
 * @remarks
 * PURITY: returns only generated bash text.
 */
function renderBoundedParallelRunner(options: AgentFleetPackOptions): string {
  const maxTotal = options.maxConcurrentTasks ?? DEFAULT_MAX_CONCURRENT_TASKS;
  const maxPerPackage =
    options.maxConcurrentTasksPerPackage ??
    DEFAULT_MAX_CONCURRENT_TASKS_PER_PACKAGE;
  const launchDelaySeconds =
    options.agentLaunchDelaySeconds ?? DEFAULT_AGENT_LAUNCH_DELAY_SECONDS;
  return `#!/usr/bin/env bash
set -uo pipefail
ROOT_DIR="\${AGENT_FLEET_WORKSPACE:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$ROOT_DIR"
RUN_COMMAND=(python3 ${shellQuote(path.join(options.sessionDir, "scripts", "bounded-scheduler.py"))} --max-total ${maxTotal} --max-per-package ${maxPerPackage} --launch-delay ${launchDelaySeconds})
if command -v caffeinate >/dev/null 2>&1; then
  caffeinate -ims "\${RUN_COMMAND[@]}" 2>&1 | tee ${shellQuote(path.join(options.sessionDir, "logs", "high-concurrency-runner.out"))}
else
  "\${RUN_COMMAND[@]}" 2>&1 | tee ${shellQuote(path.join(options.sessionDir, "logs", "high-concurrency-runner.out"))}
fi
exit \${PIPESTATUS[0]}
`;
}

/**
 * Builds a package-scoped bounded runner that caps both total and per-package concurrency to the same ceiling.
 *
 * @remarks
 * PURITY: returns only generated bash text.
 */
function renderBoundedPackageRunner(
  options: AgentFleetPackOptions,
  packageName: string,
): string {
  const maxPerPackage =
    options.maxConcurrentTasksPerPackage ??
    DEFAULT_MAX_CONCURRENT_TASKS_PER_PACKAGE;
  const launchDelaySeconds =
    options.agentLaunchDelaySeconds ?? DEFAULT_AGENT_LAUNCH_DELAY_SECONDS;
  return `#!/usr/bin/env bash
set -uo pipefail
ROOT_DIR="\${AGENT_FLEET_WORKSPACE:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$ROOT_DIR"
RUN_COMMAND=(python3 ${shellQuote(path.join(options.sessionDir, "scripts", "bounded-scheduler.py"))} --package ${shellQuote(packageName)} --max-total ${maxPerPackage} --max-per-package ${maxPerPackage} --launch-delay ${launchDelaySeconds})
if command -v caffeinate >/dev/null 2>&1; then
  caffeinate -ims "\${RUN_COMMAND[@]}" 2>&1 | tee ${shellQuote(path.join(options.sessionDir, "logs", `${packageName}-parallel-bounded-runner.out`))}
else
  "\${RUN_COMMAND[@]}" 2>&1 | tee ${shellQuote(path.join(options.sessionDir, "logs", `${packageName}-parallel-bounded-runner.out`))}
fi
exit \${PIPESTATUS[0]}
`;
}

/**
 * Shared bash preamble for sequential runners: workspace resolution, session directories, and summary TSV header.
 *
 * @remarks
 * PURITY: returns string fragments only; callers join into a full script.
 */
function runnerHeader(
  options: AgentFleetPackOptions,
  summaryFileName: string,
): string[] {
  return [
    "#!/usr/bin/env bash",
    "set -uo pipefail",
    'ROOT_DIR="${AGENT_FLEET_WORKSPACE:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"',
    'cd "$ROOT_DIR"',
    `SESSION_DIR=${shellQuote(options.sessionDir)}`,
    'mkdir -p "$SESSION_DIR/logs"',
    `SUMMARY_FILE="$SESSION_DIR/logs/${summaryFileName}"`,
    "printf 'task\\texit_code\\tlog_file\\n' > \"$SUMMARY_FILE\"",
    "overall=0",
  ];
}

/**
 * Bash fragment that runs one per-task script, captures exit status, and appends a row to the aggregate summary TSV.
 *
 * @remarks
 * PURITY: returns string fragments only.
 */
function runnerTaskLines(
  options: AgentFleetPackOptions,
  task: AgentFleetPackTask,
): string[] {
  const logFile = path.join(options.sessionDir, "logs", `${task.id}.out`);
  const scriptPath = path.join(
    options.sessionDir,
    "scripts",
    `run-${task.id}.sh`,
  );
  return [
    `echo "=== ${task.id} ==="`,
    shellQuote(scriptPath),
    "status=$?",
    `printf '${task.id}\\t%s\\t${logFile}\\n' "$status" >> "$SUMMARY_FILE"`,
    'if [ "$status" -ne 0 ]; then overall=1; fi',
  ];
}

/**
 * Renders `COMMANDS.md` inventory text: recommended runs, per-package entrypoints, summaries, and task index.
 *
 * @remarks
 * PURITY: returns markdown only.
 */
function renderCommandsDocument(
  options: AgentFleetPackOptions,
  packageGroups: ReadonlyMap<string, readonly AgentFleetPackTask[]>,
): string {
  const packageCounts = Array.from(
    packageGroups,
    ([packageName, tasks]) => `- \`${packageName}\`: ${tasks.length} tasks`,
  ).join("\n");
  const taskList = options.tasks
    .map(
      (task) =>
        `- \`${task.id}\` — \`${task.repoRelativePath}\` — ${task.diagnostics.length} inputs — \`${JSON.stringify(task.ruleCounts)}\``,
    )
    .join("\n");
  const packageVerification = Array.from(packageGroups.keys())
    .flatMap((packageName) => {
      const packageConfig = options.packageConfigs.get(packageName);
      return (
        packageConfig?.finalVerificationCommands ??
        inferFinalVerificationCommands(
          options.workspaceRoot,
          packageConfig?.packagePath ?? packageName,
        )
      );
    })
    .filter((command, index, all) => all.indexOf(command) === index)
    .join("\n");
  const recommendedRun = renderRecommendedRun(options);
  const perPackageRunners = Array.from(packageGroups.keys())
    .flatMap((packageName) => {
      const runners = [
        `${options.sessionDir}/run-${packageName}-sequentially.sh`,
      ];
      if (options.parallelStrategy === "bounded") {
        runners.push(
          `${options.sessionDir}/run-${packageName}-parallel-bounded.sh`,
        );
      }
      return runners;
    })
    .join("\n");
  const summaries = Array.from(packageGroups.keys()).flatMap((packageName) => {
    const packageSummaries = [
      `cat ${options.sessionDir}/logs/${packageName}-summary.tsv`,
    ];
    if (options.parallelStrategy === "bounded") {
      packageSummaries.push(
        `cat ${options.sessionDir}/logs/${packageName}-parallel-bounded-summary.tsv`,
      );
    }
    return packageSummaries;
  });
  let statusSection = "";
  if (options.parallelStrategy === "bounded") {
    summaries.unshift(
      `cat ${options.sessionDir}/logs/high-concurrency-summary.tsv`,
    );
    statusSection = `
## Status / progress checks

Run this while the pack is active, or after it finishes, to see done/failed/pending counts by package plus active scheduler/agent processes:

\`\`\`bash
${options.sessionDir}/run-status.sh
${options.sessionDir}/run-status.sh --examples 1
${options.sessionDir}/run-status.sh --no-processes
\`\`\`
`;
  }
  const postRunReviewCommands = [
    "git status --short",
    `git diff -- ${options.tasks.map((task) => shellQuote(task.repoRelativePath)).join(" ")}`,
    options.parallelStrategy === "bounded"
      ? `${options.sessionDir}/run-status.sh --examples 3`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return `# Agent Fleet task pack

Session directory:

\`\`\`text
${options.sessionDir}
\`\`\`

Purpose: \`${options.purposeSlug}\`.

## Inventory

${packageCounts}

Total tasks: ${options.tasks.length}

## Recommended run

${recommendedRun}

## Conservative run

\`\`\`bash
${options.sessionDir}/run-all-sequentially.sh
\`\`\`
${statusSection}
## Per-package runners

\`\`\`bash
${perPackageRunners}
\`\`\`

## Summaries

\`\`\`bash
${summaries.join("\n")}
\`\`\`

## Post-run sanity review

Successful agent exit codes are not enough. Before considering this pack done,
review the resulting working-tree changes:

\`\`\`bash
${postRunReviewCommands}
\`\`\`

Confirm each changed file matches its task scope, flag unexpected adjacent edits,
and distinguish fleet-caused changes from pre-existing workspace drift.
Large single-file refactors may leave before-file copies under
\`${options.sessionDir}/backups/\`; use those untracked artifacts for before/after
behavior review when present, but do not stage or commit them.

## Final verification

\`\`\`bash
${packageVerification || "# Add package-local verification commands here."}
\`\`\`

## Task list

${taskList}
`;
}

/**
 * Produces the human-readable "Recommended run" section describing the chosen parallel strategy.
 *
 * @remarks
 * PURITY: returns markdown snippet only.
 */
function renderRecommendedRun(options: AgentFleetPackOptions): string {
  if (options.parallelStrategy === "bounded") {
    const maxTotal = options.maxConcurrentTasks ?? DEFAULT_MAX_CONCURRENT_TASKS;
    const maxPerPackage =
      options.maxConcurrentTasksPerPackage ??
      DEFAULT_MAX_CONCURRENT_TASKS_PER_PACKAGE;
    const launchDelaySeconds =
      options.agentLaunchDelaySeconds ?? DEFAULT_AGENT_LAUNCH_DELAY_SECONDS;
    return [
      `Run bounded parallel agents (max ${maxTotal} total, max ${maxPerPackage} per package, ${launchDelaySeconds}s between launches). This mode is intended for one-file-per-task packs such as documentation-only cleanup or low-collision readability improvements:`,
      "",
      "```bash",
      `${options.sessionDir}/run-parallel-bounded.sh`,
      "```",
    ].join("\n");
  }
  if (options.parallelStrategy === "package") {
    return `Run one sequential lane per package in parallel:\n\n\`\`\`bash\n${options.sessionDir}/run-packs-parallel.sh\n\`\`\``;
  }
  return `Run all tasks sequentially:\n\n\`\`\`bash\n${options.sessionDir}/run-all-sequentially.sh\n\`\`\``;
}

/**
 * Suggests package-wide lint plus type-check commands by reading `package.json` scripts when present.
 *
 * @param workspaceRoot - Repository root used to resolve `package.json`.
 * @param packageName - Path segment for the package directory relative to `workspaceRoot`.
 */
function inferFinalVerificationCommands(
  workspaceRoot: string,
  packageName: string,
): readonly string[] {
  const packageJsonPath = path.join(workspaceRoot, packageName, "package.json");
  const commands = [inferFinalVerificationEslintCommand(packageName)];
  if (!existsSync(packageJsonPath)) {
    return commands;
  }
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    scripts?: Record<string, string>;
  };
  const scripts = packageJson.scripts ?? {};
  if (scripts["type-check"]) {
    commands.push(`(cd ${shellQuote(packageName)} && npm run type-check)`);
  } else if (scripts["ts:check"]) {
    commands.push(`(cd ${shellQuote(packageName)} && npm run ts:check)`);
  } else if (scripts.typecheck) {
    commands.push(`(cd ${shellQuote(packageName)} && npm run typecheck)`);
  }
  return commands;
}

/**
 * Builds package-wide ESLint verification commands without accidentally traversing scratch trees.
 *
 * @remarks
 * Root Agent Fleet reports use package path `.`. Linting `.` directly can traverse generated or
 * research sandboxes with their own incomplete configs, so mirror the platform-owned root lint
 * scope while keeping ESLint single-process via `--concurrency off`.
 */
function inferFinalVerificationEslintCommand(packageName: string): string {
  if (packageName !== ".") {
    return `(cd ${shellQuote(packageName)} && npx eslint --concurrency off --format stylish .)`;
  }

  return [
    "(cd '.' && npx eslint --config eslint.config.ts --report-unused-disable-directives",
    "--concurrency off --format stylish scripts .pi/extensions skills",
    "eslint.config.ts jest.config.ts .mcp.json .cursor/mcp.json .windsurf/mcp.json",
    ".vscode/mcp.json opencode.json)",
  ].join(" ");
}

/**
 * Groups tasks by `packageName` while preserving encounter order within each package bucket.
 *
 * @remarks
 * PURITY: allocates a new `Map` without mutating task objects.
 */
function groupTasksByPackage(
  tasks: readonly AgentFleetPackTask[],
): Map<string, AgentFleetPackTask[]> {
  const groups = new Map<string, AgentFleetPackTask[]>();
  for (const task of tasks) {
    const existing = groups.get(task.packageName) ?? [];
    existing.push(task);
    groups.set(task.packageName, existing);
  }
  return groups;
}

/**
 * Replaces `<REPO_RELATIVE_PATH>`, `<PACKAGE_RELATIVE_PATH>`, `<PACKAGE_PATH>`, and `<TASK_ID>` placeholders.
 *
 * @remarks
 * Used so pack authors can author verification snippets once and inherit per-task paths.
 */
function interpolateCommand(command: string, task: AgentFleetPackTask): string {
  return command
    .replaceAll("<REPO_RELATIVE_PATH>", task.repoRelativePath)
    .replaceAll("<PACKAGE_RELATIVE_PATH>", task.packageRelativePath)
    .replaceAll("<PACKAGE_PATH>", task.packagePath)
    .replaceAll("<TASK_ID>", task.id);
}

/** Normalizes arbitrary text as a single TSV cell by stripping tab and newline characters. */
function tsvCell(value: string): string {
  return value.replace(/[\t\r\n]/g, " ");
}

/**
 * Shell-single-quotes `value` for safe embedding inside generated bash or Python-invocation strings.
 *
 * @remarks
 * Escapes embedded apostrophes using the `'"'"'` idiom.
 */
function shellQuote(value: string): string {
  const escapedSingleQuote = `'"'"'`;
  return `'${value.replaceAll("'", escapedSingleQuote)}'`;
}

/** Collapses internal whitespace so long ESLint messages fit single-line prompt bullets. */
function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
