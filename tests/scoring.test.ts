import { describe, expect, it } from 'vitest';
import {
  classifyStatus,
  computeScore,
  detectTrend,
  generateRecommendation,
} from '../src/scoring.js';
import type { CheckResult, DriftPromise } from '../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePromise(id: string, weight: number): DriftPromise {
  return {
    id,
    source: 'test',
    category: 'quality',
    text: `Promise ${id}`,
    check_type: 'file_exists',
    check_config: {},
    weight,
  };
}

function makeResult(
  promiseId: string,
  promiseText: string,
  status: 'pass' | 'warn' | 'fail',
): CheckResult {
  return {
    promiseId,
    promiseText,
    status,
    detail: '',
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// computeScore
// ---------------------------------------------------------------------------

describe('computeScore', () => {
  it('returns 100 when results array is empty', () => {
    const promises = [makePromise('p1', 1)];
    expect(computeScore([], promises)).toBe(100);
  });

  it('returns 100 when promises array is empty', () => {
    const results = [makeResult('p1', 'Promise p1', 'fail')];
    expect(computeScore(results, [])).toBe(100);
  });

  it('returns 100 when all results are pass', () => {
    const promises = [makePromise('p1', 2), makePromise('p2', 3)];
    const results = [
      makeResult('p1', 'Promise p1', 'pass'),
      makeResult('p2', 'Promise p2', 'pass'),
    ];
    expect(computeScore(results, promises)).toBe(100);
  });

  it('returns 0 when all results are fail', () => {
    const promises = [makePromise('p1', 5), makePromise('p2', 5)];
    const results = [
      makeResult('p1', 'Promise p1', 'fail'),
      makeResult('p2', 'Promise p2', 'fail'),
    ];
    expect(computeScore(results, promises)).toBe(0);
  });

  it('gives warn results half weight in score calculation', () => {
    // p1 weight=4 pass → 4 earned, p2 weight=4 warn → 2 earned = 6/8 = 75
    const promises = [makePromise('p1', 4), makePromise('p2', 4)];
    const results = [
      makeResult('p1', 'Promise p1', 'pass'),
      makeResult('p2', 'Promise p2', 'warn'),
    ];
    expect(computeScore(results, promises)).toBe(75);
  });
});

// ---------------------------------------------------------------------------
// classifyStatus
// ---------------------------------------------------------------------------

describe('classifyStatus', () => {
  it('classifies score >= 80 as healthy (default thresholds)', () => {
    expect(classifyStatus(80)).toBe('healthy');
    expect(classifyStatus(100)).toBe('healthy');
  });

  it('classifies score in [60, 80) as warning (default thresholds)', () => {
    expect(classifyStatus(60)).toBe('warning');
    expect(classifyStatus(79)).toBe('warning');
  });

  it('classifies score in [40, 60) as degraded (default thresholds)', () => {
    expect(classifyStatus(40)).toBe('degraded');
    expect(classifyStatus(59)).toBe('degraded');
  });

  it('classifies score < 40 as critical (default thresholds)', () => {
    expect(classifyStatus(39)).toBe('critical');
    expect(classifyStatus(0)).toBe('critical');
  });

  it('respects custom thresholds', () => {
    const thresholds = { healthy: 90, warning: 70, degraded: 50 };
    expect(classifyStatus(95, thresholds)).toBe('healthy');
    expect(classifyStatus(80, thresholds)).toBe('warning');
    expect(classifyStatus(60, thresholds)).toBe('degraded');
    expect(classifyStatus(40, thresholds)).toBe('critical');
  });
});

// ---------------------------------------------------------------------------
// detectTrend
// ---------------------------------------------------------------------------

describe('detectTrend', () => {
  it('returns stable when fewer than 2 data points', () => {
    expect(detectTrend([])).toBe('stable');
    expect(detectTrend([75])).toBe('stable');
  });

  it('detects improving trend (avg delta > 2)', () => {
    // deltas: 5, 5, 5 → avg 5
    expect(detectTrend([60, 65, 70, 75])).toBe('improving');
  });

  it('detects declining trend (avg delta < -2)', () => {
    // deltas: -5, -5, -5 → avg -5
    expect(detectTrend([80, 75, 70, 65])).toBe('declining');
  });

  it('detects stable trend (avg delta in [-2, 2])', () => {
    // deltas: 1, -1, 1 → avg ~0.33
    expect(detectTrend([70, 71, 70, 71])).toBe('stable');
  });
});

// ---------------------------------------------------------------------------
// generateRecommendation
// ---------------------------------------------------------------------------

describe('generateRecommendation', () => {
  it('includes violation hints and status-appropriate language', () => {
    const rec = generateRecommendation('critical', 'declining', [
      'missing README',
      'no tests',
    ]);
    expect(rec).toContain('critical');
    expect(rec).toContain('missing README');
    expect(rec).toContain('no tests');
  });
});
