export interface DriftPromise {
  id: string;
  source: string;
  category: 'process' | 'style' | 'architecture' | 'quality' | 'security';
  text: string;
  check_type: CheckType;
  check_config: Record<string, unknown>;
  weight: number;
}

export type CheckType =
  | 'file_exists'
  | 'min_lines'
  | 'content_match'
  | 'glob_count'
  | 'git_pattern'
  | 'structure_match'
  | 'trend_check'
  | 'llm_eval';

export interface CheckResult {
  promiseId: string;
  promiseText: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
  timestamp: string;
}

export type QualityStatus = 'healthy' | 'warning' | 'degraded' | 'critical';
export type TrendDirection = 'improving' | 'stable' | 'declining';

export interface QualityReport {
  score: number;
  status: QualityStatus;
  stage: 1 | 2;
  violations: CheckResult[];
  trend: TrendDirection;
  recommendation: string;
  timestamp: string;
}

export interface TrackEntry {
  path: string;
  lines: number;
  size: number;
  sections?: string[];
  timestamp: string;
}

export interface SessionReport {
  startScore: number;
  endScore: number;
  drift: number;
  totalChecks: number;
  violations: number;
  topViolations: string[];
  recommendation: string;
}

export interface DriftGuardConfig {
  thresholds?: { healthy?: number; warning?: number; degraded?: number };
  checkInterval?: number;
  promiseSources?: string[];
  ignore?: string[];
}

export interface PromiseExtractionRequest {
  instruction: string;
  fileContents: Array<{ path: string; content: string }>;
}

export interface DriftGuardState {
  promises: DriftPromise[];
  history: QualityReport[];
  tracks: TrackEntry[];
}
