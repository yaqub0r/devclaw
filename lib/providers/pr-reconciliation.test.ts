import { describe, it } from 'node:test';
import assert from 'node:assert';
import { reconcileCanonicalPr } from './pr-reconciliation.js';

describe('reconcileCanonicalPr', () => {
  it('marks multiple open PRs as ambiguous', () => {
    const status = reconcileCanonicalPr({
      open: [
        { url: 'https://example.com/pr/1', state: 'OPEN', number: 1 },
        { url: 'https://example.com/pr/2', state: 'OPEN', number: 2 },
      ],
      merged: [],
      closed: [],
    });

    assert.strictEqual(status.ambiguous, true);
    assert.strictEqual(status.reason, 'multiple_open_prs');
    assert.strictEqual(status.url, 'https://example.com/pr/2');
  });

  it('prefers a single merged PR when there is no ambiguity', () => {
    const status = reconcileCanonicalPr({
      open: [],
      merged: [
        { url: 'https://example.com/pr/4', state: 'MERGED', number: 4, mergedAt: '2026-04-14T12:00:00Z' },
      ],
      closed: [
        { url: 'https://example.com/pr/3', state: 'CLOSED', number: 3 },
      ],
    });

    assert.strictEqual(status.ambiguous, undefined);
    assert.strictEqual(status.state, 'merged');
    assert.strictEqual(status.url, 'https://example.com/pr/4');
  });
});
