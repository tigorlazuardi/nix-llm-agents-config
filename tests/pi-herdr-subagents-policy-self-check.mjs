import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

const subagentsDir = join(packageRoot, "pi-extension", "subagents");
const { loadAgentDefaults } = await import(pathToFileURL(join(subagentsDir, "index.ts")));
const { buildHerdrEscapeArgs } = await import(pathToFileURL(join(subagentsDir, "herdr.ts")));
const { default: registerSubagentDone } = await import(pathToFileURL(join(subagentsDir, "subagent-done.ts")));
const reviewer = loadAgentDefaults("reviewer");
assert.equal(reviewer?.source, "global");
assert.equal(reviewer?.tools, "read");
assert.equal(reviewer?.spawning, false);
assert.equal(loadAgentDefaults("custom")?.source, "project");
assert.equal(loadAgentDefaults("missing"), null);
assert.deepEqual(buildHerdrEscapeArgs?.("pane-1"), ["pane", "send-keys", "pane-1", "Escape", "Escape"]);
assert.doesNotMatch(
  readFileSync(join(subagentsDir, "subagent-done.ts"), "utf8"),
  /registerShortcut\(["']ctrl\+j["']/,
);
assert.match(
  readFileSync(join(subagentsDir, "index.ts"), "utf8"),
  /PI_SUBAGENT_ALLOWED_TOOLS=/,
);

const handlers = new Map();
const shortcuts = new Map();
let widgetUpdates = 0;
registerSubagentDone({
  getActiveTools: () => ["read", "bash", "edit", "write", "caller_ping", "subagent_done"],
  getAllTools: () => assert.fail("widget must not count inactive registered tools"),
  on: (event, handler) => handlers.set(event, handler),
  registerShortcut: (key, options) => shortcuts.set(key, options),
  registerTool: () => {},
});
const ctx = { ui: { setWidget: () => widgetUpdates++ } };
handlers.get("session_start")({}, ctx);
assert.equal(shortcuts.has("ctrl+shift+o"), true);
shortcuts.get("ctrl+shift+o").handler(ctx);
assert.equal(widgetUpdates, 2);
