#!/usr/bin/env node

import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import { StateManager } from '../state/state-manager.js';
import { History } from '../state/history.js';
import { RuleEngine } from '../engine/rule-engine.js';
import { startServer } from '../server.js';
import {
  computeScore,
  classifyStatus,
  detectTrend,
  generateRecommendation,
  topViolationTexts,
} from '../scoring.js';
import type { QualityStatus } from '../types.js';

const DRIFT_DIR = '.drift-guard';

const CLAUDE_MD_INSTRUCTIONS = `
## drift-guard (Auto Quality Management)

When drift-guard MCP server is available:
- On session start: call \`drift_guard_init\` with project root
- After creating/modifying files: call \`drift_guard_track\` with changed file paths
- Every 5 tool uses: call \`drift_guard_check\`
- If check returns "degraded": call \`drift_guard_save\` with session summary, then warn user
- On task completion: call \`drift_guard_report\`

When dispatching subagents:
- Include in EVERY subagent prompt: "After completing work, report: files created/modified, test count, any quality concerns"
- After each subagent returns: call \`drift_guard_track\` with files the subagent changed
- After every 3rd subagent completion: call \`drift_guard_check\`
`;

const DEFAULT_CONFIG_YAML = `# drift-guard configuration
thresholds:
  healthy: 80
  warning: 60
  degraded: 40
checkInterval: 3600
promiseSources: []
ignore: []
`;

// ── Color helpers ──────────────────────────────────────────────────────────

function colorize(text: string, color: 'green' | 'yellow' | 'red' | 'cyan' | 'bold' | 'reset'): string {
  const codes: Record<string, string> = {
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    cyan: '\x1b[36m',
    bold: '\x1b[1m',
    reset: '\x1b[0m',
  };
  return `${codes[color]}${text}${codes.reset}`;
}

function statusColor(status: QualityStatus): 'green' | 'yellow' | 'red' {
  switch (status) {
    case 'healthy':
      return 'green';
    case 'warning':
      return 'yellow';
    case 'degraded':
    case 'critical':
      return 'red';
  }
}

// ── CI helpers ───────────────────────────────────────────────────────────

import { shouldFailOn } from './ci-helpers.js';

// ── CLI setup ──────────────────────────────────────────────────────────────

const program = new Command();

program
  .name('drift-guard')
  .description('Automated quality drift detection for AI-assisted development')
  .version('0.1.0');

// ── init ──────────────────────────────────────────────────────────────────

program
  .command('init')
  .description('Setup drift-guard: create .drift-guard/ and inject CLAUDE.md instructions')
  .option('--project-root <path>', 'Project root directory', '.')
  .action((options: { projectRoot: string }) => {
    const projectRoot = path.resolve(options.projectRoot);

    // 1. Init state directory
    const sm = new StateManager(projectRoot);
    sm.init();

    // 2. Write default config.yaml
    const configPath = path.join(projectRoot, DRIFT_DIR, 'config.yaml');
    if (!fs.existsSync(configPath)) {
      fs.writeFileSync(configPath, DEFAULT_CONFIG_YAML, 'utf8');
      console.log(colorize('✓', 'green') + ` Created ${configPath}`);
    } else {
      console.log(colorize('·', 'cyan') + ` Config already exists: ${configPath}`);
    }

    // 3. Inject or create CLAUDE.md
    const claudeMdPath = path.join(projectRoot, 'CLAUDE.md');
    if (fs.existsSync(claudeMdPath)) {
      const existing = fs.readFileSync(claudeMdPath, 'utf8');
      if (existing.includes('drift-guard (Auto Quality Management)')) {
        console.log(colorize('·', 'cyan') + ' CLAUDE.md already contains drift-guard instructions');
      } else {
        fs.appendFileSync(claudeMdPath, CLAUDE_MD_INSTRUCTIONS, 'utf8');
        console.log(colorize('✓', 'green') + ` Appended drift-guard instructions to ${claudeMdPath}`);
      }
    } else {
      fs.writeFileSync(claudeMdPath, CLAUDE_MD_INSTRUCTIONS.trimStart(), 'utf8');
      console.log(colorize('✓', 'green') + ` Created ${claudeMdPath} with drift-guard instructions`);
    }

    console.log('\n' + colorize('drift-guard initialized.', 'bold'));
    console.log('');
    console.log('Next steps:');
    console.log('  1. Add the MCP server to your Claude settings (see README)');
    console.log('  2. Start the server: ' + colorize('npx drift-guard serve', 'cyan'));
    console.log('  3. The AI agent auto-extracts promises from your project files');
    console.log('  4. Run manual checks: ' + colorize('drift-guard check', 'cyan'));
  });

// ── serve ─────────────────────────────────────────────────────────────────

program
  .command('serve')
  .description('Start the drift-guard MCP server (stdio)')
  .action(async () => {
    await startServer();
  });

// ── check ─────────────────────────────────────────────────────────────────

program
  .command('check')
  .description('Manual quality check (Stage 1 rule engine only)')
  .option('--project-root <path>', 'Project root directory', '.')
  .option('--json', 'Output results as JSON (CI-friendly)')
  .option('--fail-on <status>', 'Exit code 1 at this status threshold: warning, degraded, or critical (default: degraded)', '')
  .action((options: { projectRoot: string; json?: boolean; failOn?: string }) => {
    const projectRoot = path.resolve(options.projectRoot);
    const driftDir = path.join(projectRoot, DRIFT_DIR);
    const jsonMode = !!options.json;
    const failOn = options.failOn || '';

    const sm = new StateManager(projectRoot);
    const promises = sm.loadPromises();

    if (promises.length === 0) {
      if (jsonMode) {
        console.log(JSON.stringify({ error: 'No promises found', promises: 0 }));
      } else {
        console.log(colorize('No promises found.', 'yellow'));
        console.log('');
        console.log('To get started:');
        console.log('  1. Run ' + colorize('drift-guard init', 'cyan') + ' to set up the project');
        console.log('  2. Start the MCP server with ' + colorize('drift-guard serve', 'cyan'));
        console.log('  3. The AI agent will extract promises from your CLAUDE.md and config files');
        console.log('  4. Then run ' + colorize('drift-guard check', 'cyan') + ' to verify quality');
        console.log('');
        console.log('For more details, run ' + colorize('drift-guard --help', 'cyan'));
      }
      process.exit(1);
    }

    const history = new History(driftDir);
    const engine = new RuleEngine();
    const results = engine.runAll(promises, projectRoot, history.getHistory());

    const score = computeScore(results, promises);
    const status = classifyStatus(score);
    const scoreHistory = history.getScoreHistory();
    const trend = detectTrend([...scoreHistory, score]);
    const topViolations = topViolationTexts(results, promises);
    const recommendation = generateRecommendation(status, trend, topViolations);

    // JSON output mode for CI pipelines
    if (jsonMode) {
      const output = {
        score,
        status,
        trend,
        recommendation,
        results: results.map((r) => ({
          promiseId: r.promiseId,
          promiseText: r.promiseText,
          status: r.status,
          detail: r.detail,
        })),
        passed: results.filter((r) => r.status === 'pass').length,
        warned: results.filter((r) => r.status === 'warn').length,
        failed: results.filter((r) => r.status === 'fail').length,
        total: results.length,
      };
      console.log(JSON.stringify(output));

      // Determine exit code
      if (shouldFailOn(status, failOn)) {
        process.exit(1);
      }
      return;
    }

    // Print header
    console.log('\n' + colorize('drift-guard Quality Check', 'bold'));
    console.log('─'.repeat(60));

    // Print results table
    const colW = [38, 8];
    const header = `${'Promise'.padEnd(colW[0])} ${'Status'.padEnd(colW[1])}`;
    console.log(colorize(header, 'bold'));
    console.log('─'.repeat(60));

    for (const result of results) {
      const text = result.promiseText.length > colW[0] - 1
        ? result.promiseText.slice(0, colW[0] - 4) + '...'
        : result.promiseText;

      const statusStr = result.status.toUpperCase();
      const statusColored =
        result.status === 'pass'
          ? colorize(statusStr, 'green')
          : result.status === 'warn'
            ? colorize(statusStr, 'yellow')
            : colorize(statusStr, 'red');

      console.log(`${text.padEnd(colW[0])} ${statusColored}`);

      if (result.status !== 'pass') {
        console.log(`  ${colorize('→', 'cyan')} ${result.detail}`);
      }
    }

    console.log('─'.repeat(60));

    const scoreStr = score.toFixed(1);
    const scoreColored = colorize(scoreStr, statusColor(status));
    const statusColored = colorize(status.toUpperCase(), statusColor(status));
    console.log(`Score: ${scoreColored}  Status: ${statusColored}`);

    console.log(`Trend: ${trend}  Recommendation: ${recommendation}`);
    console.log();

    // Determine exit code
    if (shouldFailOn(status, failOn)) {
      process.exit(1);
    } else if (status === 'degraded' || status === 'critical') {
      process.exit(1);
    }
  });

// ── report ────────────────────────────────────────────────────────────────

program
  .command('report')
  .description('Generate quality report from history')
  .option('--project-root <path>', 'Project root directory', '.')
  .action((options: { projectRoot: string }) => {
    const projectRoot = path.resolve(options.projectRoot);
    const driftDir = path.join(projectRoot, DRIFT_DIR);

    const history = new History(driftDir);
    const sm = new StateManager(projectRoot);
    const reports = history.getHistory();

    console.log('\n' + colorize('drift-guard Session Report', 'bold'));
    console.log('─'.repeat(60));

    if (reports.length === 0) {
      console.log(colorize('No checks have been run yet.', 'yellow'));
      console.log('Run ' + colorize('drift-guard check', 'cyan') + ' to start tracking quality.');
      console.log();
      return;
    }

    const promises = sm.loadPromises();
    const startScore = reports[0].score;
    const endScore = reports[reports.length - 1].score;
    const drift = Math.round((endScore - startScore) * 10) / 10;
    const allViolations = reports.flatMap((r) => r.violations);
    const topViolations = topViolationTexts(allViolations, promises);
    const status = classifyStatus(endScore);
    const trend = detectTrend(reports.map((r) => r.score));
    const recommendation = generateRecommendation(status, trend, topViolations);

    const driftStr = drift >= 0 ? `+${drift}` : `${drift}`;
    const driftColor = drift >= 0 ? 'green' : 'red';

    console.log(`Total checks  : ${colorize(String(reports.length), 'cyan')}`);
    console.log(`Start score   : ${colorize(startScore.toFixed(1), 'cyan')}`);
    console.log(`End score     : ${colorize(endScore.toFixed(1), statusColor(status))}`);
    console.log(`Drift         : ${colorize(driftStr, driftColor)}`);
    console.log(`Violations    : ${colorize(String(allViolations.length), allViolations.length > 0 ? 'yellow' : 'green')}`);
    console.log(`Status        : ${colorize(status.toUpperCase(), statusColor(status))}`);
    console.log(`Trend         : ${trend}`);

    if (topViolations.length > 0) {
      console.log('\nTop violations:');
      for (const v of topViolations) {
        console.log(`  ${colorize('•', 'red')} ${v}`);
      }
    }

    console.log('\nRecommendation: ' + recommendation);
    console.log();
  });

// ── promises ──────────────────────────────────────────────────────────────

program
  .command('promises')
  .description('Show extracted promises')
  .option('--project-root <path>', 'Project root directory', '.')
  .action((options: { projectRoot: string }) => {
    const projectRoot = path.resolve(options.projectRoot);

    const sm = new StateManager(projectRoot);
    const promises = sm.loadPromises();

    console.log('\n' + colorize('drift-guard Promises', 'bold'));
    console.log('─'.repeat(80));

    if (promises.length === 0) {
      console.log(colorize('No promises found.', 'yellow'));
      console.log('Run ' + colorize('drift-guard init', 'cyan') + ' and start the MCP server to extract promises.');
      console.log();
      return;
    }

    // Column widths: id(8), category(14), check_type(16), weight(6), text(rest)
    const colW = { id: 8, category: 14, check: 16, weight: 6 };
    const header =
      'ID'.padEnd(colW.id) +
      'Category'.padEnd(colW.category) +
      'Check Type'.padEnd(colW.check) +
      'Wt'.padEnd(colW.weight) +
      'Promise Text';
    console.log(colorize(header, 'bold'));
    console.log('─'.repeat(80));

    for (const p of promises) {
      const maxText = 80 - colW.id - colW.category - colW.check - colW.weight - 1;
      const text =
        p.text.length > maxText ? p.text.slice(0, maxText - 3) + '...' : p.text;

      const idStr = p.id.slice(0, colW.id - 1).padEnd(colW.id);
      const catStr = p.category.padEnd(colW.category);
      const checkStr = p.check_type.padEnd(colW.check);
      const weightStr = String(p.weight).padEnd(colW.weight);

      console.log(`${colorize(idStr, 'cyan')}${catStr}${checkStr}${weightStr}${text}`);
    }

    console.log('─'.repeat(80));
    console.log(`Total: ${colorize(String(promises.length), 'cyan')} promises`);
    console.log();
  });

// ── track-auto ───────────────────────────────────────────────────────────

program
  .command('track-auto')
  .description('Auto-detect and track recently modified files')
  .option('--project-root <path>', 'Project root directory', '.')
  .option('--since <minutes>', 'Track files modified in last N minutes', '30')
  .action(async (options: { projectRoot: string; since: string }) => {
    const projectRoot = path.resolve(options.projectRoot);
    const sinceMinutes = parseInt(options.since, 10);

    if (isNaN(sinceMinutes) || sinceMinutes <= 0) {
      console.error(colorize('Invalid --since value. Must be a positive integer.', 'red'));
      process.exit(1);
    }

    const sm = new StateManager(projectRoot);
    const cutoff = Date.now() - sinceMinutes * 60 * 1000;

    // Try git status first (most reliable for tracked projects)
    const { execSync } = await import('node:child_process');
    let files: string[] = [];
    try {
      const gitOutput = execSync('git diff --name-only HEAD 2>/dev/null || git ls-files --others --modified --exclude-standard', {
        cwd: projectRoot,
        encoding: 'utf8',
        timeout: 10_000,
      });
      files = gitOutput
        .split('\n')
        .map((f) => f.trim())
        .filter((f) => f.length > 0);
    } catch {
      // Fall back to filesystem scan
      files = scanRecentFiles(projectRoot, cutoff);
    }

    // Filter by modification time
    const recentFiles: string[] = [];
    for (const file of files) {
      const fullPath = path.resolve(projectRoot, file);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.mtimeMs >= cutoff && stat.isFile()) {
          recentFiles.push(file);
        }
      } catch {
        // File may have been deleted
      }
    }

    if (recentFiles.length === 0) {
      console.log(colorize('No recently modified files found.', 'yellow'));
      return;
    }

    // Track them
    const entries = recentFiles.map((file) => {
      const fullPath = path.resolve(projectRoot, file);
      const stat = fs.statSync(fullPath);
      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n').length;
      return {
        path: file,
        lines,
        size: stat.size,
        timestamp: new Date().toISOString(),
      };
    });

    sm.init();
    sm.saveTrack(entries);

    console.log(colorize(`Tracked ${recentFiles.length} file(s):`, 'green'));
    for (const file of recentFiles) {
      console.log(`  ${colorize('•', 'cyan')} ${file}`);
    }
  });

function scanRecentFiles(dir: string, cutoff: number, prefix = ''): string[] {
  const results: string[] = [];
  const IGNORE = new Set(['node_modules', '.git', '.drift-guard', 'dist', '__pycache__', '.venv', 'venv']);
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORE.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        results.push(...scanRecentFiles(fullPath, cutoff, relPath));
      } else if (entry.isFile()) {
        try {
          const stat = fs.statSync(fullPath);
          if (stat.mtimeMs >= cutoff) {
            results.push(relPath);
          }
        } catch {
          // skip
        }
      }
    }
  } catch {
    // skip inaccessible directories
  }
  return results;
}

// ── Test file scanner ────────────────────────────────────────────────────

function findTestFiles(dir: string, prefix = ''): string[] {
  const results: string[] = [];
  const IGNORE = new Set(['node_modules', '.git', '.drift-guard', 'dist', '__pycache__', '.venv', 'venv', 'vendor']);
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORE.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        results.push(...findTestFiles(fullPath, relPath));
      } else if (entry.isFile()) {
        if (
          entry.name.endsWith('_test.go') ||
          entry.name.endsWith('_test.py') ||
          entry.name.endsWith('.test.ts') ||
          entry.name.endsWith('.test.js') ||
          entry.name.endsWith('.spec.ts') ||
          entry.name.endsWith('.spec.js')
        ) {
          results.push(relPath);
        }
      }
    }
  } catch {
    // skip inaccessible directories
  }
  return results;
}

// ── quality-gate ─────────────────────────────────────────────────────────

interface QualityCheck {
  name: string;
  check: () => boolean;
}

program
  .command('quality-gate')
  .description('Validate project meets minimum quality standards')
  .option('--project-root <path>', 'Project root directory', '.')
  .option('--json', 'Output results as JSON')
  .action((options: { projectRoot: string; json?: boolean }) => {
    const root = path.resolve(options.projectRoot);
    const jsonMode = !!options.json;

    const checks: QualityCheck[] = [
      {
        name: 'README exists',
        check: () => fs.existsSync(path.join(root, 'README.md')),
      },
      {
        name: 'README 300+ lines',
        check: () => {
          const p = path.join(root, 'README.md');
          if (!fs.existsSync(p)) return false;
          return fs.readFileSync(p, 'utf8').split('\n').length >= 300;
        },
      },
      {
        name: 'CHANGELOG exists',
        check: () => fs.existsSync(path.join(root, 'CHANGELOG.md')),
      },
      {
        name: 'ROUND_LOG exists',
        check: () => fs.existsSync(path.join(root, 'ROUND_LOG.md')),
      },
      {
        name: 'LICENSE exists',
        check: () => fs.existsSync(path.join(root, 'LICENSE')),
      },
      {
        name: 'Tests exist',
        check: () => {
          // Check for tests/ or test/ directory, OR any *_test.go files, OR *_test.py files
          const testDirs = ['tests', 'test', '__tests__', 'spec'];
          const hasDirs = testDirs.some((d) => {
            const dirPath = path.join(root, d);
            return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
          });
          if (hasDirs) return true;
          return findTestFiles(root).length > 0;
        },
      },
      {
        name: 'README has for-the-badge style',
        check: () => {
          const p = path.join(root, 'README.md');
          if (!fs.existsSync(p)) return false;
          return fs.readFileSync(p, 'utf8').includes('for-the-badge');
        },
      },
      {
        name: 'README has Why This Exists section',
        check: () => {
          const p = path.join(root, 'README.md');
          if (!fs.existsSync(p)) return false;
          const content = fs.readFileSync(p, 'utf8').toLowerCase();
          return content.includes('why this exists') || content.includes('why-this-exists');
        },
      },
    ];

    const results = checks.map((c) => {
      let passed = false;
      try {
        passed = c.check();
      } catch {
        passed = false;
      }
      return { name: c.name, passed };
    });

    const passedCount = results.filter((r) => r.passed).length;
    const totalCount = results.length;
    const allPassed = passedCount === totalCount;

    if (jsonMode) {
      console.log(JSON.stringify({ checks: results, passed: passedCount, total: totalCount, allPassed }));
      if (!allPassed) process.exit(1);
      return;
    }

    console.log('\n' + colorize('drift-guard Quality Gate', 'bold'));
    console.log('─'.repeat(50));

    for (const r of results) {
      const icon = r.passed ? colorize('✓', 'green') : colorize('✗', 'red');
      console.log(`  ${icon}  ${r.name}`);
    }

    console.log('─'.repeat(50));
    const scoreStr = `${passedCount}/${totalCount}`;
    const scoreColor = allPassed ? 'green' : passedCount >= totalCount * 0.6 ? 'yellow' : 'red';
    console.log(`Result: ${colorize(scoreStr, scoreColor)} checks passed`);

    if (!allPassed) {
      console.log(colorize('\nQuality gate FAILED.', 'red'));
      process.exit(1);
    } else {
      console.log(colorize('\nQuality gate PASSED.', 'green'));
    }
    console.log();
  });

// ── Unknown command hint ─────────────────────────────────────────────────

program.on('command:*', () => {
  console.error(colorize(`Unknown command: ${program.args.join(' ')}`, 'red'));
  console.log('Run ' + colorize('drift-guard --help', 'cyan') + ' to see available commands.');
  process.exit(1);
});

// ── Parse ──────────────────────────────────────────────────────────────────

program.parse(process.argv);
