import { describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { checkFileExists } from '../../../src/engine/checks/file-exists.js';
import type { DriftPromise } from '../../../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLE_PROJECT = join(__dirname, '../../../fixtures/sample-project');

function makePromise(overrides: Partial<DriftPromise> = {}): DriftPromise {
  return {
    id: 'p1',
    source: 'test',
    category: 'quality',
    text: 'README must exist',
    check_type: 'file_exists',
    check_config: { path: 'README.md' },
    weight: 1,
    ...overrides,
  };
}

describe('checkFileExists', () => {
  it('passes when the file exists (path config)', () => {
    const result = checkFileExists(makePromise({ check_config: { path: 'README.md' } }), SAMPLE_PROJECT);
    expect(result.status).toBe('pass');
    expect(result.detail).toContain('README.md');
  });

  it('fails when the file does not exist', () => {
    const dir = join(tmpdir(), `dg-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    try {
      const result = checkFileExists(makePromise({ check_config: { path: 'MISSING.md' } }), dir);
      expect(result.status).toBe('fail');
      expect(result.detail).toContain('MISSING.md');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes when glob matches files', () => {
    const result = checkFileExists(makePromise({ check_config: { glob: 'src/**/*.ts' } }), SAMPLE_PROJECT);
    expect(result.status).toBe('pass');
    expect(result.detail).toContain('matched');
  });

  it('fails when glob matches no files', () => {
    const dir = join(tmpdir(), `dg-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    try {
      const result = checkFileExists(makePromise({ check_config: { glob: 'docs/specs/*.md' } }), dir);
      expect(result.status).toBe('fail');
      expect(result.detail).toContain('matched no files');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails with invalid config (no path or glob)', () => {
    const result = checkFileExists(makePromise({ check_config: {} }), SAMPLE_PROJECT);
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('requires');
  });
});
