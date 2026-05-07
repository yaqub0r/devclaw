import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const script = path.resolve('dev/scripts/parse-stagegates-conversation.mjs');

function run(args, input) {
  return JSON.parse(execFileSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    input,
    encoding: 'utf8',
  }));
}

test('parses markdown transcript and extracts structured highlights', () => {
  const input = `[2026-05-07 10:00 UTC] user: We need to convert stagegate alpha to project onboarding.\nassistant: Decision: we will keep one project per stagegate for now.\nuser: Action item: map stagegate alpha -> project onboarding before rollout.\nassistant: Open question: should billing be its own project?\nassistant: Risk: a mixed stagegate/project period could confuse routing.`;

  const result = run(['--stdin', '--format', 'markdown'], input);

  assert.equal(result.meta.format, 'markdown');
  assert.equal(result.meta.messageCount, 5);
  assert.ok(result.highlights.decisions.some((item) => item.includes('keep one project per stagegate')));
  assert.ok(result.highlights.actionItems.some((item) => item.includes('map stagegate alpha -> project onboarding')));
  assert.ok(result.highlights.openQuestions.some((item) => item.includes('billing')));
  assert.ok(result.highlights.risks.some((item) => item.includes('confuse routing')));
  assert.deepEqual(result.highlights.stagegateProjectMappings.map((item) => ({ stagegate: item.stagegate, project: item.project })), [
    { stagegate: 'alpha', project: 'onboarding' },
  ]);
});

test('parses OpenClaw-style jsonl transcripts', () => {
  const input = [
    JSON.stringify({
      type: 'message',
      timestamp: '2026-05-07T10:00:00.000Z',
      message: { role: 'user', content: [{ type: 'text', text: 'We should migrate stagegate beta to project billing.' }] },
    }),
    JSON.stringify({
      type: 'message',
      timestamp: '2026-05-07T10:01:00.000Z',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Decision: project billing replaces stagegate beta.' }] },
    }),
  ].join('\n');

  const result = run(['--stdin', '--format', 'openclaw'], input);

  assert.equal(result.meta.format, 'openclaw');
  assert.equal(result.meta.messageCount, 2);
  assert.equal(result.extracted.timeline.length, 2);
  assert.deepEqual(result.highlights.stagegateProjectMappings.map((item) => ({ stagegate: item.stagegate, project: item.project })), [
    { stagegate: 'beta', project: 'billing' },
  ]);
});
