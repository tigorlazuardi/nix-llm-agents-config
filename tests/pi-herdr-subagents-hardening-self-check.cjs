const assert = require("node:assert/strict");
const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const [packageRoot, piNodeModules, userRoot, projectRoot, helper] = process.argv.slice(2);
const { createJiti } = require(join(piNodeModules, "jiti"));
const load = createJiti(join(packageRoot, "nix-check.cjs"), { interopDefault: true });
const mod = load("./extension/index.ts");
const registrar = load("./extension/registrar.ts");

const userAgentsDir = join(userRoot, ".pi", "agents");
const projectAgentsDir = join(projectRoot, ".pi", "agents");
mkdirSync(userAgentsDir, { recursive: true });
mkdirSync(projectAgentsDir, { recursive: true });
const agent = (name, tools, body = "fixture") =>
  `---\nname: ${JSON.stringify(name)}\ndescription: "fixture"\ntools:\n${tools.map((tool) => `  - ${JSON.stringify(tool)}\n`).join("")}---\n${body}`;
const writeUserAgent = (file, name, tools) => writeFileSync(join(userAgentsDir, file), agent(name, tools));
writeUserAgent("ordinary.md", "ordinary", ["read", "bash"]);
writeUserAgent("orchestrator.md", "orchestrator", ["read", "bash", "subagent"]);
writeUserAgent("ordinary-policy-violation.md", "ordinary-policy-violation", ["read", "subagent"]);
writeUserAgent("empty.md", "empty", []);
writeUserAgent("mixed.md", "mixed", ["read", 7]);
writeUserAgent("padded.md", "padded", ["read", " bash"]);
writeUserAgent("duplicate.md", "duplicate", ["read", "read"]);
writeUserAgent("unresolved.md", "different-name", ["read"]);
writeFileSync(join(userAgentsDir, "scalar.md"), '---\nname: "scalar"\ndescription: "fixture"\ntools: read, bash\n---\nfixture');
writeFileSync(join(userAgentsDir, "missing-tools.md"), '---\nname: "missing-tools"\ndescription: "fixture"\n---\nfixture');
writeFileSync(join(projectAgentsDir, "ordinary-shadow.md"), agent("ordinary", ["subagent"], "project shadow"));
writeFileSync(join(projectAgentsDir, "project-only.md"), agent("project-only", ["subagent"], "project only"));
process.env.HERDR_SUBAGENT_HELPER = helper;

async function activeTools(agentName, envValue, cwd = projectRoot) {
  let active = ["read", "bash", "subagent"];
  const calls = [];
  const handlers = {};
  const pi = {
    registerFlag() {},
    registerTool() {},
    getFlag: () => agentName,
    getActiveTools: () => active,
    setActiveTools(tools) {
      active = [...tools];
      calls.push([...tools]);
    },
    sendMessage() {},
    on(event, handler) {
      handlers[event] = handler;
      return () => {};
    },
  };
  if (envValue === undefined) delete process.env.HERDR_SUBAGENT;
  else process.env.HERDR_SUBAGENT = envValue;
  mod._setResolveCwd(cwd);
  mod._setResolveUserDir(userRoot);
  mod.default(pi);
  let result;
  let threw = false;
  try {
    result = await handlers.before_agent_start({ systemPrompt: "base" });
  } catch {
    threw = true;
  }
  await handlers.session_shutdown();
  return { active, calls, threw, systemPrompt: result?.systemPrompt };
}

const policyResult = ({ active, calls, threw }) => ({ active, calls, threw });

(async () => {
  const parsedSpecial = registrar.resolveManagedUserAgent("edge: # [] {}", userRoot);
  assert.equal(parsedSpecial.name, "edge: # [] {}");
  assert.equal(parsedSpecial.description, "line one:\nline two # []");
  assert.deepEqual(parsedSpecial.tools, ["tool: special # []", "line\ntool"]);
  assert.equal(parsedSpecial.path, join(userAgentsDir, "edge: # [] {}.md"));

  for (const envValue of [undefined, "", "0", "true", "01"]) {
    assert.deepEqual(policyResult(await activeTools("ordinary", envValue)), {
      active: ["read", "bash", "subagent"],
      calls: [],
      threw: false,
    });
  }

  const cases = [
    ["ordinary", ["read", "bash"], [[], ["read", "bash"]]],
    ["orchestrator", ["read", "bash", "subagent"], [[], ["read", "bash", "subagent"]]],
    ["ordinary-policy-violation", ["read"], [[], ["read"]]],
    ["edge: # [] {}", ["tool: special # []", "line\ntool"], [[], ["tool: special # []", "line\ntool"]]],
    ["project-only", [], [[]]],
    ["../escape", [], [[]]],
    ["empty", [], [[]]],
    ["scalar", [], [[]]],
    ["mixed", [], [[]]],
    ["padded", [], [[]]],
    ["duplicate", [], [[]]],
    ["missing-tools", [], [[]]],
    ["unresolved", [], [[]]],
    ["missing", [], [[]]],
  ];
  for (const [name, active, calls] of cases) {
    assert.deepEqual(policyResult(await activeTools(name, "1")), { active, calls, threw: false }, name);
  }

  const shadowed = await activeTools("ordinary", "1");
  assert.match(shadowed.systemPrompt, /project shadow$/);
  assert(!shadowed.active.includes("subagent"));

  assert.deepEqual(policyResult(await activeTools("ordinary", "1", null)), {
    active: [],
    calls: [[]],
    threw: true,
  });
})();
