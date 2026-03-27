import fs from 'node:fs';
import path from 'node:path';

const CONTEXT_FILE = 'context.md';

export interface ContextMetadata {
  [key: string]: unknown;
}

export class ContextPreserver {
  private contextPath: string;

  constructor(driftDir: string) {
    this.contextPath = path.join(driftDir, CONTEXT_FILE);
  }

  /**
   * Write context.md with an ISO timestamp header followed by the summary
   * and any optional metadata serialised as YAML-like key/value lines.
   */
  save(summary: string, metadata?: ContextMetadata): void {
    const timestamp = new Date().toISOString();
    const lines: string[] = [`<!-- saved: ${timestamp} -->`, '', summary];

    if (metadata && Object.keys(metadata).length > 0) {
      lines.push('');
      lines.push('<!-- metadata');
      for (const [key, value] of Object.entries(metadata)) {
        lines.push(`  ${key}: ${JSON.stringify(value)}`);
      }
      lines.push('-->');
    }

    const dir = path.dirname(this.contextPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.contextPath, lines.join('\n'), 'utf8');
  }

  /** Read context.md and return its full content, or null if it does not exist */
  load(): string | null {
    if (!fs.existsSync(this.contextPath)) return null;
    return fs.readFileSync(this.contextPath, 'utf8');
  }

  /** Return true when context.md exists on disk */
  exists(): boolean {
    return fs.existsSync(this.contextPath);
  }
}
