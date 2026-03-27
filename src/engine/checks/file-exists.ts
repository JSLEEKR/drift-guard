import { existsSync, globSync } from 'node:fs';
import type { CheckResult, DriftPromise } from '../../types.js';
import { safePath } from '../../utils/path-safety.js';

export function checkFileExists(
  promise: DriftPromise,
  projectRoot: string,
): CheckResult {
  const config = promise.check_config;
  const timestamp = new Date().toISOString();

  if (typeof config['glob'] === 'string') {
    const pattern = config['glob'] as string;
    let matches: string[] = [];
    try {
      matches = globSync(pattern, { cwd: projectRoot });
    } catch {
      matches = [];
    }
    if (matches.length > 0) {
      return {
        promiseId: promise.id,
        promiseText: promise.text,
        status: 'pass',
        detail: `Glob "${pattern}" matched ${matches.length} file(s)`,
        timestamp,
      };
    }
    return {
      promiseId: promise.id,
      promiseText: promise.text,
      status: 'fail',
      detail: `Glob "${pattern}" matched no files in ${projectRoot}`,
      timestamp,
    };
  }

  if (typeof config['path'] === 'string') {
    let filePath: string;
    try {
      filePath = safePath(projectRoot, config['path'] as string);
    } catch {
      return {
        promiseId: promise.id,
        promiseText: promise.text,
        status: 'fail',
        detail: `Path "${config['path']}" is outside the project root (path traversal blocked)`,
        timestamp,
      };
    }
    if (existsSync(filePath)) {
      return {
        promiseId: promise.id,
        promiseText: promise.text,
        status: 'pass',
        detail: `File "${config['path']}" exists`,
        timestamp,
      };
    }
    return {
      promiseId: promise.id,
      promiseText: promise.text,
      status: 'fail',
      detail: `File "${config['path']}" not found in ${projectRoot}`,
      timestamp,
    };
  }

  return {
    promiseId: promise.id,
    promiseText: promise.text,
    status: 'fail',
    detail: 'file_exists check requires "path" or "glob" in config',
    timestamp,
  };
}
