import type { CheckResult, DriftPromise, QualityReport } from '../../types.js';

export function checkTrendCheck(
  promise: DriftPromise,
  _projectRoot: string,
  history?: QualityReport[],
): CheckResult {
  const config = promise.check_config;
  const timestamp = new Date().toISOString();

  const metric = config['metric'];
  const direction = config['direction'];

  if (typeof metric !== 'string') {
    return {
      promiseId: promise.id,
      promiseText: promise.text,
      status: 'fail',
      detail: 'trend_check requires "metric" in config',
      timestamp,
    };
  }

  if (typeof direction !== 'string') {
    return {
      promiseId: promise.id,
      promiseText: promise.text,
      status: 'fail',
      detail: 'trend_check requires "direction" in config',
      timestamp,
    };
  }

  if (!history || history.length < 2) {
    return {
      promiseId: promise.id,
      promiseText: promise.text,
      status: 'warn',
      detail: 'Insufficient history to evaluate trend (need at least 2 reports)',
      timestamp,
    };
  }

  // Extract the metric values from history
  const values = history.map((report) => {
    if (metric === 'score') return report.score;
    return null;
  }).filter((v): v is number => v !== null);

  if (values.length < 2) {
    return {
      promiseId: promise.id,
      promiseText: promise.text,
      status: 'warn',
      detail: `Insufficient data for metric "${metric}"`,
      timestamp,
    };
  }

  const recent = values[values.length - 1];
  const previous = values[values.length - 2];
  const delta = recent - previous;

  if (direction === 'not_declining') {
    if (delta >= 0) {
      return {
        promiseId: promise.id,
        promiseText: promise.text,
        status: 'pass',
        detail: `Metric "${metric}" is not declining (${previous} → ${recent}, delta: ${delta >= 0 ? '+' : ''}${delta})`,
        timestamp,
      };
    }
    return {
      promiseId: promise.id,
      promiseText: promise.text,
      status: 'fail',
      detail: `Metric "${metric}" is declining (${previous} → ${recent}, delta: ${delta})`,
      timestamp,
    };
  }

  if (direction === 'improving') {
    if (delta > 0) {
      return {
        promiseId: promise.id,
        promiseText: promise.text,
        status: 'pass',
        detail: `Metric "${metric}" is improving (${previous} → ${recent}, delta: +${delta})`,
        timestamp,
      };
    }
    return {
      promiseId: promise.id,
      promiseText: promise.text,
      status: 'fail',
      detail: `Metric "${metric}" is not improving (${previous} → ${recent}, delta: ${delta})`,
      timestamp,
    };
  }

  return {
    promiseId: promise.id,
    promiseText: promise.text,
    status: 'warn',
    detail: `Unknown direction "${direction}" in trend_check config`,
    timestamp,
  };
}
