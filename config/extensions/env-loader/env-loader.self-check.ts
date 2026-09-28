import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDotEnvInto, parseDotEnv } from "./index.ts";

// parseDotEnv: comments, blanks, quotes, export prefix, malformed lines
assert.deepEqual(
	parseDotEnv('A=1\n# comment\n  # indented comment\nB="two words"\nexport C=3\n\nD=\'sq\'\nEMPTY=\nbroken line\n=novalue'),
	{ A: "1", B: "two words", C: "3", D: "sq", EMPTY: "" },
);

// missing .env → 0, no throw
const missingDir = mkdtempSync(join(tmpdir(), "env-loader-missing-"));
assert.equal(loadDotEnvInto({}, missingDir), 0);

// loads into empty env, counts
const dir = mkdtempSync(join(tmpdir(), "env-loader-"));
writeFileSync(join(dir, ".env"), "PROBE_A=yes\nPROBE_B=42\n");
const target: NodeJS.ProcessEnv = {};
assert.equal(loadDotEnvInto(target, dir), 2);
assert.equal(target.PROBE_A, "yes");
assert.equal(target.PROBE_B, "42");

// real environment wins: existing vars never overwritten
const guarded: NodeJS.ProcessEnv = { PROBE_A: "from-real-env" };
assert.equal(loadDotEnvInto(guarded, dir), 1);
assert.equal(guarded.PROBE_A, "from-real-env");

rmSync(dir, { recursive: true, force: true });
rmSync(missingDir, { recursive: true, force: true });
console.log("env-loader self-check passed");
