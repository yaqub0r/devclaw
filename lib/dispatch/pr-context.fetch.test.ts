import { describe, it } from 'node:test';
import assert from 'node:assert';
import { fetchPrContext, fetchPrFeedback } from './pr-context.js';
import { TestProvider } from '../testing/test-provider.js';
import { PrState } from '../providers/provider.js';

describe('fetchPrContext', () => {
  it('returns undefined when multiple PRs make the canonical PR ambiguous', async () => {
    const provider = new TestProvider();
    provider.setPrStatus(42, {
      state: PrState.OPEN,
      url: 'https://example.com/pr/2',
      ambiguous: true,
      reason: 'multiple_open_prs',
      candidates: [
        { url: 'https://example.com/pr/1', state: 'OPEN' },
        { url: 'https://example.com/pr/2', state: 'OPEN' },
      ],
    });

    const result = await fetchPrContext(provider, 42);
    assert.strictEqual(result, undefined);
  });
});

describe('fetchPrFeedback', () => {
  it('returns undefined when the issue no longer has a single canonical reviewable PR', async () => {
    const provider = new TestProvider();
    provider.setPrStatus(42, {
      state: PrState.OPEN,
      url: 'https://example.com/pr/2',
      ambiguous: true,
      reason: 'multiple_open_prs',
      candidates: [
        { url: 'https://example.com/pr/1', state: 'OPEN' },
        { url: 'https://example.com/pr/2', state: 'OPEN' },
      ],
    });

    const result = await fetchPrFeedback(provider, 42);
    assert.strictEqual(result, undefined);
  });
});
