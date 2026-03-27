import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import type { DriftGuardConfig, DriftPromise, TrackEntry } from '../types.js';
import { sanitizeConfig } from '../utils/path-safety.js';

const DRIFT_DIR = '.drift-guard';
const PROMISES_FILE = 'promises.json';
const CONFIG_FILE = 'config.yaml';
const HISTORY_SUBDIR = 'history';

const DEFAULT_CONFIG: Required<DriftGuardConfig> = {
  thresholds: { healthy: 80, warning: 60, degraded: 40 },
  checkInterval: 3600,
  promiseSources: [],
  ignore: [],
};

export class StateManager {
  private driftDir: string;

  constructor(private projectRoot: string) {
    this.driftDir = path.join(projectRoot, DRIFT_DIR);
  }

  /** Create .drift-guard/ and .drift-guard/history/ directories */
  init(projectRoot?: string): void {
    const base = projectRoot ?? this.projectRoot;
    this.projectRoot = base;
    this.driftDir = path.join(base, DRIFT_DIR);

    fs.mkdirSync(this.driftDir, { recursive: true });
    fs.mkdirSync(path.join(this.driftDir, HISTORY_SUBDIR), { recursive: true });
  }

  /** Atomically write promises.json via a temp file + rename */
  savePromises(promises: DriftPromise[]): void {
    this.ensureDriftDir();
    const dest = path.join(this.driftDir, PROMISES_FILE);
    const tmp = dest + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(promises, null, 2), 'utf8');
    fs.renameSync(tmp, dest);
  }

  /** Read promises.json; return [] if the file is missing or corrupted */
  loadPromises(): DriftPromise[] {
    const filePath = path.join(this.driftDir, PROMISES_FILE);
    if (!fs.existsSync(filePath)) return [];
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(raw) as DriftPromise[];
    } catch {
      return [];
    }
  }

  /** Write config.yaml */
  saveConfig(config: DriftGuardConfig): void {
    this.ensureDriftDir();
    const filePath = path.join(this.driftDir, CONFIG_FILE);
    fs.writeFileSync(filePath, yaml.dump(config), 'utf8');
  }

  /** Read config.yaml; return defaults if the file is missing or oversized */
  loadConfig(): Required<DriftGuardConfig> {
    const filePath = path.join(this.driftDir, CONFIG_FILE);
    if (!fs.existsSync(filePath)) return { ...DEFAULT_CONFIG };
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      // Reject oversized YAML (> 64 KB) to prevent YAML bomb attacks
      if (raw.length > 65_536) {
        return { ...DEFAULT_CONFIG };
      }
      const parsed = yaml.load(raw, { schema: yaml.CORE_SCHEMA }) as DriftGuardConfig;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { ...DEFAULT_CONFIG };
      }
      const safe = sanitizeConfig(parsed as unknown as Record<string, unknown>);
      return {
        thresholds: (safe['thresholds'] as DriftGuardConfig['thresholds']) ?? DEFAULT_CONFIG.thresholds,
        checkInterval: (safe['checkInterval'] as number) ?? DEFAULT_CONFIG.checkInterval,
        promiseSources: (safe['promiseSources'] as string[]) ?? DEFAULT_CONFIG.promiseSources,
        ignore: (safe['ignore'] as string[]) ?? DEFAULT_CONFIG.ignore,
      };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  /** Write a track snapshot to history/track-{timestamp}.json */
  saveTrack(entries: TrackEntry[]): string {
    const histDir = path.join(this.driftDir, HISTORY_SUBDIR);
    fs.mkdirSync(histDir, { recursive: true });
    const timestamp = Date.now();
    const filename = `track-${timestamp}.json`;
    const filePath = path.join(histDir, filename);
    fs.writeFileSync(filePath, JSON.stringify(entries, null, 2), 'utf8');
    return filePath;
  }

  /** Return the project root directory */
  getProjectRoot(): string {
    return this.projectRoot;
  }

  // ── private helpers ───────────────────────────────────────────────────────

  private ensureDriftDir(): void {
    fs.mkdirSync(this.driftDir, { recursive: true });
  }
}
