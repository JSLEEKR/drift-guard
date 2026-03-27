import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RuleEngine } from '../../src/engine/rule-engine.js';
import { StateManager } from '../../src/state/state-manager.js';
import { History } from '../../src/state/history.js';
import { computeScore, detectTrend } from '../../src/scoring.js';
import type { DriftPromise, QualityReport, CheckResult } from '../../src/types.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePromise(id: string, checkType: DriftPromise['check_type'] = 'file_exists'): DriftPromise {
  const configs: Record<string, Record<string, unknown>> = {
    file_exists: { path: 'package.json' },
    content_match: { path: 'package.json', pattern: 'drift-guard' },
    min_lines: { path: 'package.json', min: 1 },
    glob_count: { pattern: '*.json', min: 1 },
    structure_match: { paths: ['package.json'] },
    trend_check: { metric: 'score', direction: 'not_declining' },
  };
  return {
    id,
    source: 'perf-test',
    category: 'quality',
    text: `Promise ${id}`,
    check_type: checkType,
    check_config: configs[checkType] ?? configs['file_exists'],
    weight: 1,
  };
}

function makeReport(score: number, index: number): QualityReport {
  return {
    score,
    status: score >= 80 ? 'healthy' : score >= 60 ? 'warning' : score >= 40 ? 'degraded' : 'critical',
    stage: 1,
    violations: [],
    trend: 'stable',
    recommendation: '',
    timestamp: new Date(Date.now() - (500 - index) * 60_000).toISOString(),
  };
}

function makeCheckResult(id: string, status: CheckResult['status'] = 'pass'): CheckResult {
  return {
    promiseId: id,
    promiseText: `Promise ${id}`,
    status,
    detail: 'perf test',
    timestamp: new Date().toISOString(),
  };
}

// ── Performance: Rule Engine with 100 Promises ──────────────────────────────

describe('Performance: Rule Engine with 100 promises', () => {
  const projectRoot = path.resolve('.');

  it('processes 100 file_exists promises under 2 seconds', () => {
    const engine = new RuleEngine();
    const promises = Array.from({ length: 100 }, (_, i) => makePromise(`fe-${i}`, 'file_exists'));

    const start = performance.now();
    const results = engine.runAll(promises, projectRoot);
    const elapsed = performance.now() - start;

    expect(results).toHaveLength(100);
    expect(elapsed).toBeLessThan(2000);
    results.forEach((r) => expect(['pass', 'warn', 'fail']).toContain(r.status));
  });

  it('processes 100 content_match promises under 2 seconds', () => {
    const engine = new RuleEngine();
    const promises = Array.from({ length: 100 }, (_, i) => makePromise(`cm-${i}`, 'content_match'));

    const start = performance.now();
    const results = engine.runAll(promises, projectRoot);
    const elapsed = performance.now() - start;

    expect(results).toHaveLength(100);
    expect(elapsed).toBeLessThan(2000);
  });

  it('processes 100 mixed-type promises under 2 seconds', () => {
    const engine = new RuleEngine();
    const types: DriftPromise['check_type'][] = [
      'file_exists', 'content_match', 'min_lines', 'glob_count', 'structure_match',
    ];
    const promises = Array.from({ length: 100 }, (_, i) =>
      makePromise(`mixed-${i}`, types[i % types.length]),
    );

    const start = performance.now();
    const results = engine.runAll(promises, projectRoot);
    const elapsed = performance.now() - start;

    expect(results).toHaveLength(100);
    expect(elapsed).toBeLessThan(2000);
  });

  it('produces correct pass/fail distribution for 100 promises', () => {
    const engine = new RuleEngine();
    const promises = Array.from({ length: 100 }, (_, i) => makePromise(`dist-${i}`, 'file_exists'));

    const results = engine.runAll(promises, projectRoot);
    const passCount = results.filter((r) => r.status === 'pass').length;
    // package.json exists, so all file_exists checks should pass
    expect(passCount).toBe(100);
  });
});

// ── Performance: Trend Detection with 500 History Entries ───────────────────

describe('Performance: Trend detection with 500 history entries', () => {
  it('detectTrend handles 500 score entries under 50ms', () => {
    const scores = Array.from({ length: 500 }, (_, i) => 70 + Math.sin(i / 10) * 15);

    const start = performance.now();
    const trend = detectTrend(scores);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(50);
    expect(['improving', 'stable', 'declining']).toContain(trend);
  });

  it('computeScore handles 500 results under 50ms', () => {
    const promises = Array.from({ length: 500 }, (_, i) => makePromise(`score-${i}`));
    const results = Array.from({ length: 500 }, (_, i) =>
      makeCheckResult(`score-${i}`, i % 3 === 0 ? 'fail' : 'pass'),
    );

    const start = performance.now();
    const score = computeScore(results, promises);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(50);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(100);
  });

  it('trend_check processes 500-entry history without degradation', () => {
    const engine = new RuleEngine();
    const history = Array.from({ length: 500 }, (_, i) => makeReport(70 + (i % 20), i));
    const promises = [makePromise('trend-big', 'trend_check')];

    const start = performance.now();
    const results = engine.runAll(promises, '.', history);
    const elapsed = performance.now() - start;

    expect(results).toHaveLength(1);
    expect(elapsed).toBeLessThan(200);
  });

  it('handles monotonically increasing 500-entry history correctly', () => {
    const scores = Array.from({ length: 500 }, (_, i) => 50 + i * 0.1);
    const trend = detectTrend(scores);
    expect(trend).toBe('stable'); // 0.1 delta < 2 threshold
  });

  it('handles monotonically decreasing 500-entry history correctly', () => {
    const scores = Array.from({ length: 500 }, (_, i) => 100 - i * 0.01);
    // Last 5: very small deltas
    const trend = detectTrend(scores);
    expect(trend).toBe('stable');
  });

  it('detects declining trend in rapidly dropping 500-entry history', () => {
    // Last 5 scores must show avg delta < -2 for detectTrend to flag declining
    const scores = Array.from({ length: 500 }, (_, i) => 100 - i * 0.05);
    // Override last 5 to show clear decline
    scores[495] = 80;
    scores[496] = 75;
    scores[497] = 70;
    scores[498] = 65;
    scores[499] = 60;
    const trend = detectTrend(scores);
    expect(trend).toBe('declining');
  });
});

// ── Performance: State Manager Rapid Save/Load ──────────────────────────────

describe('Performance: State manager rapid save/load cycles', () => {
  let tmpDir: string;
  let mgr: StateManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-perf-'));
    mgr = new StateManager(tmpDir);
    mgr.init();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('survives 50 rapid save/load promise cycles under 1 second', () => {
    const promises = Array.from({ length: 20 }, (_, i) => makePromise(`rapid-${i}`));

    const start = performance.now();
    for (let cycle = 0; cycle < 50; cycle++) {
      mgr.savePromises(promises);
      const loaded = mgr.loadPromises();
      expect(loaded).toHaveLength(20);
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(1000);
  });

  it('survives 50 rapid config save/load cycles under 1 second', () => {
    const config = {
      thresholds: { healthy: 80, warning: 60, degraded: 40 },
      checkInterval: 3600,
      promiseSources: ['CLAUDE.md'],
      ignore: ['node_modules'],
    };

    const start = performance.now();
    for (let cycle = 0; cycle < 50; cycle++) {
      mgr.saveConfig(config);
      const loaded = mgr.loadConfig();
      expect(loaded.checkInterval).toBe(3600);
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(1000);
  });

  it('handles large promise payload (100 promises) save/load', () => {
    const promises = Array.from({ length: 100 }, (_, i) => makePromise(`big-${i}`));

    const start = performance.now();
    mgr.savePromises(promises);
    const loaded = mgr.loadPromises();
    const elapsed = performance.now() - start;

    expect(loaded).toHaveLength(100);
    expect(elapsed).toBeLessThan(500);
    expect(loaded[0].id).toBe('big-0');
    expect(loaded[99].id).toBe('big-99');
  });
});

// ── Performance: History with Bulk Entries ──────────────────────────────────

describe('Performance: History bulk operations', () => {
  let tmpDir: string;
  let history: History;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-hist-perf-'));
    const driftDir = path.join(tmpDir, '.drift-guard');
    fs.mkdirSync(path.join(driftDir, 'history'), { recursive: true });
    history = new History(driftDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes and reads 100 history entries under 3 seconds', () => {
    const start = performance.now();

    for (let i = 0; i < 100; i++) {
      history.addCheck(makeReport(70 + (i % 30), i));
    }

    const all = history.getHistory();
    const elapsed = performance.now() - start;

    expect(all).toHaveLength(100);
    expect(elapsed).toBeLessThan(3000);
  });

  it('getScoreHistory returns correct length for 100 entries', () => {
    for (let i = 0; i < 100; i++) {
      history.addCheck(makeReport(50 + i * 0.5, i));
    }

    const scores = history.getScoreHistory();
    expect(scores).toHaveLength(100);
    expect(scores[0]).toBeGreaterThanOrEqual(50);
  });

  it('trim handles 100 entries efficiently', () => {
    for (let i = 0; i < 100; i++) {
      history.addCheck(makeReport(80, i));
    }

    const start = performance.now();
    history.trim(10);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(500);
    expect(history.getHistory()).toHaveLength(10);
  });

  it('clear handles 100 entries efficiently', () => {
    for (let i = 0; i < 100; i++) {
      history.addCheck(makeReport(80, i));
    }

    const start = performance.now();
    history.clear();
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(500);
    expect(history.getHistory()).toHaveLength(0);
  });
});
