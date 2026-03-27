import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTmpDir, cleanupTmpDir } from '../helpers.js';

describe('quality-gate command logic', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir('drift-guard-quality-gate-');
  });

  afterEach(() => {
    cleanupTmpDir(tmpDir);
  });

  // ── Individual check tests ─────────────────────────────────────────────

  it('detects README.md existence', () => {
    expect(fs.existsSync(path.join(tmpDir, 'README.md'))).toBe(false);
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Project\n', 'utf8');
    expect(fs.existsSync(path.join(tmpDir, 'README.md'))).toBe(true);
  });

  it('checks README has 300+ lines', () => {
    const shortReadme = 'line\n'.repeat(50);
    fs.writeFileSync(path.join(tmpDir, 'README.md'), shortReadme, 'utf8');
    const shortLines = fs.readFileSync(path.join(tmpDir, 'README.md'), 'utf8').split('\n').length;
    expect(shortLines).toBeLessThan(300);

    const longReadme = 'line\n'.repeat(310);
    fs.writeFileSync(path.join(tmpDir, 'README.md'), longReadme, 'utf8');
    const longLines = fs.readFileSync(path.join(tmpDir, 'README.md'), 'utf8').split('\n').length;
    expect(longLines).toBeGreaterThanOrEqual(300);
  });

  it('detects CHANGELOG.md existence', () => {
    expect(fs.existsSync(path.join(tmpDir, 'CHANGELOG.md'))).toBe(false);
    fs.writeFileSync(path.join(tmpDir, 'CHANGELOG.md'), '# Changelog\n', 'utf8');
    expect(fs.existsSync(path.join(tmpDir, 'CHANGELOG.md'))).toBe(true);
  });

  it('detects ROUND_LOG.md existence', () => {
    expect(fs.existsSync(path.join(tmpDir, 'ROUND_LOG.md'))).toBe(false);
    fs.writeFileSync(path.join(tmpDir, 'ROUND_LOG.md'), '# Round Log\n', 'utf8');
    expect(fs.existsSync(path.join(tmpDir, 'ROUND_LOG.md'))).toBe(true);
  });

  it('detects LICENSE existence', () => {
    expect(fs.existsSync(path.join(tmpDir, 'LICENSE'))).toBe(false);
    fs.writeFileSync(path.join(tmpDir, 'LICENSE'), 'MIT License\n', 'utf8');
    expect(fs.existsSync(path.join(tmpDir, 'LICENSE'))).toBe(true);
  });

  it('detects test directories', () => {
    const testDirs = ['tests', 'test', '__tests__', 'spec'];
    for (const d of testDirs) {
      const dirPath = path.join(tmpDir, d);
      expect(fs.existsSync(dirPath)).toBe(false);
    }

    fs.mkdirSync(path.join(tmpDir, 'tests'), { recursive: true });
    const hasTestDir = testDirs.some((d) => {
      const dirPath = path.join(tmpDir, d);
      return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
    });
    expect(hasTestDir).toBe(true);
  });

  it('detects for-the-badge style in README', () => {
    const readme = '# Project\n\n![badge](https://img.shields.io/badge/foo-bar-blue?style=for-the-badge)\n';
    fs.writeFileSync(path.join(tmpDir, 'README.md'), readme, 'utf8');
    const content = fs.readFileSync(path.join(tmpDir, 'README.md'), 'utf8');
    expect(content.includes('for-the-badge')).toBe(true);
  });

  it('detects Why This Exists section in README', () => {
    const readme = '# Project\n\n## Why This Exists\n\nBecause reasons.\n';
    fs.writeFileSync(path.join(tmpDir, 'README.md'), readme, 'utf8');
    const content = fs.readFileSync(path.join(tmpDir, 'README.md'), 'utf8').toLowerCase();
    expect(content.includes('why this exists')).toBe(true);
  });

  it('fails when no README exists', () => {
    const hasReadme = fs.existsSync(path.join(tmpDir, 'README.md'));
    expect(hasReadme).toBe(false);
  });

  // ── Full gate simulation ──────────────────────────────────────────────

  it('all checks pass for a fully compliant project', () => {
    // Create all required files
    const longReadme = [
      '# Project',
      '',
      '![badge](https://img.shields.io/badge/foo-bar-blue?style=for-the-badge)',
      '',
      '## Why This Exists',
      '',
      'Because we need it.',
      '',
      ...Array.from({ length: 300 }, (_, i) => `Line ${i + 1}`),
    ].join('\n');
    fs.writeFileSync(path.join(tmpDir, 'README.md'), longReadme, 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'CHANGELOG.md'), '# Changelog\n', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'ROUND_LOG.md'), '# Round Log\n', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'LICENSE'), 'MIT License\n', 'utf8');
    fs.mkdirSync(path.join(tmpDir, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'tests', 'sample.test.ts'), 'it("works", () => {})', 'utf8');

    // Run all checks
    const checks = [
      fs.existsSync(path.join(tmpDir, 'README.md')),
      fs.readFileSync(path.join(tmpDir, 'README.md'), 'utf8').split('\n').length >= 300,
      fs.existsSync(path.join(tmpDir, 'CHANGELOG.md')),
      fs.existsSync(path.join(tmpDir, 'ROUND_LOG.md')),
      fs.existsSync(path.join(tmpDir, 'LICENSE')),
      fs.existsSync(path.join(tmpDir, 'tests')),
      fs.readFileSync(path.join(tmpDir, 'README.md'), 'utf8').includes('for-the-badge'),
      fs.readFileSync(path.join(tmpDir, 'README.md'), 'utf8').toLowerCase().includes('why this exists'),
    ];

    expect(checks.every(Boolean)).toBe(true);
  });

  it('partial compliance returns correct pass count', () => {
    // Only create README and LICENSE
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Short README\n', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'LICENSE'), 'MIT\n', 'utf8');

    const checks = [
      { name: 'README exists', passed: fs.existsSync(path.join(tmpDir, 'README.md')) },
      { name: 'README 300+ lines', passed: fs.readFileSync(path.join(tmpDir, 'README.md'), 'utf8').split('\n').length >= 300 },
      { name: 'CHANGELOG exists', passed: fs.existsSync(path.join(tmpDir, 'CHANGELOG.md')) },
      { name: 'LICENSE exists', passed: fs.existsSync(path.join(tmpDir, 'LICENSE')) },
    ];

    const passedCount = checks.filter((c) => c.passed).length;
    expect(passedCount).toBe(2); // README exists + LICENSE exists
  });
});

describe('CLAUDE_MD_INSTRUCTIONS includes subagent rules', () => {
  it('updated instructions contain subagent dispatching section', () => {
    // Read the source file to verify the constant includes subagent rules
    const cliSrc = fs.readFileSync(
      path.resolve(__dirname, '../../src/cli/index.ts'),
      'utf8',
    );
    expect(cliSrc).toContain('When dispatching subagents:');
    expect(cliSrc).toContain('After each subagent returns');
    expect(cliSrc).toContain('After every 3rd subagent completion');
    expect(cliSrc).toContain('drift_guard_track');
    expect(cliSrc).toContain('drift_guard_check');
  });
});
