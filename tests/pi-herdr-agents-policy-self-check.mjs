import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [packageRoot, root, implementerFixture, orchestratorFixture, yamlSafeFixture] = process.argv.slice(2);
const agentDir = join(root, "agent");
const project = join(root, "project");
mkdirSync(join(agentDir, "agents"), { recursive: true });
mkdirSync(join(project, ".pi", "agents"), { recursive: true });
process.env.PI_CODING_AGENT_DIR = agentDir;
process.chdir(project);

copyFileSync(implementerFixture, join(agentDir, "agents", "implementer.md"));
copyFileSync(orchestratorFixture, join(agentDir, "agents", "orchestrator.md"));
// The rendered "edge: # [] {}" agent: hostile name and description must still
// render into a definition 3.7.2 discovers instead of rejecting.
copyFileSync(yamlSafeFixture, join(agentDir, "agents", "hostile-name.md"));

const subagentsDir = join(packageRoot, "pi-extension", "subagents");
const { __test__ } = await import(pathToFileURL(join(subagentsDir, "index.ts")));
const { loadAgentDefaults, discoverAgentCatalog } = __test__;
const { buildSubagentToolAllowlist } = await import(
  pathToFileURL(join(packageRoot, "maestro", "adapters", "pi", "launch-command.ts"))
);

// --- Rendered global roles resolve, with every launch-relevant field parsed.
const catalog = discoverAgentCatalog();
assert.deepEqual(
  catalog.diagnostics,
  [],
  `unexpected discovery diagnostics: ${JSON.stringify(catalog.diagnostics)}`,
);
const implementer = loadAgentDefaults("implementer");
assert.equal(implementer?.source, "global");
assert.equal(implementer?.tools, "read, bash, edit, write, grep, find");
assert.equal(implementer?.spawning, false);
assert.equal(implementer?.model, "omniroute/personal/implementer");
assert.equal(implementer?.thinking, "high");
assert.equal(implementer?.sessionMode, "standalone");
assert.equal(implementer?.systemPromptMode, "replace");
assert.equal(implementer?.autoExit, true);
assert.match(implementer?.body ?? "", /You implement one approved task/);

const orchestrator = loadAgentDefaults("orchestrator");
assert.equal(orchestrator?.source, "global");
assert.equal(orchestrator?.model, "omniroute/personal/main");
assert.equal(orchestrator?.thinking, "high");
assert.equal(orchestrator?.tools, "read, bash, subagent");
assert.equal(orchestrator?.spawning, true);
assert.equal(loadAgentDefaults("missing"), null);

// A hostile name survives as the launch key: it is emitted unquoted, so no
// literal quote characters end up in the discovered name or capability scalars.
const hostile = catalog.agents.find((agent) => agent.name === "edge: # [] {}");
assert.ok(
  hostile,
  `hostile-name role missing: ${JSON.stringify(catalog.agents.map((agent) => agent.name))}`,
);
assert.deepEqual(hostile.role.allowedTools, ["read", "bash"]);
assert.match(hostile.description ?? "", /line one/);

// --- Child tool allowlist: 3.7.2 drops subagent_done, always adds caller_ping,
// and re-adds subagent_done only for non-auto-exit children.
assert.equal(
  buildSubagentToolAllowlist(implementer?.tools, implementer?.autoExit),
  "read,bash,edit,write,grep,find,caller_ping",
);
assert.equal(
  buildSubagentToolAllowlist(orchestrator?.tools, orchestrator?.autoExit),
  "read,bash,subagent,caller_ping",
);
assert.equal(
  buildSubagentToolAllowlist(implementer?.tools, false),
  "read,bash,edit,write,grep,find,caller_ping,subagent_done",
);
assert.equal(buildSubagentToolAllowlist(undefined, true), null);

// --- Project precedence wins over the global render (accepted 3.7.2 behavior).
writeFileSync(
  join(project, ".pi", "agents", "implementer.md"),
  "---\nname: implementer\ntools: write\nspawning: true\n---\nproject\n",
);
writeFileSync(join(project, ".pi", "agents", "custom.md"), "---\nname: custom\ntools: write\n---\ncustom\n");
const projectImplementer = loadAgentDefaults("implementer");
assert.equal(projectImplementer?.source, "project");
assert.equal(projectImplementer?.tools, "write");
assert.equal(projectImplementer?.spawning, true);
assert.equal(loadAgentDefaults("orchestrator")?.source, "global");
assert.equal(loadAgentDefaults("custom")?.source, "project");
