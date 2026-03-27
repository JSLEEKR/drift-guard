import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTmpDir, cleanupTmpDir } from '../helpers.js';

/** Recursive scan for test files (mirrors findTestFiles in CLI) */
function scanForTestFiles(dir: string, prefix = ''): string[] {
  const results: string[] = [];
  const IGNORE = new Set(['node_modules', '.git', '.drift-guard', 'dist', '__pycache__', '.venv', 'venv', 'vendor']);
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORE.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        results.push(...scanForTestFiles(fullPath, relPath));
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
    // skip
  }
  return results;
}

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

  it('detects Go test files (*_test.go) without test directory', () => {
    // No test directory exists
    const testDirs = ['tests', 'test', '__tests__', 'spec'];
    for (const d of testDirs) {
      expect(fs.existsSync(path.join(tmpDir, d))).toBe(false);
    }

    // Create Go test files alongside source
    fs.mkdirSync(path.join(tmpDir, 'pkg', 'handler'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'pkg', 'handler', 'handler.go'), 'package handler\n', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'pkg', 'handler', 'handler_test.go'), 'package handler\n', 'utf8');

    // Scan for test files
    const found = scanForTestFiles(tmpDir);
    expect(found.length).toBeGreaterThan(0);
    expect(found.some((f: string) => f.endsWith('_test.go'))).toBe(true);
  });

  it('detects colocated TS/JS test files (*.test.ts, *.spec.ts) without test directory', () => {
    fs.mkdirSync(path.join(tmpDir, 'src', 'core'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'core', 'engine.ts'), 'export class Engine {}\n', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'src', 'core', 'engine.test.ts'), 'it("works", () => {})\n', 'utf8');

    const found = scanForTestFiles(tmpDir);
    expect(found.length).toBeGreaterThan(0);
    expect(found.some((f: string) => f.endsWith('.test.ts'))).toBe(true);
  });

  it('detects Python test files (*_test.py) without test directory', () => {
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'app.py'), 'print("hi")\n', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'src', 'app_test.py'), 'def test_app(): pass\n', 'utf8');

    const found = scanForTestFiles(tmpDir);
    expect(found.length).toBeGreaterThan(0);
    expect(found.some((f: string) => f.endsWith('_test.py'))).toBe(true);
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
