import { describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { checkContentMatch } from '../../../src/engine/checks/content-match.js';
import type { DriftPromise } from '../../../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLE_PROJECT = join(__dirname, '../../../fixtures/sample-project');

function makePromise(overrides: Partial<DriftPromise> = {}): DriftPromise {
  return {
    id: 'p1',
    source: 'test',
    category: 'quality',
    text: 'README must contain required sections',
    check_type: 'content_match',
    check_config: { file: 'README.md', must_contain: ['## Overview'] },
    weight: 1,
    ...overrides,
  };
}

describe('checkContentMatch', () => {
  it('passes when all required terms are present', () => {
    const result = checkContentMatch(
      makePromise({ check_config: { file: 'README.md', must_contain: ['## Overview', '## License'] } }),
      SAMPLE_PROJECT,
    );
    expect(result.status).toBe('pass');
    expect(result.detail).toContain('term(s) found');
  });

  it('fails when a required term is missing', () => {
    const dir = join(tmpdir(), `dg-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    try {
      writeFileSync(join(dir, 'README.md'), '# Title\nSome content.\n');
      const result = checkContentMatch(
        makePromise({ check_config: { file: 'README.md', must_contain: ['for-the-badge', 'Why This Exists'] } }),
        dir,
      );
      expect(result.status).toBe('fail');
      expect(result.detail).toContain('Missing');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails when file is missing', () => {
    const dir = join(tmpdir(), `dg-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    try {
      const result = checkContentMatch(
        makePromise({ check_config: { file: 'README.md', must_contain: ['hello'] } }),
        dir,
      );
      expect(result.status).toBe('fail');
      expect(result.detail).toContain('not found');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails with missing config keys', () => {
    const result = checkContentMatch(makePromise({ check_config: {} }), SAMPLE_PROJECT);
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('requires');
  });
});
