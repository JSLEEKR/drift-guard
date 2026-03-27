import type { QualityStatus } from '../types.js';

const STATUS_SEVERITY: Record<QualityStatus, number> = {
  healthy: 0,
  warning: 1,
  degraded: 2,
  critical: 3,
};

/**
 * Determine whether the current status should cause a non-zero exit.
 * `failOn` is a threshold: if the actual status is at or above this severity, fail.
 */
export function shouldFailOn(status: QualityStatus, failOn: string): boolean {
  if (!failOn || !(failOn in STATUS_SEVERITY)) return false;
  return STATUS_SEVERITY[status] >= STATUS_SEVERITY[failOn as QualityStatus];
}
