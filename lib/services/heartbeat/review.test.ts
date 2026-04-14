import { describe, it } from 'node:test';
import assert from 'node:assert';
import { reviewPass } from './review.js';
import { TestProvider } from '../../testing/test-provider.js';
import { DEFAULT_WORKFLOW } from '../../workflow/index.js';
import { PrState } from '../../providers/provider.js';

const runCommand = async () => ({ stdout: '', stderr: '', exitCode: 0, code: 0, signal: null, killed: false, termination: 'exit' } as any);

describe('reviewPass ambiguity reconciliation', () => {
  it('treats an already merged external PR as canonical and advances without re-merging', async () => {
    const provider = new TestProvider();
    provider.seedIssue({ iid: 130, title: 'Externally merged PR', labels: ['To Review', 'review:human'] });
    provider.setPrStatus(130, {
      state: PrState.MERGED,
      url: 'https://example.com/pr/130',
      title: 'docs: clarify provenance',
      sourceBranch: 'feature/130-docs-provenance',
    });

    const transitions = await reviewPass({
      workspaceDir: '/tmp',
      projectName: 'devclaw',
      workflow: DEFAULT_WORKFLOW,
      provider,
      repoPath: '/tmp',
      runCommand,
    });

    assert.strictEqual(transitions, 1);
    assert.strictEqual(provider.callsTo('mergePr').length, 0, 'should not try to merge an already merged PR');

    const issue = await provider.getIssue(130);
    assert.ok(issue.labels.includes('To Test'));
    assert.ok(!issue.labels.includes('To Review'));
  });

  it('surfaces ambiguous multiple open PRs instead of silently transitioning', async () => {
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

  it('surfaces ambiguous merged PRs instead of pretending the issue is reviewable', async () => {
    const provider = new TestProvider();
    provider.seedIssue({ iid: 132, title: 'Merged ambiguity', labels: ['To Review', 'review:human'] });
    provider.setPrStatus(132, {
      state: PrState.MERGED,
      url: 'https://example.com/pr/8',
      ambiguous: true,
      reason: 'multiple_merged_prs',
      candidates: [
        { url: 'https://example.com/pr/7', state: 'MERGED' },
        { url: 'https://example.com/pr/8', state: 'MERGED' },
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
    assert.match(provider.callsTo('addComment')[0].args.body, /cannot reconcile review state safely/i);
  });
});
