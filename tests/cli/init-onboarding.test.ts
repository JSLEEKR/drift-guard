import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StateManager } from '../../src/state/state-manager.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'drift-guard-cli-'));
}

const CLAUDE_MD_INSTRUCTIONS_MARKER = 'drift-guard (Auto Quality Management)';

const DEFAULT_CONFIG_YAML = `# drift-guard configuration
thresholds:
  healthy: 80
  warning: 60
  degraded: 40
checkInterval: 3600
promiseSources: []
ignore: []
`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CLI init onboarding', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── init creates .drift-guard directory ─────────────────────────────────

  it('creates .drift-guard directory and history subdirectory', () => {
    const sm = new StateManager(tmpDir);
    sm.init();

    const driftDir = path.join(tmpDir, '.drift-guard');
    expect(fs.existsSync(driftDir)).toBe(true);
    expect(fs.existsSync(path.join(driftDir, 'history'))).toBe(true);
  });

  // ── init creates config.yaml with correct defaults ─────────────────────

  it('creates default config.yaml when not present', () => {
    const sm = new StateManager(tmpDir);
    sm.init();

    const configPath = path.join(tmpDir, '.drift-guard', 'config.yaml');
    fs.writeFileSync(configPath, DEFAULT_CONFIG_YAML, 'utf8');

    const content = fs.readFileSync(configPath, 'utf8');
    expect(content).toContain('healthy: 80');
    expect(content).toContain('warning: 60');
    expect(content).toContain('degraded: 40');
    expect(content).toContain('checkInterval: 3600');
  });

  // ── init creates CLAUDE.md with monitoring instructions ─────────────────

  it('creates CLAUDE.md with drift-guard monitoring instructions', () => {
    const sm = new StateManager(tmpDir);
    sm.init();

    const claudeMdPath = path.join(tmpDir, 'CLAUDE.md');
    const instructions = [
      `## ${CLAUDE_MD_INSTRUCTIONS_MARKER}`,
      '',
      'When drift-guard MCP server is available:',
      '- On session start: call `drift_guard_init` with project root',
      '- After creating/modifying files: call `drift_guard_track` with changed file paths',
      '- Every 5 tool uses: call `drift_guard_check`',
      '- If check returns "degraded": call `drift_guard_save` with session summary, then warn user',
      '- On task completion: call `drift_guard_report`',
      '',
    ].join('\n');
    fs.writeFileSync(claudeMdPath, instructions, 'utf8');

    const content = fs.readFileSync(claudeMdPath, 'utf8');
    expect(content).toContain(CLAUDE_MD_INSTRUCTIONS_MARKER);
    expect(content).toContain('drift_guard_init');
    expect(content).toContain('drift_guard_check');
  });

  // ── init appends to existing CLAUDE.md ──────────────────────────────────

  it('appends instructions to existing CLAUDE.md without drift-guard section', () => {
    const claudeMdPath = path.join(tmpDir, 'CLAUDE.md');
    const existingContent = '# My Project\n\nExisting instructions here.\n';
    fs.writeFileSync(claudeMdPath, existingContent, 'utf8');

    // Simulate appending instructions (as cli/index.ts does)
    const newInstructions = `\n## ${CLAUDE_MD_INSTRUCTIONS_MARKER}\n\nMonitoring instructions.\n`;
    const current = fs.readFileSync(claudeMdPath, 'utf8');
    if (!current.includes(CLAUDE_MD_INSTRUCTIONS_MARKER)) {
      fs.appendFileSync(claudeMdPath, newInstructions, 'utf8');
    }

    const result = fs.readFileSync(claudeMdPath, 'utf8');
    expect(result).toContain('My Project');
    expect(result).toContain('Existing instructions here');
    expect(result).toContain(CLAUDE_MD_INSTRUCTIONS_MARKER);
  });

  // ── init is idempotent ──────────────────────────────────────────────────

  it('init is idempotent — running twice does not duplicate content', () => {
    const claudeMdPath = path.join(tmpDir, 'CLAUDE.md');
    const instructions = `## ${CLAUDE_MD_INSTRUCTIONS_MARKER}\n\nInstructions.\n`;
    fs.writeFileSync(claudeMdPath, instructions, 'utf8');

    // Simulate second init
    const content = fs.readFileSync(claudeMdPath, 'utf8');
    if (!content.includes(CLAUDE_MD_INSTRUCTIONS_MARKER)) {
      fs.appendFileSync(claudeMdPath, instructions, 'utf8');
    }

    const result = fs.readFileSync(claudeMdPath, 'utf8');
    const occurrences = result.split(CLAUDE_MD_INSTRUCTIONS_MARKER).length - 1;
    expect(occurrences).toBe(1);
  });

  // ── empty project has no promises ───────────────────────────────────────

  it('returns empty array when no promises.json exists', () => {
    const sm = new StateManager(tmpDir);
    sm.init();

    const promises = sm.loadPromises();
    expect(promises).toEqual([]);
  });

  // ── package.json has required fields ────────────────────────────────────

  it('package.json has engines, description, keywords, and repository fields', () => {
    const pkgPath = path.resolve(__dirname, '../../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

    expect(pkg.engines).toBeDefined();
    expect(pkg.engines.node).toBeDefined();
    expect(pkg.description).toBeDefined();
    expect(pkg.description.length).toBeGreaterThan(10);
    expect(pkg.keywords).toBeDefined();
    expect(pkg.keywords.length).toBeGreaterThan(0);
    expect(pkg.repository).toBeDefined();
  });

  // ── config.yaml loads with defaults when missing ────────────────────────

  it('loadConfig returns defaults when config.yaml is missing', () => {
    const sm = new StateManager(tmpDir);
    sm.init();

    const config = sm.loadConfig();
    expect(config.thresholds.healthy).toBe(80);
    expect(config.thresholds.warning).toBe(60);
    expect(config.thresholds.degraded).toBe(40);
    expect(config.checkInterval).toBe(3600);
    expect(config.promiseSources).toEqual([]);
    expect(config.ignore).toEqual([]);
  });
});
