import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { StateManager } from '../../src/state/state-manager.js';
import { History } from '../../src/state/history.js';
import { ContextPreserver } from '../../src/state/context-preserver.js';
import type { QualityReport, DriftPromise } from '../../src/types.js';

let tmpDir: string;
let driftDir: string;

function makeReport(score: number): QualityReport {
  return {
    score,
    status: 'healthy',
    stage: 1,
    violations: [],
    trend: 'stable',
    recommendation: 'ok',
    timestamp: new Date().toISOString(),
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-err-'));
  driftDir = path.join(tmpDir, '.drift-guard');
  fs.mkdirSync(driftDir, { recursive: true });
  fs.mkdirSync(path.join(driftDir, 'history'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('.drift-guard/ deleted mid-session', () => {
  it('StateManager.savePromises recreates .drift-guard/ if deleted', () => {
    const sm = new StateManager(tmpDir);
    // Delete the drift dir
    fs.rmSync(driftDir, { recursive: true, force: true });
    expect(fs.existsSync(driftDir)).toBe(false);

    // savePromises should recreate it
    const promises: DriftPromise[] = [
      {
        id: 'p-001',
        source: 'test',
        text: 'test',
        category: 'quality',
        check_type: 'file_exists',
        check_config: { path: 'README.md' },
        weight: 5,
      },
    ];
    sm.savePromises(promises);
    expect(fs.existsSync(driftDir)).toBe(true);
    expect(sm.loadPromises()).toEqual(promises);
  });

  it('StateManager.loadPromises returns [] if .drift-guard/ is gone', () => {
    const sm = new StateManager(tmpDir);
    fs.rmSync(driftDir, { recursive: true, force: true });
    const result = sm.loadPromises();
    expect(result).toEqual([]);
  });

  it('StateManager.loadConfig returns defaults if .drift-guard/ is gone', () => {
    const sm = new StateManager(tmpDir);
    fs.rmSync(driftDir, { recursive: true, force: true });
    const config = sm.loadConfig();
    expect(config.thresholds).toEqual({ healthy: 80, warning: 60, degraded: 40 });
  });

  it('History.addCheck recreates history/ if deleted', () => {
    const history = new History(driftDir);
    fs.rmSync(path.join(driftDir, 'history'), { recursive: true, force: true });
    expect(fs.existsSync(path.join(driftDir, 'history'))).toBe(false);

    const filePath = history.addCheck(makeReport(85));
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.existsSync(path.join(driftDir, 'history'))).toBe(true);
  });

  it('History.getHistory returns [] if history/ is gone', () => {
    const history = new History(driftDir);
    fs.rmSync(path.join(driftDir, 'history'), { recursive: true, force: true });
    const result = history.getHistory();
    expect(result).toEqual([]);
  });

  it('ContextPreserver.load returns null if .drift-guard/ is gone', () => {
    const cp = new ContextPreserver(driftDir);
    fs.rmSync(driftDir, { recursive: true, force: true });
    expect(cp.load()).toBeNull();
    expect(cp.exists()).toBe(false);
  });

  it('ContextPreserver.save recreates .drift-guard/ if deleted', () => {
    const cp = new ContextPreserver(driftDir);
    fs.rmSync(driftDir, { recursive: true, force: true });
    cp.save('test summary');
    expect(cp.exists()).toBe(true);
    expect(cp.load()).toContain('test summary');
  });
});

describe('promises.json corrupted between checks', () => {
  it('returns [] when promises.json contains invalid JSON', () => {
    const sm = new StateManager(tmpDir);
    fs.writeFileSync(path.join(driftDir, 'promises.json'), '{invalid json!!!', 'utf8');
    const result = sm.loadPromises();
    expect(result).toEqual([]);
  });

  it('returns [] when promises.json is empty', () => {
    const sm = new StateManager(tmpDir);
    fs.writeFileSync(path.join(driftDir, 'promises.json'), '', 'utf8');
    const result = sm.loadPromises();
    expect(result).toEqual([]);
  });

  it('returns [] when promises.json contains non-array JSON', () => {
    const sm = new StateManager(tmpDir);
    fs.writeFileSync(path.join(driftDir, 'promises.json'), '{"not":"array"}', 'utf8');
    const result = sm.loadPromises();
    expect(result).toEqual([]);
  });

  it('returns [] when promises.json contains a numeric JSON value', () => {
    const sm = new StateManager(tmpDir);
    fs.writeFileSync(path.join(driftDir, 'promises.json'), '42', 'utf8');
    const result = sm.loadPromises();
    expect(result).toEqual([]);
  });

  it('overwrites corrupted promises.json on next save', () => {
    const sm = new StateManager(tmpDir);
    fs.writeFileSync(path.join(driftDir, 'promises.json'), 'CORRUPTED!', 'utf8');

    const promises: DriftPromise[] = [
      {
        id: 'p-001',
        source: 'test',
        text: 'recovered',
        category: 'quality',
        check_type: 'file_exists',
        check_config: {},
        weight: 5,
      },
    ];
    sm.savePromises(promises);
    const loaded = sm.loadPromises();
    expect(loaded[0].text).toBe('recovered');
  });
});

describe('history/ directory edge cases', () => {
  it('History.getHistory skips corrupted check files gracefully', () => {
    const history = new History(driftDir);
    const histDir = path.join(driftDir, 'history');

    // Write a valid check
    history.addCheck(makeReport(90));

    // Write a corrupted check file
    fs.writeFileSync(path.join(histDir, 'check-999999-0.json'), 'NOT JSON', 'utf8');

    // Write another valid check
    history.addCheck(makeReport(80));

    const results = history.getHistory();
    // Should have 2 valid entries, corrupted one skipped
    expect(results.length).toBe(2);
    expect(results[0].score).toBe(90);
    expect(results[1].score).toBe(80);
  });

  it('History.trim handles missing history directory', () => {
    const history = new History(driftDir);
    fs.rmSync(path.join(driftDir, 'history'), { recursive: true, force: true });
    // Should not throw
    expect(() => history.trim(5)).not.toThrow();
  });

  it('History.clear handles missing history directory', () => {
    const history = new History(driftDir);
    fs.rmSync(path.join(driftDir, 'history'), { recursive: true, force: true });
    // Should not throw
    expect(() => history.clear()).not.toThrow();
  });
});

describe('StateManager.saveTrack handles missing history dir', () => {
  it('recreates history/ and saves track entries', () => {
    const sm = new StateManager(tmpDir);
    sm.init();
    fs.rmSync(path.join(driftDir, 'history'), { recursive: true, force: true });

    const filePath = sm.saveTrack([
      { path: 'test.ts', lines: 10, size: 100, timestamp: new Date().toISOString() },
    ]);
    expect(fs.existsSync(filePath)).toBe(true);
  });
});

describe('config.yaml edge cases', () => {
  it('returns defaults for empty config.yaml', () => {
    const sm = new StateManager(tmpDir);
    fs.writeFileSync(path.join(driftDir, 'config.yaml'), '', 'utf8');
    const config = sm.loadConfig();
    expect(config.thresholds).toEqual({ healthy: 80, warning: 60, degraded: 40 });
  });

  it('returns defaults for config.yaml with only comments', () => {
    const sm = new StateManager(tmpDir);
    fs.writeFileSync(path.join(driftDir, 'config.yaml'), '# just a comment\n', 'utf8');
    const config = sm.loadConfig();
    expect(config.thresholds).toEqual({ healthy: 80, warning: 60, degraded: 40 });
  });
});
