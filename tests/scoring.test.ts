import { describe, expect, it } from 'vitest';
import {
  classifyStatus,
  computeScore,
  detectTrend,
  generateRecommendation,
  topViolationTexts,
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

  it('uses fallback weight of 1 for results with unknown promiseId', () => {
    const promises = [makePromise('p1', 10)];
    // 'unknown-id' not in promises → fallback weight=1, fail → 0 earned
    // 'p1' weight=10, pass → 10 earned
    // total=11, earned=10, score=10/11*100 ≈ 90.9
    const results = [
      makeResult('p1', 'Promise p1', 'pass'),
      makeResult('unknown-id', 'Unknown', 'fail'),
    ];
    expect(computeScore(results, promises)).toBe(90.9);
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

  it('healthy + improving branch', () => {
    const rec = generateRecommendation('healthy', 'improving', []);
    expect(rec).toContain('healthy');
    expect(rec).toContain('improving');
  });

  it('healthy + declining branch', () => {
    const rec = generateRecommendation('healthy', 'declining', []);
    expect(rec).toContain('healthy');
    expect(rec).toContain('declining');
  });

  it('healthy + stable branch', () => {
    const rec = generateRecommendation('healthy', 'stable', []);
    expect(rec).toContain('healthy');
    expect(rec).toContain('No immediate action');
  });

  it('warning + declining branch', () => {
    const rec = generateRecommendation('warning', 'declining', []);
    expect(rec).toContain('warning');
    expect(rec).toContain('declining');
  });

  it('warning + improving branch', () => {
    const rec = generateRecommendation('warning', 'improving', []);
    expect(rec).toContain('warning');
    expect(rec).toContain('improving');
  });

  it('warning + stable branch', () => {
    const rec = generateRecommendation('warning', 'stable', []);
    expect(rec).toContain('warning');
    expect(rec).toContain('Address violations');
  });

  it('degraded + declining branch', () => {
    const rec = generateRecommendation('degraded', 'declining', []);
    expect(rec).toContain('degraded');
    expect(rec).toContain('declining');
    expect(rec).toContain('Immediate');
  });

  it('degraded + stable branch', () => {
    const rec = generateRecommendation('degraded', 'stable', []);
    expect(rec).toContain('degraded');
    expect(rec).toContain('urgently');
  });

  it('truncates violations to at most 3 in the hint', () => {
    const rec = generateRecommendation('critical', 'declining', [
      'v1', 'v2', 'v3', 'v4', 'v5',
    ]);
    expect(rec).toContain('v1');
    expect(rec).toContain('v2');
    expect(rec).toContain('v3');
    expect(rec).not.toContain('v4');
  });
});

// ---------------------------------------------------------------------------
// topViolationTexts
// ---------------------------------------------------------------------------

describe('topViolationTexts', () => {
  it('returns top violations sorted by weight (highest first)', () => {
    const promises = [makePromise('p1', 2), makePromise('p2', 8), makePromise('p3', 5)];
    const results = [
      makeResult('p1', 'Low weight fail', 'fail'),
      makeResult('p2', 'High weight warn', 'warn'),
      makeResult('p3', 'Mid weight fail', 'fail'),
    ];
    const top = topViolationTexts(results, promises, 2);
    expect(top).toHaveLength(2);
    expect(top[0]).toBe('High weight warn');
    expect(top[1]).toBe('Mid weight fail');
  });

  it('excludes passing results', () => {
    const promises = [makePromise('p1', 10), makePromise('p2', 5)];
    const results = [
      makeResult('p1', 'Passing promise', 'pass'),
      makeResult('p2', 'Failing promise', 'fail'),
    ];
    const top = topViolationTexts(results, promises);
    expect(top).toHaveLength(1);
    expect(top[0]).toBe('Failing promise');
  });

  it('returns empty array when no violations exist', () => {
    const promises = [makePromise('p1', 5)];
    const results = [makeResult('p1', 'OK', 'pass')];
    expect(topViolationTexts(results, promises)).toEqual([]);
  });

  it('defaults to limit of 3', () => {
    const promises = [
      makePromise('p1', 1), makePromise('p2', 2),
      makePromise('p3', 3), makePromise('p4', 4),
    ];
    const results = [
      makeResult('p1', 'V1', 'fail'),
      makeResult('p2', 'V2', 'fail'),
      makeResult('p3', 'V3', 'fail'),
      makeResult('p4', 'V4', 'fail'),
    ];
    expect(topViolationTexts(results, promises)).toHaveLength(3);
  });
});
