import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { shouldFailOn } from '../../src/cli/ci-helpers.js';
import { StateManager } from '../../src/state/state-manager.js';
import { RuleEngine } from '../../src/engine/rule-engine.js';
import { History } from '../../src/state/history.js';
import {
  computeScore,
  classifyStatus,
  detectTrend,
  generateRecommendation,
  topViolationTexts,
} from '../../src/scoring.js';
import type { DriftPromise, QualityStatus } from '../../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'drift-guard-ci-'));
}

function makePromise(overrides: Partial<DriftPromise> = {}): DriftPromise {
  return {
    id: 'p-001',
    source: 'test',
    category: 'quality',
    text: 'README.md must exist',
    check_type: 'file_exists',
    check_config: { path: 'README.md' },
    weight: 5,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// shouldFailOn
// ---------------------------------------------------------------------------

describe('shouldFailOn', () => {
  it('returns false when failOn is empty', () => {
    expect(shouldFailOn('critical', '')).toBe(false);
  });

  it('returns false when failOn is an invalid value', () => {
    expect(shouldFailOn('critical', 'banana')).toBe(false);
  });

  it('returns true when status matches failOn exactly', () => {
    expect(shouldFailOn('warning', 'warning')).toBe(true);
  });

  it('returns true when status exceeds failOn threshold', () => {
    expect(shouldFailOn('critical', 'warning')).toBe(true);
    expect(shouldFailOn('degraded', 'warning')).toBe(true);
  });

  it('returns false when status is below failOn threshold', () => {
    expect(shouldFailOn('healthy', 'warning')).toBe(false);
    expect(shouldFailOn('warning', 'degraded')).toBe(false);
  });

  it('healthy failOn triggers on all statuses except none below healthy', () => {
    expect(shouldFailOn('healthy', 'healthy')).toBe(true);
    expect(shouldFailOn('warning', 'healthy')).toBe(true);
    expect(shouldFailOn('degraded', 'healthy')).toBe(true);
    expect(shouldFailOn('critical', 'healthy')).toBe(true);
  });

  it('critical failOn only triggers on critical', () => {
    expect(shouldFailOn('healthy', 'critical')).toBe(false);
    expect(shouldFailOn('warning', 'critical')).toBe(false);
    expect(shouldFailOn('degraded', 'critical')).toBe(false);
    expect(shouldFailOn('critical', 'critical')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// JSON output structure
// ---------------------------------------------------------------------------

describe('CI JSON output structure', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    const sm = new StateManager(tmpDir);
    sm.init();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('produces valid JSON output shape with all expected fields', () => {
    // Setup: create a README.md so file_exists passes
    fs.writeFileSync(path.join(tmpDir, 'README.md'), 'Hello\n'.repeat(10));

    const promises: DriftPromise[] = [
      makePromise({ id: 'p-001', text: 'README.md must exist', check_type: 'file_exists', check_config: { path: 'README.md' } }),
    ];

    const sm = new StateManager(tmpDir);
    sm.savePromises(promises);

    const history = new History(path.join(tmpDir, '.drift-guard'));
    const engine = new RuleEngine();
    const results = engine.runAll(promises, tmpDir, history.getHistory());

    const score = computeScore(results, promises);
    const status = classifyStatus(score);
    const scoreHistory = history.getScoreHistory();
    const trend = detectTrend([...scoreHistory, score]);
    const topViolations = topViolationTexts(results, promises);
    const recommendation = generateRecommendation(status, trend, topViolations);

    // Simulate JSON output construction (mirrors cli/index.ts --json logic)
    const output = {
      score,
      status,
      trend,
      recommendation,
      results: results.map((r) => ({
        promiseId: r.promiseId,
        promiseText: r.promiseText,
        status: r.status,
        detail: r.detail,
      })),
      passed: results.filter((r) => r.status === 'pass').length,
      warned: results.filter((r) => r.status === 'warn').length,
      failed: results.filter((r) => r.status === 'fail').length,
      total: results.length,
    };

    // Verify JSON is parseable
    const json = JSON.stringify(output);
    const parsed = JSON.parse(json);

    expect(parsed).toHaveProperty('score');
    expect(parsed).toHaveProperty('status');
    expect(parsed).toHaveProperty('trend');
    expect(parsed).toHaveProperty('recommendation');
    expect(parsed).toHaveProperty('results');
    expect(parsed).toHaveProperty('passed');
    expect(parsed).toHaveProperty('warned');
    expect(parsed).toHaveProperty('failed');
    expect(parsed).toHaveProperty('total');

    expect(parsed.score).toBe(100);
    expect(parsed.status).toBe('healthy');
    expect(parsed.passed).toBe(1);
    expect(parsed.failed).toBe(0);
    expect(parsed.total).toBe(1);
  });

  it('JSON output includes failure details', () => {
    // No README.md -- file_exists should fail
    const promises: DriftPromise[] = [
      makePromise({ id: 'p-001', text: 'README.md must exist', check_type: 'file_exists', check_config: { path: 'README.md' } }),
      makePromise({ id: 'p-002', text: 'src/ must exist', check_type: 'file_exists', check_config: { path: 'src/' }, weight: 3 }),
    ];

    const sm = new StateManager(tmpDir);
    sm.savePromises(promises);

    const history = new History(path.join(tmpDir, '.drift-guard'));
    const engine = new RuleEngine();
    const results = engine.runAll(promises, tmpDir, history.getHistory());

    const score = computeScore(results, promises);
    const status = classifyStatus(score);

    const output = {
      score,
      status,
      results: results.map((r) => ({
        promiseId: r.promiseId,
        promiseText: r.promiseText,
        status: r.status,
        detail: r.detail,
      })),
      passed: results.filter((r) => r.status === 'pass').length,
      warned: results.filter((r) => r.status === 'warn').length,
      failed: results.filter((r) => r.status === 'fail').length,
      total: results.length,
    };

    expect(output.failed).toBeGreaterThan(0);
    expect(output.score).toBeLessThan(100);
    expect(output.status).not.toBe('healthy');
    expect(output.results.some((r) => r.status === 'fail')).toBe(true);
  });

  it('exit code determination based on failOn flag', () => {
    // Simulate different status + failOn combinations
    const cases: Array<{ status: QualityStatus; failOn: string; expected: boolean }> = [
      { status: 'healthy', failOn: '', expected: false },
      { status: 'healthy', failOn: 'warning', expected: false },
      { status: 'warning', failOn: 'warning', expected: true },
      { status: 'degraded', failOn: 'warning', expected: true },
      { status: 'critical', failOn: 'degraded', expected: true },
      { status: 'warning', failOn: 'degraded', expected: false },
    ];

    for (const { status, failOn, expected } of cases) {
      expect(shouldFailOn(status, failOn)).toBe(expected);
    }
  });
});
