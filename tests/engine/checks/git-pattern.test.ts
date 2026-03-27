import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { checkGitPattern } from '../../../src/engine/checks/git-pattern.js';
import type { DriftPromise } from '../../../src/types.js';

// Use the drift-guard repo itself (has many commits)
const __dirname = dirname(fileURLToPath(import.meta.url));
const DRIFT_GUARD_ROOT = join(__dirname, '../../../');

function makePromise(overrides: Partial<DriftPromise> = {}): DriftPromise {
  return {
    id: 'p1',
    source: 'test',
    category: 'process',
    text: 'Repository must have at least 1 commit',
    check_type: 'git_pattern',
    check_config: { min_commits: 1 },
    weight: 1,
    ...overrides,
  };
}

describe('checkGitPattern', () => {
  it('passes when commit count meets the minimum', () => {
    const result = checkGitPattern(
      makePromise({ check_config: { min_commits: 1 } }),
      DRIFT_GUARD_ROOT,
    );
    expect(result.status).toBe('pass');
    expect(result.detail).toContain('commit');
  });

  it('fails when commit count is below minimum', () => {
    // Create a minimal git repo with exactly 1 commit
    const dir = join(tmpdir(), `dg-git-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    try {
      execSync('git init', { cwd: dir, stdio: 'pipe' });
      execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });
      execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });
      writeFileSync(join(dir, 'README.md'), '# Test\n');
      execSync('git add .', { cwd: dir, stdio: 'pipe' });
      execSync('git commit -m "init"', { cwd: dir, stdio: 'pipe' });

      const result = checkGitPattern(
        makePromise({ check_config: { min_commits: 20 } }),
        dir,
      );
      expect(result.status).toBe('fail');
      expect(result.detail).toContain('expected at least 20');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails with missing config keys', () => {
    const result = checkGitPattern(makePromise({ check_config: {} }), DRIFT_GUARD_ROOT);
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('requires');
  });
});
