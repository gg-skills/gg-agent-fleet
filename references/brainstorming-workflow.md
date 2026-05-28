# Agent Fleet Brainstorming Workflow

> **Use case:** Multi-wave analysis of a codebase system to identify abstraction opportunities
> from multiple perspectives. Each wave produces cross-validated insights from agents
> with different biases.

## When to Use This Workflow

**TRIGGER when:**
- User wants deep analysis of a system (e.g., pipeline core, auth layer, models)
- Goal is to identify reusable abstractions, not make edits
- User wants diverse perspectives through varied agent biases
- Analysis should be saved for later review and synthesis

**SKIP when:**
- User wants immediate code changes (use standard edit route)
- Single-agent analysis is sufficient
- User has specific files already identified

---

## Brainstorming Workflow Phases

### Phase 1: Initial Reconnaissance (Wave 1)

**Purpose:** High-level scan of the entire codebase to identify candidate systems

**Typical size:** 10-20 agents
**Agent bias variety:** Maximum diversity (security, performance, API design, data modeling, testing, documentation, type safety, error handling, scalability, maintainability, modularity, DX, observability, configuration, cross-cutting, business logic, infrastructure, integration, code org, best practices)

**Output:** List of candidate systems ranked by cross-analyst consensus

**Example:** First fleet found `pipeline-core` as highest priority from 6+ analysts

---

### Phase 2: Deep Dive (Wave 2+)

**Purpose:** Thorough analysis of specific systems identified in Phase 1

**Typical size:** 10-20 agents per system
**Agent bias variety:** Focused diversity (5-10 different perspectives on the same system)

**Output:** Detailed abstraction proposals with:
- Current implementation gaps
- Proposed interface/API design
- Package structure
- Migration strategy
- Code evidence

**Example:** Pipeline fleet analyzed Step interface, error handling, LLM adapters, orchestration patterns

---

### Phase 3: Synthesis (Optional Wave N)

**Purpose:** Consolidate findings across waves into actionable recommendations

**Output:**
- Consolidated analysis document
- Priority-ranked abstraction candidates
- Package architecture proposal
- Next steps for implementation

---

## Prompt Template for Brainstorming Agents

Every brainstorming prompt should include:

```markdown
# <System> Analysis: <Bias Name>

You are analyzing `<target>` in the `<package>` repository.
This is an **analysis-only task** — do not make any edits.

## Your Unique Bias: <BIAS-NAME>

Analyze <system> through a <bias> lens:
- <Specific aspects to focus on>
- <Another aspect>
- <Third aspect>

## Context

<Brief description of the system being analyzed>

## Required References

Before analyzing, read:
- `AGENTS.md`
- Package-local `AGENTS.md`
- Relevant domain standards

## Objective

1. **Catalog all <aspect> patterns** in the system
2. **Identify the TOP 3 <aspect> improvements** for abstraction
3. **For #1**, provide a detailed abstraction proposal including:
   - Current gaps
   - Proposed design
   - Interface definitions
   - Migration strategy

## Output Location

Save to: `.tmp/<session>/logs/<ANALYST-ID>-ASSESSMENT.md`

## Expected Output Structure

```markdown
# <ANALYST-ID> — <Title>

## Executive Summary
## <Category> Inventory
## Top 3 Improvements
## Deep Dive: #1 Abstraction Design
## Implementation Recommendations
```

## Analysis Guidelines

Spend thorough time exploring:
1. Use `find` and `grep` to discover patterns
2. Read key implementation files
3. Examine test files for usage patterns
4. Check for existing abstractions
5. Look for duplication and gaps

For your abstraction proposal, be specific about:
- What the package would export
- What it would depend on
- How it would be consumed
- What guarantees it would provide
```

---

## Bias Catalog for Brainstorming

| Bias | Focus Areas |
|------|------------|
| **SECURITY-FIRST** | Auth, validation, secrets, injection, rate limiting |
| **PERFORMANCE-OPTIMIZED** | N+1, caching, async efficiency, memory |
| **API-DESIGN-FOCUSED** | Contracts, consistency, versioning |
| **DATA-MODELING-CENTRIC** | Schemas, relationships, persistence |
| **TESTING-COMPREHENSIVE** | Coverage, mocks, fixtures |
| **DOCUMENTATION-FIRST** | JSDoc, README, examples |
| **TYPE-SAFETY-MAXIMALIST** | `any` elimination, branded types, guards |
| **ERROR-RESILIENT** | Retry, fallbacks, circuit breakers |
| **SCALE-READY** | Stateless design, queues, partitioning |
| **MAINTAINABILITY-DRIVEN** | Duplication, complexity, refactoring |
| **PLUGIN-ARCHITECTURE** | Extension points, hooks, middleware |
| **DX-OPTIMIZED** | CLI, debugging, onboarding |
| **OBSERVABILITY-FIRST** | Tracing, metrics, logging |
| **CONFIG-DRIVEN** | Schema, env, secrets |
| **AOP-MINDED** | Cross-cutting concerns, decorators |
| **DOMAIN-DRIVEN** | Entities, aggregates, DDD |
| **INFRASTRUCTURE-AWARE** | Lifecycle, health, deployment |
| **INTEGRATION-PATTERN** | Adapters, external services |
| **ARCHITECTURE-STRUCTURE** | Layers, modules, boundaries |
| **EVOLUTION-MINDED** | Versioning, migrations, deprecation |

---

## Runner Script Template

```bash
#!/usr/bin/env bash
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

BASE_DIR=".tmp/$(date -u +%Y%m%dT%H%M%SZ)-agent-fleet-<slug>"
LOG_DIR="$BASE_DIR/logs"
SUMMARY_FILE="$LOG_DIR/run-summary.tsv"
mkdir -p "$LOG_DIR"
printf 'task\tarea\tbias\t\texit_code\tlog_file\n' > "$SUMMARY_FILE"

run_task() {
  local task_id="$1"
  local area="$2"
  local bias="$3"
  local prompt_path="$BASE_DIR/prompts/${task_id}.md"
  local log_file="$LOG_DIR/${task_id}.out"

  echo ""
  echo "=============================================="
  echo "LAUNCHING: $task_id ($area / $bias)"
  echo "=============================================="

  agent -p --trust --force --model composer-2 --workspace "$PWD" \
    "$(cat "$prompt_path")" \
    2>&1 | tee "$log_file"
  
  local status=${PIPESTATUS[0]}
  printf '%s\t%s\t%s\t%s\t%s\n' "$task_id" "$area" "$bias" "$status" "$log_file" >> "$SUMMARY_FILE"
  
  [ $status -eq 0 ] && echo "✅ $task_id completed" || echo "❌ $task_id failed"
  return 0
}

# Define tasks: ID|Area|Bias
TASKS=(
  "ANALYST-001|<area>|BIAS-NAME"
  "ANALYST-002|<area>|BIAS-NAME"
  # ... more tasks
)

for task_info in "${TASKS[@]}"; do
  IFS='|' read -r task_id area bias <<< "$task_info"
  run_task "$task_id" "$area" "$bias"
done

echo ""
echo "=============================================="
echo "FLEET COMPLETE"
echo "=============================================="
cat "$SUMMARY_FILE"
```

---

## Consolidation Template

After all agents complete, create a consolidated analysis:

```markdown
# <System> Abstraction Analysis: Fleet Results

**Generated:** <date>
**Fleet:** <N> agents, unique biases
**Target:** <target path>

## Fleet Completion Summary

| Metric | Value |
|--------|-------|
| Total Agents | N |
| Successful | N (100%) |
| Total Runtime | ~X minutes |
| Total Assessment Size | ~XKB |

## Cross-Analyst Priority Matrix

| System | Analysts Recommending | Top Biases |
|--------|---------------------|------------|
| <System 1> | N | <bias1>, <bias2> |
| <System 2> | N | <bias1>, <bias2> |

## Top Abstraction Candidates

### #1 <System Name>

**Recommended by:** N analysts

**Key Findings:**
- <Finding 1>
- <Finding 2>

**Proposed Package:** `@cloom/<package>`

### #2 <System Name>

...

## Unique Insights by Analyst

| Analyst | Bias | Key Unique Finding |
|---------|------|-------------------|
| <ID> | <Bias> | <Finding> |

## Recommended Package Architecture

Based on cross-analyst consensus:

```
@cloom/<package1>/
@cloom/<package2>/
@cloom/<package3>/
```

## Next Steps

1. Deep dive on <highest priority>
2. Quick wins (low effort, high impact)
3. Implementation planning

---

*Generated by N-agent fleet analysis*
```

---

## Key Differences from Standard Agent Fleet

| Aspect | Standard Route (Fix) | Brainstorming Route |
|--------|---------------------|---------------------|
| **Goal** | Fix specific issues | Explore and discover |
| **Output** | Code changes | Assessment documents |
| **Verification** | Lint passes | Insights generated |
| **Agent cooperation** | Avoid conflicts | Encourage diversity |
| **Scope** | Bounded file/task | System-wide exploration |
| **Bias usage** | Single focus | Multiple perspectives |

---

## Tips for Effective Brainstorming

1. **Maximum bias diversity** in Wave 1 for discovery
2. **Focused bias selection** in Wave 2+ for depth
3. **Save all assessments** — they become evidence for decisions
4. **Look for consensus** — systems mentioned by multiple analysts
5. **Note unique findings** — single-agent insights can be gems
6. **Synthesize at the end** — consolidate into actionable recommendations
