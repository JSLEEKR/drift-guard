import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CheckResult, DriftPromise } from '../../types.js';

export function checkContentMatch(
  promise: DriftPromise,
  projectRoot: string,
): CheckResult {
  const config = promise.check_config;
  const timestamp = new Date().toISOString();

  const file = config['file'];
  const mustContain = config['must_contain'];

  if (typeof file !== 'string') {
    return {
      promiseId: promise.id,
      promiseText: promise.text,
      status: 'fail',
      detail: 'content_match check requires "file" in config',
      timestamp,
    };
  }

  if (!Array.isArray(mustContain) || mustContain.length === 0) {
    return {
      promiseId: promise.id,
      promiseText: promise.text,
      status: 'fail',
      detail: 'content_match check requires "must_contain" array in config',
      timestamp,
    };
  }

  const filePath = join(projectRoot, file);
  if (!existsSync(filePath)) {
    return {
      promiseId: promise.id,
      promiseText: promise.text,
      status: 'fail',
      detail: `File "${file}" not found`,
      timestamp,
    };
  }

  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch (err) {
    return {
      promiseId: promise.id,
      promiseText: promise.text,
      status: 'fail',
      detail: `Failed to read "${file}": ${String(err)}`,
      timestamp,
    };
  }

  const missing: string[] = [];
  for (const term of mustContain) {
    if (typeof term === 'string' && !content.includes(term)) {
      missing.push(term);
    }
  }

  if (missing.length === 0) {
    return {
      promiseId: promise.id,
      promiseText: promise.text,
      status: 'pass',
      detail: `All ${mustContain.length} required term(s) found in "${file}"`,
      timestamp,
    };
  }

  return {
    promiseId: promise.id,
    promiseText: promise.text,
    status: 'fail',
    detail: `Missing ${missing.length} term(s) in "${file}": ${missing.join(', ')}`,
    timestamp,
  };
}
