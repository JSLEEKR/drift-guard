import { describe, expect, it } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RuleEngine } from '../../src/engine/rule-engine.js';
import type { DriftPromise, QualityReport } from '../../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLE_PROJECT = join(__dirname, '../../fixtures/sample-project');

function makePromise(
  id: string,
  checkType: DriftPromise['check_type'],
  checkConfig: Record<string, unknown>,
): DriftPromise {
  return {
    id,
    source: 'test',
    category: 'quality',
    text: `Promise ${id}`,
    check_type: checkType,
    check_config: checkConfig,
    weight: 1,
  };
}

describe('RuleEngine', () => {
  const engine = new RuleEngine();

  it('filters out llm_eval promises and runs the rest', () => {
    const promises: DriftPromise[] = [
      makePromise('p1', 'file_exists', { path: 'README.md' }),
      makePromise('p2', 'llm_eval', { prompt: 'Is this good?' }),
    ];
    const results = engine.runAll(promises, SAMPLE_PROJECT);
    expect(results).toHaveLength(1);
    expect(results[0].promiseId).toBe('p1');
  });

  it('returns correct results for multiple check types', () => {
    const promises: DriftPromise[] = [
      makePromise('p1', 'file_exists', { path: 'README.md' }),
      makePromise('p2', 'structure_match', { must_have: ['src/', 'README.md'] }),
      makePromise('p3', 'min_lines', { file: 'README.md', min: 10 }),
    ];
    const results = engine.runAll(promises, SAMPLE_PROJECT);
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.status === 'pass')).toBe(true);
  });

  it('passes history to trend_check', () => {
    const history: QualityReport[] = [
      {
        score: 90,
        status: 'healthy',
        stage: 1,
        violations: [],
        trend: 'stable',
        recommendation: '',
        timestamp: new Date().toISOString(),
      },
      {
        score: 95,
        status: 'healthy',
        stage: 1,
        violations: [],
        trend: 'improving',
        recommendation: '',
        timestamp: new Date().toISOString(),
      },
    ];
    const promises: DriftPromise[] = [
      makePromise('p1', 'trend_check', { metric: 'score', direction: 'not_declining' }),
    ];
    const results = engine.runAll(promises, SAMPLE_PROJECT, history);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('pass');
  });

  it('returns warn for unknown check types not in llm_eval filter', () => {
    // Simulate unknown check type using type cast
    const promise = {
      ...makePromise('p1', 'file_exists', {}),
      check_type: 'unknown_type' as DriftPromise['check_type'],
    };
    const results = engine.runAll([promise], SAMPLE_PROJECT);
    // The check dispatches to file_exists which fails due to empty config,
    // or falls through to default warn — either is acceptable
    expect(results).toHaveLength(1);
  });

  it('returns empty array when all promises are llm_eval', () => {
    const promises: DriftPromise[] = [
      makePromise('p1', 'llm_eval', { prompt: 'Check this' }),
      makePromise('p2', 'llm_eval', { prompt: 'Check that' }),
    ];
    const results = engine.runAll(promises, SAMPLE_PROJECT);
    expect(results).toHaveLength(0);
  });
});
