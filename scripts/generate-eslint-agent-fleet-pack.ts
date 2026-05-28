#!/usr/bin/env -S npx tsx
/**
 * @fileoverview Generates ready-to-run Agent Fleet task packs from ESLint JSON reports.
 *
 * @remarks
 * This CLI turns one or more package-local ESLint JSON outputs into the same scaffolding this skill has been
 * producing manually: prompts, per-task shell runners, per-package sequential runners, a package-parallel runner,
 * logs directories, TSV summaries, and COMMANDS.md. It is intentionally dependency-free and does not execute
 * Agent Fleet, commit, push, or modify source files.
 *
 * @example
 * ```bash
 * npx tsx skills/agent-fleet/scripts/generate-eslint-agent-fleet-pack.ts \
 *   --purpose overnight-lint-react-ts-cleanup \
 *   --input core-package=.tmp/gate-reports/lint-json/core-package-current.json \
 *   --input ui-package=.tmp/gate-reports/lint-json/ui-package-current.json \
 *   --exclude-rule @typescript-eslint/no-empty-object-type
 * ```
 *
 * @testing CLI: npx tsx skills/agent-fleet/scripts/generate-eslint-agent-fleet-pack.ts --help
 * @see skills/agent-fleet/scripts/agent-fleet-pack-lib.ts - Shared pack writer utilities.
 * @see skills/agent-fleet/references/task-splitting.md - Task-boundary rules mirrored by this script.
 * @documentation reviewed=2026-05-06 standard=FILE_OVERVIEW_STANDARDS_TYPESCRIPT@3
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  agentFleetPackRepoRelativePath,
  agentFleetPackSessionDir,
  agentFleetPackSlugify,
  agentFleetPackWrite,
  type AgentFleetPackDiagnostic,
  type AgentFleetPackPackageConfig,
  type AgentFleetPackRuleCounts,
  type AgentFleetPackTask,
} from "./agent-fleet-pack-lib";

/**
 * Fully parsed CLI options for turning ESLint JSON reports into a Agent Fleet task pack.
 */
type CliOptions = {
  readonly inputs: readonly InputSpec[];
  readonly packagePaths: ReadonlyMap<string, string>;
  readonly purpose: string;
  readonly outRoot: string;
  readonly model: string;
  readonly workspaceRoot: string;
  readonly includeWarnings: boolean;
  readonly excludeRules: ReadonlySet<string>;
  readonly onlyRules: ReadonlySet<string>;
  readonly contextNote?: string;
  readonly excludedRuleNotes: readonly string[];
  readonly parallelStrategy: "package" | "none" | "bounded";
  readonly maxConcurrentTasks: number;
  readonly maxConcurrentTasksPerPackage: number;
  readonly agentLaunchDelaySeconds: number;
  readonly workerVerificationMode: WorkerVerificationMode;
};

/**
 * Verification-command breadth embedded in each worker prompt.
 */
type WorkerVerificationMode = "lint-only" | "lint-and-type-check";

/**
 * One `--input` binding: package label and path to that package's ESLint JSON report file.
 */
type InputSpec = {
  readonly packageName: string;
  readonly reportPath: string;
};

/**
 * Single-file record shape produced by ESLint's JSON formatter (`eslint -f json`).
 */
type EslintJsonResult = {
  readonly filePath: string;
  readonly messages?: readonly EslintJsonMessage[];
};

/**
 * One diagnostic line from ESLint JSON output before normalization into pack fields.
 */
type EslintJsonMessage = {
  readonly ruleId?: string | null;
  readonly severity?: number;
  readonly message?: string;
  readonly line?: number;
  readonly column?: number;
};

const DEFAULT_CONTEXT_NOTE =
  "A lint gate report has been converted into bounded Agent Fleet tasks. Fix this file's diagnostics without weakening project standards or changing unrelated behavior.";

/**
 * CLI entrypoint.
 */
function main(): void {
  const options = parseArgs(process.argv.slice(2));
  if (options.inputs.length === 0) {
    throw new Error("At least one --input <package>=<eslint-json> is required.");
  }

  const packageConfigs = new Map<string, AgentFleetPackPackageConfig>();
  const tasks: AgentFleetPackTask[] = [];

  for (const input of options.inputs) {
    const packagePath =
      options.packagePaths.get(input.packageName) ?? defaultPackagePathForPackageName(input.packageName);
    packageConfigs.set(input.packageName, {
      packageName: input.packageName,
      packagePath,
      taskIdPrefix: taskPrefixForPackage(input.packageName),
    });

    const packageTasks = readEslintTasks({ input, packagePath, options });
    tasks.push(...packageTasks);
  }

  const sessionDir = agentFleetPackSessionDir(options.outRoot, options.purpose);
  const result = agentFleetPackWrite({
    workspaceRoot: options.workspaceRoot,
    sessionDir,
    model: options.model,
    purposeSlug: options.purpose,
    packageConfigs,
    tasks,
    contextNote: options.contextNote ?? DEFAULT_CONTEXT_NOTE,
    excludedRuleNotes: options.excludedRuleNotes,
    parallelStrategy: options.parallelStrategy,
    maxConcurrentTasks: options.maxConcurrentTasks,
    maxConcurrentTasksPerPackage: options.maxConcurrentTasksPerPackage,
    agentLaunchDelaySeconds: options.agentLaunchDelaySeconds,
  });

  console.log(result.sessionDir);
  console.log(`tasks=${result.taskCount}`);
  for (const [packageName, count] of result.packageTaskCounts) {
    console.log(`${packageName}=${count}`);
  }
}

/**
 * Loads one package's ESLint JSON report and emits one task per file that still has included diagnostics.
 */
function readEslintTasks(args: { readonly input: InputSpec; readonly packagePath: string; readonly options: CliOptions }): AgentFleetPackTask[] {
  const reportPath = path.resolve(args.options.workspaceRoot, args.input.reportPath);
  if (!existsSync(reportPath)) {
    throw new Error(`ESLint JSON report not found: ${args.input.reportPath}`);
  }

  const report = JSON.parse(readFileSync(reportPath, "utf8")) as EslintJsonResult[];
  const prefix = taskPrefixForPackage(args.input.packageName);
  const tasks: AgentFleetPackTask[] = [];
  let taskIndex = 1;

  for (const fileResult of report) {
    const diagnostics = (fileResult.messages ?? [])
      .filter((message) => shouldIncludeMessage(message, args.options))
      .map(toDiagnostic);
    if (diagnostics.length === 0) {
      continue;
    }

    const repoRelativePath = agentFleetPackRepoRelativePath(args.options.workspaceRoot, fileResult.filePath);
    const packageRelativePath = path
      .relative(path.join(args.options.workspaceRoot, args.packagePath), path.join(args.options.workspaceRoot, repoRelativePath))
      .split(path.sep)
      .join("/");
    const ruleCounts = countRules(diagnostics);
    const taskId = `${prefix}-${String(taskIndex).padStart(3, "0")}-${agentFleetPackSlugify(packageRelativePath)}`;
    taskIndex += 1;

    tasks.push({
      id: taskId,
      packageName: args.input.packageName,
      packagePath: args.packagePath,
      repoRelativePath,
      packageRelativePath,
      title: `Fix lint diagnostics in \`${repoRelativePath}\``,
      diagnostics,
      ruleCounts,
      verificationCommands:
        args.options.workerVerificationMode === "lint-only"
          ? [formatFocusedEslintVerificationCommand(args.packagePath, packageRelativePath)]
          : undefined,
    });
  }

  return tasks;
}

/**
 * Builds the safest per-worker ESLint command: one target file and one ESLint process.
 *
 * @remarks
 * Cognitive-complexity fleets can run many workers at once; package type-checks stay operator-owned
 * final verification so workers do not multiply TypeScript/ESLint memory across lanes.
 */
function formatFocusedEslintVerificationCommand(packagePath: string, packageRelativeFile: string): string {
  return `(cd ${shellQuoteForGeneratedCommand(packagePath)} && npx eslint --concurrency off --format stylish ${shellQuoteForGeneratedCommand(packageRelativeFile)})`;
}

/**
 * Converts conventional package names into working directories for generated commands.
 *
 * @remarks
 * The root package is named `root` in reports and task ids, but its shell working directory is `.`
 * rather than a literal `root/` folder.
 */
function defaultPackagePathForPackageName(packageName: string): string {
  if (packageName === "root") {
    return ".";
  }
  return packageName;
}

/**
 * Whether a JSON message survives severity, `--include-warnings`, `--exclude-rule`, and `--only-rule` filters.
 */
function shouldIncludeMessage(message: EslintJsonMessage, options: CliOptions): boolean {
  const severity = message.severity ?? 0;
  if (severity !== 2 && !(options.includeWarnings && severity === 1)) {
    return false;
  }
  const ruleId = message.ruleId ?? "fatal";
  if (options.excludeRules.has(ruleId)) {
    return false;
  }
  if (options.onlyRules.size > 0 && !options.onlyRules.has(ruleId)) {
    return false;
  }
  return true;
}

/**
 * Maps a raw ESLint JSON message to the stable diagnostic shape stored in generated tasks.
 */
function toDiagnostic(message: EslintJsonMessage): AgentFleetPackDiagnostic {
  return {
    line: message.line,
    column: message.column,
    ruleId: message.ruleId ?? "fatal",
    message: message.message ?? "ESLint diagnostic without message.",
  };
}

/**
 * Builds per-rule occurrence counts for embedding in task prompts and summaries.
 */
function countRules(diagnostics: readonly AgentFleetPackDiagnostic[]): AgentFleetPackRuleCounts {
  const counts: Record<string, number> = {};
  for (const diagnostic of diagnostics) {
    counts[diagnostic.ruleId] = (counts[diagnostic.ruleId] ?? 0) + 1;
  }
  return counts;
}

/**
 * Short uppercase prefix for task ids; uses known abbreviations or a slug-derived fallback.
 */
function taskPrefixForPackage(packageName: string): string {
  const knownPrefixes: Record<string, string> = {
    "core-package": "CORE",
    "ui-package": "UI",
    "manager-next-package": "MNEXT",
    "manager-astro-package": "ASTRO",
    "sample-package": "SAMPLE",
  };
  return knownPrefixes[packageName] ?? agentFleetPackSlugify(packageName).replace(/-/g, "").slice(0, 10).toUpperCase();
}

/**
 * Parses argv into CLI options; throws on missing values, unknown flags, or invalid enum/number inputs.
 */
function parseArgs(args: readonly string[]): CliOptions {
  const inputs: InputSpec[] = [];
  const packagePaths = new Map<string, string>();
  const excludeRules = new Set<string>();
  const onlyRules = new Set<string>();
  const excludedRuleNotes: string[] = [];
  let purpose = "lint-gate-fixes";
  let outRoot = ".tmp";
  let model = "composer-2";
  let workspaceRoot = process.cwd();
  let includeWarnings = false;
  let contextNote: string | undefined;
  let parallelStrategy: "package" | "none" | "bounded" = "package";
  let maxConcurrentTasks = 10;
  let maxConcurrentTasksPerPackage = 4;
  let agentLaunchDelaySeconds = 10;
  let workerVerificationMode: WorkerVerificationMode = "lint-and-type-check";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      printHelpAndExit();
    }
    if (arg === "--include-warnings") {
      includeWarnings = true;
      continue;
    }
    const value = args[index + 1];
    if (value === undefined) {
      throw new Error(`Missing value for ${arg}`);
    }
    switch (arg) {
      case "--input": {
        const [packageName, reportPath] = splitAssignment(value, "--input");
        inputs.push({ packageName, reportPath });
        index += 1;
        break;
      }
      case "--package-path": {
        const [packageName, packagePath] = splitAssignment(value, "--package-path");
        packagePaths.set(packageName, packagePath);
        index += 1;
        break;
      }
      case "--exclude-rule":
        excludeRules.add(value);
        index += 1;
        break;
      case "--only-rule":
        onlyRules.add(value);
        index += 1;
        break;
      case "--excluded-rule-note":
        excludedRuleNotes.push(value);
        index += 1;
        break;
      case "--purpose":
        purpose = value;
        index += 1;
        break;
      case "--out-root":
        outRoot = value;
        index += 1;
        break;
      case "--model":
        model = value;
        index += 1;
        break;
      case "--workspace":
        workspaceRoot = path.resolve(value);
        index += 1;
        break;
      case "--context-note":
        contextNote = value;
        index += 1;
        break;
      case "--parallel":
        if (value !== "package" && value !== "none" && value !== "bounded") {
          throw new Error("--parallel must be 'package', 'bounded', or 'none'.");
        }
        parallelStrategy = value;
        index += 1;
        break;
      case "--max-total-agents":
        maxConcurrentTasks = parsePositiveInteger(value, "--max-total-agents");
        index += 1;
        break;
      case "--max-package-agents":
        maxConcurrentTasksPerPackage = parsePositiveInteger(value, "--max-package-agents");
        index += 1;
        break;
      case "--agent-launch-delay-seconds":
        agentLaunchDelaySeconds = parseNonNegativeNumber(value, "--agent-launch-delay-seconds");
        index += 1;
        break;
      case "--worker-verification":
        if (value !== "lint-only" && value !== "lint-and-type-check") {
          throw new Error("--worker-verification must be 'lint-only' or 'lint-and-type-check'.");
        }
        workerVerificationMode = value;
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return {
    inputs,
    packagePaths,
    purpose,
    outRoot,
    model,
    workspaceRoot,
    includeWarnings,
    excludeRules,
    onlyRules,
    contextNote,
    excludedRuleNotes,
    parallelStrategy,
    maxConcurrentTasks,
    maxConcurrentTasksPerPackage,
    agentLaunchDelaySeconds,
    workerVerificationMode,
  };
}

/**
 * Parses a string as a safe integer strictly greater than zero for bounded-runner limits.
 */
function parsePositiveInteger(value: string, flagName: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${flagName} must be a positive integer.`);
  }
  return parsed;
}

/**
 * Parses a finite number ≥ 0 for delay-style CLI flags.
 */
function parseNonNegativeNumber(value: string, flagName: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flagName} must be a non-negative number.`);
  }
  return parsed;
}

/**
 * Parses `NAME=VALUE` arguments for flags like `--input` and `--package-path`.
 */
function splitAssignment(value: string, flagName: string): readonly [string, string] {
  const equalsIndex = value.indexOf("=");
  if (equalsIndex <= 0 || equalsIndex === value.length - 1) {
    throw new Error(`${flagName} expects NAME=VALUE, received: ${value}`);
  }
  return [value.slice(0, equalsIndex), value.slice(equalsIndex + 1)];
}

/**
 * Shell-single-quotes `value` for safe generated bash command snippets.
 */
function shellQuoteForGeneratedCommand(value: string): string {
  const escapedSingleQuote = `'"'"'`;
  return `'${value.replaceAll("'", escapedSingleQuote)}'`;
}

/**
 * Prints CLI usage to stdout and terminates the process with code 0 (no pack generated).
 */
function printHelpAndExit(): never {
  console.log(`Generate a runnable Agent Fleet pack from ESLint JSON reports.

Usage:
  npx tsx skills/agent-fleet/scripts/generate-eslint-agent-fleet-pack.ts \\
    --purpose overnight-lint-react-ts-cleanup \\
    --input core-package=.tmp/gate-reports/lint-json/core-package-current.json \\
    --input ui-package=.tmp/gate-reports/lint-json/ui-package-current.json

Options:
  --input NAME=PATH              Package name and ESLint JSON report. Repeatable.
  --package-path NAME=PATH       Override package directory when it differs from NAME.
  --purpose SLUG                 Purpose slug for .tmp/<timestamp>-agent-fleet-<slug>/.
  --out-root PATH                Output root. Default: .tmp.
  --model MODEL                  Agent Fleet model. Default: composer-2.
  --workspace PATH               Workspace root. Default: current directory.
  --parallel package|bounded|none Generate package, bounded, or no parallel runner. Default: package.
  --max-total-agents N           Bounded mode max active agents across all packages. Default: 10.
  --max-package-agents N         Bounded mode max active agents per package. Default: 4.
  --agent-launch-delay-seconds N Bounded mode delay between launching agents. Default: 10.
  --worker-verification MODE    Per-worker verification breadth: lint-only or lint-and-type-check. Default: lint-and-type-check.
  --include-warnings             Include severity=1 diagnostics, not only errors.
  --exclude-rule RULE            Exclude a rule ID. Repeatable.
  --only-rule RULE               Include only a rule ID. Repeatable.
  --excluded-rule-note TEXT      Note to embed in prompts about intentionally excluded rules.
  --context-note TEXT            Override default prompt context.
`);
  process.exit(0);
}

main();
