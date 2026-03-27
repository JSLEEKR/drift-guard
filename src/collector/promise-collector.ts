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
          const weight = Number.isFinite(rawWeight) ? rawWeight : 5;

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
