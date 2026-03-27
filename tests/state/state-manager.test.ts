import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StateManager } from '../../src/state/state-manager.js';
import type { DriftGuardConfig, DriftPromise, TrackEntry } from '../../src/types.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'drift-guard-sm-'));
}

const SAMPLE_PROMISE: DriftPromise = {
  id: 'p1',
  source: 'README.md',
  category: 'quality',
  text: 'all tests pass',
  check_type: 'file_exists',
  check_config: {},
  weight: 1,
};

const SAMPLE_CONFIG: DriftGuardConfig = {
  thresholds: { healthy: 85, warning: 65, degraded: 45 },
  checkInterval: 1800,
  promiseSources: ['CLAUDE.md'],
  ignore: ['node_modules'],
};

describe('StateManager', () => {
  let tmpDir: string;
  let sm: StateManager;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    sm = new StateManager(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('init creates .drift-guard and history directories', () => {
    sm.init();
    expect(fs.existsSync(path.join(tmpDir, '.drift-guard'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.drift-guard', 'history'))).toBe(true);
  });

  it('init accepts an explicit projectRoot argument', () => {
    const alt = makeTmpDir();
    try {
      sm.init(alt);
      expect(fs.existsSync(path.join(alt, '.drift-guard'))).toBe(true);
      expect(sm.getProjectRoot()).toBe(alt);
    } finally {
      fs.rmSync(alt, { recursive: true, force: true });
    }
  });

  it('savePromises and loadPromises roundtrip', () => {
    sm.init();
    sm.savePromises([SAMPLE_PROMISE]);
    const loaded = sm.loadPromises();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual(SAMPLE_PROMISE);
  });

  it('loadPromises returns [] when promises.json is missing', () => {
    sm.init();
    expect(sm.loadPromises()).toEqual([]);
  });

  it('saveConfig and loadConfig roundtrip', () => {
    sm.init();
    sm.saveConfig(SAMPLE_CONFIG);
    const loaded = sm.loadConfig();
    expect(loaded.thresholds).toEqual(SAMPLE_CONFIG.thresholds);
    expect(loaded.checkInterval).toBe(1800);
    expect(loaded.promiseSources).toEqual(['CLAUDE.md']);
    expect(loaded.ignore).toEqual(['node_modules']);
  });

  it('loadConfig returns defaults when config.yaml is missing', () => {
    sm.init();
    const cfg = sm.loadConfig();
    expect(cfg.thresholds).toEqual({ healthy: 80, warning: 60, degraded: 40 });
    expect(cfg.checkInterval).toBe(3600);
    expect(cfg.promiseSources).toEqual([]);
    expect(cfg.ignore).toEqual([]);
  });

  it('saveTrack creates a file in the history directory', () => {
    sm.init();
    const entries: TrackEntry[] = [
      { path: 'src/index.ts', lines: 50, size: 1200, timestamp: new Date().toISOString() },
    ];
    const filePath = sm.saveTrack(entries);
    expect(fs.existsSync(filePath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].path).toBe('src/index.ts');
  });

  it('loadPromises returns [] for corrupted JSON', () => {
    sm.init();
    const promisesPath = path.join(tmpDir, '.drift-guard', 'promises.json');
    fs.writeFileSync(promisesPath, '{ invalid json ::::', 'utf8');
    expect(sm.loadPromises()).toEqual([]);
  });

  it('getProjectRoot returns the base path', () => {
    expect(sm.getProjectRoot()).toBe(tmpDir);
  });
});
