import type { CheckResult, DriftPromise } from '../types.js';

export class LLMEvaluator {
  buildEvaluationPrompt(
    promises: DriftPromise[],
    fileContents: Map<string, string>,
  ): string {
    const promisesJson = JSON.stringify(
      promises.map((p) => ({
        id: p.id,
        text: p.text,
        category: p.category,
        check_type: p.check_type,
        weight: p.weight,
      })),
      null,
      2,
    );

    const filesSection: string[] = [];
    for (const [path, content] of fileContents.entries()) {
      filesSection.push(`### File: ${path}\n\`\`\`\n${content}\n\`\`\``);
    }

    return [
      'Here are the project promises:',
      '```json',
      promisesJson,
      '```',
      '',
      'Here are the current project files:',
      filesSection.join('\n\n'),
      '',
      'Review the files against each promise. Score compliance from 0-100, where 100 means all promises are fully met.',
      'List any violations as a JSON object with this exact shape:',
      '```json',
      '{',
      '  "score": <number 0-100>,',
      '  "violations": [',
      '    {',
      '      "promiseId": "<id>",',
      '      "promiseText": "<text>",',
      '      "status": "fail" | "warn",',
      '      "detail": "<explanation>",',
      '      "timestamp": "<ISO8601>"',
      '    }',
      '  ]',
      '}',
      '```',
      'Return ONLY the JSON object, no other text.',
    ].join('\n');
  }

  parseEvaluationResponse(response: string): { score: number; violations: CheckResult[] } {
    // Try to extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        score: 0,
        violations: [
          {
            promiseId: 'llm-eval',
            promiseText: 'LLM evaluation',
            status: 'fail',
            detail: `Malformed response: no JSON object found. Raw: ${response.slice(0, 200)}`,
            timestamp: new Date().toISOString(),
          },
        ],
      };
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]) as unknown;
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !('score' in parsed)
      ) {
        throw new Error('Missing score field');
      }

      const obj = parsed as Record<string, unknown>;
      const score = typeof obj['score'] === 'number' ? obj['score'] : 0;
      const rawViolations = Array.isArray(obj['violations']) ? obj['violations'] : [];

      const violations: CheckResult[] = rawViolations
        .filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null)
        .map((v) => ({
          promiseId: typeof v['promiseId'] === 'string' ? v['promiseId'] : 'unknown',
          promiseText: typeof v['promiseText'] === 'string' ? v['promiseText'] : '',
          status: (v['status'] === 'warn' ? 'warn' : 'fail') as 'warn' | 'fail',
          detail: typeof v['detail'] === 'string' ? v['detail'] : '',
          timestamp:
            typeof v['timestamp'] === 'string'
              ? v['timestamp']
              : new Date().toISOString(),
        }));

      return { score, violations };
    } catch (err) {
      return {
        score: 0,
        violations: [
          {
            promiseId: 'llm-eval',
            promiseText: 'LLM evaluation',
            status: 'fail',
            detail: `Malformed response: ${err instanceof Error ? err.message : String(err)}`,
            timestamp: new Date().toISOString(),
          },
        ],
      };
    }
  }
}
