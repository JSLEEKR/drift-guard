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
    console.log('Next step: start the MCP server with ' + colorize('drift-guard serve', 'cyan'));
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
  .action((options: { projectRoot: string }) => {
    const projectRoot = path.resolve(options.projectRoot);
    const driftDir = path.join(projectRoot, DRIFT_DIR);

    const sm = new StateManager(projectRoot);
    const promises = sm.loadPromises();

    if (promises.length === 0) {
      console.log(colorize('No promises found. Run drift-guard init first.', 'yellow'));
      process.exit(1);
    }

    const history = new History(driftDir);
    const engine = new RuleEngine();
    const results = engine.runAll(promises, projectRoot, history.getHistory());

    const score = computeScore(results, promises);
    const status = classifyStatus(score);

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

    const scoreHistory = history.getScoreHistory();
    const trend = detectTrend([...scoreHistory, score]);
    const topViolations = topViolationTexts(results, promises);
    const recommendation = generateRecommendation(status, trend, topViolations);
    console.log(`Trend: ${trend}  Recommendation: ${recommendation}`);
    console.log();

    if (status === 'degraded' || status === 'critical') {
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
      console.log(colorize('No promises found. Run drift-guard init first.', 'yellow'));
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

// ── Parse ──────────────────────────────────────────────────────────────────

program.parse(process.argv);
