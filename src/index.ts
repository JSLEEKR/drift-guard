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
