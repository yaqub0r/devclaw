/**
 * providers/resilience.ts — Retry and circuit breaker policies for provider calls.
 *
 * Uses cockatiel for lightweight resilience without heavyweight orchestration.
 * Applied to GitHub/GitLab CLI calls that can fail due to network, rate limits, or timeouts.
 */
import {
  ExponentialBackoff,
  retry,
  circuitBreaker,
  ConsecutiveBreaker,
  handleAll,
  wrap,
  type IPolicy,
} from "cockatiel";

/**
 * Default retry policy: 3 attempts with exponential backoff.
 * Handles all errors (network, timeout, CLI failure).
 * Safe to share globally because it carries no failure state between calls.
 */
const retryPolicy = retry(handleAll, {
  maxAttempts: 3,
  backoff: new ExponentialBackoff({
    initialDelay: 500,
    maxDelay: 5_000,
  }),
});

type ProviderPolicyOptions = {
  halfOpenAfter?: number;
  consecutiveFailures?: number;
};

const DEFAULT_POLICY_OPTIONS: Required<ProviderPolicyOptions> = {
  halfOpenAfter: 30_000,
  consecutiveFailures: 5,
};

const providerPolicies = new Map<string, IPolicy>();

function createProviderPolicy(opts: ProviderPolicyOptions = {}): IPolicy {
  const resolved = { ...DEFAULT_POLICY_OPTIONS, ...opts };
  const breakerPolicy = circuitBreaker(handleAll, {
    halfOpenAfter: resolved.halfOpenAfter,
    breaker: new ConsecutiveBreaker(resolved.consecutiveFailures),
  });
  return wrap(breakerPolicy, retryPolicy);
}

export function getProviderPolicy(scopeKey: string, opts?: ProviderPolicyOptions): IPolicy {
  const existing = providerPolicies.get(scopeKey);
  if (existing) return existing;

  const created = createProviderPolicy(opts);
  providerPolicies.set(scopeKey, created);
  return created;
}

/**
 * Execute a provider call with retry + circuit breaker.
 * Circuit breaker state is scoped per provider/repo key instead of shared globally.
 */
export function withResilience<T>(scopeKey: string, fn: () => Promise<T>): Promise<T> {
  return getProviderPolicy(scopeKey).execute(() => fn()) as Promise<T>;
}

export function resetProviderPoliciesForTest(): void {
  providerPolicies.clear();
}
