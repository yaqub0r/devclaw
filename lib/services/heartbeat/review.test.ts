import { describe, it } from 'node:test';
import assert from 'node:assert';
import { reviewPass } from './review.js';
import { TestProvider } from '../../testing/test-provider.js';
import { DEFAULT_WORKFLOW } from '../../workflow/index.js';
import { PrState } from '../../providers/provider.js';

const runCommand = async () => ({ stdout: '', stderr: '', exitCode: 0, code: 0, signal: null, killed: false, termination: 'exit' } as any);

describe('reviewPass ambiguity reconciliation', () => {
  it('surfaces ambiguous multiple PRs instead of silently transitioning', async () => {
    const provider = new TestProvider();
    provider.seedIssue({ iid: 131, title: 'Ambiguous review', labels: ['To Review', 'review:human'] });
    provider.setPrStatus(131, {
      state: PrState.OPEN,
      url: 'https://example.com/pr/2',
      ambiguous: true,
      reason: 'multiple_open_prs',
      candidates: [
        { url: 'https://example.com/pr/1', state: 'OPEN' },
        { url: 'https://example.com/pr/2', state: 'OPEN' },
      ],
    });

    const transitions = await reviewPass({
      workspaceDir: '/tmp',
      projectName: 'devclaw',
      workflow: DEFAULT_WORKFLOW,
      provider,
      repoPath: '/tmp',
      runCommand,
    });

    assert.strictEqual(transitions, 0);
    assert.strictEqual(provider.callsTo('transitionLabel').length, 0);
    assert.strictEqual(provider.callsTo('addComment').length, 1);
    assert.match(provider.callsTo('addComment')[0].args.body, /multiple candidate PRs/i);
  });
});
