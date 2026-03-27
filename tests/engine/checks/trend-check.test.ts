import { describe, expect, it } from 'vitest';
import { checkTrendCheck } from '../../../src/engine/checks/trend-check.js';
import type { DriftPromise, QualityReport } from '../../../src/types.js';

function makePromise(overrides: Partial<DriftPromise> = {}): DriftPromise {
  return {
    id: 'p1',
    source: 'test',
    category: 'quality',
    text: 'Score must not decline',
    check_type: 'trend_check',
    check_config: { metric: 'score', direction: 'not_declining' },
    weight: 1,
    ...overrides,
  };
}

function makeReport(score: number): QualityReport {
  return {
    score,
    status: 'healthy',
    stage: 1,
    violations: [],
    trend: 'stable',
    recommendation: '',
    timestamp: new Date().toISOString(),
  };
}

describe('checkTrendCheck', () => {
  it('passes when score is not declining', () => {
    const history: QualityReport[] = [makeReport(80), makeReport(85)];
    const result = checkTrendCheck(makePromise(), '/fake', history);
    expect(result.status).toBe('pass');
    expect(result.detail).toContain('not declining');
  });

  it('passes when score stays flat (not_declining)', () => {
    const history: QualityReport[] = [makeReport(80), makeReport(80)];
    const result = checkTrendCheck(makePromise(), '/fake', history);
    expect(result.status).toBe('pass');
  });

  it('fails when score is declining', () => {
    const history: QualityReport[] = [makeReport(90), makeReport(75)];
    const result = checkTrendCheck(makePromise(), '/fake', history);
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('declining');
  });

  it('warns when insufficient history', () => {
    const result = checkTrendCheck(makePromise(), '/fake', [makeReport(80)]);
    expect(result.status).toBe('warn');
    expect(result.detail).toContain('Insufficient');
  });

  it('warns when no history provided', () => {
    const result = checkTrendCheck(makePromise(), '/fake', undefined);
    expect(result.status).toBe('warn');
  });

  it('fails with missing config keys', () => {
    const result = checkTrendCheck(makePromise({ check_config: {} }), '/fake', [makeReport(80), makeReport(90)]);
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('requires');
  });
});
