import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CheckResult, DriftPromise } from '../../types.js';
import { safePath } from '../../utils/path-safety.js';

export function checkMinLines(
  promise: DriftPromise,
  projectRoot: string,
): CheckResult {
  const config = promise.check_config;
  const timestamp = new Date().toISOString();

  const file = config['file'];
  const min = config['min'];

  if (typeof file !== 'string') {
    return {
      promiseId: promise.id,
      promiseText: promise.text,
      status: 'fail',
      detail: 'min_lines check requires "file" in config',
      timestamp,
    };
  }

  if (typeof min !== 'number') {
    return {
      promiseId: promise.id,
      promiseText: promise.text,
      status: 'fail',
      detail: 'min_lines check requires "min" number in config',
      timestamp,
    };
  }

  let filePath: string;
  try {
    filePath = safePath(projectRoot, file);
  } catch {
    return {
      promiseId: promise.id,
      promiseText: promise.text,
      status: 'fail',
      detail: `Path "${file}" is outside the project root (path traversal blocked)`,
      timestamp,
    };
  }
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

  const lineCount = content.split('\n').length;

  if (lineCount >= min) {
    return {
      promiseId: promise.id,
      promiseText: promise.text,
      status: 'pass',
      detail: `"${file}" has ${lineCount} lines (min: ${min})`,
      timestamp,
    };
  }

  return {
    promiseId: promise.id,
    promiseText: promise.text,
    status: 'fail',
    detail: `"${file}" has ${lineCount} lines, expected at least ${min}`,
    timestamp,
  };
}
