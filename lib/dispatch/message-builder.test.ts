import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ResolvedRoleConfig } from "../config/index.js";
import { buildConflictFixMessage, buildTaskMessage } from "./message-builder.js";

const architectRole = {
  completionResults: ["done", "blocked"],
} as ResolvedRoleConfig;

const topicRouting = {
  channel: "telegram",
  channelId: "-1000000000000",
  accountId: "sample-account",
  messageThreadId: 101,
};

describe("worker task routing contract", () => {
  it("includes the channel, account, topic, and exact work_finish routing", () => {
    const message = buildTaskMessage({
      projectName: "Example Project",
      routing: topicRouting,
      role: "architect",
      issueId: 101,
      issueTitle: "Research worker lifecycle",
      issueDescription: "Validate OpenClaw 2026.7 dispatch.",
      issueUrl: "https://example.invalid/issues/101",
      repo: "example/example-project",
      baseBranch: "main",
      resolvedRole: architectRole,
    });

    assert.match(message, /`channel`: "telegram"/);
    assert.match(message, /`channelId`: "-1000000000000"/);
    assert.match(message, /`accountId`: "sample-account"/);
    assert.match(message, /`messageThreadId`: 101/);
    assert.match(message, /"channelId": "-1000000000000"/);
    assert.match(message, /"messageThreadId": 101/);
    assert.match(message, /Valid `result` values: "done", "blocked"/);
  });

  it("keeps the same topic routing on conflict-fix dispatches", () => {
    const message = buildConflictFixMessage({
      projectName: "Example Project",
      routing: topicRouting,
      role: "developer",
      issueId: 101,
      issueTitle: "Resolve conflict",
      issueUrl: "https://example.invalid/issues/101",
      repo: "example/example-project",
      baseBranch: "main",
      resolvedRole: architectRole,
      prFeedback: {
        url: "https://example.invalid/pull/101",
        branchName: "issue/101",
        reason: "merge_conflict",
        comments: [],
      },
    });

    assert.match(message, /"channelId": "-1000000000000"/);
    assert.match(message, /"messageThreadId": 101/);
  });
});
