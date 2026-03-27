import { globSync } from 'node:fs';
import type { CheckResult, DriftPromise } from '../../types.js';

export function checkGlobCount(
  promise: DriftPromise,
  projectRoot: string,
): CheckResult {
  const config = promise.check_config;
  const timestamp = new Date().toISOString();

  const pattern = config['pattern'];
  const min = config['min'];

  if (typeof pattern !== 'string') {
    return {
      promiseId: promise.id,
      promiseText: promise.text,
      status: 'fail',
      detail: 'glob_count check requires "pattern" in config',
      timestamp,
    };
  }

  if (typeof min !== 'number') {
    return {
      promiseId: promise.id,
      promiseText: promise.text,
      status: 'fail',
      detail: 'glob_count check requires "min" number in config',
      timestamp,
    };
  }

  let matches: string[] = [];
  try {
    matches = globSync(pattern, { cwd: projectRoot });
  } catch {
    matches = [];
  }

  if (matches.length >= min) {
    return {
      promiseId: promise.id,
      promiseText: promise.text,
      status: 'pass',
      detail: `Pattern "${pattern}" matched ${matches.length} file(s) (min: ${min})`,
      timestamp,
    };
  }

  return {
    promiseId: promise.id,
    promiseText: promise.text,
    status: 'fail',
    detail: `Pattern "${pattern}" matched ${matches.length} file(s), expected at least ${min}`,
    timestamp,
  };
}
