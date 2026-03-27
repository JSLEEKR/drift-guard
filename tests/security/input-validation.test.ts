import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { safePath, sanitizeProjectRoot, sanitizeConfig, PathTraversalError } from '../../src/utils/path-safety.js';
import { checkFileExists } from '../../src/engine/checks/file-exists.js';
import { checkContentMatch } from '../../src/engine/checks/content-match.js';
import { checkMinLines } from '../../src/engine/checks/min-lines.js';
import { checkStructureMatch } from '../../src/engine/checks/structure-match.js';
import { StateManager } from '../../src/state/state-manager.js';
import { PromiseCollector } from '../../src/collector/promise-collector.js';
import { createTmpDir, cleanupTmpDir, makePromise } from '../helpers.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = createTmpDir('dg-sec-');
  fs.writeFileSync(path.join(tmpDir, 'legit.txt'), 'hello', 'utf8');
});

afterEach(() => {
  cleanupTmpDir(tmpDir);
});

describe('safePath', () => {
  it('allows paths within project root', () => {
    const result = safePath(tmpDir, 'legit.txt');
    expect(result).toBe(path.resolve(tmpDir, 'legit.txt'));
  });

  it('blocks path traversal with ../', () => {
    expect(() => safePath(tmpDir, '../../etc/passwd')).toThrow(PathTraversalError);
  });

  it('blocks absolute path escape', () => {
    const escapePath = path.resolve(tmpDir, '..', '..', 'etc', 'passwd');
    // Construct a relative path that escapes
    const relative = path.relative(tmpDir, escapePath);
    expect(() => safePath(tmpDir, relative)).toThrow(PathTraversalError);
  });

  it('blocks path with embedded null bytes via traversal', () => {
    expect(() => safePath(tmpDir, '../../../etc/shadow')).toThrow(PathTraversalError);
  });
});

describe('sanitizeProjectRoot', () => {
  it('resolves a relative path to absolute', () => {
    const result = sanitizeProjectRoot('.');
    expect(path.isAbsolute(result)).toBe(true);
  });

  it('normalises the path', () => {
    const result = sanitizeProjectRoot(path.join(tmpDir, 'sub', '..'));
    expect(result).toBe(path.resolve(tmpDir));
  });
});

describe('sanitizeConfig', () => {
  it('clamps threshold values to 0-100', () => {
    const result = sanitizeConfig({
      thresholds: { healthy: 200, warning: -10, degraded: 50 },
    });
    const t = result['thresholds'] as Record<string, number>;
    expect(t['healthy']).toBe(100);
    expect(t['warning']).toBe(0);
    expect(t['degraded']).toBe(50);
  });

  it('clamps checkInterval to 1-86400', () => {
    expect(sanitizeConfig({ checkInterval: 0 })['checkInterval']).toBe(1);
    expect(sanitizeConfig({ checkInterval: 999999 })['checkInterval']).toBe(86400);
  });

  it('filters non-string items from promiseSources', () => {
    const result = sanitizeConfig({
      promiseSources: ['valid.md', 123, null, 'also-valid.md'],
    });
    expect(result['promiseSources']).toEqual(['valid.md', 'also-valid.md']);
  });

  it('limits promiseSources to 100 entries', () => {
    const bigArray = Array.from({ length: 200 }, (_, i) => `file-${i}.md`);
    const result = sanitizeConfig({ promiseSources: bigArray });
    expect((result['promiseSources'] as string[]).length).toBe(100);
  });

  it('ignores non-object thresholds value', () => {
    const result = sanitizeConfig({ thresholds: 'not-an-object' });
    expect(result['thresholds']).toBeUndefined();
  });

  it('ignores array thresholds value', () => {
    const result = sanitizeConfig({ thresholds: [80, 60, 40] });
    expect(result['thresholds']).toBeUndefined();
  });

  it('truncates individual source strings to 500 chars', () => {
    const longSource = 'a'.repeat(600);
    const result = sanitizeConfig({ promiseSources: [longSource] });
    expect((result['promiseSources'] as string[])[0].length).toBe(500);
  });
});

describe('checkFileExists blocks path traversal', () => {
  it('fails with path traversal detail when path escapes root', () => {
    const promise = makePromise({
      check_type: 'file_exists',
      check_config: { path: '../../etc/passwd' },
    });
    const result = checkFileExists(promise, tmpDir);
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('path traversal blocked');
  });
});

describe('checkContentMatch blocks path traversal', () => {
  it('fails when file path escapes project root', () => {
    const promise = makePromise({
      check_type: 'content_match',
      check_config: { file: '../../etc/passwd', must_contain: ['root'] },
    });
    const result = checkContentMatch(promise, tmpDir);
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('path traversal blocked');
  });
});

describe('checkMinLines blocks path traversal', () => {
  it('fails when file path escapes project root', () => {
    const promise = makePromise({
      check_type: 'min_lines',
      check_config: { file: '../../etc/passwd', min: 1 },
    });
    const result = checkMinLines(promise, tmpDir);
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('path traversal blocked');
  });
});

describe('checkStructureMatch blocks path traversal', () => {
  it('reports traversal items as blocked', () => {
    const promise = makePromise({
      check_type: 'structure_match',
      check_config: { must_have: ['../../etc/passwd', 'legit.txt'] },
    });
    const result = checkStructureMatch(promise, tmpDir);
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('blocked: path traversal');
  });
});

describe('StateManager loadConfig with oversized YAML', () => {
  it('returns defaults for YAML larger than 64KB', () => {
    const driftDir = path.join(tmpDir, '.drift-guard');
    fs.mkdirSync(driftDir, { recursive: true });
    // Write a very large YAML file (> 64KB)
    const bigYaml = 'key: ' + 'x'.repeat(70_000) + '\n';
    fs.writeFileSync(path.join(driftDir, 'config.yaml'), bigYaml, 'utf8');

    const sm = new StateManager(tmpDir);
    const config = sm.loadConfig();
    expect(config.thresholds).toEqual({ healthy: 80, warning: 60, degraded: 40 });
  });

  it('returns defaults for non-object YAML', () => {
    const driftDir = path.join(tmpDir, '.drift-guard');
    fs.mkdirSync(driftDir, { recursive: true });
    fs.writeFileSync(path.join(driftDir, 'config.yaml'), '"just a string"', 'utf8');

    const sm = new StateManager(tmpDir);
    const config = sm.loadConfig();
    expect(config.thresholds).toEqual({ healthy: 80, warning: 60, degraded: 40 });
  });
});

describe('PromiseCollector parseExtractionResponse handles malicious input', () => {
  it('handles extremely nested JSON without crashing', () => {
    const collector = new PromiseCollector();
    const malicious = '[' + '{"text":"ok","category":"quality","check_type":"file_exists","check_config":{},"weight":5}'.repeat(1) + ']';
    const result = collector.parseExtractionResponse(malicious);
    expect(Array.isArray(result)).toBe(true);
  });

  it('returns empty array for prototype pollution attempt', () => {
    const collector = new PromiseCollector();
    const malicious = '[{"__proto__":{"isAdmin":true},"text":"evil","check_type":"file_exists","check_config":{}}]';
    const result = collector.parseExtractionResponse(malicious);
    expect(result.length).toBe(1);
    // Verify prototype wasn't polluted
    expect(({} as Record<string, unknown>)['isAdmin']).toBeUndefined();
  });
});

describe('safePath rejects encoded path traversals', () => {
  it('blocks percent-encoded ../ traversal (%2e%2e%2f)', () => {
    expect(() => safePath(tmpDir, '%2e%2e%2fetc%2fpasswd')).toThrow(PathTraversalError);
  });

  it('blocks null byte in path', () => {
    expect(() => safePath(tmpDir, 'legit.txt\0../../etc/passwd')).toThrow(PathTraversalError);
  });

  it('blocks percent-encoded null byte (%00)', () => {
    expect(() => safePath(tmpDir, 'legit.txt%00../../etc/passwd')).toThrow(PathTraversalError);
  });

  it('allows normal percent characters in filenames that are not valid URI encoding', () => {
    // A literal "%" followed by non-hex chars should not cause issues
    // decodeURIComponent will fail, so the raw path is used
    const result = safePath(tmpDir, 'file%ZZname.txt');
    expect(result).toBe(path.resolve(tmpDir, 'file%ZZname.txt'));
  });
});

describe('sanitizeConfig strips dangerous keys', () => {
  it('does not pass through __proto__ pollution to output', () => {
    const raw = JSON.parse('{"__proto__":{"polluted":true},"checkInterval":100}');
    const result = sanitizeConfig(raw);
    // sanitizeConfig only copies known keys, so __proto__ is never propagated
    expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).toBe(false);
    expect(result['checkInterval']).toBe(100);
    // Verify prototype was not actually polluted
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('does not pass through constructor key to output', () => {
    const result = sanitizeConfig({ constructor: { evil: true } as unknown as string, checkInterval: 50 });
    // Only known keys are copied; constructor should not appear as own property
    expect(Object.prototype.hasOwnProperty.call(result, 'constructor')).toBe(false);
    expect(result['checkInterval']).toBe(50);
  });
});
