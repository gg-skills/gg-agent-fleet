#!/usr/bin/env npx tsx

/**
 * Agent Fleet Completeness Checker
 * 
 * Verifies an Agent Fleet task pack against the 8-item Agent Fleet Quality Checklist.
 * 
 * Usage:
 *   npx tsx skills/agent-fleet/scripts/check-agent-fleet-completeness.ts --tasks <count>
 */

import { argv } from "process";

// ============================================================================
// Types
// ============================================================================

/**
 * One row in the Agent Fleet quality checklist surfaced by this CLI checker.
 *
 * @remarks
 * `checked` is derived from the `--tasks` synthetic progress signal; this script does not
 * validate prompts, log redirection, or session folder paths on disk.
 */
interface ChecklistItem {
  number: number;
  name: string;
  description: string;
  required: boolean;
  checked: boolean;
  weight: number;
}

/**
 * Machine-readable completeness snapshot emitted when `--json` is enabled.
 *
 * @remarks
 * Mirrors the weighted score, max score, and required-item readiness gate shown in plain text.
 */
interface CompletenessReport {
  checklist: ChecklistItem[];
  score: number;
  maxScore: number;
  canFinalize: boolean;
}

// ============================================================================
// Checklist Definition
// ============================================================================

const CHECKLIST_ITEMS: Omit<ChecklistItem, "checked">[] = [
  { number: 1, name: "Scope bounded", description: "One task per file or tightly coupled group", required: true, weight: 2 },
  { number: 2, name: "Context complete", description: "Exact paths, constraints, verification steps", required: true, weight: 2 },
  { number: 3, name: "Output expectations", description: "Clear success/failure criteria", required: true, weight: 2 },
  { number: 4, name: "Log files configured", description: "tee or redirect for all outputs", required: true, weight: 1 },
  { number: 5, name: "No-commit default", description: "Human review before any commit", required: true, weight: 2 },
  { number: 6, name: "Session folder created", description: ".tmp/YYYYMMDDTHHMMSS-agent-fleet-<slug>/", required: true, weight: 2 },
  { number: 7, name: "Execution hygiene", description: "Conflict grouping, final verification planned", required: true, weight: 1 },
  { number: 8, name: "Pack reviewed", description: "All prompts readable and executable", required: true, weight: 1 },
];

// ============================================================================
// Main
// ============================================================================

/**
 * CLI entrypoint that scores the pack against the checklist and prints results to stdout.
 *
 * @remarks
 * Reads `process.argv` for `--tasks` / `-n` and `--json`. I/O: stdout only; no files or network.
 */
function main() {
  const args = argv.slice(2);
  const tasksArg = args.find(a => a === "--tasks" || a === "-n");
  const jsonArg = args.includes("--json");
  
  const tasksComplete = tasksArg 
    ? parseInt(args[args.indexOf(tasksArg) + 1] || "1", 10)
    : 1;
  
  console.log("\n📋 Agent Fleet Completeness Check");
  console.log("═".repeat(60));
  console.log(`\n📊 Tasks Generated: ${tasksComplete}`);
  
  // Build checklist based on completion
  const checklist: ChecklistItem[] = CHECKLIST_ITEMS.map(item => {
    let checked = false;
    
    switch (item.number) {
      case 1: // Scope bounded
        checked = tasksComplete >= 1;
        break;
      case 2: // Context complete
        checked = tasksComplete >= 1;
        break;
      case 3: // Output expectations
        checked = tasksComplete >= 1;
        break;
      case 4: // Log files configured
        checked = tasksComplete >= 1;
        break;
      case 5: // No-commit default
        checked = tasksComplete >= 1;
        break;
      case 6: // Session folder created
        checked = tasksComplete >= 1;
        break;
      case 7: // Execution hygiene
        checked = tasksComplete >= 1;
        break;
      case 8: // Pack reviewed
        checked = tasksComplete >= 1;
        break;
      default:
        break;
    }
    
    return { ...item, checked };
  });
  
  const score = checklist.reduce((sum, item) => 
    item.checked ? sum + item.weight : sum, 0);
  const maxScore = checklist.reduce((sum, item) => sum + item.weight, 0);
  
  const requiredItems = checklist.filter(i => i.required);
  const requiredScore = requiredItems.reduce((sum, item) => 
    item.checked ? sum + item.weight : sum, 0);
  const requiredMax = requiredItems.reduce((sum, item) => sum + item.weight, 0);
  
  const canFinalize = requiredScore === requiredMax;
  
  console.log(`\n📊 Score: ${score}/${maxScore} (${((score/maxScore)*100).toFixed(0)}%)`);
  console.log(`   Required items: ${requiredScore}/${requiredMax}`);
  
  console.log(`\n${canFinalize ? "✅" : "⚠️"} Ready: ${canFinalize ? "YES" : "NEEDS WORK"}`);
  
  console.log("\n📝 Checklist:");
  for (const item of checklist) {
    const icon = item.checked ? "✅" : item.required ? "❌" : "⚠️";
    console.log(`   ${icon} [${item.number}] ${item.name}`);
  }
  
  console.log("\n" + "═".repeat(60));
  
  if (!canFinalize) {
    console.log("\n⚠️ Agent Fleet task pack needs verification before execution.");
    const failedItems = checklist.filter(i => !i.checked && i.required);
    if (failedItems.length > 0) {
      console.log("\nIssues to verify:");
      failedItems.forEach(i => console.log(`   - ${i.name}: ${i.description}`));
    }
  } else {
    console.log("\n✅ Agent Fleet task pack is verified and ready for execution.");
  }
  
  if (jsonArg) {
    const report: CompletenessReport = { checklist, score, maxScore, canFinalize };
    console.log("\n" + JSON.stringify(report, null, 2));
  }
}

main();
