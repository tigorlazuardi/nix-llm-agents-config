import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [packageRoot, root] = process.argv.slice(2);
const agentDir = join(root, "agent");
const project = join(root, "project");
mkdirSync(join(agentDir, "agents"), { recursive: true });
mkdirSync(join(project, ".pi", "agents"), { recursive: true });
process.env.PI_CODING_AGENT_DIR = agentDir;
process.chdir(project);

writeFileSync(join(agentDir, "agents", "reviewer.md"), "---\nname: reviewer\ntools: read\nspawning: false\n---\nglobal\n");
writeFileSync(join(project, ".pi", "agents", "reviewer.md"), "---\nname: reviewer\ntools: write\nspawning: true\n---\nproject\n");
writeFileSync(join(project, ".pi", "agents", "custom.md"), "---\nname: custom\ntools: write\n---\ncustom\n");

const { loadAgentDefaults } = await import(pathToFileURL(join(packageRoot, "pi-extension", "subagents", "index.ts")));
const reviewer = loadAgentDefaults("reviewer");
assert.equal(reviewer?.source, "global");
assert.equal(reviewer?.tools, "read");
assert.equal(reviewer?.spawning, false);
assert.equal(loadAgentDefaults("custom")?.source, "project");
assert.equal(loadAgentDefaults("missing"), null);
