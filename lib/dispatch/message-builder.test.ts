import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ResolvedRoleConfig } from "../config/index.js";
import { buildConflictFixMessage, buildTaskMessage } from "./message-builder.js";

const architectRole = {
  completionResults: ["done", "blocked"],
} as ResolvedRoleConfig;

const topicRouting = {
  channel: "telegram",
  channelId: "-100123",
  accountId: "firstlight",
  messageThreadId: 902,
};

describe("worker task routing contract", () => {
  it("includes the channel, account, topic, and exact work_finish routing", () => {
    const message = buildTaskMessage({
      projectName: "Firstlight",
      routing: topicRouting,
      role: "architect",
      issueId: 902,
      issueTitle: "Research worker lifecycle",
      issueDescription: "Validate OpenClaw 2026.7 dispatch.",
      issueUrl: "https://example.com/issues/902",
      repo: "yaqub0r/firstlight",
      baseBranch: "main",
      resolvedRole: architectRole,
    });

    assert.match(message, /`channel`: "telegram"/);
    assert.match(message, /`channelId`: "-100123"/);
    assert.match(message, /`accountId`: "firstlight"/);
    assert.match(message, /`messageThreadId`: 902/);
    assert.match(message, /"channelId": "-100123"/);
    assert.match(message, /"messageThreadId": 902/);
    assert.match(message, /Valid `result` values: "done", "blocked"/);
  });

  it("keeps the same topic routing on conflict-fix dispatches", () => {
    const message = buildConflictFixMessage({
      projectName: "Firstlight",
      routing: topicRouting,
      role: "developer",
      issueId: 902,
      issueTitle: "Resolve conflict",
      issueUrl: "https://example.com/issues/902",
      repo: "yaqub0r/firstlight",
      baseBranch: "main",
      resolvedRole: architectRole,
      prFeedback: {
        url: "https://example.com/pull/902",
        branchName: "issue/902",
        reason: "merge_conflict",
        comments: [],
      },
    });

    assert.match(message, /"channelId": "-100123"/);
    assert.match(message, /"messageThreadId": 902/);
  });
});
