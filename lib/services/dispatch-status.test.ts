/**
 * Tests for dispatch status persistence and failure tracking.
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { createTestHarness } from "../testing/index.js";
import { ensureSessionFireAndForget, sendToAgent } from "../dispatch/session.js";
import { getDispatchStatus, upsertDispatchStatus } from "./dispatch-status.js";

describe("dispatch status", () => {
  it("records label moved but sessions.patch failed", async () => {
    const h = await createTestHarness();
    try {
      const runCommand = async () => { throw new Error("sessions.patch failed"); };
      await upsertDispatchStatus(h.workspaceDir, { projectSlug: h.project.slug, issueId: 62, role: "architect" }, {
        projectName: h.project.name,
        level: "senior",
        sessionKey: "s1",
        sessionAction: "spawn",
        labelMovedAt: new Date().toISOString(),
      });

      ensureSessionFireAndForget("s1", "m1", h.workspaceDir, runCommand as any, {
        projectSlug: h.project.slug,
        projectName: h.project.name,
        issueId: 62,
        role: "architect",
      });
      await new Promise((r) => setTimeout(r, 25));

      const status = await getDispatchStatus(h.workspaceDir, { projectSlug: h.project.slug, issueId: 62, role: "architect" });
      assert.ok(status?.sessionPatchStartedAt);
      assert.ok(status?.sessionPatchFailedAt);
      assert.match(status?.sessionPatchError ?? "", /sessions.patch failed/);
    } finally {
      await h.cleanup();
    }
  });

  it("records label moved but agent delivery failed", async () => {
    const h = await createTestHarness();
    try {
      const runCommand = async () => { throw new Error("gateway agent failed"); };
      await upsertDispatchStatus(h.workspaceDir, { projectSlug: h.project.slug, issueId: 63, role: "architect" }, {
        projectName: h.project.name,
        level: "senior",
        sessionKey: "s2",
        sessionAction: "spawn",
        labelMovedAt: new Date().toISOString(),
      });

      sendToAgent("s2", "task", {
        projectSlug: h.project.slug,
        projectName: h.project.name,
        issueId: 63,
        role: "architect",
        level: "senior",
        workspaceDir: h.workspaceDir,
        runCommand: runCommand as any,
      });
      await new Promise((r) => setTimeout(r, 25));

      const status = await getDispatchStatus(h.workspaceDir, { projectSlug: h.project.slug, issueId: 63, role: "architect" });
      assert.ok(status?.agentDispatchStartedAt);
      assert.ok(status?.agentDispatchFailedAt);
      assert.match(status?.agentDispatchError ?? "", /gateway agent failed/);
    } finally {
      await h.cleanup();
    }
  });
});
