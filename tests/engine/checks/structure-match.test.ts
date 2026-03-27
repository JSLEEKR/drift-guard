import { describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { checkStructureMatch } from '../../../src/engine/checks/structure-match.js';
import type { DriftPromise } from '../../../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLE_PROJECT = join(__dirname, '../../../fixtures/sample-project');

function makePromise(overrides: Partial<DriftPromise> = {}): DriftPromise {
  return {
    id: 'p1',
    source: 'test',
    category: 'architecture',
    text: 'Project must have required structure',
    check_type: 'structure_match',
    check_config: { must_have: ['src/', 'README.md'] },
    weight: 1,
    ...overrides,
  };
}

describe('checkStructureMatch', () => {
  it('passes when all required paths exist', () => {
    const result = checkStructureMatch(
      makePromise({ check_config: { must_have: ['src/', 'README.md'] } }),
      SAMPLE_PROJECT,
    );
    expect(result.status).toBe('pass');
    expect(result.detail).toContain('exist');
  });

  it('fails when required paths are missing', () => {
    const dir = join(tmpdir(), `dg-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    try {
      const result = checkStructureMatch(
        makePromise({ check_config: { must_have: ['src/', 'tests/', 'README.md'] } }),
        dir,
      );
      expect(result.status).toBe('fail');
      expect(result.detail).toContain('Missing');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails with missing config keys', () => {
    const result = checkStructureMatch(makePromise({ check_config: {} }), SAMPLE_PROJECT);
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('requires');
  });
});
