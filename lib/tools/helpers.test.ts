import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestHarness } from "../testing/harness.js";
import type { ToolContext } from "../types.js";
import { normalizeRepoTarget, resolveToolProject } from "./helpers.js";

const TEST_PROJECT = "example-project";
const TEST_CHANNEL_ID = "-1000000000001";
const OTHER_CHANNEL_ID = "-1000000000002";
const TEST_ISSUE_ID = "42";
const TEST_WORKER_SESSION =
  "agent:devclaw:subagent:example-project-architect-junior-worker";

describe("normalizeRepoTarget", () => {
  it("normalizes github https and ssh remotes", () => {
    assert.equal(normalizeRepoTarget("https://github.com/example-owner/example-repo.git"), "example-owner/example-repo");
    assert.equal(normalizeRepoTarget("git@github.com:example-owner/example-repo.git"), "example-owner/example-repo");
  });

  it("normalizes gitlab remotes and trims whitespace", () => {
    assert.equal(normalizeRepoTarget("  https://gitlab.com/group/project.git  "), "group/project");
  });

  it("preserves already-normalized owner repo targets", () => {
    assert.equal(normalizeRepoTarget("example-owner/example-repo"), "example-owner/example-repo");
  });
});

describe("native worker project resolution", () => {
  it("uses a registered worker session when the synthetic source channel is webchat", async () => {
    const harness = await createTestHarness({
      projectName: TEST_PROJECT,
      channelId: TEST_CHANNEL_ID,
      workers: {
        architect: {
          level: "junior",
          active: true,
          issueId: TEST_ISSUE_ID,
          sessionKey: TEST_WORKER_SESSION,
        },
      },
    });

    try {
      const toolContext: ToolContext = {
        workspaceDir: harness.workspaceDir,
        sessionKey: TEST_WORKER_SESSION,
        messageChannel: "webchat",
      };

      const { project } = await resolveToolProject(
        harness.workspaceDir,
        toolContext,
        harness.channelId,
      );

      assert.strictEqual(project.slug, TEST_PROJECT);
    } finally {
      await harness.cleanup();
    }
  });

  it("keeps synthetic webchat routing invalid for ordinary non-worker sessions", async () => {
    const harness = await createTestHarness({
      projectName: TEST_PROJECT,
      channelId: TEST_CHANNEL_ID,
    });

    try {
      await assert.rejects(
        resolveToolProject(
          harness.workspaceDir,
          {
            workspaceDir: harness.workspaceDir,
            sessionKey: "agent:devclaw:main",
            messageChannel: "webchat",
          },
          harness.channelId,
        ),
        /No project found/,
      );
    } finally {
      await harness.cleanup();
    }
  });

  it("rejects worker-shaped session keys that are not registered to a slot", async () => {
    const harness = await createTestHarness({
      projectName: TEST_PROJECT,
      channelId: TEST_CHANNEL_ID,
    });

    try {
      await assert.rejects(
        resolveToolProject(
          harness.workspaceDir,
          {
            workspaceDir: harness.workspaceDir,
            sessionKey:
              "agent:devclaw:subagent:example-project-architect-junior-forged",
            messageChannel: "webchat",
          },
          harness.channelId,
        ),
        /No project found/,
      );
    } finally {
      await harness.cleanup();
    }
  });

  it("rejects registered worker sessions after their slot is inactive", async () => {
    const harness = await createTestHarness({
      projectName: TEST_PROJECT,
      channelId: TEST_CHANNEL_ID,
      workers: {
        architect: {
          level: "junior",
          active: false,
          issueId: null,
          sessionKey: TEST_WORKER_SESSION,
        },
      },
    });

    try {
      await assert.rejects(
        resolveToolProject(
          harness.workspaceDir,
          {
            workspaceDir: harness.workspaceDir,
            sessionKey: TEST_WORKER_SESSION,
            messageChannel: "webchat",
          },
          harness.channelId,
        ),
        /No project found/,
      );
    } finally {
      await harness.cleanup();
    }
  });

  it("rejects a registered worker that supplies a route outside its project", async () => {
    const harness = await createTestHarness({
      projectName: TEST_PROJECT,
      channelId: TEST_CHANNEL_ID,
      workers: {
        architect: {
          level: "junior",
          active: true,
          issueId: TEST_ISSUE_ID,
          sessionKey: TEST_WORKER_SESSION,
        },
      },
    });

    try {
      await assert.rejects(
        resolveToolProject(
          harness.workspaceDir,
          {
            workspaceDir: harness.workspaceDir,
            sessionKey: TEST_WORKER_SESSION,
            messageChannel: "webchat",
          },
          OTHER_CHANNEL_ID,
        ),
        /No project found/,
      );
    } finally {
      await harness.cleanup();
    }
  });
});
