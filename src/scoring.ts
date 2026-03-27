import type {
  CheckResult,
  DriftPromise,
  QualityStatus,
  TrendDirection,
} from './types.js';

/**
 * Compute a weighted quality score (0–100) from an array of check results
 * against a set of promises.
 *
 * Score logic:
 *  - pass  → full weight
 *  - warn  → half weight
 *  - fail  → zero weight
 *
 * Returns 100 when there are no results or no promises to avoid false alarms.
 */
export function computeScore(
  results: CheckResult[],
  promises: DriftPromise[],
): number {
  if (results.length === 0 || promises.length === 0) return 100;

  const weightMap = new Map<string, number>(
    promises.map((p) => [p.id, p.weight]),
  );

  let totalWeight = 0;
  let earnedWeight = 0;

  for (const result of results) {
    const weight = weightMap.get(result.promiseId) ?? 1;
    totalWeight += weight;

    if (result.status === 'pass') {
      earnedWeight += weight;
    } else if (result.status === 'warn') {
      earnedWeight += weight * 0.5;
    }
    // 'fail' contributes 0
  }

  if (totalWeight === 0) return 100;

  const raw = (earnedWeight / totalWeight) * 100;
  return Math.round(raw * 10) / 10; // one decimal place
}

/**
 * Classify a numeric score into a QualityStatus using configurable thresholds.
 *
 * Default thresholds (inclusive lower bound):
 *   healthy  ≥ 80
 *   warning  ≥ 60
 *   degraded ≥ 40
 *   critical  < 40
 */
export function classifyStatus(
  score: number,
  thresholds?: { healthy?: number; warning?: number; degraded?: number },
): QualityStatus {
  const healthy = thresholds?.healthy ?? 80;
  const warning = thresholds?.warning ?? 60;
  const degraded = thresholds?.degraded ?? 40;

  if (score >= healthy) return 'healthy';
  if (score >= warning) return 'warning';
  if (score >= degraded) return 'degraded';
  return 'critical';
}

/**
 * Detect the trend direction given an ordered history of scores
 * (oldest → newest).
 *
 * Uses the last 5 scores for the calculation.
 *  - improving : average delta > +2
 *  - declining : average delta < -2
 *  - stable    : otherwise
 *
 * Returns 'stable' when fewer than 2 data points are provided.
 */
export function detectTrend(history: number[]): TrendDirection {
  if (history.length < 2) return 'stable';

  const window = history.slice(-5);
  const deltas: number[] = [];

  for (let i = 1; i < window.length; i++) {
    deltas.push(window[i] - window[i - 1]);
  }

  const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;

  if (avgDelta > 2) return 'improving';
  if (avgDelta < -2) return 'declining';
  return 'stable';
}

/**
 * Generate a human-readable recommendation based on status, trend, and
 * the top failing violations.
 */
export function generateRecommendation(
  status: QualityStatus,
  trend: TrendDirection,
  topViolations: string[],
): string {
  const violationHint =
    topViolations.length > 0
      ? ` Focus on: ${topViolations.slice(0, 3).join(', ')}.`
      : '';

  switch (status) {
    case 'healthy':
      if (trend === 'improving') {
        return `Quality is healthy and improving. Keep up the good work.${violationHint}`;
      }
      if (trend === 'declining') {
        return `Quality is currently healthy but showing a declining trend. Monitor closely.${violationHint}`;
      }
      return `Quality is healthy. No immediate action required.${violationHint}`;

    case 'warning':
      if (trend === 'declining') {
        return `Quality is in warning and declining — act now before it degrades further.${violationHint}`;
      }
      if (trend === 'improving') {
        return `Quality is in warning but improving. Continue the fixes.${violationHint}`;
      }
      return `Quality is in warning. Address violations to restore health.${violationHint}`;

    case 'degraded':
      if (trend === 'declining') {
        return `Quality is degraded and declining. Immediate remediation required.${violationHint}`;
      }
      return `Quality is degraded. Prioritise violation fixes urgently.${violationHint}`;

    case 'critical':
      return `Quality is critical. Stop new work and fix violations immediately.${violationHint}`;
  }
}

/**
 * Pick the top N violations by weight (highest weight first) from a list of
 * failed/warned check results paired with their promise definitions.
 */
export function topViolationTexts(
  results: CheckResult[],
  promises: DriftPromise[],
  limit = 3,
): string[] {
  const weightMap = new Map<string, number>(
    promises.map((p) => [p.id, p.weight]),
  );

  return results
    .filter((r) => r.status === 'fail' || r.status === 'warn')
    .sort(
      (a, b) =>
        (weightMap.get(b.promiseId) ?? 0) - (weightMap.get(a.promiseId) ?? 0),
    )
    .slice(0, limit)
    .map((r) => r.promiseText);
}
