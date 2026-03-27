import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Tests — verify README has required documentation sections
// ---------------------------------------------------------------------------

describe('README documentation completeness', () => {
  const readmePath = path.resolve(__dirname, '../../README.md');
  const readme = fs.readFileSync(readmePath, 'utf8');

  it('has a Troubleshooting section', () => {
    expect(readme).toContain('## Troubleshooting');
  });

  it('has a FAQ section', () => {
    expect(readme).toContain('## FAQ');
  });

  it('has a "When to Use This" section', () => {
    expect(readme).toContain('## When to Use This');
  });

  it('has an "Example Output" section with check and report examples', () => {
    expect(readme).toContain('## Example Output');
    expect(readme).toContain('drift-guard check');
    expect(readme).toContain('drift-guard report');
  });

  it('Troubleshooting covers common error scenarios', () => {
    expect(readme).toContain('No promises found');
    expect(readme).toContain('MCP server won\'t start');
    expect(readme).toContain('Score is always 100');
    expect(readme).toContain('How do I reset drift-guard');
  });

  it('FAQ answers key user questions', () => {
    expect(readme).toContain('send my code to an external server');
    expect(readme).toContain('without Claude Code');
    expect(readme).toContain('custom promises');
    expect(readme).toContain('committed to git');
    expect(readme).toContain('run drift-guard in CI');
  });

  it('has Quick Start section with install, init, and MCP config steps', () => {
    expect(readme).toContain('## Quick Start');
    expect(readme).toContain('npm install drift-guard');
    expect(readme).toContain('npx drift-guard init');
    expect(readme).toContain('drift-guard serve');
  });

  it('has Requirements section listing Node.js, TypeScript, and Git', () => {
    expect(readme).toContain('## Requirements');
    expect(readme).toContain('Node.js >= 18');
    expect(readme).toContain('TypeScript');
    expect(readme).toContain('Git');
  });
});
