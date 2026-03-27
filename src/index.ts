// Types
export type {
  CheckResult,
  CheckType,
  DriftGuardConfig,
  DriftGuardState,
  DriftPromise,
  PromiseExtractionRequest,
  QualityReport,
  QualityStatus,
  SessionReport,
  TrackEntry,
  TrendDirection,
} from './types.js';

// Scoring
export {
  classifyStatus,
  computeScore,
  detectTrend,
  generateRecommendation,
  topViolationTexts,
} from './scoring.js';

// State
export { StateManager } from './state/state-manager.js';
export { ContextPreserver } from './state/context-preserver.js';
export type { ContextMetadata } from './state/context-preserver.js';
export { History } from './state/history.js';

// Engine
export { RuleEngine } from './engine/rule-engine.js';
export { checkFileExists } from './engine/checks/file-exists.js';
export { checkContentMatch } from './engine/checks/content-match.js';
export { checkMinLines } from './engine/checks/min-lines.js';
export { checkGlobCount } from './engine/checks/glob-count.js';
export { checkGitPattern } from './engine/checks/git-pattern.js';
export { checkStructureMatch } from './engine/checks/structure-match.js';
export { checkTrendCheck } from './engine/checks/trend-check.js';
