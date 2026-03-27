import fs from 'node:fs';
import path from 'node:path';
import type { QualityReport } from '../types.js';

const CHECK_PREFIX = 'check-';
const CHECK_EXT = '.json';

export class History {
  private historyDir: string;

  constructor(driftDir: string) {
    this.historyDir = path.join(driftDir, 'history');
  }

  /**
   * Save a QualityReport as check-{timestamp}-{counter}.json.
   * The counter disambiguates files written within the same millisecond.
   */
  addCheck(report: QualityReport): string {
    fs.mkdirSync(this.historyDir, { recursive: true });

    const timestamp = Date.now();
    // Find an unused filename (handles sub-ms races in tests)
    let index = 0;
    let filename: string;
    do {
      filename = `${CHECK_PREFIX}${timestamp}-${index}${CHECK_EXT}`;
      index++;
    } while (fs.existsSync(path.join(this.historyDir, filename)));

    const filePath = path.join(this.historyDir, filename);
    fs.writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf8');
    return filePath;
  }

  /**
   * Load all check-*.json files from the history directory, sorted by the
   * timestamp embedded in the filename (oldest first).
   */
  getHistory(): QualityReport[] {
    if (!fs.existsSync(this.historyDir)) return [];

    const files = fs
      .readdirSync(this.historyDir)
      .filter((f) => f.startsWith(CHECK_PREFIX) && f.endsWith(CHECK_EXT))
      .sort(); // lexicographic sort matches numeric sort for fixed-format names

    const results: QualityReport[] = [];
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(this.historyDir, file), 'utf8');
        results.push(JSON.parse(raw) as QualityReport);
      } catch {
        // skip corrupted entries
      }
    }
    return results;
  }

  /** Return just the score field from every history entry (oldest first) */
  getScoreHistory(): number[] {
    return this.getHistory().map((r) => r.score);
  }

  /**
   * Keep only the last `maxEntries` check files; delete the rest.
   * Files are ordered oldest-first so we delete from the front.
   */
  trim(maxEntries: number): void {
    if (!fs.existsSync(this.historyDir)) return;

    const files = fs
      .readdirSync(this.historyDir)
      .filter((f) => f.startsWith(CHECK_PREFIX) && f.endsWith(CHECK_EXT))
      .sort();

    const toDelete = files.slice(0, Math.max(0, files.length - maxEntries));
    for (const file of toDelete) {
      fs.unlinkSync(path.join(this.historyDir, file));
    }
  }

  /** Delete every check-*.json file from the history directory */
  clear(): void {
    if (!fs.existsSync(this.historyDir)) return;

    const files = fs
      .readdirSync(this.historyDir)
      .filter((f) => f.startsWith(CHECK_PREFIX) && f.endsWith(CHECK_EXT));

    for (const file of files) {
      fs.unlinkSync(path.join(this.historyDir, file));
    }
  }
}
