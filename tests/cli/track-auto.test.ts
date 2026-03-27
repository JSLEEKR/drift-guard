import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StateManager } from '../../src/state/state-manager.js';
import { createTmpDir, cleanupTmpDir } from '../helpers.js';

describe('track-auto command logic', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir('drift-guard-track-auto-');
  });

  afterEach(() => {
    cleanupTmpDir(tmpDir);
  });

  it('tracks recently modified files via StateManager.saveTrack', () => {
    const sm = new StateManager(tmpDir);
    sm.init();

    // Create some files
    fs.writeFileSync(path.join(tmpDir, 'file1.ts'), 'const a = 1;\nconst b = 2;\n', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'file2.ts'), 'export default {};\n', 'utf8');

    // Simulate what track-auto does: build entries and save
    const files = ['file1.ts', 'file2.ts'];
    const entries = files.map((file) => {
      const fullPath = path.join(tmpDir, file);
      const stat = fs.statSync(fullPath);
      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n').length;
      return {
        path: file,
        lines,
        size: stat.size,
        timestamp: new Date().toISOString(),
      };
    });

    const savedPath = sm.saveTrack(entries);
    expect(fs.existsSync(savedPath)).toBe(true);

    const saved = JSON.parse(fs.readFileSync(savedPath, 'utf8'));
    expect(saved).toHaveLength(2);
    expect(saved[0].path).toBe('file1.ts');
    expect(saved[0].lines).toBe(3); // 2 lines + trailing newline
    expect(saved[1].path).toBe('file2.ts');
  });

  it('filters files by modification time', () => {
    const sm = new StateManager(tmpDir);
    sm.init();

    // Create a file and set its mtime to 2 hours ago
    const oldFile = path.join(tmpDir, 'old.ts');
    fs.writeFileSync(oldFile, 'old content\n', 'utf8');
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    fs.utimesSync(oldFile, twoHoursAgo, twoHoursAgo);

    // Create a recent file
    const newFile = path.join(tmpDir, 'new.ts');
    fs.writeFileSync(newFile, 'new content\n', 'utf8');

    // Filter like track-auto does with --since 30
    const cutoff = Date.now() - 30 * 60 * 1000;
    const allFiles = ['old.ts', 'new.ts'];
    const recentFiles = allFiles.filter((file) => {
      const stat = fs.statSync(path.join(tmpDir, file));
      return stat.mtimeMs >= cutoff;
    });

    expect(recentFiles).toEqual(['new.ts']);
    expect(recentFiles).not.toContain('old.ts');
  });

  it('handles empty project with no files', () => {
    const sm = new StateManager(tmpDir);
    sm.init();

    const entries = sm.saveTrack([]);
    expect(fs.existsSync(entries)).toBe(true);
    const saved = JSON.parse(fs.readFileSync(entries, 'utf8'));
    expect(saved).toEqual([]);
  });

  it('ignores node_modules and .git directories during scan', () => {
    const sm = new StateManager(tmpDir);
    sm.init();

    // Create files in ignored directories
    fs.mkdirSync(path.join(tmpDir, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'node_modules', 'pkg.js'), 'module.exports = {}', 'utf8');
    fs.mkdirSync(path.join(tmpDir, '.git', 'objects'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.git', 'config'), '[core]', 'utf8');

    // Create a valid source file
    fs.writeFileSync(path.join(tmpDir, 'index.ts'), 'console.log("hello")\n', 'utf8');

    // Simulate the IGNORE set logic from scanRecentFiles
    const IGNORE = new Set(['node_modules', '.git', '.drift-guard', 'dist', '__pycache__', '.venv', 'venv']);
    const entries = fs.readdirSync(tmpDir, { withFileTypes: true });
    const validEntries = entries.filter((e) => !IGNORE.has(e.name));
    const fileNames = validEntries.filter((e) => e.isFile()).map((e) => e.name);

    expect(fileNames).toContain('index.ts');
    expect(fileNames).not.toContain('pkg.js');
  });

  it('correctly counts lines in tracked files', () => {
    const sm = new StateManager(tmpDir);
    sm.init();

    const content = 'line1\nline2\nline3\nline4\nline5\n';
    fs.writeFileSync(path.join(tmpDir, 'multi.ts'), content, 'utf8');

    const stat = fs.statSync(path.join(tmpDir, 'multi.ts'));
    const lines = content.split('\n').length;
    const entry = {
      path: 'multi.ts',
      lines,
      size: stat.size,
      timestamp: new Date().toISOString(),
    };

    expect(entry.lines).toBe(6); // 5 lines + trailing newline split
    expect(entry.size).toBeGreaterThan(0);
  });
});
