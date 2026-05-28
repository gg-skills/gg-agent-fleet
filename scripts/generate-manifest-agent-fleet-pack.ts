#!/usr/bin/env -S npx tsx
/**
 * @fileoverview Generates runnable Agent Fleet task packs from a generic JSON manifest.
 *
 * @remarks
 * Use this generator when the work is not ESLint-specific: functional smoke tests, browser QA, typecheck fixes,
 * documentation audits, migration review, API behavior checks, or manually inferred task packs from conversation
 * context. The manifest captures the task inventory; this script supplies the repeatable scaffolding: prompts,
 * per-task scripts, package sequential runners, package-parallel runner, logs folders, summaries, and COMMANDS.md.
 * Manifest examples use `npx eslint --concurrency off` for lint verification so worker prompts do not inherit
 * memory-heavy package scripts that force concurrent ESLint.
 *
 * @example
 * ```bash
 * npx tsx skills/agent-fleet/scripts/generate-manifest-agent-fleet-pack.ts \
 *   --manifest .tmp/agent-fleet-pack-manifest.json
 * ```
 *
 * @testing CLI: npx tsx skills/agent-fleet/scripts/generate-manifest-agent-fleet-pack.ts --help
 * @see skills/agent-fleet/scripts/agent-fleet-pack-lib.ts - Shared pack writer utilities.
 * @see skills/agent-fleet/references/prompt-schema.md - Prompt sections rendered by this generator.
 * @documentation reviewed=2026-05-13 standard=FILE_OVERVIEW_STANDARDS_TYPESCRIPT@3
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  agentFleetPackSessionDir,
  agentFleetPackSlugify,
  agentFleetPackWrite,
  type AgentFleetPackDiagnostic,
  type AgentFleetPackPackageConfig,
  type AgentFleetPackTask,
} from "./agent-fleet-pack-lib";

/**
 * Root JSON contract consumed by the manifest-driven Agent Fleet pack generator.
 *
 * @remarks
 * Aligns with the generic inventory shape: optional workspace-level knobs plus a non-empty `tasks`
 * array. Missing fields fall back to CLI flags or script defaults in `main()`.
 */
type Manifest = {
  readonly purpose?: string;
  readonly outRoot?: string;
  readonly model?: string;
  readonly workspaceRoot?: string;
  readonly contextNote?: string;
  readonly excludedRuleNotes?: readonly string[];
  readonly parallelStrategy?: "package" | "none" | "bounded";
  readonly maxConcurrentTasks?: number;
  readonly maxConcurrentTasksPerPackage?: number;
  readonly agentLaunchDelaySeconds?: number;
  readonly packages?: Record<string, ManifestPackage>;
  readonly tasks: readonly ManifestTask[];
};

/**
 * Per-package scaffold overrides embedded in the manifest `packages` map.
 *
 * @remarks
 * Values apply when a task names `packageName`; they seed `AgentFleetPackPackageConfig` paths, id
 * prefixes, standards hints, and verification command lists for that package.
 */
type ManifestPackage = {
  readonly packagePath?: string;
  readonly taskIdPrefix?: string;
  readonly standards?: readonly string[];
  readonly verificationCommands?: readonly string[];
  readonly finalVerificationCommands?: readonly string[];
};

/**
 * Single manifest task entry before normalization into `AgentFleetPackTask`.
 *
 * @remarks
 * `repoRelativePath` anchors filesystem targets; optional diagnostics or requirements become
 * pack-visible issue rows for prompts and runners.
 */
type ManifestTask = {
  readonly id?: string;
  readonly packageName: string;
  readonly packagePath?: string;
  readonly repoRelativePath: string;
  readonly packageRelativePath?: string;
  readonly title?: string;
  readonly objective?: string;
  readonly expectedApproach?: string;
  readonly allowedAdjacentFiles?: readonly string[];
  readonly taskKind?: string;
  readonly diagnostics?: readonly ManifestDiagnostic[];
  readonly requirements?: readonly string[];
  readonly verificationCommands?: readonly string[];
  readonly standards?: readonly string[];
};

/**
 * Lint-style row supplied in the manifest for a task, prior to slug normalization.
 *
 * @remarks
 * `ruleId` may be absent when manifests carry only ESLint `category` or fall back to `taskKind`.
 */
type ManifestDiagnostic = {
  readonly line?: number;
  readonly column?: number;
  readonly ruleId?: string;
  readonly category?: string;
  readonly message: string;
};

/**
 * Parsed CLI flags after argv normalization.
 *
 * @remarks
 * Overrides win over manifest fields for purpose, output root, model, and workspace root when set.
 */
type CliOptions = {
  readonly manifestPath: string;
  readonly purposeOverride?: string;
  readonly outRootOverride?: string;
  readonly modelOverride?: string;
  readonly workspaceOverride?: string;
};

/**
 * CLI entrypoint.
 */
function main(): void {
  const cli = parseArgs(process.argv.slice(2));
  const manifestPath = path.resolve(cli.manifestPath);
  if (!existsSync(manifestPath)) {
    throw new Error(`Manifest not found: ${cli.manifestPath}`);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  if (!Array.isArray(manifest.tasks) || manifest.tasks.length === 0) {
    throw new Error("Manifest must contain a non-empty tasks array.");
  }

  const workspaceRoot = path.resolve(cli.workspaceOverride ?? manifest.workspaceRoot ?? process.cwd());
  const purpose = cli.purposeOverride ?? manifest.purpose ?? "manual-task-pack";
  const outRoot = cli.outRootOverride ?? manifest.outRoot ?? ".tmp";
  const model = cli.modelOverride ?? manifest.model ?? "composer-2";
  const packageConfigs = buildPackageConfigs(manifest);
  const tasks = manifest.tasks.map((task, index) => toAgentFleetPackTask({ task, index, packageConfigs, workspaceRoot }));
  const sessionDir = agentFleetPackSessionDir(outRoot, purpose);

  const result = agentFleetPackWrite({
    workspaceRoot,
    sessionDir,
    model,
    purposeSlug: purpose,
    packageConfigs,
    tasks,
    contextNote:
      manifest.contextNote ??
      "A manually inferred task inventory has been converted into bounded Agent Fleet tasks. Complete the scoped objective while preserving behavior and documentation quality.",
    excludedRuleNotes: manifest.excludedRuleNotes ?? [],
    parallelStrategy: manifest.parallelStrategy ?? "package",
    maxConcurrentTasks: manifest.maxConcurrentTasks,
    maxConcurrentTasksPerPackage: manifest.maxConcurrentTasksPerPackage,
    agentLaunchDelaySeconds: manifest.agentLaunchDelaySeconds,
  });

  console.log(result.sessionDir);
  console.log(`tasks=${result.taskCount}`);
  for (const [packageName, count] of result.packageTaskCounts) {
    console.log(`${packageName}=${count}`);
  }
}

/**
 * Builds the per-package configuration map used when materializing tasks.
 *
 * @remarks
 * Walks every manifest task, merges optional `manifest.packages` overrides, and ensures a synthetic
 * `root` entry exists when the manifest declares `packages.root`.
 */
function buildPackageConfigs(manifest: Manifest): Map<string, AgentFleetPackPackageConfig> {
  const packageConfigs = new Map<string, AgentFleetPackPackageConfig>();
  for (const task of manifest.tasks) {
    const manifestPackage = manifest.packages?.[task.packageName];
    const packagePath = task.packagePath ?? manifestPackage?.packagePath ?? task.packageName;
    packageConfigs.set(task.packageName, {
      packageName: task.packageName,
      packagePath,
      taskIdPrefix: manifestPackage?.taskIdPrefix,
      standards: manifestPackage?.standards,
      verificationCommands: manifestPackage?.verificationCommands,
      finalVerificationCommands: manifestPackage?.finalVerificationCommands,
    });
  }

  // Ensure the root package can be represented without having a package.json directory named `root`.
  if (!packageConfigs.has("root") && manifest.packages?.root) {
    packageConfigs.set("root", {
      packageName: "root",
      packagePath: manifest.packages.root.packagePath ?? ".",
      taskIdPrefix: manifest.packages.root.taskIdPrefix ?? "ROOT",
      standards: manifest.packages.root.standards,
      verificationCommands: manifest.packages.root.verificationCommands,
      finalVerificationCommands: manifest.packages.root.finalVerificationCommands,
    });
  }

  return packageConfigs;
}

/**
 * Converts a manifest task row into the richer `AgentFleetPackTask` pack format.
 *
 * @remarks
 * Derives stable ids via `taskIdPrefix` or `defaultPrefix`, resolves repository-relative paths, and
 * attaches diagnostic summaries derived from `taskDiagnostics`.
 */
function toAgentFleetPackTask(args: {
  readonly task: ManifestTask;
  readonly index: number;
  readonly packageConfigs: ReadonlyMap<string, AgentFleetPackPackageConfig>;
  readonly workspaceRoot: string;
}): AgentFleetPackTask {
  const packageConfig = args.packageConfigs.get(args.task.packageName);
  const packagePath = args.task.packagePath ?? packageConfig?.packagePath ?? args.task.packageName;
  const packageRelativePath =
    args.task.packageRelativePath ??
    path.relative(path.join(args.workspaceRoot, packagePath), path.join(args.workspaceRoot, args.task.repoRelativePath)).split(path.sep).join("/");
  const diagnostics = taskDiagnostics(args.task);
  const prefix = packageConfig?.taskIdPrefix ?? defaultPrefix(args.task.packageName);
  const id = args.task.id ?? `${prefix}-${String(args.index + 1).padStart(3, "0")}-${agentFleetPackSlugify(packageRelativePath)}`;

  return {
    id,
    packageName: args.task.packageName,
    packagePath,
    repoRelativePath: args.task.repoRelativePath,
    packageRelativePath,
    title: args.task.title ?? `Complete task for \`${args.task.repoRelativePath}\``,
    diagnostics,
    ruleCounts: countDiagnostics(diagnostics),
    objective: args.task.objective,
    expectedApproach: args.task.expectedApproach,
    allowedAdjacentFiles: args.task.allowedAdjacentFiles,
    verificationCommands: args.task.verificationCommands,
    standards: args.task.standards,
    taskKind: args.task.taskKind,
  };
}

/**
 * Normalizes manifest diagnostics, free-form requirements, or objectives into pack rows.
 *
 * @remarks
 * Prefers explicit `diagnostics`, otherwise maps `requirements` to synthetic rule ids, and finally
 * synthesizes a single row from `objective` when nothing else is present.
 */
function taskDiagnostics(task: ManifestTask): readonly AgentFleetPackDiagnostic[] {
  if (task.diagnostics?.length) {
    return task.diagnostics.map((diagnostic) => ({
      line: diagnostic.line,
      column: diagnostic.column,
      ruleId: diagnostic.ruleId ?? diagnostic.category ?? task.taskKind ?? "task",
      message: diagnostic.message,
    }));
  }
  if (task.requirements?.length) {
    return task.requirements.map((requirement, index) => ({
      line: index + 1,
      column: 1,
      ruleId: task.taskKind ?? "requirement",
      message: requirement,
    }));
  }
  return [
    {
      ruleId: task.taskKind ?? "task",
      message: task.objective ?? "Complete the scoped task.",
    },
  ];
}

/**
 * Tallies how many diagnostics appear per `ruleId` for summary tables.
 *
 * @remarks
 * `PURITY:` Pure aggregation over in-memory structures only.
 */
function countDiagnostics(diagnostics: readonly AgentFleetPackDiagnostic[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const diagnostic of diagnostics) {
    counts[diagnostic.ruleId] = (counts[diagnostic.ruleId] ?? 0) + 1;
  }
  return counts;
}

/**
 * Resolves the uppercase task-id prefix for a logical package name.
 *
 * @remarks
 * Known platform packages map to stable tokens; everything else slugifies and truncates for compact
 * ids.
 */
function defaultPrefix(packageName: string): string {
  const knownPrefixes: Record<string, string> = {
    root: "ROOT",
    "core-package": "CORE",
    "ui-package": "UI",
    "manager-next-package": "MNEXT",
    "manager-astro-package": "ASTRO",
    "sample-package": "SAMPLE",
  };
  return knownPrefixes[packageName] ?? agentFleetPackSlugify(packageName).replace(/-/g, "").slice(0, 10).toUpperCase();
}

/**
 * Parses CLI argv into structured options, enforcing required `--manifest`.
 *
 * @throws Error when operands are missing, unknown, or `--help` handling is not triggered first.
 */
function parseArgs(args: readonly string[]): CliOptions {
  let manifestPath: string | undefined;
  let purposeOverride: string | undefined;
  let outRootOverride: string | undefined;
  let modelOverride: string | undefined;
  let workspaceOverride: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      printHelpAndExit();
    }
    const value = args[index + 1];
    if (value === undefined) {
      throw new Error(`Missing value for ${arg}`);
    }
    switch (arg) {
      case "--manifest":
        manifestPath = value;
        index += 1;
        break;
      case "--purpose":
        purposeOverride = value;
        index += 1;
        break;
      case "--out-root":
        outRootOverride = value;
        index += 1;
        break;
      case "--model":
        modelOverride = value;
        index += 1;
        break;
      case "--workspace":
        workspaceOverride = value;
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!manifestPath) {
    throw new Error("--manifest <path> is required.");
  }

  return { manifestPath, purposeOverride, outRootOverride, modelOverride, workspaceOverride };
}

/**
 * Prints usage instructions to stdout and terminates the process successfully.
 *
 * @remarks
 * `USAGE:` Invoked before other validation when `--help` appears; ends the program via
 * `process.exit(0)` rather than returning.
 */
function printHelpAndExit(): never {
  console.log(`Generate a runnable Agent Fleet pack from a generic JSON manifest.

Usage:
  npx tsx skills/agent-fleet/scripts/generate-manifest-agent-fleet-pack.ts \\
    --manifest .tmp/agent-fleet-pack-manifest.json

Manifest shape:
  {
    "purpose": "browser-functional-sanity",
    "parallelStrategy": "package",
    "maxConcurrentTasks": 10,
    "maxConcurrentTasksPerPackage": 4,
    "agentLaunchDelaySeconds": 10,
    "contextNote": "Standalone context for every generated prompt.",
    "packages": {
      "ui-package": {
        "packagePath": "ui-package",
        "finalVerificationCommands": [
          "cd ui-package && npx eslint --concurrency off --format stylish .",
          "cd ui-package && npm run ts:check"
        ]
      }
    },
    "tasks": [
      {
        "packageName": "ui-package",
        "repoRelativePath": "ui-package/app/(with-sidebar)/app/page.tsx",
        "taskKind": "browser-smoke",
        "objective": "Verify /app route behavior and fix scoped regressions if found.",
        "requirements": ["Use browser/curl to verify the route is not a 404."],
        "verificationCommands": [
          "cd ui-package && npx eslint --concurrency off --format stylish app/(with-sidebar)/app/page.tsx",
          "cd ui-package && npm run ts:check"
        ]
      }
    ]
  }

Options:
  --manifest PATH      Generic task manifest JSON. Required.
  --purpose SLUG       Override manifest purpose.
  --out-root PATH      Override output root. Default from manifest or .tmp.
  --model MODEL        Override model. Default composer-2.
  --workspace PATH     Override workspace root.
`);
  process.exit(0);
}

main();
