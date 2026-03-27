import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StateManager } from '../../src/state/state-manager.js';
import { ContextPreserver } from '../../src/state/context-preserver.js';
import { RuleEngine } from '../../src/engine/rule-engine.js';
import { LLMEvaluator } from '../../src/engine/llm-evaluator.js';
import {
  computeScore,
  classifyStatus,
  detectTrend,
  generateRecommendation,
} from '../../src/scoring.js';
import type { DriftPromise, QualityReport } from '../../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'drift-guard-int-'));
}

function makePromise(
  id: string,
  checkType: DriftPromise['check_type'],
  checkConfig: Record<string, unknown>,
  text = `Promise ${id}`,
  weight = 1,
): DriftPromise {
  return {
    id,
    source: 'test',
    category: 'quality',
    text,
    check_type: checkType,
    check_config: checkConfig,
    weight,
  };
}

function makeReport(score: number): QualityReport {
  return {
    score,
    status: classifyStatus(score),
    stage: 1,
    violations: [],
    trend: 'stable',
    recommendation: '',
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Integration: full drift-guard pipeline', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Test 1 ─────────────────────────────────────────────────────────────────

  it('Test 1: init → track → check (Stage 1 pass) → report', () => {
    // Create sample project files
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), '# Claude\nUse plugin architecture.\n', 'utf8');
    fs.writeFileSync(
      path.join(tmpDir, 'README.md'),
      Array.from({ length: 20 }, (_, i) => `Line ${i + 1}: documentation text`).join('\n'),
      'utf8',
    );
    fs.writeFileSync(path.join(tmpDir, 'src', 'index.ts'), 'export const hello = () => "world";\n', 'utf8');

    // Init StateManager
    const sm = new StateManager(tmpDir);
    sm.init();

    // Create promises: file_exists for README, min_lines with low threshold
    const promises: DriftPromise[] = [
      makePromise('p1', 'file_exists', { path: 'README.md' }, 'README.md must exist', 2),
      makePromise('p2', 'min_lines', { file: 'README.md', min: 5 }, 'README.md must have at least 5 lines', 1),
    ];
    sm.savePromises(promises);

    // Track files (save a track snapshot)
    const trackEntries = [
      {
        path: 'README.md',
        lines: 20,
        size: fs.statSync(path.join(tmpDir, 'README.md')).size,
        timestamp: new Date().toISOString(),
      },
      {
        path: 'src/index.ts',
        lines: 1,
        size: fs.statSync(path.join(tmpDir, 'src', 'index.ts')).size,
        timestamp: new Date().toISOString(),
      },
    ];
    const trackPath = sm.saveTrack(trackEntries);
    expect(fs.existsSync(trackPath)).toBe(true);

    // Load promises back and run RuleEngine check
    const loadedPromises = sm.loadPromises();
    expect(loadedPromises).toHaveLength(2);

    const engine = new RuleEngine();
    const results = engine.runAll(loadedPromises, tmpDir);

    // Stage 1 should pass — all checks pass
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === 'pass')).toBe(true);

    // Compute score → should be healthy
    const score = computeScore(results, loadedPromises);
    expect(score).toBe(100);
    const status = classifyStatus(score);
    expect(status).toBe('healthy');

    // Generate report
    const trend = detectTrend([score]);
    const rec = generateRecommendation(status, trend, []);
    expect(rec).toContain('healthy');
  });

  // ── Test 2 ─────────────────────────────────────────────────────────────────

  it('Test 2: full pipeline with violation — check Stage 1 fail', () => {
    // Project missing README.md
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), '# Claude\nMaintain README.\n', 'utf8');

    const sm = new StateManager(tmpDir);
    sm.init();

    // Promise requiring README.md (file_exists)
    const promises: DriftPromise[] = [
      makePromise('p1', 'file_exists', { path: 'README.md' }, 'README.md must exist', 5),
    ];
    sm.savePromises(promises);

    const loadedPromises = sm.loadPromises();
    const engine = new RuleEngine();
    const results = engine.runAll(loadedPromises, tmpDir);

    // README doesn't exist → should fail
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('fail');

    // Score should be 0 (one weighted fail)
    const score = computeScore(results, loadedPromises);
    expect(score).toBe(0);

    // Status should be warning, degraded, or critical (< 80)
    const status = classifyStatus(score);
    expect(score).toBeLessThan(80);
    expect(['warning', 'degraded', 'critical']).toContain(status);
  });

  // ── Test 3 ─────────────────────────────────────────────────────────────────

  it('Test 3: context save/restore cycle', () => {
    const sm = new StateManager(tmpDir);
    sm.init();

    const driftDir = path.join(tmpDir, '.drift-guard');
    const cp = new ContextPreserver(driftDir);

    // Save context
    const contextText = 'Important: use plugin architecture';
    cp.save(contextText);

    // Load context → should contain saved text
    const loaded = cp.load();
    expect(loaded).not.toBeNull();
    expect(loaded).toContain(contextText);

    // Verify file exists at .drift-guard/context.md
    const contextFilePath = path.join(driftDir, 'context.md');
    expect(fs.existsSync(contextFilePath)).toBe(true);
  });

  // ── Test 4 ─────────────────────────────────────────────────────────────────

  it('Test 4: trend detection — multiple checks with declining scores', () => {
    const scores = [95, 90, 80, 70, 60];

    // detectTrend should return 'declining'
    const trend = detectTrend(scores);
    expect(trend).toBe('declining');

    // generateRecommendation should mention declining
    const status = classifyStatus(scores[scores.length - 1]);
    const rec = generateRecommendation(status, trend, []);
    expect(rec.toLowerCase()).toContain('declining');
  });

  // ── Test 5 ─────────────────────────────────────────────────────────────────

  it('Test 5: empty project — works with zero promises', () => {
    const sm = new StateManager(tmpDir);
    sm.init();

    // Load promises → empty array (no promises.json yet)
    const promises = sm.loadPromises();
    expect(promises).toEqual([]);

    // Run check with empty promises → score 100
    const engine = new RuleEngine();
    const results = engine.runAll(promises, tmpDir);
    expect(results).toHaveLength(0);

    const score = computeScore(results, promises);
    expect(score).toBe(100);

    // Status → healthy (clean)
    const status = classifyStatus(score);
    expect(status).toBe('healthy');

    // Generate clean report
    const trend = detectTrend([score]);
    const rec = generateRecommendation(status, trend, []);
    expect(rec).toContain('healthy');
  });

  // ── Test 6 ─────────────────────────────────────────────────────────────────

  it('Test 6: LLM Evaluator prompt building and mock response parsing', () => {
    const promises: DriftPromise[] = [
      makePromise('p1', 'llm_eval', {}, 'All modules must be documented', 3),
      makePromise('p2', 'llm_eval', {}, 'No console.log in production code', 5),
    ];

    const fileContents = new Map<string, string>([
      ['src/index.ts', 'export const hello = () => "world"; // well documented\n'],
      ['README.md', '# Project\n\nThis project does X.\n'],
    ]);

    const evaluator = new LLMEvaluator();

    // Build evaluation prompt
    const prompt = evaluator.buildEvaluationPrompt(promises, fileContents);

    // Verify prompt contains all promise texts
    expect(prompt).toContain('All modules must be documented');
    expect(prompt).toContain('No console.log in production code');

    // Verify prompt contains file contents
    expect(prompt).toContain('export const hello');
    expect(prompt).toContain('# Project');

    // Parse a mock response → verify CheckResult structure
    const mockResponse = JSON.stringify({
      score: 75,
      violations: [
        {
          promiseId: 'p2',
          promiseText: 'No console.log in production code',
          status: 'warn',
          detail: 'Found potential console usage in codebase',
          timestamp: new Date().toISOString(),
        },
      ],
    });

    const parsed = evaluator.parseEvaluationResponse(mockResponse);
    expect(parsed.score).toBe(75);
    expect(parsed.violations).toHaveLength(1);

    const violation = parsed.violations[0];
    expect(violation.promiseId).toBe('p2');
    expect(violation.promiseText).toBe('No console.log in production code');
    expect(violation.status).toBe('warn');
    expect(typeof violation.detail).toBe('string');
    expect(typeof violation.timestamp).toBe('string');
  });
});
