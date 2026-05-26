import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync, execSync } from "node:child_process";
import { afterEach, describe, it } from "node:test";

const SCRIPT = path.resolve("dev/scripts/bootstrap-issue-worktree.sh");

const cleanupPaths: string[] = [];

afterEach(async () => {
  while (cleanupPaths.length) {
    const target = cleanupPaths.pop();
    if (!target) continue;
    await fs.rm(target, { recursive: true, force: true });
  }
});

describe("bootstrap-issue-worktree.sh", () => {
  it("creates new issue branches from fetched origin/<base-branch>", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "devclaw-bootstrap-script-"));
    cleanupPaths.push(tmp);

    const remote = path.join(tmp, "remote.git");
    const seed = path.join(tmp, "seed");
    const repo = path.join(tmp, "repo");
    await fs.mkdir(remote, { recursive: true });

    execSync(`git init --bare ${JSON.stringify(remote)}`);
    execSync(`git init ${JSON.stringify(seed)}`);
    execSync(`git -C ${JSON.stringify(seed)} config user.name 'DevClaw Test'`);
    execSync(`git -C ${JSON.stringify(seed)} config user.email 'devclaw@example.com'`);
    await fs.writeFile(path.join(seed, "package.json"), '{"name":"bootstrap-test","version":"1.0.0"}\n');
    await fs.writeFile(path.join(seed, "package-lock.json"), '{"name":"bootstrap-test","lockfileVersion":3}\n');
    await fs.mkdir(path.join(seed, "node_modules"), { recursive: true });
    await fs.writeFile(path.join(seed, "node_modules", ".keep"), "ok\n");
    execSync(`git -C ${JSON.stringify(seed)} add package.json package-lock.json node_modules/.keep`);
    execSync(`git -C ${JSON.stringify(seed)} commit -m 'seed base'`);
    execSync(`git -C ${JSON.stringify(seed)} branch -M main`);
    execSync(`git -C ${JSON.stringify(seed)} remote add origin ${JSON.stringify(remote)}`);
    execSync(`git -C ${JSON.stringify(seed)} push origin main`);

    execSync(`git clone ${JSON.stringify(remote)} ${JSON.stringify(repo)}`);
    execSync(`git -C ${JSON.stringify(repo)} checkout -b main origin/main`);

    const baseHead = execSync(`git -C ${JSON.stringify(repo)} rev-parse HEAD`, { encoding: "utf8" }).trim();

    await fs.writeFile(path.join(seed, "README.md"), 'fresh upstream\n');
    execSync(`git -C ${JSON.stringify(seed)} add README.md`);
    execSync(`git -C ${JSON.stringify(seed)} commit -m 'upstream advance'`);
    execSync(`git -C ${JSON.stringify(seed)} push origin main`);
    const originHead = execSync(`git -C ${JSON.stringify(seed)} rev-parse HEAD`, { encoding: "utf8" }).trim();
    assert.notEqual(originHead, baseHead);

    execFileSync(SCRIPT, [repo, "238", "Bootstrap worker issue worktrees", "main"], {
      cwd: path.resolve("."),
      encoding: "utf8",
    });

    const branchHead = execSync(
      `git -C ${JSON.stringify(repo)} rev-parse refs/heads/issue/238-bootstrap-worker-issue-worktrees`,
      { encoding: "utf8" },
    ).trim();
    assert.equal(branchHead, originHead);
  });
});
