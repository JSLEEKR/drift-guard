import path from 'node:path';

/**
 * Resolve a relative file path against a project root and ensure the result
 * stays inside the root directory. Throws if the resolved path escapes.
 *
 * Handles path traversal attacks like `../../etc/passwd`.
 */
export function safePath(projectRoot: string, relativePath: string): string {
  // Reject null bytes — they can truncate paths at the OS level
  if (relativePath.includes('\0')) {
    throw new PathTraversalError(
      `Path contains null byte (possible injection attack)`,
    );
  }

  // Decode percent-encoded sequences before validation to prevent
  // bypasses like %2e%2e%2f (../) or %00 (null byte)
  let decoded: string;
  try {
    decoded = decodeURIComponent(relativePath);
  } catch {
    // If decoding fails, use the raw path — it may contain literal % characters
    decoded = relativePath;
  }

  if (decoded.includes('\0')) {
    throw new PathTraversalError(
      `Path contains encoded null byte (possible injection attack)`,
    );
  }

  const resolvedRoot = path.resolve(projectRoot);
  // Resolve using the decoded path to catch encoded traversals
  const resolvedFull = path.resolve(resolvedRoot, decoded);

  // Ensure the resolved path is inside or exactly the project root
  if (!resolvedFull.startsWith(resolvedRoot + path.sep) && resolvedFull !== resolvedRoot) {
    throw new PathTraversalError(
      `Path "${relativePath}" escapes project root "${resolvedRoot}"`,
    );
  }

  return resolvedFull;
}

/**
 * Validate that a project root path is an absolute path and does not contain
 * suspicious patterns. Returns the resolved, normalised path.
 */
export function sanitizeProjectRoot(projectRoot: string): string {
  const resolved = path.resolve(projectRoot);

  // Must be absolute after resolution
  if (!path.isAbsolute(resolved)) {
    throw new PathTraversalError(`Project root must resolve to an absolute path, got "${resolved}"`);
  }

  return resolved;
}

/**
 * Validate YAML config values to prevent unreasonable inputs.
 * Returns a safe, clamped config object.
 */
export function sanitizeConfig(raw: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};

  // Reject prototype pollution keys at top level
  const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
  for (const key of Object.keys(raw)) {
    if (DANGEROUS_KEYS.has(key)) {
      delete (raw as Record<string, unknown>)[key];
    }
  }

  // Clamp thresholds to 0-100
  if (raw['thresholds'] && typeof raw['thresholds'] === 'object' && !Array.isArray(raw['thresholds'])) {
    const t = raw['thresholds'] as Record<string, unknown>;
    safe['thresholds'] = {
      healthy: clampNumber(t['healthy'], 0, 100, 80),
      warning: clampNumber(t['warning'], 0, 100, 60),
      degraded: clampNumber(t['degraded'], 0, 100, 40),
    };
  }

  // Clamp checkInterval to 1-86400 (1 second to 1 day)
  if (typeof raw['checkInterval'] === 'number') {
    safe['checkInterval'] = clampNumber(raw['checkInterval'], 1, 86400, 3600);
  }

  // Validate promiseSources is an array of strings with limited length
  if (Array.isArray(raw['promiseSources'])) {
    safe['promiseSources'] = raw['promiseSources']
      .filter((s): s is string => typeof s === 'string')
      .slice(0, 100) // max 100 sources
      .map((s) => s.slice(0, 500)); // max 500 chars per source
  }

  // Validate ignore is an array of strings with limited length
  if (Array.isArray(raw['ignore'])) {
    safe['ignore'] = raw['ignore']
      .filter((s): s is string => typeof s === 'string')
      .slice(0, 100)
      .map((s) => s.slice(0, 500));
  }

  return safe;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

export class PathTraversalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathTraversalError';
  }
}
