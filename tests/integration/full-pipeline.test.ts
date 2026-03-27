import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StateManager } from '../../src/state/state-manager.js';
import { ContextPreserver } from '../../src/state/context-preserver.js';
import { History } from '../../src/state/history.js';
import { RuleEngine } from '../../src/engine/rule-engine.js';
import { LLMEvaluator } from '../../src/engine/llm-evaluator.js';
import {
  computeScore,
  classifyStatus,
  detectTrend,
  generateRecommendation,
  topViolationTexts,
} from '../../src/scoring.js';
import type { DriftPromise, CheckResult, QualityReport } from '../../src/types.js';
import { createTmpDir, cleanupTmpDir, makePromise as makeBasePromise } from '../helpers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePromise(
  id: string,
  checkType: DriftPromise['check_type'],
  checkConfig: Record<string, unknown>,
  text = `Promise ${id}`,
  weight = 1,
): DriftPromise {
  return makeBasePromise({ id, check_type: checkType, check_config: checkConfig, text, weight });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Integration: full drift-guard pipeline', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir('drift-guard-int-');
  });

  afterEach(() => {
    cleanupTmpDir(tmpDir);
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

  // ── Test 7 ─────────────────────────────────────────────────────────────────

  it('Test 7: full workflow — init → promise extraction (mock) → track → check Stage 1 → check Stage 2 → save context → report', () => {
    // Set up a realistic project structure
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), '# Claude\nUse plugin architecture.\nMaintain README.\n', 'utf8');
    fs.writeFileSync(
      path.join(tmpDir, 'README.md'),
      Array.from({ length: 30 }, (_, i) => `Line ${i + 1}: documentation`).join('\n'),
      'utf8',
    );
    fs.writeFileSync(path.join(tmpDir, 'src', 'index.ts'), 'export const main = () => console.log("hello");\n', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'tests', 'index.test.ts'), 'test("works", () => {});\n', 'utf8');

    // Step 1: Init
    const sm = new StateManager(tmpDir);
    sm.init();
    const driftDir = path.join(tmpDir, '.drift-guard');
    expect(fs.existsSync(driftDir)).toBe(true);
    expect(fs.existsSync(path.join(driftDir, 'history'))).toBe(true);

    // Step 2: Simulate promise extraction (mock — normally done by LLM)
    const promises: DriftPromise[] = [
      makePromise('p-readme', 'file_exists', { path: 'README.md' }, 'README.md must exist', 3),
      makePromise('p-lines', 'min_lines', { file: 'README.md', min: 10 }, 'README >= 10 lines', 2),
      makePromise('p-src', 'file_exists', { path: 'src/index.ts' }, 'src/index.ts must exist', 2),
      makePromise('p-tests', 'file_exists', { path: 'tests/index.test.ts' }, 'Tests must exist', 1),
      makePromise('p-llm', 'llm_eval', {}, 'Code quality must be high', 5),
    ];
    sm.savePromises(promises);
    expect(sm.loadPromises()).toHaveLength(5);

    // Step 3: Track files
    const filesToTrack = ['README.md', 'src/index.ts', 'tests/index.test.ts'];
    const trackEntries = filesToTrack.map((f) => ({
      path: f,
      lines: fs.readFileSync(path.join(tmpDir, f), 'utf8').split('\n').length,
      size: fs.statSync(path.join(tmpDir, f)).size,
      timestamp: new Date().toISOString(),
    }));
    const trackPath = sm.saveTrack(trackEntries);
    expect(fs.existsSync(trackPath)).toBe(true);

    // Step 4: Check Stage 1 — rule engine (skips llm_eval promises)
    const engine = new RuleEngine();
    const stage1Results = engine.runAll(sm.loadPromises(), tmpDir);
    // 4 rule-based promises, 1 llm_eval skipped
    expect(stage1Results).toHaveLength(4);
    expect(stage1Results.every((r) => r.status === 'pass')).toBe(true);

    // Stage 1 score (rule-based only)
    const stage1Score = computeScore(stage1Results, promises.filter((p) => p.check_type !== 'llm_eval'));
    expect(stage1Score).toBe(100);

    // Step 5: Check Stage 2 — simulate AI evaluation result
    const mockEvalResult = {
      score: 85,
      violations: [
        {
          promiseId: 'p-llm',
          promiseText: 'Code quality must be high',
          status: 'warn' as const,
          detail: 'console.log found in production code',
          timestamp: new Date().toISOString(),
        },
      ],
    };

    // Combine Stage 1 + Stage 2
    const allResults: CheckResult[] = [...stage1Results, ...mockEvalResult.violations];
    const finalScore = mockEvalResult.score;
    const finalStatus = classifyStatus(finalScore);
    expect(finalStatus).toBe('healthy');

    const history = new History(driftDir);
    const trend = detectTrend(history.getScoreHistory().concat(finalScore));
    const topViolations = topViolationTexts(allResults, promises);
    const recommendation = generateRecommendation(finalStatus, trend, topViolations);

    const report: QualityReport = {
      score: finalScore,
      status: finalStatus,
      stage: 2,
      violations: allResults.filter((r) => r.status !== 'pass'),
      trend,
      recommendation,
      timestamp: new Date().toISOString(),
    };
    history.addCheck(report);

    // Verify report was saved
    const savedHistory = history.getHistory();
    expect(savedHistory).toHaveLength(1);
    expect(savedHistory[0].score).toBe(85);
    expect(savedHistory[0].stage).toBe(2);
    expect(savedHistory[0].violations).toHaveLength(1);

    // Step 6: Save context
    const cp = new ContextPreserver(driftDir);
    cp.save('Session completed: 4/5 rules pass, LLM eval score 85. One warning about console.log.', {
      finalScore: 85,
      totalChecks: 5,
      violations: 1,
    });
    expect(cp.exists()).toBe(true);
    const savedContext = cp.load();
    expect(savedContext).toContain('Session completed');
    expect(savedContext).toContain('finalScore');

    // Step 7: Generate session report
    const reports = history.getHistory();
    const startScore = reports[0].score;
    const endScore = reports[reports.length - 1].score;
    const drift = Math.round((endScore - startScore) * 10) / 10;
    expect(drift).toBe(0); // only one check so far
    expect(startScore).toBe(85);
    expect(endScore).toBe(85);
  });

  // ── Test 8 ─────────────────────────────────────────────────────────────────

  it('Test 8: context preservation across simulated session restart (save → new StateManager → load)', () => {
    // Session 1: Initialize, create promises, run check, save context
    const sm1 = new StateManager(tmpDir);
    sm1.init();
    const driftDir = path.join(tmpDir, '.drift-guard');

    // Create project files
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'README.md'), 'Hello world\nLine 2\nLine 3\n', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'src', 'app.ts'), 'export default {};\n', 'utf8');

    // Save promises
    const promises: DriftPromise[] = [
      makePromise('s-readme', 'file_exists', { path: 'README.md' }, 'README must exist', 3),
      makePromise('s-app', 'file_exists', { path: 'src/app.ts' }, 'app.ts must exist', 2),
    ];
    sm1.savePromises(promises);

    // Run check
    const engine1 = new RuleEngine();
    const results1 = engine1.runAll(sm1.loadPromises(), tmpDir);
    expect(results1.every((r) => r.status === 'pass')).toBe(true);

    const score1 = computeScore(results1, promises);
    expect(score1).toBe(100);

    // Save history
    const history1 = new History(driftDir);
    history1.addCheck({
      score: score1,
      status: classifyStatus(score1),
      stage: 1,
      violations: [],
      trend: 'stable',
      recommendation: 'All good',
      timestamp: new Date().toISOString(),
    });

    // Save context with metadata about the session
    const cp1 = new ContextPreserver(driftDir);
    cp1.save('Session 1: All promises pass. Score 100. No violations.', {
      session: 1,
      score: 100,
      promiseCount: promises.length,
    });

    // Track files
    sm1.saveTrack([
      { path: 'README.md', lines: 3, size: 24, timestamp: new Date().toISOString() },
      { path: 'src/app.ts', lines: 1, size: 20, timestamp: new Date().toISOString() },
    ]);

    // ── SIMULATE SESSION RESTART ──
    // Create completely new instances (as if the process restarted)

    const sm2 = new StateManager(tmpDir);
    // Note: we do NOT call sm2.init() — it should already exist

    // Verify promises persist
    const loadedPromises = sm2.loadPromises();
    expect(loadedPromises).toHaveLength(2);
    expect(loadedPromises[0].id).toBe('s-readme');
    expect(loadedPromises[1].id).toBe('s-app');

    // Verify context persists
    const cp2 = new ContextPreserver(driftDir);
    expect(cp2.exists()).toBe(true);
    const restoredContext = cp2.load();
    expect(restoredContext).not.toBeNull();
    expect(restoredContext).toContain('Session 1');
    expect(restoredContext).toContain('Score 100');
    expect(restoredContext).toContain('session: 1');

    // Verify history persists
    const history2 = new History(driftDir);
    const scoreHistory = history2.getScoreHistory();
    expect(scoreHistory).toHaveLength(1);
    expect(scoreHistory[0]).toBe(100);

    // Run check again with restored state (Session 2)
    const engine2 = new RuleEngine();
    const results2 = engine2.runAll(loadedPromises, tmpDir);
    expect(results2).toHaveLength(2);
    expect(results2.every((r) => r.status === 'pass')).toBe(true);

    const score2 = computeScore(results2, loadedPromises);
    history2.addCheck({
      score: score2,
      status: classifyStatus(score2),
      stage: 1,
      violations: [],
      trend: detectTrend([...scoreHistory, score2]),
      recommendation: 'Still healthy',
      timestamp: new Date().toISOString(),
    });

    // Verify history now has 2 entries
    const finalHistory = history2.getHistory();
    expect(finalHistory).toHaveLength(2);
    expect(finalHistory[0].score).toBe(100);
    expect(finalHistory[1].score).toBe(100);

    // Trend should be stable
    const finalTrend = detectTrend(finalHistory.map((h) => h.score));
    expect(finalTrend).toBe('stable');

    // Update context for session 2
    cp2.save('Session 2: Restored from session 1. All promises still pass. Score 100.', {
      session: 2,
      score: 100,
      previousSession: 1,
    });

    // Verify updated context
    const finalContext = cp2.load();
    expect(finalContext).toContain('Session 2');
    expect(finalContext).toContain('Restored from session 1');
    expect(finalContext).toContain('previousSession: 1');
  });
});
