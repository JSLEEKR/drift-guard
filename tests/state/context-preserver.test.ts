import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextPreserver } from '../../src/state/context-preserver.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'drift-guard-cp-'));
}

describe('ContextPreserver', () => {
  let tmpDir: string;
  let driftDir: string;
  let cp: ContextPreserver;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    driftDir = path.join(tmpDir, '.drift-guard');
    fs.mkdirSync(driftDir, { recursive: true });
    cp = new ContextPreserver(driftDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('save writes context.md to the drift directory', () => {
    cp.save('This is a summary of the current session.');
    expect(fs.existsSync(path.join(driftDir, 'context.md'))).toBe(true);
  });

  it('load returns the saved content', () => {
    const summary = 'Session context: quality is improving.';
    cp.save(summary);
    const content = cp.load();
    expect(content).not.toBeNull();
    expect(content).toContain(summary);
  });

  it('load returns null when context.md does not exist', () => {
    expect(cp.load()).toBeNull();
  });

  it('save overwrites previous context.md', () => {
    cp.save('first version');
    cp.save('second version');
    const content = cp.load();
    expect(content).toContain('second version');
    expect(content).not.toContain('first version');
  });

  it('saved content includes an ISO timestamp header', () => {
    cp.save('some summary');
    const content = cp.load()!;
    // Expect a line like <!-- saved: 2025-01-01T00:00:00.000Z -->
    expect(content).toMatch(/<!-- saved: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z -->/);
  });

  it('exists() returns false before save and true after save', () => {
    expect(cp.exists()).toBe(false);
    cp.save('test summary');
    expect(cp.exists()).toBe(true);
  });

  it('save with metadata appends key-value lines inside HTML comment', () => {
    cp.save('session summary', { score: 85, status: 'healthy' });
    const content = cp.load()!;
    expect(content).toContain('session summary');
    expect(content).toContain('<!-- metadata');
    expect(content).toContain('score: 85');
    expect(content).toContain('status: "healthy"');
    expect(content).toContain('-->');
  });

  it('save without metadata does not include metadata block', () => {
    cp.save('no meta here');
    const content = cp.load()!;
    expect(content).not.toContain('<!-- metadata');
  });

  it('save with empty metadata object does not include metadata block', () => {
    cp.save('empty meta', {});
    const content = cp.load()!;
    expect(content).not.toContain('<!-- metadata');
  });
});
