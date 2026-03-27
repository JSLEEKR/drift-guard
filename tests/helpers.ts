/**
 * Shared test helpers to reduce duplication across test files.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { DriftPromise, QualityReport } from '../src/types.js';

/**
 * Create a temporary directory with a given prefix.
 * Caller is responsible for cleanup via `cleanupTmpDir`.
 */
export function createTmpDir(prefix = 'drift-guard-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Remove a temporary directory created by `createTmpDir`.
 */
export function cleanupTmpDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Create a DriftPromise with sensible defaults, overridable via spread.
 */
export function makePromise(overrides: Partial<DriftPromise> = {}): DriftPromise {
  return {
    id: 'test-001',
    source: 'test',
    text: 'test promise',
    category: 'quality',
    check_type: 'file_exists',
    check_config: {},
    weight: 5,
    ...overrides,
  };
}

/**
 * Create a QualityReport with a given score and sensible defaults.
 */
export function makeReport(score: number): QualityReport {
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
