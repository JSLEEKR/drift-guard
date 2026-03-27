import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { History } from '../../src/state/history.js';
import type { QualityReport } from '../../src/types.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'drift-guard-hist-'));
}

function makeReport(score: number, overrides: Partial<QualityReport> = {}): QualityReport {
  return {
    score,
    status: score >= 80 ? 'healthy' : score >= 60 ? 'warning' : 'degraded',
    stage: 1,
    violations: [],
    trend: 'stable',
    recommendation: 'ok',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('History', () => {
  let tmpDir: string;
  let driftDir: string;
  let hist: History;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    driftDir = path.join(tmpDir, '.drift-guard');
    fs.mkdirSync(path.join(driftDir, 'history'), { recursive: true });
    hist = new History(driftDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('addCheck saves a check-*.json file in the history directory', () => {
    const filePath = hist.addCheck(makeReport(90));
    expect(fs.existsSync(filePath)).toBe(true);
    const basename = path.basename(filePath);
    expect(basename).toMatch(/^check-\d+-\d+\.json$/);
  });

  it('getHistory returns all entries sorted oldest first', () => {
    // Add 3 reports with a small delay guaranteed by unique counter logic
    hist.addCheck(makeReport(70));
    hist.addCheck(makeReport(80));
    hist.addCheck(makeReport(90));

    const history = hist.getHistory();
    expect(history).toHaveLength(3);
    // Sorted oldest-first means scores should be in insertion order
    expect(history.map((r) => r.score)).toEqual([70, 80, 90]);
  });

  it('getScoreHistory returns an array of numbers', () => {
    hist.addCheck(makeReport(60));
    hist.addCheck(makeReport(75));
    const scores = hist.getScoreHistory();
    expect(scores).toEqual([60, 75]);
  });

  it('trim keeps only the last N entries', () => {
    for (let i = 0; i < 5; i++) hist.addCheck(makeReport(50 + i * 5));
    hist.trim(3);
    expect(hist.getHistory()).toHaveLength(3);
    // Remaining entries should be the 3 most recent (highest scores in our sequence)
    const scores = hist.getScoreHistory();
    expect(scores).toEqual([60, 65, 70]);
  });

  it('clear removes all history files', () => {
    hist.addCheck(makeReport(80));
    hist.addCheck(makeReport(85));
    hist.clear();
    expect(hist.getHistory()).toHaveLength(0);
    const files = fs.readdirSync(path.join(driftDir, 'history'));
    expect(files).toHaveLength(0);
  });

  it('getHistory returns [] when history directory is empty', () => {
    expect(hist.getHistory()).toEqual([]);
  });
});
