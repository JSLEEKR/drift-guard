import { describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { checkGlobCount } from '../../../src/engine/checks/glob-count.js';
import type { DriftPromise } from '../../../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLE_PROJECT = join(__dirname, '../../../fixtures/sample-project');

function makePromise(overrides: Partial<DriftPromise> = {}): DriftPromise {
  return {
    id: 'p1',
    source: 'test',
    category: 'quality',
    text: 'Must have at least 1 TypeScript source file',
    check_type: 'glob_count',
    check_config: { pattern: 'src/**/*.ts', min: 1 },
    weight: 1,
    ...overrides,
  };
}

describe('checkGlobCount', () => {
  it('passes when glob matches enough files', () => {
    const result = checkGlobCount(
      makePromise({ check_config: { pattern: 'src/**/*.ts', min: 1 } }),
      SAMPLE_PROJECT,
    );
    expect(result.status).toBe('pass');
    expect(result.detail).toContain('matched');
  });

  it('fails when glob matches fewer files than required', () => {
    const dir = join(tmpdir(), `dg-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    try {
      const result = checkGlobCount(
        makePromise({ check_config: { pattern: 'tests/**/*.test.ts', min: 5 } }),
        dir,
      );
      expect(result.status).toBe('fail');
      expect(result.detail).toContain('expected at least 5');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails with missing config keys', () => {
    const result = checkGlobCount(makePromise({ check_config: { min: 1 } }), SAMPLE_PROJECT);
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('requires');
  });
});
