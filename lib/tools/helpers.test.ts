import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestHarness } from "../testing/harness.js";
import type { ToolContext } from "../types.js";
import { normalizeRepoTarget, resolveToolProject } from "./helpers.js";

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
    const sessionKey =
      "agent:devclaw:subagent:firstlight-architect-junior-judi";
    const harness = await createTestHarness({
      projectName: "firstlight",
      channelId: "-1003746138337",
      workers: {
        architect: {
          level: "junior",
          active: true,
          issueId: "902",
          sessionKey,
        },
      },
    });

    try {
      const toolContext: ToolContext = {
        workspaceDir: harness.workspaceDir,
        sessionKey,
        messageChannel: "webchat",
      };

      const { project } = await resolveToolProject(
        harness.workspaceDir,
        toolContext,
        harness.channelId,
      );

      assert.strictEqual(project.slug, "firstlight");
    } finally {
      await harness.cleanup();
    }
  });

  it("keeps synthetic webchat routing invalid for ordinary non-worker sessions", async () => {
    const harness = await createTestHarness({
      projectName: "firstlight",
      channelId: "-1003746138337",
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
      projectName: "firstlight",
      channelId: "-1003746138337",
    });

    try {
      await assert.rejects(
        resolveToolProject(
          harness.workspaceDir,
          {
            workspaceDir: harness.workspaceDir,
            sessionKey:
              "agent:devclaw:subagent:firstlight-architect-junior-forged",
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
    const sessionKey =
      "agent:devclaw:subagent:firstlight-architect-junior-judi";
    const harness = await createTestHarness({
      projectName: "firstlight",
      channelId: "-1003746138337",
      workers: {
        architect: {
          level: "junior",
          active: false,
          issueId: null,
          sessionKey,
        },
      },
    });

    try {
      await assert.rejects(
        resolveToolProject(
          harness.workspaceDir,
          {
            workspaceDir: harness.workspaceDir,
            sessionKey,
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
    const sessionKey =
      "agent:devclaw:subagent:firstlight-architect-junior-judi";
    const harness = await createTestHarness({
      projectName: "firstlight",
      channelId: "-1003746138337",
      workers: {
        architect: {
          level: "junior",
          active: true,
          issueId: "902",
          sessionKey,
        },
      },
    });

    try {
      await assert.rejects(
        resolveToolProject(
          harness.workspaceDir,
          {
            workspaceDir: harness.workspaceDir,
            sessionKey,
            messageChannel: "webchat",
          },
          "-1000000000000",
        ),
        /No project found/,
      );
    } finally {
      await harness.cleanup();
    }
  });
});
