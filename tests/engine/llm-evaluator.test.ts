import { describe, it, expect } from 'vitest';
import { LLMEvaluator } from '../../src/engine/llm-evaluator.js';
import type { DriftPromise } from '../../src/types.js';

const makePromise = (overrides: Partial<DriftPromise> = {}): DriftPromise => ({
  id: 'promise-001',
  source: 'CLAUDE.md',
  category: 'quality',
  text: 'Test coverage must remain above 80%',
  check_type: 'llm_eval',
  check_config: {},
  weight: 8,
  ...overrides,
});

describe('LLMEvaluator', () => {
  const evaluator = new LLMEvaluator();

  describe('buildEvaluationPrompt', () => {
    it('includes all promises in the prompt', () => {
      const promises = [
        makePromise({ id: 'promise-001', text: 'Test coverage must be above 80%' }),
        makePromise({ id: 'promise-002', text: 'No circular dependencies', category: 'architecture' }),
      ];
      const fileContents = new Map<string, string>();

      const prompt = evaluator.buildEvaluationPrompt(promises, fileContents);

      expect(prompt).toContain('promise-001');
      expect(prompt).toContain('Test coverage must be above 80%');
      expect(prompt).toContain('promise-002');
      expect(prompt).toContain('No circular dependencies');
    });

    it('includes file contents in the prompt', () => {
      const promises = [makePromise()];
      const fileContents = new Map<string, string>([
        ['CLAUDE.md', '# Project Rules\n- Tests are required'],
        ['src/index.ts', 'export const foo = 1;'],
      ]);

      const prompt = evaluator.buildEvaluationPrompt(promises, fileContents);

      expect(prompt).toContain('CLAUDE.md');
      expect(prompt).toContain('# Project Rules');
      expect(prompt).toContain('src/index.ts');
      expect(prompt).toContain('export const foo = 1;');
    });

    it('asks for score 0-100 and JSON violations', () => {
      const promises = [makePromise()];
      const fileContents = new Map<string, string>();

      const prompt = evaluator.buildEvaluationPrompt(promises, fileContents);

      expect(prompt).toContain('0-100');
      expect(prompt).toContain('violations');
      expect(prompt).toContain('JSON');
    });
  });

  describe('parseEvaluationResponse', () => {
    it('parses valid JSON response', () => {
      const response = JSON.stringify({
        score: 85,
        violations: [
          {
            promiseId: 'promise-001',
            promiseText: 'Test coverage must be above 80%',
            status: 'warn',
            detail: 'Coverage is at 78%',
            timestamp: '2026-03-26T00:00:00.000Z',
          },
        ],
      });

      const result = evaluator.parseEvaluationResponse(response);

      expect(result.score).toBe(85);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].promiseId).toBe('promise-001');
      expect(result.violations[0].status).toBe('warn');
    });

    it('handles malformed response with score 0 and error detail', () => {
      const result = evaluator.parseEvaluationResponse('not valid json at all!!!');

      expect(result.score).toBe(0);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].status).toBe('fail');
      expect(result.violations[0].detail).toContain('Malformed');
    });

    it('returns empty violations array when response has no violations', () => {
      const response = JSON.stringify({
        score: 100,
        violations: [],
      });

      const result = evaluator.parseEvaluationResponse(response);

      expect(result.score).toBe(100);
      expect(result.violations).toHaveLength(0);
    });

    it('extracts JSON from surrounding text', () => {
      const response = `Here is my analysis:\n${JSON.stringify({
        score: 92,
        violations: [
          {
            promiseId: 'p1',
            promiseText: 'Docs complete',
            status: 'warn',
            detail: 'Missing API docs',
            timestamp: '2026-03-26T00:00:00.000Z',
          },
        ],
      })}\nThat concludes my review.`;

      const result = evaluator.parseEvaluationResponse(response);

      expect(result.score).toBe(92);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].promiseId).toBe('p1');
    });

    it('returns fail when JSON is missing score field', () => {
      const response = JSON.stringify({ violations: [] });

      const result = evaluator.parseEvaluationResponse(response);

      expect(result.score).toBe(0);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].status).toBe('fail');
      expect(result.violations[0].detail).toContain('Missing score');
    });

    it('defaults missing violation fields gracefully', () => {
      const response = JSON.stringify({
        score: 70,
        violations: [
          { somethingElse: true },
        ],
      });

      const result = evaluator.parseEvaluationResponse(response);

      expect(result.score).toBe(70);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].promiseId).toBe('unknown');
      expect(result.violations[0].status).toBe('fail');
    });
  });
});
