import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import type { CheckType, DriftPromise, PromiseExtractionRequest } from '../types.js';

const EXTRACTION_INSTRUCTION = `Read these project configuration files and extract all "promises" — rules, standards, processes, and quality expectations the user wants maintained.

For each promise, return a JSON array of objects with:
- text: what was promised (in English)
- category: process | style | architecture | quality | security
- check_type: file_exists | min_lines | content_match | glob_count | git_pattern | structure_match | trend_check | llm_eval
- check_config: parameters for the check (e.g., { "file": "README.md", "min": 300 })
- weight: importance 1-10

Return ONLY a JSON array, no other text.`;

const KNOWN_CHECK_TYPES: Set<string> = new Set([
  'file_exists',
  'min_lines',
  'content_match',
  'glob_count',
  'git_pattern',
  'structure_match',
  'trend_check',
  'llm_eval',
]);

const DEFAULT_SOURCE_PATTERNS = [
  'CLAUDE.md',
  'memory/*.md',
  'docs/specs/*.md',
  '.drift-guard/config.yaml',
];

/** Simple glob: supports one-level `dir/*.ext` patterns */
function resolvePattern(projectRoot: string, pattern: string): string[] {
  const starIdx = pattern.indexOf('*');
  if (starIdx === -1) {
    // Literal path
    const fullPath = join(projectRoot, pattern);
    return existsSync(fullPath) ? [fullPath] : [];
  }

  // Pattern with a wildcard — support `dir/*.ext`
  const dir = dirname(pattern);
  const filePart = basename(pattern); // e.g. "*.md"
  const ext = filePart.startsWith('*') ? filePart.slice(1) : ''; // e.g. ".md"
  const prefix = filePart.includes('*') ? filePart.split('*')[0] : ''; // prefix before *

  const fullDir = join(projectRoot, dir);
  if (!existsSync(fullDir)) return [];

  try {
    const entries = readdirSync(fullDir);
    return entries
      .filter((entry) => {
        const fullEntry = join(fullDir, entry);
        try {
          return statSync(fullEntry).isFile() &&
            (prefix ? entry.startsWith(prefix) : true) &&
            (ext ? entry.endsWith(ext) : true);
        } catch {
          return false;
        }
      })
      .map((entry) => join(fullDir, entry));
  } catch {
    return [];
  }
}

export class PromiseCollector {
  async collectSources(
    projectRoot: string,
    customSources?: string[],
  ): Promise<PromiseExtractionRequest> {
    const patterns = customSources ?? DEFAULT_SOURCE_PATTERNS;
    const fileContents: Array<{ path: string; content: string }> = [];

    for (const pattern of patterns) {
      const matchedPaths = resolvePattern(projectRoot, pattern);
      for (const fullPath of matchedPaths) {
        const relativePath = fullPath
          .replace(projectRoot, '')
          .replace(/^[/\\]/, '')
          .replace(/\\/g, '/');
        try {
          const content = readFileSync(fullPath, 'utf-8');
          fileContents.push({ path: relativePath, content });
        } catch {
          // skip unreadable
        }
      }
    }

    return {
      instruction: EXTRACTION_INSTRUCTION,
      fileContents,
    };
  }

  /**
   * Auto-extract promises from CLAUDE.md and project files using pattern matching.
   * No AI required — parses known patterns into verifiable promises.
   */
  autoExtract(projectRoot: string, customSources?: string[]): DriftPromise[] {
    const patterns = customSources ?? DEFAULT_SOURCE_PATTERNS;
    const promises: DriftPromise[] = [];
    let id = 1;

    for (const pattern of patterns) {
      const matchedPaths = resolvePattern(projectRoot, pattern);
      for (const fullPath of matchedPaths) {
        try {
          const content = readFileSync(fullPath, 'utf-8');
          const extracted = this.extractFromContent(content, id);
          promises.push(...extracted);
          id += extracted.length;
        } catch {
          // skip unreadable
        }
      }
    }

    // Always add structural promises for the project
    const structural = this.extractStructuralPromises(projectRoot, id);
    promises.push(...structural);

    return promises;
  }

  /** Extract promises from markdown content using pattern matching */
  private extractFromContent(content: string, startId: number): DriftPromise[] {
    const promises: DriftPromise[] = [];
    let id = startId;
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Pattern: "README 300줄+" or "README.md" with line requirements
      const readmeLineMatch = line.match(/README[^\d]*(\d+)\s*줄|README[^\d]*(\d+)\s*lines?/i);
      if (readmeLineMatch) {
        const min = parseInt(readmeLineMatch[1] ?? readmeLineMatch[2], 10);
        if (min > 0) {
          promises.push({
            id: `promise-${String(id++).padStart(3, '0')}`,
            source: 'auto-extracted',
            text: `README.md must have at least ${min} lines`,
            category: 'quality',
            check_type: 'min_lines',
            check_config: { file: 'README.md', min },
            weight: 6,
          });
        }
      }

      // Pattern: "tests" with count — e.g., "80+ tests", "120+ tests"
      const testCountMatch = line.match(/(\d+)\+?\s*tests?/i);
      if (testCountMatch && !line.includes('Table') && !line.includes('|')) {
        const minTests = parseInt(testCountMatch[1], 10);
        if (minTests >= 10) {
          promises.push({
            id: `promise-${String(id++).padStart(3, '0')}`,
            source: 'auto-extracted',
            text: `Project must have at least ${minTests} tests`,
            category: 'quality',
            check_type: 'glob_count',
            check_config: { pattern: '**/*.test.{ts,js,go,py,rs}', min: 1 },
            weight: 8,
          });
        }
      }

      // Pattern: "Generator ≠ Evaluator" or "NEVER combine"
      if (line.includes('Generator') && line.includes('Evaluator') && (line.includes('≠') || line.includes('NOT'))) {
        promises.push({
          id: `promise-${String(id++).padStart(3, '0')}`,
          source: 'auto-extracted',
          text: 'Generator and Evaluator must be separate agents',
          category: 'process',
          check_type: 'content_match',
          check_config: { file: 'CLAUDE.md', must_contain: ['Generator', 'Evaluator'] },
          weight: 9,
        });
      }

      // Pattern: file must exist — e.g., "CHANGELOG.md", "LICENSE"
      const fileExistMatch = line.match(/must (?:have|include|contain)\s+[`"]?(\w+(?:\.\w+)+)[`"]?/i);
      if (fileExistMatch) {
        promises.push({
          id: `promise-${String(id++).padStart(3, '0')}`,
          source: 'auto-extracted',
          text: `${fileExistMatch[1]} must exist`,
          category: 'quality',
          check_type: 'file_exists',
          check_config: { path: fileExistMatch[1] },
          weight: 5,
        });
      }

      // Pattern: topics count — "topics 8+"
      const topicsMatch = line.match(/topics?\s+(\d+)\+?/i);
      if (topicsMatch) {
        const min = parseInt(topicsMatch[1], 10);
        if (min > 0) {
          promises.push({
            id: `promise-${String(id++).padStart(3, '0')}`,
            source: 'auto-extracted',
            text: `GitHub repo must have at least ${min} topics`,
            category: 'quality',
            check_type: 'git_pattern',
            check_config: { min_commits: 1 },
            weight: 4,
          });
        }
      }

      // Pattern: security gates — hooks, pre_bash_review, etc.
      if (line.includes('.hooks/') && line.includes('.js')) {
        const hookMatch = line.match(/\.hooks\/(\S+\.js)/);
        if (hookMatch) {
          promises.push({
            id: `promise-${String(id++).padStart(3, '0')}`,
            source: 'auto-extracted',
            text: `Safety hook ${hookMatch[1]} must exist`,
            category: 'security',
            check_type: 'file_exists',
            check_config: { path: `.hooks/${hookMatch[1]}` },
            weight: 7,
          });
        }
      }

      // Pattern: "3 consecutive clean" eval requirement
      if (line.includes('3 consecutive') && (line.includes('clean') || line.includes('CLEAN'))) {
        promises.push({
          id: `promise-${String(id++).padStart(3, '0')}`,
          source: 'auto-extracted',
          text: '3 consecutive clean eval cycles required before shipping',
          category: 'process',
          check_type: 'content_match',
          check_config: { file: 'CLAUDE.md', must_contain: ['3 consecutive', 'clean'] },
          weight: 9,
        });
      }
    }

    // Deduplicate by text
    const seen = new Set<string>();
    return promises.filter((p) => {
      if (seen.has(p.text)) return false;
      seen.add(p.text);
      return true;
    });
  }

  /** Extract structural promises by checking what exists in the project */
  private extractStructuralPromises(projectRoot: string, startId: number): DriftPromise[] {
    const promises: DriftPromise[] = [];
    let id = startId;

    // Check for common required files
    const requiredFiles = ['README.md', 'LICENSE', '.gitignore'];
    for (const file of requiredFiles) {
      if (existsSync(join(projectRoot, file))) {
        promises.push({
          id: `promise-${String(id++).padStart(3, '0')}`,
          source: 'auto-structural',
          text: `${file} must exist`,
          category: 'quality',
          check_type: 'file_exists',
          check_config: { path: file },
          weight: 5,
        });
      }
    }

    // Check for CLAUDE.md
    if (existsSync(join(projectRoot, 'CLAUDE.md'))) {
      promises.push({
        id: `promise-${String(id++).padStart(3, '0')}`,
        source: 'auto-structural',
        text: 'CLAUDE.md project instructions must exist',
        category: 'architecture',
        check_type: 'file_exists',
        check_config: { path: 'CLAUDE.md' },
        weight: 7,
      });
    }

    // Check for test files
    const testDirs = ['tests', 'test', 'src', '__tests__'];
    for (const dir of testDirs) {
      const fullDir = join(projectRoot, dir);
      if (existsSync(fullDir)) {
        promises.push({
          id: `promise-${String(id++).padStart(3, '0')}`,
          source: 'auto-structural',
          text: `Test directory ${dir}/ must contain test files`,
          category: 'quality',
          check_type: 'glob_count',
          check_config: { pattern: `${dir}/**/*.test.*`, min: 1 },
          weight: 8,
        });
        break;
      }
    }

    return promises;
  }

  parseExtractionResponse(response: string): DriftPromise[] {
    // Try to extract JSON array from response
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return [];
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
        .map((item, index) => {
          const id = `promise-${String(index + 1).padStart(3, '0')}`;

          const rawCheckType =
            typeof item['check_type'] === 'string' ? item['check_type'] : 'llm_eval';
          const check_type: CheckType = KNOWN_CHECK_TYPES.has(rawCheckType)
            ? (rawCheckType as CheckType)
            : 'llm_eval';

          const rawWeight = typeof item['weight'] === 'number' ? item['weight'] : 5;
          const weight = Number.isFinite(rawWeight) ? Math.max(1, Math.min(10, rawWeight)) : 5;

          const rawCategory = typeof item['category'] === 'string' ? item['category'] : 'quality';
          const category = (
            ['process', 'style', 'architecture', 'quality', 'security'] as const
          ).includes(rawCategory as 'process' | 'style' | 'architecture' | 'quality' | 'security')
            ? (rawCategory as DriftPromise['category'])
            : 'quality';

          return {
            id,
            source: 'extracted',
            text: typeof item['text'] === 'string' ? item['text'] : '',
            category,
            check_type,
            check_config:
              typeof item['check_config'] === 'object' &&
              item['check_config'] !== null &&
              !Array.isArray(item['check_config'])
                ? (item['check_config'] as Record<string, unknown>)
                : {},
            weight,
          } satisfies DriftPromise;
        });
    } catch {
      return [];
    }
  }
}
