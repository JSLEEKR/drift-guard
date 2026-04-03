import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'node:fs';
import path from 'node:path';

import { StateManager } from './state/state-manager.js';
import { ContextPreserver } from './state/context-preserver.js';
import { History } from './state/history.js';
import { PromiseCollector } from './collector/promise-collector.js';
import { RuleEngine } from './engine/rule-engine.js';
import { LLMEvaluator } from './engine/llm-evaluator.js';
import { sanitizeProjectRoot, safePath } from './utils/path-safety.js';
import {
  computeScore,
  classifyStatus,
  detectTrend,
  generateRecommendation,
  topViolationTexts,
} from './scoring.js';
import type { CheckResult, QualityReport, SessionReport, TrackEntry } from './types.js';

const DRIFT_DIR = '.drift-guard';

function driftDir(projectRoot: string): string {
  return path.join(projectRoot, DRIFT_DIR);
}

export function createServer(): Server {
  const server = new Server(
    { name: 'drift-guard', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  // ── List Tools ──────────────────────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'drift_guard_init',
        description:
          'Initialise drift-guard for a project: create .drift-guard/, auto-extract quality promises from CLAUDE.md, run baseline check, and restore previous session context.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            projectRoot: { type: 'string', description: 'Absolute path to the project root' },
          },
          required: ['projectRoot'],
        },
      },
      {
        name: 'drift_guard_track',
        description:
          'Track file metadata (path, line count, size, sections for .md). Saves a snapshot to history.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            files: {
              type: 'array',
              items: { type: 'string' },
              description: 'File paths to track (relative to projectRoot)',
            },
            projectRoot: { type: 'string', description: 'Absolute path to the project root' },
          },
          required: ['files', 'projectRoot'],
        },
      },
      {
        name: 'drift_guard_check',
        description:
          'Run quality checks. Stage 1 uses rule engine; if any llm_eval promises exist and rules pass, returns an evaluation prompt for Stage 2. If evaluationResult is provided, computes the final score.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            workingDir: { type: 'string', description: 'Absolute path to the project root' },
            evaluationResult: {
              type: 'object',
              description: 'Stage 2 AI evaluation result (optional)',
              properties: {
                score: { type: 'number' },
                violations: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      promise: { type: 'string' },
                      status: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
          required: ['workingDir'],
        },
      },
      {
        name: 'drift_guard_save',
        description: 'Save a session context summary to .drift-guard/context.md for future restoration.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            summary: { type: 'string', description: 'Session summary text' },
            projectRoot: { type: 'string', description: 'Absolute path to the project root' },
          },
          required: ['summary', 'projectRoot'],
        },
      },
      {
        name: 'drift_guard_report',
        description: 'Generate a session report from check history: start/end score, drift, violations.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            workingDir: { type: 'string', description: 'Absolute path to the project root' },
          },
          required: ['workingDir'],
        },
      },
    ],
  }));

  // ── Call Tool ───────────────────────────────────────────────────────────

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'drift_guard_init':
          return await handleInit(args as { projectRoot: string });

        case 'drift_guard_track':
          return await handleTrack(args as { files: string[]; projectRoot: string });

        case 'drift_guard_check':
          return await handleCheck(
            args as {
              workingDir: string;
              evaluationResult?: {
                score: number;
                violations: Array<{ promise: string; status: string }>;
              };
            },
          );

        case 'drift_guard_save':
          return await handleSave(args as { summary: string; projectRoot: string });

        case 'drift_guard_report':
          return await handleReport(args as { workingDir: string });

        default:
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
            isError: true,
          };
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  });

  return server;
}

// ── Tool handlers ─────────────────────────────────────────────────────────

async function handleInit(args: { projectRoot: string }) {
  const projectRoot = sanitizeProjectRoot(args.projectRoot);

  // 1. Init state directory
  const sm = new StateManager(projectRoot);
  sm.init();

  // 2. Load config to get custom promise sources
  const config = sm.loadConfig();
  const customSources = config.promiseSources.length > 0 ? config.promiseSources : undefined;

  // 3. Auto-extract promises from project files (pattern-based, no AI needed)
  const collector = new PromiseCollector();
  const promises = collector.autoExtract(projectRoot, customSources);

  // 4. Save promises (merge with any existing manually-added promises)
  const existing = sm.loadPromises();
  const manualPromises = existing.filter((p) => p.source === 'manual');
  const allPromises = [...promises, ...manualPromises];
  sm.savePromises(allPromises);

  // 5. Check for previous context
  const cp = new ContextPreserver(driftDir(projectRoot));
  const restoredContext = cp.exists() ? cp.load() : null;

  // 6. Run an initial check to get baseline score
  const history = new History(driftDir(projectRoot));
  const engine = new RuleEngine();
  const ruleResults = engine.runAll(allPromises, projectRoot, history.getHistory());
  const score = computeScore(ruleResults, allPromises);
  const status = classifyStatus(score);

  const result = {
    promisesExtracted: promises.length,
    totalPromises: allPromises.length,
    baselineScore: score,
    baselineStatus: status,
    violations: ruleResults.filter((r) => r.status !== 'pass').map((r) => ({
      promise: r.promiseText,
      status: r.status,
      detail: r.detail,
    })),
    restoredContext,
  };

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result) }],
  };
}

async function handleTrack(args: { files: string[]; projectRoot: string }) {
  const projectRoot = sanitizeProjectRoot(args.projectRoot);
  const { files } = args;
  const sm = new StateManager(projectRoot);
  const entries: TrackEntry[] = [];

  for (const file of files) {
    let fullPath: string;
    try {
      fullPath = path.isAbsolute(file) ? file : safePath(projectRoot, file);
      // If absolute, verify it's within project root
      if (path.isAbsolute(file)) {
        const resolved = path.resolve(file);
        const resolvedRoot = path.resolve(projectRoot);
        if (!resolved.startsWith(resolvedRoot + path.sep) && resolved !== resolvedRoot) {
          continue; // skip files outside project root
        }
      }
    } catch {
      continue; // skip path traversal attempts
    }
    try {
      const stat = fs.statSync(fullPath);
      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n').length;

      const entry: TrackEntry = {
        path: file,
        lines,
        size: stat.size,
        timestamp: new Date().toISOString(),
      };

      // Extract sections for .md files
      if (file.endsWith('.md')) {
        const sections = content
          .split('\n')
          .filter((line) => line.startsWith('#'))
          .map((line) => line.replace(/^#+\s*/, ''));
        entry.sections = sections;
      }

      entries.push(entry);
    } catch {
      // skip files that cannot be read
    }
  }

  sm.saveTrack(entries);

  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ tracked: entries.length }) }],
  };
}

async function handleCheck(args: {
  workingDir: string;
  evaluationResult?: {
    score: number;
    violations: Array<{ promise: string; status: string }>;
  };
}) {
  const workingDir = sanitizeProjectRoot(args.workingDir);
  const { evaluationResult } = args;
  const dd = driftDir(workingDir);
  const sm = new StateManager(workingDir);
  const history = new History(dd);
  let promises = sm.loadPromises();

  // Auto-extract if no promises exist (fallback)
  if (promises.length === 0) {
    const collector = new PromiseCollector();
    const config = sm.loadConfig();
    const customSources = config.promiseSources.length > 0 ? config.promiseSources : undefined;
    promises = collector.autoExtract(workingDir, customSources);
    if (promises.length > 0) {
      sm.savePromises(promises);
    }
  }

  if (promises.length === 0) {
    // Still no promises — return a healthy default
    const report: QualityReport = {
      score: 100,
      status: 'healthy',
      stage: 1,
      violations: [],
      trend: 'stable',
      recommendation: 'No promises to check. Add CLAUDE.md or run drift_guard_init.',
      timestamp: new Date().toISOString(),
    };
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(report) }],
    };
  }

  const scoreHistory = history.getScoreHistory();

  // Stage 2: AI evaluation result provided
  if (evaluationResult) {
    const llmViolations: CheckResult[] = evaluationResult.violations.map((v) => ({
      promiseId: v.promise,
      promiseText: v.promise,
      status: (v.status === 'warn' ? 'warn' : 'fail') as 'warn' | 'fail',
      detail: `AI evaluation: ${v.status}`,
      timestamp: new Date().toISOString(),
    }));

    // Combine with Stage 1 rule results
    const engine = new RuleEngine();
    const ruleResults = engine.runAll(promises, workingDir, history.getHistory());
    const allResults = [...ruleResults, ...llmViolations];

    const score = evaluationResult.score;
    const status = classifyStatus(score);
    const trend = detectTrend([...scoreHistory, score]);
    const topViolations = topViolationTexts(allResults, promises);
    const recommendation = generateRecommendation(status, trend, topViolations);

    const report: QualityReport = {
      score,
      status,
      stage: 2,
      violations: allResults.filter((r) => r.status !== 'pass'),
      trend,
      recommendation,
      timestamp: new Date().toISOString(),
    };

    history.addCheck(report);

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(report) }],
    };
  }

  // Stage 1: Rule engine
  const engine = new RuleEngine();
  const ruleResults = engine.runAll(promises, workingDir, history.getHistory());

  const hasLLMPromises = promises.some((p) => p.check_type === 'llm_eval');
  const hasFailed = ruleResults.some((r) => r.status === 'fail' || r.status === 'warn');

  // If all rules pass and no llm_eval promises, save healthy report
  if (!hasFailed && !hasLLMPromises) {
    const score = computeScore(ruleResults, promises);
    const status = classifyStatus(score);
    const trend = detectTrend([...scoreHistory, score]);
    const topViolations = topViolationTexts(ruleResults, promises);
    const recommendation = generateRecommendation(status, trend, topViolations);

    const report: QualityReport = {
      score,
      status,
      stage: 1,
      violations: [],
      trend,
      recommendation,
      timestamp: new Date().toISOString(),
    };

    history.addCheck(report);

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(report) }],
    };
  }

  // At this point, either hasFailed or hasLLMPromises is true — build Stage 2 prompt
  const llmPromises = promises.filter((p) => p.check_type === 'llm_eval');
  const evaluator = new LLMEvaluator();

  // Collect file contents for evaluation
  const collector = new PromiseCollector();
  const extraction = await collector.collectSources(workingDir);
  const fileMap = new Map<string, string>();
  for (const fc of extraction.fileContents) {
    fileMap.set(fc.path, fc.content);
  }

  const evaluationPrompt = evaluator.buildEvaluationPrompt(
    llmPromises.length > 0 ? llmPromises : promises,
    fileMap,
  );

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          needsEvaluation: true,
          evaluationPrompt,
          stage1Results: ruleResults,
        }),
      },
    ],
  };
}

async function handleSave(args: { summary: string; projectRoot: string }) {
  const projectRoot = sanitizeProjectRoot(args.projectRoot);
  const { summary } = args;
  const dd = driftDir(projectRoot);
  const cp = new ContextPreserver(dd);
  cp.save(summary);

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ saved: true, path: path.join(dd, 'context.md') }),
      },
    ],
  };
}

async function handleReport(args: { workingDir: string }) {
  const workingDir = sanitizeProjectRoot(args.workingDir);
  const dd = driftDir(workingDir);
  const history = new History(dd);
  const sm = new StateManager(workingDir);
  const reports = history.getHistory();

  if (reports.length === 0) {
    const emptyReport: SessionReport = {
      startScore: 100,
      endScore: 100,
      drift: 0,
      totalChecks: 0,
      violations: 0,
      topViolations: [],
      recommendation: 'No checks have been run yet.',
    };
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(emptyReport),
        },
      ],
    };
  }

  const promises = sm.loadPromises();
  const startScore = reports[0].score;
  const endScore = reports[reports.length - 1].score;
  const drift = Math.round((endScore - startScore) * 10) / 10;

  const allViolations = reports.flatMap((r) => r.violations);
  const topViolations = topViolationTexts(allViolations, promises);

  const status = classifyStatus(endScore);
  const trend = detectTrend(reports.map((r) => r.score));
  const recommendation = generateRecommendation(status, trend, topViolations);

  const sessionReport: SessionReport = {
    startScore,
    endScore,
    drift,
    totalChecks: reports.length,
    violations: allViolations.length,
    topViolations,
    recommendation,
  };

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(sessionReport) }],
  };
}

export async function startServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
