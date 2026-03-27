<div align="center">

# 🛡️ drift-guard

### Quality guardian for AI coding agents

[![GitHub Stars](https://img.shields.io/github/stars/JSLEEKR/drift-guard?style=for-the-badge&logo=github&color=yellow)](https://github.com/JSLEEKR/drift-guard/stargazers)
[![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](LICENSE)
[![TypeScript](https://img.shields.io/badge/typescript-5.4+-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://typescriptlang.org)
[![Tests](https://img.shields.io/badge/tests-98%20passing-brightgreen?style=for-the-badge)](#)

<br/>

**Detect quality drift before your AI agent ships degraded code**

Promise Extraction + Rule Engine + LLM Evaluation + Context Preservation

[Quick Start](#-quick-start) | [How It Works](#how-it-works) | [MCP Tools](#mcp-tools)

</div>

---

## Why This Exists

AI coding agents silently degrade during long sessions. Context gets compressed, early instructions get forgotten, and quality drops — without anyone noticing. The agent keeps responding confidently, never warning that it has lost track of your design decisions, style guides, or quality standards.

- **Context compression** -- as conversations grow, early instructions vanish. Your architecture decisions, style rules, and process requirements silently disappear
- **Usage exhaustion** -- when API quota runs low, subagents are automatically reduced. Steps get skipped, outputs get shorter, quality drops
- **No warning system** -- the agent doesn't know what it forgot, so it can't warn you. It confidently ships degraded work

drift-guard acts as an independent memory and quality guardian. It extracts your project's "promises" from CLAUDE.md, memory files, and specs — then continuously monitors whether those promises are being kept.

---

## How It Works

drift-guard operates as a three-layer quality pipeline that runs alongside your AI coding agent:

```
                         ┌─────────────────────────────────┐
                         │      Your Project Files         │
                         │  CLAUDE.md, memory/*.md, specs  │
                         └────────────┬────────────────────┘
                                      │
                              ┌───────▼───────┐
                              │   Layer 1:    │
                              │   Promise     │
                              │   Extraction  │
                              │               │
                              │  Reads config │
                              │  files and    │
                              │  asks LLM to  │
                              │  extract      │
                              │  promises     │
                              └───────┬───────┘
                                      │
                              ┌───────▼───────┐
                              │   Layer 2:    │
                              │   Rule        │
                              │   Engine      │
                              │               │
                              │  7 built-in   │
                              │  check types  │
                              │  run locally  │
                              │  (no LLM)     │
                              └───────┬───────┘
                                      │
                              ┌───────▼───────┐
                              │   Layer 3:    │
                              │   LLM         │
                              │   Evaluation  │
                              │               │
                              │  Complex      │
                              │  promises     │
                              │  evaluated    │
                              │  by AI        │
                              └───────┬───────┘
                                      │
                              ┌───────▼───────┐
                              │   Scoring &   │
                              │   Reporting   │
                              │               │
                              │  0-100 score  │
                              │  trend detect │
                              │  actionable   │
                              │  advice       │
                              └───────────────┘
```

### Auto-Operation Flow

When connected as an MCP server, drift-guard operates automatically:

```
Session Start ──► drift_guard_init ──► Extract promises from CLAUDE.md, memory files
       │
       ▼
  File Changes ──► drift_guard_track ──► Snapshot file metadata (lines, size, sections)
       │
       ▼
  Every 5 Tool Uses ──► drift_guard_check
       │                    │
       │              ┌─────▼─────┐
       │              │ Stage 1:  │──► All rules pass, no LLM promises ──► Score directly
       │              │ Rules     │
       │              └─────┬─────┘
       │                    │ Has LLM promises or failures
       │              ┌─────▼─────┐
       │              │ Stage 2:  │──► Returns evaluation prompt
       │              │ LLM Eval  │──► Agent evaluates, calls check again with result
       │              └─────┬─────┘
       │                    │
       │              ┌─────▼─────┐
       │              │ Report    │──► Score + status + trend + recommendation
       │              └───────────┘
       │
       ▼
  Score Degraded ──► drift_guard_save ──► Persist context for next session
       │
       ▼
  Task Complete ──► drift_guard_report ──► Session summary with drift analysis
```

---

## Features

| Feature | Description |
|---------|-------------|
| **Promise Extraction** | Automatically reads CLAUDE.md, memory files, and specs to identify quality promises |
| **7 Rule-Based Checks** | `file_exists`, `min_lines`, `content_match`, `glob_count`, `git_pattern`, `structure_match`, `trend_check` |
| **LLM Evaluation** | Complex promises evaluated by AI when rule checks cannot cover them |
| **Two-Stage Pipeline** | Fast local rules first, AI evaluation only when needed |
| **Weighted Scoring** | Each promise has a weight (1-10) for proportional scoring |
| **Trend Detection** | Tracks score history and detects improving/stable/declining patterns |
| **Context Preservation** | Saves session context to `.drift-guard/context.md` for cross-session memory |
| **CLAUDE.md Injection** | `init` command auto-injects monitoring instructions into CLAUDE.md |
| **MCP Server** | 5 tools accessible via Model Context Protocol (stdio transport) |
| **CLI Interface** | 5 commands for manual inspection and quality checks |
| **Configurable Thresholds** | Customize healthy/warning/degraded/critical boundaries via YAML |
| **Session Reports** | Start/end score, drift delta, top violations, actionable recommendations |

---

## Quick Start

### 1. Install

```bash
npm install drift-guard
```

### 2. Initialize

```bash
npx drift-guard init
```

This creates:
- `.drift-guard/` directory with config and history storage
- `.drift-guard/config.yaml` with default thresholds
- Appends monitoring instructions to `CLAUDE.md` (creates it if needed)

### 3. Add MCP Configuration

Add to your Claude Code MCP settings (`~/.claude/settings.json` or project `.mcp.json`):

```json
{
  "mcpServers": {
    "drift-guard": {
      "command": "npx",
      "args": ["drift-guard", "serve"]
    }
  }
}
```

That's it. drift-guard will now automatically monitor quality during AI-assisted sessions.

---

## MCP Tools

drift-guard exposes 5 tools via the Model Context Protocol:

### `drift_guard_init`

Initialize drift-guard for a project. Collects source files for promise extraction and restores previous session context.

**Input:**
```json
{
  "projectRoot": "/absolute/path/to/project"
}
```

**Output:**
```json
{
  "instruction": "Read these project configuration files and extract all promises...",
  "fileContents": [
    { "path": "CLAUDE.md", "content": "..." },
    { "path": "memory/rules.md", "content": "..." }
  ],
  "restoredContext": "<!-- saved: 2026-03-25T... -->\nPrevious session summary..."
}
```

The agent uses the `instruction` and `fileContents` to extract promises, then saves them via the state manager.

---

### `drift_guard_track`

Track file metadata snapshots. Records path, line count, byte size, and markdown section headers.

**Input:**
```json
{
  "files": ["src/index.ts", "README.md", "docs/api.md"],
  "projectRoot": "/absolute/path/to/project"
}
```

**Output:**
```json
{
  "tracked": 3
}
```

Track entries are saved to `.drift-guard/history/track-{timestamp}.json`.

---

### `drift_guard_check`

Run quality checks against extracted promises. Operates in two stages:

**Stage 1 -- Rule Engine (no `evaluationResult`):**

```json
{
  "workingDir": "/absolute/path/to/project"
}
```

If all rules pass and no `llm_eval` promises exist, returns a score directly:

```json
{
  "score": 95.0,
  "status": "healthy",
  "stage": 1,
  "violations": [],
  "trend": "stable",
  "recommendation": "Quality is healthy. No immediate action required."
}
```

If LLM evaluation is needed, returns an evaluation prompt:

```json
{
  "needsEvaluation": true,
  "evaluationPrompt": "Here are the project promises: ...",
  "stage1Results": [...]
}
```

**Stage 2 -- With AI Evaluation Result:**

```json
{
  "workingDir": "/absolute/path/to/project",
  "evaluationResult": {
    "score": 85,
    "violations": [
      { "promise": "All functions must have JSDoc", "status": "warn" }
    ]
  }
}
```

Returns the final combined report.

---

### `drift_guard_save`

Save a session context summary for future restoration.

**Input:**
```json
{
  "summary": "Working on auth module. Completed JWT middleware. Next: role-based access control.",
  "projectRoot": "/absolute/path/to/project"
}
```

**Output:**
```json
{
  "saved": true,
  "path": "/project/.drift-guard/context.md"
}
```

---

### `drift_guard_report`

Generate a session report from check history.

**Input:**
```json
{
  "workingDir": "/absolute/path/to/project"
}
```

**Output:**
```json
{
  "startScore": 100,
  "endScore": 85.5,
  "drift": -14.5,
  "totalChecks": 8,
  "violations": 3,
  "topViolations": ["README must have 400+ lines", "All exports must have JSDoc"],
  "recommendation": "Quality is healthy but showing a declining trend. Monitor closely."
}
```

---

## CLI Commands

### `drift-guard init`

Set up drift-guard for a project.

```bash
drift-guard init [--project-root <path>]
```

- Creates `.drift-guard/` directory with `config.yaml` and `history/`
- Injects or creates `CLAUDE.md` with auto-monitoring instructions
- Idempotent: safe to run multiple times

### `drift-guard serve`

Start the MCP server (stdio transport).

```bash
drift-guard serve
```

Designed to be launched by Claude Code as an MCP server process. Communicates via stdin/stdout using the MCP protocol.

### `drift-guard check`

Run a manual quality check (Stage 1 rule engine only).

```bash
drift-guard check [--project-root <path>] [--json] [--fail-on <status>]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--project-root <path>` | Project root directory (default: `.`) |
| `--json` | Output results as JSON for CI pipelines |
| `--fail-on <status>` | Exit with code 1 if status meets or exceeds threshold (`warning`, `degraded`, `critical`) |

Outputs a formatted table of promise checks with pass/warn/fail status, score, trend, and recommendation. Exits with code 1 if status is degraded or critical (default), or at the `--fail-on` threshold.

**JSON output shape:**

```json
{
  "score": 85.0,
  "status": "healthy",
  "trend": "stable",
  "recommendation": "Quality is healthy. No immediate action required.",
  "results": [
    {
      "promiseId": "p-001",
      "promiseText": "README.md must exist",
      "status": "pass",
      "detail": "File exists"
    }
  ],
  "passed": 5,
  "warned": 1,
  "failed": 0,
  "total": 6
}
```

### `drift-guard report`

Generate a session report from check history.

```bash
drift-guard report [--project-root <path>]
```

Shows total checks, start/end score, drift delta, violation count, top violations, and recommendation.

### `drift-guard promises`

Display all extracted promises.

```bash
drift-guard promises [--project-root <path>]
```

Shows a formatted table with ID, category, check type, weight, and promise text for each extracted promise.

---

## Promise Types

Promises are the core concept in drift-guard. Each promise represents a quality expectation extracted from your project configuration files.

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Auto-generated (`promise-001`, `promise-002`, ...) |
| `source` | string | Origin file (e.g., `CLAUDE.md`) |
| `category` | enum | `process`, `style`, `architecture`, `quality`, `security` |
| `text` | string | Human-readable description of the promise |
| `check_type` | enum | How to verify this promise (see Check Types below) |
| `check_config` | object | Parameters for the check function |
| `weight` | number | Importance weight (1-10) for scoring |

## Check Types

| Check Type | Config | Description |
|------------|--------|-------------|
| `file_exists` | `{ path: "README.md" }` or `{ glob: "src/**/*.ts" }` | Verify a file or glob pattern exists |
| `min_lines` | `{ file: "README.md", min: 300 }` | Verify a file has at least N lines |
| `content_match` | `{ file: "package.json", must_contain: ["vitest", "typescript"] }` | Verify a file contains required strings |
| `glob_count` | `{ pattern: "tests/**/*.test.ts", min: 10 }` | Verify at least N files match a glob pattern |
| `git_pattern` | `{ min_commits: 5 }` | Verify the git repository has at least N commits |
| `structure_match` | `{ must_have: ["src/", "tests/", "README.md"] }` | Verify required files/directories exist |
| `trend_check` | `{ metric: "score", direction: "not_declining" }` | Verify a metric is not declining over history |
| `llm_eval` | `{}` | Evaluated by AI (Stage 2) for complex/subjective promises |

---

## Scoring

### Score Calculation

Each check result contributes to a weighted score (0-100):

| Result | Weight Contribution |
|--------|-------------------|
| `pass` | Full weight |
| `warn` | Half weight (0.5x) |
| `fail` | Zero weight |

**Formula:** `score = (earnedWeight / totalWeight) * 100`

### Status Thresholds

| Status | Score Range | Meaning |
|--------|-----------|---------|
| `healthy` | >= 80 | All or nearly all promises are being kept |
| `warning` | >= 60 | Some promises are being violated |
| `degraded` | >= 40 | Significant quality drift detected |
| `critical` | < 40 | Severe quality degradation — stop and fix |

### Trend Detection

Uses the last 5 scores to compute an average delta:

| Trend | Condition |
|-------|-----------|
| `improving` | Average delta > +2 |
| `stable` | Average delta between -2 and +2 |
| `declining` | Average delta < -2 |

### Recommendations

drift-guard generates actionable recommendations based on status + trend:

- **Healthy + Improving:** "Keep up the good work."
- **Healthy + Declining:** "Quality is currently healthy but showing a declining trend. Monitor closely."
- **Warning + Declining:** "Quality is in warning and declining -- act now before it degrades further."
- **Degraded + Declining:** "Immediate remediation required."
- **Critical:** "Stop new work and fix violations immediately."

Recommendations include the top 3 violations by weight for focused action.

---

## Configuration

drift-guard stores its configuration in `.drift-guard/config.yaml`:

```yaml
# drift-guard configuration
thresholds:
  healthy: 80    # Score >= 80 is healthy
  warning: 60    # Score >= 60 is warning
  degraded: 40   # Score >= 40 is degraded, below is critical

checkInterval: 3600  # Seconds between automatic checks

promiseSources: []   # Additional source files beyond defaults
  # - "docs/architecture.md"
  # - "docs/style-guide.md"

ignore: []           # Patterns to ignore during checks
  # - "generated/**"
  # - "vendor/**"
```

### Default Source Patterns

When `promiseSources` is empty, drift-guard scans these default locations:

| Pattern | Description |
|---------|-------------|
| `CLAUDE.md` | Project-level Claude instructions |
| `memory/*.md` | Memory files with persistent rules |
| `docs/specs/*.md` | Specification documents |
| `.drift-guard/config.yaml` | drift-guard's own configuration |

---

## Architecture

```
drift-guard/
├── src/
│   ├── index.ts                    # Public API exports
│   ├── server.ts                   # MCP server (5 tool handlers)
│   ├── types.ts                    # TypeScript interfaces & types
│   ├── scoring.ts                  # Score computation, status, trend, recommendations
│   ├── cli/
│   │   └── index.ts                # CLI commands (init, serve, check, report, promises)
│   ├── collector/
│   │   └── promise-collector.ts    # Source file collection & promise parsing
│   ├── engine/
│   │   ├── rule-engine.ts          # Dispatches checks to the correct handler
│   │   ├── llm-evaluator.ts        # Builds LLM evaluation prompts, parses responses
│   │   └── checks/
│   │       ├── file-exists.ts      # file_exists check
│   │       ├── min-lines.ts        # min_lines check
│   │       ├── content-match.ts    # content_match check
│   │       ├── glob-count.ts       # glob_count check
│   │       ├── git-pattern.ts      # git_pattern check
│   │       ├── structure-match.ts  # structure_match check
│   │       └── trend-check.ts      # trend_check check
│   └── state/
│       ├── state-manager.ts        # .drift-guard/ directory, promises.json, config.yaml
│       ├── context-preserver.ts    # context.md save/load for session continuity
│       └── history.ts              # Check history (check-*.json files)
├── tests/
│   ├── scoring.test.ts
│   ├── collector/
│   │   └── promise-collector.test.ts
│   ├── engine/
│   │   ├── rule-engine.test.ts
│   │   ├── llm-evaluator.test.ts
│   │   └── checks/
│   │       ├── file-exists.test.ts
│   │       ├── min-lines.test.ts
│   │       ├── content-match.test.ts
│   │       ├── glob-count.test.ts
│   │       ├── git-pattern.test.ts
│   │       ├── structure-match.test.ts
│   │       └── trend-check.test.ts
│   ├── state/
│   │   ├── state-manager.test.ts
│   │   ├── context-preserver.test.ts
│   │   └── history.test.ts
│   ├── cli/
│   │   └── init-onboarding.test.ts    # CLI init & onboarding tests
│   └── integration/
│       └── full-pipeline.test.ts
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

### Key Design Decisions

- **MCP over HTTP:** Uses stdio transport for zero-config integration with Claude Code — no ports, no auth, no network setup
- **Two-stage evaluation:** Rule engine runs locally for speed; LLM evaluation only triggers when needed (saves tokens and latency)
- **Atomic state writes:** `promises.json` writes use temp-file + rename to prevent corruption during crashes
- **History as files:** Each check result is a separate JSON file, making it easy to inspect, debug, and trim without database dependencies
- **Weighted scoring:** Not all promises are equal — architecture decisions (weight 9) matter more than formatting preferences (weight 2)

---

## Transparent Auto-Operation

When `drift-guard init` runs, it appends the following instructions to your project's `CLAUDE.md`:

```markdown
## drift-guard (Auto Quality Management)

When drift-guard MCP server is available:
- On session start: call `drift_guard_init` with project root
- After creating/modifying files: call `drift_guard_track` with changed file paths
- Every 5 tool uses: call `drift_guard_check`
- If check returns "degraded": call `drift_guard_save` with session summary, then warn user
- On task completion: call `drift_guard_report`
```

This makes drift-guard fully transparent. The AI agent reads these instructions from `CLAUDE.md` and follows them automatically — no manual intervention required.

### Context Preservation

When a session ends (or quality degrades), drift-guard saves a context summary to `.drift-guard/context.md`:

```markdown
<!-- saved: 2026-03-26T10:30:00.000Z -->

Working on authentication module. Completed:
- JWT middleware with RS256 signing
- Rate limiting (100 req/min per IP)

Next steps:
- Role-based access control
- Refresh token rotation

Key decisions:
- Using jose library (not jsonwebtoken) for Edge compatibility
- Tokens stored in httpOnly cookies, not localStorage
```

On the next session, `drift_guard_init` restores this context, ensuring the new agent starts with full awareness of previous work.

---

## Testing

drift-guard has comprehensive test coverage across all modules:

```bash
# Run all tests
npm test

# Run with verbose output
npm run ci

# Run specific test file
npx vitest run tests/scoring.test.ts

# Run tests in watch mode
npx vitest
```

**Test suite:** 98 tests across 16 test files covering:

| Module | Tests | Coverage |
|--------|-------|----------|
| `scoring` | Score computation, status classification, trend detection, recommendations |
| `promise-collector` | Source collection, extraction response parsing, pattern resolution |
| `rule-engine` | Check dispatching, LLM promise filtering |
| `llm-evaluator` | Prompt building, response parsing, error handling |
| `file-exists` | Path-based and glob-based file existence checks |
| `min-lines` | Line count verification with edge cases |
| `content-match` | String presence verification in files |
| `glob-count` | File count verification against glob patterns |
| `git-pattern` | Git commit count verification |
| `structure-match` | Project structure verification |
| `trend-check` | Historical metric trend analysis |
| `state-manager` | Directory init, promises CRUD, config CRUD, track snapshots |
| `context-preserver` | Context save/load/exists with metadata |
| `history` | Check history CRUD, trimming, clearing |
| `init-onboarding` | CLI init, config defaults, CLAUDE.md injection, idempotency, package.json fields |
| `full-pipeline` | End-to-end integration tests |

---

## API Reference

drift-guard exports all core modules for programmatic use:

```typescript
import {
  // Types
  type CheckResult,
  type CheckType,
  type DriftGuardConfig,
  type DriftGuardState,
  type DriftPromise,
  type PromiseExtractionRequest,
  type QualityReport,
  type QualityStatus,
  type SessionReport,
  type TrackEntry,
  type TrendDirection,

  // Scoring
  computeScore,
  classifyStatus,
  detectTrend,
  generateRecommendation,
  topViolationTexts,

  // State
  StateManager,
  ContextPreserver,
  type ContextMetadata,
  History,

  // Engine
  RuleEngine,
  LLMEvaluator,

  // Collector
  PromiseCollector,

  // Individual checks
  checkFileExists,
  checkContentMatch,
  checkMinLines,
  checkGlobCount,
  checkGitPattern,
  checkStructureMatch,
  checkTrendCheck,

  // Server
  createServer,
  startServer,
} from 'drift-guard';
```

### Scoring Functions

```typescript
// Compute weighted score from check results
computeScore(results: CheckResult[], promises: DriftPromise[]): number

// Classify score into status
classifyStatus(score: number, thresholds?: { healthy?: number; warning?: number; degraded?: number }): QualityStatus

// Detect trend from score history
detectTrend(history: number[]): TrendDirection

// Generate human-readable recommendation
generateRecommendation(status: QualityStatus, trend: TrendDirection, topViolations: string[]): string

// Get top N violation texts sorted by weight
topViolationTexts(results: CheckResult[], promises: DriftPromise[], limit?: number): string[]
```

### State Management

```typescript
const sm = new StateManager('/path/to/project');
sm.init();                           // Create .drift-guard/ directory
sm.savePromises(promises);           // Write promises.json (atomic)
sm.loadPromises();                   // Read promises.json
sm.saveConfig(config);               // Write config.yaml
sm.loadConfig();                     // Read config.yaml with defaults
sm.saveTrack(entries);               // Write track snapshot to history
```

### History

```typescript
const history = new History('/path/to/project/.drift-guard');
history.addCheck(report);            // Save a quality report
history.getHistory();                // Load all reports (oldest first)
history.getScoreHistory();           // Load just scores (oldest first)
history.trim(maxEntries);            // Keep only last N entries
history.clear();                     // Delete all history
```

### Context Preservation

```typescript
const cp = new ContextPreserver('/path/to/project/.drift-guard');
cp.save(summary, metadata?);        // Write context.md
cp.load();                           // Read context.md (or null)
cp.exists();                         // Check if context.md exists
```

---

## Future Extensions

### Codex Integration

drift-guard's MCP interface is tool-agnostic. Future versions will support:

- **OpenAI Codex** -- monitor Codex agent sessions for quality drift
- **Cursor** -- integrate with Cursor's AI pair programming to track code quality across edits

### GitHub Actions

drift-guard works in CI today using the CLI. Add this workflow to your repository:

```yaml
# .github/workflows/drift-guard.yml
name: Quality Gate
on: [push, pull_request]

jobs:
  quality-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '18'

      - name: Install drift-guard
        run: npm install -g drift-guard

      - name: Run quality check
        run: drift-guard check --json --fail-on warning
        # Exits with code 1 if status is warning or worse
        # Use --fail-on degraded for a less strict gate

      - name: Upload results (optional)
        if: always()
        run: drift-guard check --json > drift-guard-report.json

      - name: Upload artifact
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: drift-guard-report
          path: drift-guard-report.json
```

**Exit code behavior:**

| `--fail-on` value | Exits 1 when status is... |
|--------------------|--------------------------|
| `warning` | warning, degraded, or critical |
| `degraded` | degraded or critical |
| `critical` | critical only |
| *(not set)* | degraded or critical (default) |

### Planned Features

- **Multi-agent support** -- track quality across parallel agent sessions
- **Dashboard** -- web UI for visualizing quality trends over time
- **Custom check plugins** -- register project-specific check functions
- **Slack/Discord alerts** -- notify when quality drops below threshold
- **Git hook integration** -- block commits when quality is degraded
- **Promise diff** -- detect when CLAUDE.md changes invalidate existing promises

---

## When to Use This

| Scenario | Without drift-guard | With drift-guard |
|----------|-------------------|-----------------|
| **Long coding session (2+ hours)** | Agent silently forgets early instructions, ships inconsistent code | Continuous monitoring catches drift before it compounds |
| **Multi-file refactoring** | Agent loses track of which files need updates, leaves stale code | Promise checks verify all required files exist and meet standards |
| **Team with CLAUDE.md standards** | No way to verify the agent follows team rules | Promises extracted from CLAUDE.md are automatically enforced |
| **Cross-session projects** | Agent starts fresh each session, repeats mistakes | Context preservation carries decisions and progress forward |
| **CI/CD quality gates** | Manual review is the only safety net | `drift-guard check` exits non-zero when quality drops below threshold |
| **Agent switching mid-task** | New agent has zero context about previous work | Saved context restores full awareness of prior decisions |

---

## Example Output

### `drift-guard check`

```
drift-guard Quality Check
────────────────────────────────────────────────────────────────

Promise                                Status
────────────────────────────────────────────────────────────────
README.md must exist                   PASS
README.md must have 300+ lines         WARN
  → File has 247 lines, expected >= 300
All exports must have JSDoc            PASS
Tests directory must exist             PASS
At least 10 test files required        FAIL
  → Found 7 files matching tests/**/*.test.ts, expected >= 10
Git repo must have 5+ commits          PASS
────────────────────────────────────────────────────────────────
Score: 72.5  Status: WARNING
Trend: declining  Recommendation: Quality is in warning and declining — act
now before it degrades further. Focus on: At least 10 test files required,
README.md must have 300+ lines.
```

### `drift-guard report`

```
drift-guard Session Report
────────────────────────────────────────────────────────────────
Total checks  : 5
Start score   : 100.0
End score     : 72.5
Drift         : -27.5
Violations    : 3
Status        : WARNING
Trend         : declining

Top violations:
  • At least 10 test files required
  • README.md must have 300+ lines

Recommendation: Quality is in warning and declining — act now before it
degrades further.
```

---

## Troubleshooting

### "No promises found" error

**Cause:** drift-guard needs promises to be extracted from your project files before it can run checks.

**Fix:**
1. Run `drift-guard init` to set up the project
2. Start the MCP server: `npx drift-guard serve`
3. The AI agent will call `drift_guard_init` and extract promises from your CLAUDE.md and config files
4. Promises are saved to `.drift-guard/promises.json`

You can verify with: `drift-guard promises`

### MCP server won't start

**Cause:** Usually a Node.js version issue or missing build step.

**Fix:**
1. Verify Node.js >= 18: `node --version`
2. Build the project: `npm run build`
3. Try running directly: `npx drift-guard serve`

### Score is always 100

**Cause:** Either no promises are extracted, or all promises are passing.

**Fix:**
1. Check if promises exist: `drift-guard promises`
2. If empty, re-run the init flow via MCP (see "No promises found" above)
3. If promises exist but all pass, your project is in great shape

### Checks don't detect my CLAUDE.md changes

**Cause:** Promises are extracted once and cached in `.drift-guard/promises.json`. Editing CLAUDE.md does not auto-update promises.

**Fix:**
1. Delete `.drift-guard/promises.json`
2. Re-run the MCP init flow so the agent re-extracts promises
3. Or manually edit `.drift-guard/promises.json` to add/update promises

### drift-guard slows down my workflow

**Cause:** The `git_pattern` check spawns a git subprocess, and `llm_eval` requires an AI roundtrip.

**Fix:**
1. Reduce check frequency in `.drift-guard/config.yaml`: set `checkInterval` higher
2. Convert `llm_eval` promises to rule-based checks where possible
3. The rule engine (Stage 1) is fast — only Stage 2 (LLM) adds latency

### How do I reset drift-guard?

Delete the `.drift-guard/` directory to start fresh:

```bash
rm -rf .drift-guard
drift-guard init
```

This clears all history, promises, config, and saved context.

---

## FAQ

**Q: Does drift-guard send my code to an external server?**
A: No. drift-guard runs entirely locally. The MCP server uses stdio transport (stdin/stdout) — no network calls. The only external call happens when the AI agent evaluates `llm_eval` promises, and that uses whatever LLM the agent is already connected to.

**Q: Can I use drift-guard without Claude Code?**
A: Yes. The CLI commands (`init`, `check`, `report`, `promises`) work standalone. The MCP server integration adds automatic monitoring, but manual checks work without it.

**Q: How do I add custom promises?**
A: Edit `.drift-guard/promises.json` directly. Each promise needs an `id`, `source`, `category`, `text`, `check_type`, `check_config`, and `weight`. See the [Promise Types](#promise-types) section for the full schema.

**Q: What happens if .drift-guard/ is committed to git?**
A: It is safe to commit. The config and promises are portable. History files are small JSON snapshots. Add `.drift-guard/context.md` to `.gitignore` if you don't want session context shared across developers.

**Q: Can I run drift-guard in CI?**
A: Yes. Use `drift-guard check` in your CI pipeline. It exits with code 1 when quality is `degraded` or `critical`, making it suitable as a quality gate.

---

## Requirements

- Node.js >= 18.0.0
- TypeScript >= 5.4
- Git (for `git_pattern` checks)

---

## License

[MIT](LICENSE) -- JSLEEKR 2026
