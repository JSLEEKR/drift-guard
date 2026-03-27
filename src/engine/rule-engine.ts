import type { CheckResult, DriftPromise, QualityReport } from '../types.js';
import { checkFileExists } from './checks/file-exists.js';
import { checkContentMatch } from './checks/content-match.js';
import { checkMinLines } from './checks/min-lines.js';
import { checkGlobCount } from './checks/glob-count.js';
import { checkGitPattern } from './checks/git-pattern.js';
import { checkStructureMatch } from './checks/structure-match.js';
import { checkTrendCheck } from './checks/trend-check.js';

export class RuleEngine {
  runAll(
    promises: DriftPromise[],
    projectRoot: string,
    history?: QualityReport[],
  ): CheckResult[] {
    return promises
      .filter((p) => p.check_type !== 'llm_eval')
      .map((p) => this.runCheck(p, projectRoot, history));
  }

  private runCheck(
    promise: DriftPromise,
    root: string,
    history?: QualityReport[],
  ): CheckResult {
    switch (promise.check_type) {
      case 'file_exists':
        return checkFileExists(promise, root);
      case 'content_match':
        return checkContentMatch(promise, root);
      case 'min_lines':
        return checkMinLines(promise, root);
      case 'glob_count':
        return checkGlobCount(promise, root);
      case 'git_pattern':
        return checkGitPattern(promise, root);
      case 'structure_match':
        return checkStructureMatch(promise, root);
      case 'trend_check':
        return checkTrendCheck(promise, root, history);
      default:
        return {
          promiseId: promise.id,
          promiseText: promise.text,
          status: 'warn',
          detail: `Unknown check type: ${promise.check_type as string}`,
          timestamp: new Date().toISOString(),
        };
    }
  }
}
