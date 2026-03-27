import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PromiseCollector } from '../../src/collector/promise-collector.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const FIXTURE_PROJECT = join(__dirname, '../../fixtures/sample-project');
const EMPTY_PROJECT = join(__dirname, '../../fixtures/empty-project');

describe('PromiseCollector', () => {
  const collector = new PromiseCollector();

  describe('collectSources', () => {
    it('finds CLAUDE.md in the fixture project', async () => {
      const result = await collector.collectSources(FIXTURE_PROJECT);

      const paths = result.fileContents.map((f) => f.path);
      expect(paths).toContain('CLAUDE.md');
    });

    it('finds memory files in the fixture project', async () => {
      const result = await collector.collectSources(FIXTURE_PROJECT);

      const paths = result.fileContents.map((f) => f.path);
      const hasMemoryFile = paths.some((p) => p.includes('memory'));
      expect(hasMemoryFile).toBe(true);
    });

    it('builds correct extraction instruction', async () => {
      const result = await collector.collectSources(FIXTURE_PROJECT);

      expect(result.instruction).toContain('promises');
      expect(result.instruction).toContain('JSON array');
      expect(result.instruction).toContain('category');
      expect(result.instruction).toContain('check_type');
    });

    it('returns empty fileContents for empty project', async () => {
      const result = await collector.collectSources(EMPTY_PROJECT);

      expect(result.fileContents).toHaveLength(0);
      // Instruction is still present
      expect(result.instruction).toBeTruthy();
    });

    it('respects customSources when provided', async () => {
      const result = await collector.collectSources(FIXTURE_PROJECT, ['CLAUDE.md']);

      const paths = result.fileContents.map((f) => f.path);
      expect(paths).toContain('CLAUDE.md');
      // Should not have memory files since we only asked for CLAUDE.md
      const hasMemoryFile = paths.some((p) => p.includes('memory'));
      expect(hasMemoryFile).toBe(false);
    });
  });

  describe('parseExtractionResponse', () => {
    it('parses valid JSON array response', () => {
      const response = JSON.stringify([
        {
          text: 'All features must have corresponding tests',
          category: 'process',
          check_type: 'glob_count',
          check_config: { pattern: 'tests/**/*.test.ts', min: 1 },
          weight: 9,
        },
        {
          text: 'Use TypeScript strict mode',
          category: 'style',
          check_type: 'content_match',
          check_config: { file: 'tsconfig.json', pattern: '"strict": true' },
          weight: 7,
        },
      ]);

      const result = collector.parseExtractionResponse(response);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('promise-001');
      expect(result[1].id).toBe('promise-002');
      expect(result[0].text).toBe('All features must have corresponding tests');
      expect(result[0].category).toBe('process');
      expect(result[0].check_type).toBe('glob_count');
      expect(result[0].weight).toBe(9);
    });

    it('assigns sequential IDs starting from promise-001', () => {
      const response = JSON.stringify([
        { text: 'Rule A', category: 'quality', check_type: 'file_exists', check_config: {}, weight: 5 },
        { text: 'Rule B', category: 'security', check_type: 'file_exists', check_config: {}, weight: 3 },
        { text: 'Rule C', category: 'style', check_type: 'file_exists', check_config: {}, weight: 7 },
      ]);

      const result = collector.parseExtractionResponse(response);

      expect(result[0].id).toBe('promise-001');
      expect(result[1].id).toBe('promise-002');
      expect(result[2].id).toBe('promise-003');
    });

    it('defaults weight to 5 when not provided', () => {
      const response = JSON.stringify([
        { text: 'Some rule', category: 'quality', check_type: 'file_exists', check_config: {} },
      ]);

      const result = collector.parseExtractionResponse(response);

      expect(result[0].weight).toBe(5);
    });

    it('defaults unknown check_type to llm_eval', () => {
      const response = JSON.stringify([
        {
          text: 'Some rule',
          category: 'quality',
          check_type: 'totally_unknown_type',
          check_config: {},
          weight: 5,
        },
      ]);

      const result = collector.parseExtractionResponse(response);

      expect(result[0].check_type).toBe('llm_eval');
    });

    it('returns empty array for malformed response', () => {
      const result = collector.parseExtractionResponse('not json at all');

      expect(result).toHaveLength(0);
    });
  });
});
