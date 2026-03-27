import { existsSync } from 'node:fs';
import type { CheckResult, DriftPromise } from '../../types.js';
import { safePath } from '../../utils/path-safety.js';

export function checkStructureMatch(
  promise: DriftPromise,
  projectRoot: string,
): CheckResult {
  const config = promise.check_config;
  const timestamp = new Date().toISOString();

  const mustHave = config['must_have'];

  if (!Array.isArray(mustHave) || mustHave.length === 0) {
    return {
      promiseId: promise.id,
      promiseText: promise.text,
      status: 'fail',
      detail: 'structure_match check requires "must_have" array in config',
      timestamp,
    };
  }

  const missing: string[] = [];
  for (const item of mustHave) {
    if (typeof item === 'string') {
      try {
        const fullPath = safePath(projectRoot, item);
        if (!existsSync(fullPath)) {
          missing.push(item);
        }
      } catch {
        missing.push(`${item} (blocked: path traversal)`);
      }
    }
  }

  if (missing.length === 0) {
    return {
      promiseId: promise.id,
      promiseText: promise.text,
      status: 'pass',
      detail: `All ${mustHave.length} required path(s) exist`,
      timestamp,
    };
  }

  return {
    promiseId: promise.id,
    promiseText: promise.text,
    status: 'fail',
    detail: `Missing ${missing.length} required path(s): ${missing.join(', ')}`,
    timestamp,
  };
}
