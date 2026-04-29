/**
 * esbuild bundler — produces a single dist/index.js with all dependencies inlined.
 *
 * Eliminates the need for `npm install` at plugin install time.
 * openclaw/plugin-sdk is kept external (peer dependency provided by the host).
 */
import esbuild from "esbuild";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const pkg = JSON.parse(readFileSync("package.json", "utf-8"));

function git(args) {
  try {
    return execSync(`git ${args}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return null;
  }
}

const commitSha = git("rev-parse HEAD");
const shortCommitSha = git("rev-parse --short HEAD");
const branch = git("rev-parse --abbrev-ref HEAD");
const dirty = git("status --porcelain=v1") ? true : false;
const buildTimestamp = new Date().toISOString();
const buildProvenance = {
  packageName: pkg.name,
  packageVersion: pkg.version,
  commitSha,
  shortCommitSha,
  branch,
  dirty: commitSha ? dirty : null,
  buildTimestamp,
};

await esbuild.build({
  entryPoints: ["index.ts"],
  bundle: true,
  outfile: "dist/index.js",
  format: "esm",
  platform: "node",
  target: "es2022",
  external: ["openclaw", "openclaw/*"],
  sourcemap: true,
  define: {
    __PLUGIN_VERSION__: JSON.stringify(pkg.version),
    __PACKAGE_NAME__: JSON.stringify(pkg.name),
    __BUILD_PROVENANCE__: JSON.stringify(JSON.stringify(buildProvenance)),
  },
});

console.log(`Built dist/index.js (${pkg.name}@${pkg.version})`);
console.log(`Embedded build provenance: ${JSON.stringify(buildProvenance)}`);
