import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [packageRoot, root, implementerFixture, orchestratorFixture] = process.argv.slice(2);
const agentDir = join(root, "agent");
const project = join(root, "project");
mkdirSync(join(agentDir, "agents"), { recursive: true });
mkdirSync(join(project, ".pi", "agents"), { recursive: true });
process.env.PI_CODING_AGENT_DIR = agentDir;
process.chdir(project);

copyFileSync(implementerFixture, join(agentDir, "agents", "implementer.md"));
copyFileSync(orchestratorFixture, join(agentDir, "agents", "orchestrator.md"));
writeFileSync(join(project, ".pi", "agents", "implementer.md"), "---\nname: implementer\ntools: write\nspawning: true\n---\nproject\n");
writeFileSync(join(project, ".pi", "agents", "custom.md"), "---\nname: custom\ntools: write\n---\ncustom\n");

const subagentsDir = join(packageRoot, "pi-extension", "subagents");
const { loadAgentDefaults, __test__ } = await import(pathToFileURL(join(subagentsDir, "index.ts")));
const { buildHerdrEscapeArgs } = await import(pathToFileURL(join(subagentsDir, "herdr.ts")));
const { default: registerSubagentDone } = await import(pathToFileURL(join(subagentsDir, "subagent-done.ts")));
const implementer = loadAgentDefaults("implementer");
assert.equal(implementer?.source, "global");
assert.equal(implementer?.tools, "read, bash, edit, write, grep, find");
assert.equal(implementer?.spawning, false);
assert.equal(implementer?.model, "openai-codex/gpt-5.6-sol");
assert.equal(implementer?.thinking, "medium");
assert.equal(implementer?.sessionMode, "standalone");
assert.equal(implementer?.systemPromptMode, "replace");
assert.match(implementer?.body ?? "", /You implement one approved task/);
assert.equal(
  __test__.buildSubagentToolAllowlist(implementer?.tools),
  "read,bash,edit,write,grep,find,caller_ping,subagent_done",
);
const orchestrator = loadAgentDefaults("orchestrator");
assert.equal(orchestrator?.source, "global");
assert.equal(orchestrator?.model, "openai-codex/gpt-5.6-terra");
assert.equal(orchestrator?.thinking, "medium");
assert.equal(orchestrator?.tools, "read, bash, subagent");
assert.equal(orchestrator?.spawning, true);
assert.equal(
  __test__.buildSubagentToolAllowlist(orchestrator?.tools),
  "read,bash,subagent,caller_ping,subagent_done",
);
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
