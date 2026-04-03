import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { PromiseCollector } from '../../src/collector/promise-collector.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const FIXTURE_PROJECT = join(__dirname, '../../fixtures/sample-project');
const EMPTY_PROJECT = join(__dirname, '../../fixtures/empty-project');
const TMP_PROJECT = join(__dirname, '../../fixtures/tmp-auto-extract');

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

  describe('autoExtract', () => {
    beforeEach(() => {
      mkdirSync(TMP_PROJECT, { recursive: true });
    });
    afterEach(() => {
      rmSync(TMP_PROJECT, { recursive: true, force: true });
    });

    it('extracts README line count promises', () => {
      writeFileSync(join(TMP_PROJECT, 'CLAUDE.md'), '- README 300줄+ 필수\n');
      writeFileSync(join(TMP_PROJECT, 'README.md'), 'Hello\n');

      const result = collector.autoExtract(TMP_PROJECT);

      const readmePromise = result.find((p) => p.text.includes('300 lines'));
      expect(readmePromise).toBeDefined();
      expect(readmePromise?.check_type).toBe('min_lines');
      expect(readmePromise?.check_config).toEqual({ file: 'README.md', min: 300 });
    });

    it('extracts Generator ≠ Evaluator promise', () => {
      writeFileSync(join(TMP_PROJECT, 'CLAUDE.md'), '### Generator ≠ Evaluator (CRITICAL)\n- Builder must NOT evaluate its own work\n');

      const result = collector.autoExtract(TMP_PROJECT);

      const genEval = result.find((p) => p.text.includes('Generator'));
      expect(genEval).toBeDefined();
      expect(genEval?.category).toBe('process');
      expect(genEval?.weight).toBe(9);
    });

    it('extracts 3 consecutive clean promise', () => {
      writeFileSync(join(TMP_PROJECT, 'CLAUDE.md'), '→ 3 consecutive DEEP AUDIT CLEAN → PASS\n');

      const result = collector.autoExtract(TMP_PROJECT);

      const cleanPromise = result.find((p) => p.text.includes('3 consecutive'));
      expect(cleanPromise).toBeDefined();
      expect(cleanPromise?.check_type).toBe('content_match');
    });

    it('extracts safety hook promises', () => {
      writeFileSync(join(TMP_PROJECT, 'CLAUDE.md'), '- .hooks/pre_bash_review.js blocks dangerous commands\n');

      const result = collector.autoExtract(TMP_PROJECT);

      const hookPromise = result.find((p) => p.text.includes('pre_bash_review'));
      expect(hookPromise).toBeDefined();
      expect(hookPromise?.category).toBe('security');
      expect(hookPromise?.check_type).toBe('file_exists');
    });

    it('adds structural promises for existing files', () => {
      writeFileSync(join(TMP_PROJECT, 'README.md'), '# Test\n');
      writeFileSync(join(TMP_PROJECT, 'LICENSE'), 'MIT\n');

      const result = collector.autoExtract(TMP_PROJECT);

      const readmeExists = result.find((p) => p.text === 'README.md must exist');
      const licenseExists = result.find((p) => p.text === 'LICENSE must exist');
      expect(readmeExists).toBeDefined();
      expect(licenseExists).toBeDefined();
    });

    it('deduplicates promises by text', () => {
      writeFileSync(join(TMP_PROJECT, 'CLAUDE.md'),
        '- README 300줄+ 필수\n- README 300줄+ 이상\n');

      const result = collector.autoExtract(TMP_PROJECT);

      const readmePromises = result.filter((p) => p.text.includes('300 lines'));
      expect(readmePromises).toHaveLength(1);
    });

    it('returns structural promises even with no CLAUDE.md', () => {
      writeFileSync(join(TMP_PROJECT, 'README.md'), '# Test\n');

      const result = collector.autoExtract(TMP_PROJECT);

      expect(result.length).toBeGreaterThan(0);
      expect(result.some((p) => p.source === 'auto-structural')).toBe(true);
    });

    it('returns empty for truly empty project', () => {
      const result = collector.autoExtract(TMP_PROJECT);

      // No files exist, no structural promises either
      expect(result).toHaveLength(0);
    });
  });
});
