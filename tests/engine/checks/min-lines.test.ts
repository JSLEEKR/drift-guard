import { describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { checkMinLines } from '../../../src/engine/checks/min-lines.js';
import type { DriftPromise } from '../../../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLE_PROJECT = join(__dirname, '../../../fixtures/sample-project');

function makePromise(overrides: Partial<DriftPromise> = {}): DriftPromise {
  return {
    id: 'p1',
    source: 'test',
    category: 'quality',
    text: 'README must have at least 50 lines',
    check_type: 'min_lines',
    check_config: { file: 'README.md', min: 50 },
    weight: 1,
    ...overrides,
  };
}

describe('checkMinLines', () => {
  it('passes when file has enough lines', () => {
    // sample-project README.md has 76 lines
    const result = checkMinLines(
      makePromise({ check_config: { file: 'README.md', min: 50 } }),
      SAMPLE_PROJECT,
    );
    expect(result.status).toBe('pass');
    expect(result.detail).toContain('lines');
  });

  it('fails when file has fewer lines than required', () => {
    const dir = join(tmpdir(), `dg-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    try {
      writeFileSync(join(dir, 'README.md'), 'Short file.\nOnly two lines.\n');
      const result = checkMinLines(
        makePromise({ check_config: { file: 'README.md', min: 300 } }),
        dir,
      );
      expect(result.status).toBe('fail');
      expect(result.detail).toContain('expected at least 300');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails when file is missing', () => {
    const dir = join(tmpdir(), `dg-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    try {
      const result = checkMinLines(
        makePromise({ check_config: { file: 'README.md', min: 10 } }),
        dir,
      );
      expect(result.status).toBe('fail');
      expect(result.detail).toContain('not found');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails with missing config keys', () => {
    const result = checkMinLines(makePromise({ check_config: { file: 'README.md' } }), SAMPLE_PROJECT);
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('requires');
  });
});
