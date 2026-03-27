# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2026-03-26

### Added

- **Promise Extraction** -- `PromiseCollector` reads CLAUDE.md, memory files, and specs to identify quality promises via LLM extraction
- **Rule Engine** with 7 built-in check types:
  - `file_exists` -- verify files or glob patterns exist
  - `min_lines` -- verify minimum line counts
  - `content_match` -- verify required strings in files
  - `glob_count` -- verify minimum file counts matching patterns
  - `git_pattern` -- verify git commit counts
  - `structure_match` -- verify required project structure
  - `trend_check` -- verify metrics are not declining over history
- **LLM Evaluation** -- two-stage pipeline: fast local rules first, AI evaluation only when needed
- **Scoring System** -- weighted score computation (0-100) with configurable thresholds (healthy/warning/degraded/critical)
- **Trend Detection** -- analyzes last 5 scores to detect improving/stable/declining patterns
- **Context Preservation** -- saves and restores session context via `.drift-guard/context.md`
- **Check History** -- persists quality reports as timestamped JSON files with trim and clear operations
- **MCP Server** with 5 tools:
  - `drift_guard_init` -- initialize project and collect promise sources
  - `drift_guard_track` -- track file metadata snapshots
  - `drift_guard_check` -- run quality checks (Stage 1 rules + Stage 2 LLM)
  - `drift_guard_save` -- save session context for future restoration
  - `drift_guard_report` -- generate session quality report
- **CLI** with 5 commands:
  - `drift-guard init` -- set up .drift-guard/ and inject CLAUDE.md instructions
  - `drift-guard serve` -- start MCP server (stdio transport)
  - `drift-guard check` -- manual quality check with formatted output
  - `drift-guard report` -- session report with drift analysis
  - `drift-guard promises` -- display extracted promises table
- **CLAUDE.md Auto-Injection** -- `init` command appends transparent monitoring instructions
- **Configurable** via `.drift-guard/config.yaml` (thresholds, check interval, promise sources, ignore patterns)
- **Full TypeScript** with strict mode, ES2022 target, NodeNext modules
- **90 tests** across 15 test files covering all modules and integration scenarios
