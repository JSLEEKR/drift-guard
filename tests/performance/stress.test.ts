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
    source: 'stress-test',
    category: 'quality',
    text: `Promise ${id}`,
    check_type: checkType,
    check_config: configs[checkType] ?? configs['file_exists'],
    weight: 1 + Math.floor(Math.random() * 10),
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
    timestamp: new Date(Date.now() - (1000 - index) * 60_000).toISOString(),
  };
}

function makeCheckResult(id: string, status: CheckResult['status'] = 'pass'): CheckResult {
  return {
    promiseId: id,
    promiseText: `Promise ${id}`,
    status,
    detail: 'stress test',
    timestamp: new Date().toISOString(),
  };
}

// ── Stress Test: 200 Mixed Promises — Rule Engine ────────────────────────────

describe('Stress: Rule engine with 200 mixed promises', () => {
  const projectRoot = path.resolve('.');

  it('processes 200 mixed-type promises under 3 seconds', () => {
    const engine = new RuleEngine();
    const types: DriftPromise['check_type'][] = [
      'file_exists', 'content_match', 'min_lines', 'glob_count', 'structure_match',
    ];
    const promises = Array.from({ length: 200 }, (_, i) =>
      makePromise(`stress-${i}`, types[i % types.length]),
    );

    const start = performance.now();
    const results = engine.runAll(promises, projectRoot);
    const elapsed = performance.now() - start;

    expect(results).toHaveLength(200);
    expect(elapsed).toBeLessThan(3000);
    results.forEach((r) => expect(['pass', 'warn', 'fail']).toContain(r.status));
  });

  it('produces deterministic results across repeated runs', () => {
    const engine = new RuleEngine();
    const types: DriftPromise['check_type'][] = [
      'file_exists', 'content_match', 'min_lines', 'glob_count', 'structure_match',
    ];
    const promises = Array.from({ length: 200 }, (_, i) =>
      makePromise(`det-${i}`, types[i % types.length]),
    );

    const run1 = engine.runAll(promises, projectRoot);
    const run2 = engine.runAll(promises, projectRoot);

    expect(run1).toHaveLength(run2.length);
    for (let i = 0; i < run1.length; i++) {
      expect(run1[i].promiseId).toBe(run2[i].promiseId);
      expect(run1[i].status).toBe(run2[i].status);
    }
  });

  it('scoring handles 200 weighted results correctly', () => {
    const promises = Array.from({ length: 200 }, (_, i) => makePromise(`score-${i}`));
    const results = Array.from({ length: 200 }, (_, i) => {
      const statuses: CheckResult['status'][] = ['pass', 'warn', 'fail'];
      return makeCheckResult(`score-${i}`, statuses[i % 3]);
    });

    const start = performance.now();
    const score = computeScore(results, promises);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(50);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(100);
  });
});

// ── Stress Test: 1000 History Entries — Trend Detection + Trim ───────────────

describe('Stress: 1000 history entries — trend detection + trim', () => {
  let tmpDir: string;
  let history: History;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-stress-hist-'));
    const driftDir = path.join(tmpDir, '.drift-guard');
    fs.mkdirSync(path.join(driftDir, 'history'), { recursive: true });
    history = new History(driftDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes 1000 history entries without error', () => {
    const start = performance.now();

    for (let i = 0; i < 1000; i++) {
      history.addCheck(makeReport(50 + (i % 50), i));
    }

    const elapsed = performance.now() - start;
    const all = history.getHistory();

    expect(all).toHaveLength(1000);
    // Allow generous time for 1000 file writes on Windows
    expect(elapsed).toBeLessThan(30000);
  });

  it('getScoreHistory returns correct 1000-entry array', () => {
    for (let i = 0; i < 1000; i++) {
      history.addCheck(makeReport(60 + (i % 40), i));
    }

    const scores = history.getScoreHistory();
    expect(scores).toHaveLength(1000);
    scores.forEach((s) => {
      expect(s).toBeGreaterThanOrEqual(60);
      expect(s).toBeLessThanOrEqual(99);
    });
  });

  it('detectTrend handles 1000 score entries under 10ms', () => {
    const scores = Array.from({ length: 1000 }, (_, i) => 50 + Math.sin(i / 20) * 30);

    const start = performance.now();
    const trend = detectTrend(scores);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(10);
    expect(['improving', 'stable', 'declining']).toContain(trend);
  });

  it('trim from 1000 to 50 entries is stable', () => {
    for (let i = 0; i < 1000; i++) {
      history.addCheck(makeReport(70, i));
    }

    const start = performance.now();
    history.trim(50);
    const elapsed = performance.now() - start;

    const remaining = history.getHistory();
    expect(remaining).toHaveLength(50);
    // Trim should be fast even with 950 file deletions
    expect(elapsed).toBeLessThan(15000);
  });

  it('clear on 1000 entries completes without corruption', () => {
    for (let i = 0; i < 1000; i++) {
      history.addCheck(makeReport(80, i));
    }

    history.clear();
    const afterClear = history.getHistory();
    expect(afterClear).toHaveLength(0);

    // Can write again after clear
    history.addCheck(makeReport(90, 0));
    expect(history.getHistory()).toHaveLength(1);
  });

  it('trend_check with 1000-entry history array completes under 500ms', () => {
    const engine = new RuleEngine();
    const historyArr = Array.from({ length: 1000 }, (_, i) => makeReport(70 + (i % 20), i));
    const promises = [makePromise('trend-1k', 'trend_check')];

    const start = performance.now();
    const results = engine.runAll(promises, '.', historyArr);
    const elapsed = performance.now() - start;

    expect(results).toHaveLength(1);
    expect(elapsed).toBeLessThan(500);
  });
});

// ── Stress Test: Rapid Init/Check/Save Cycles — No File Corruption ──────────

describe('Stress: rapid init/check/save cycles — file integrity', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-stress-cycle-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('100 init/save/load promise cycles produce no corruption', () => {
    const mgr = new StateManager(tmpDir);
    mgr.init();

    const promises = Array.from({ length: 50 }, (_, i) => makePromise(`cycle-${i}`));

    const start = performance.now();
    for (let cycle = 0; cycle < 100; cycle++) {
      mgr.savePromises(promises);
      const loaded = mgr.loadPromises();
      expect(loaded).toHaveLength(50);
      expect(loaded[0].id).toBe('cycle-0');
      expect(loaded[49].id).toBe('cycle-49');
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(5000);
  });

  it('interleaved config and promise saves do not corrupt each other', () => {
    const mgr = new StateManager(tmpDir);
    mgr.init();

    const promises = Array.from({ length: 30 }, (_, i) => makePromise(`interleave-${i}`));
    const config = {
      thresholds: { healthy: 85, warning: 65, degraded: 45 },
      checkInterval: 1800,
      promiseSources: ['CLAUDE.md', 'docs/spec.md'],
      ignore: ['node_modules', '.git'],
    };

    for (let cycle = 0; cycle < 50; cycle++) {
      mgr.savePromises(promises);
      mgr.saveConfig(config);
      const loadedP = mgr.loadPromises();
      const loadedC = mgr.loadConfig();

      expect(loadedP).toHaveLength(30);
      expect(loadedC.checkInterval).toBe(1800);
      expect(loadedC.thresholds?.healthy).toBe(85);
    }
  });

  it('full cycle: init + engine run + history save + score — 50 iterations', () => {
    const mgr = new StateManager(tmpDir);
    mgr.init();

    // Create a dummy package.json so file_exists checks pass
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}', 'utf8');

    const promises = Array.from({ length: 20 }, (_, i) => makePromise(`full-${i}`, 'file_exists'));
    const engine = new RuleEngine();
    const hist = new History(path.join(tmpDir, '.drift-guard'));

    const start = performance.now();
    for (let cycle = 0; cycle < 50; cycle++) {
      mgr.savePromises(promises);
      const loaded = mgr.loadPromises();
      const results = engine.runAll(loaded, tmpDir);
      const score = computeScore(results, loaded);
      const trend = detectTrend(hist.getScoreHistory());

      hist.addCheck({
        score,
        status: score >= 80 ? 'healthy' : 'warning',
        stage: 1,
        violations: [],
        trend,
        recommendation: '',
        timestamp: new Date().toISOString(),
      });
    }
    const elapsed = performance.now() - start;

    const finalHistory = hist.getHistory();
    expect(finalHistory).toHaveLength(50);
    expect(finalHistory[49].score).toBe(100); // all file_exists pass
    expect(elapsed).toBeLessThan(15000);

    // Verify no file corruption — reload everything
    const reloadedPromises = mgr.loadPromises();
    expect(reloadedPromises).toHaveLength(20);
    const reloadedScores = hist.getScoreHistory();
    expect(reloadedScores).toHaveLength(50);
    reloadedScores.forEach((s) => expect(s).toBe(100));
  });

  it('concurrent-like rapid writes do not leave temp files behind', () => {
    const mgr = new StateManager(tmpDir);
    mgr.init();

    const promises = Array.from({ length: 10 }, (_, i) => makePromise(`tmp-${i}`));

    // Rapid fire writes
    for (let i = 0; i < 100; i++) {
      mgr.savePromises(promises);
    }

    // Check .drift-guard for leftover .tmp files
    const driftDir = path.join(tmpDir, '.drift-guard');
    const files = fs.readdirSync(driftDir);
    const tmpFiles = files.filter((f) => f.endsWith('.tmp'));
    expect(tmpFiles).toHaveLength(0);
  });
});
