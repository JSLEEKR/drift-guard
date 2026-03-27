import { execSync } from 'node:child_process';
import type { CheckResult, DriftPromise } from '../../types.js';

export function checkGitPattern(
  promise: DriftPromise,
  projectRoot: string,
): CheckResult {
  const config = promise.check_config;
  const timestamp = new Date().toISOString();

  const minCommits = config['min_commits'];

  if (typeof minCommits !== 'number') {
    return {
      promiseId: promise.id,
      promiseText: promise.text,
      status: 'fail',
      detail: 'git_pattern check requires "min_commits" number in config',
      timestamp,
    };
  }

  let commitCount: number;
  try {
    const output = execSync('git log --oneline | wc -l', {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    commitCount = parseInt(output.trim(), 10);
    if (isNaN(commitCount)) {
      throw new Error(`Unexpected output: "${output.trim()}"`);
    }
  } catch (err) {
    return {
      promiseId: promise.id,
      promiseText: promise.text,
      status: 'fail',
      detail: `Failed to count git commits: ${String(err)}`,
      timestamp,
    };
  }

  if (commitCount >= minCommits) {
    return {
      promiseId: promise.id,
      promiseText: promise.text,
      status: 'pass',
      detail: `Repository has ${commitCount} commit(s) (min: ${minCommits})`,
      timestamp,
    };
  }

  return {
    promiseId: promise.id,
    promiseText: promise.text,
    status: 'fail',
    detail: `Repository has ${commitCount} commit(s), expected at least ${minCommits}`,
    timestamp,
  };
}
