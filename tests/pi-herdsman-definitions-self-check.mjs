// Validates the rendered pi-herdsman agent-definition fixtures against the
// frontmatter contract pi-herdsman's validateDefinition enforces at discovery:
// unknown fields fail the whole roster, tools/skills/agents must be arrays,
// and systemPromptMode defaults to append unless explicitly "replace".
// Values are rendered as JSON by the module, so each frontmatter line parses
// with JSON.parse without a YAML dependency.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const [, , implementerFixture, orchestratorFixture] = process.argv;
assert(implementerFixture && orchestratorFixture, "usage: self-check <implementer.md> <orchestrator.md>");

const LEGACY_KEYS = new Set(["system-prompt", "session-mode", "spawning", "auto-exit", "interactive"]);

function parseFixture(path) {
  const content = readFileSync(path, "utf8");
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  assert(match, `${path}: frontmatter block missing`);
  const frontmatter = {};
  for (const line of match[1].split("\n")) {
    const keyValue = line.match(/^([A-Za-z]+): (.*)$/);
    assert(keyValue, `${path}: unparsable frontmatter line: ${line}`);
    frontmatter[keyValue[1]] = JSON.parse(keyValue[2]);
  }
  const body = content.slice(match[0].length);
  assert(body.trim().length > 0, `${path}: prompt body missing`);
  return frontmatter;
}

function assertHerdsmanShape(path, frontmatter, expectedAgents) {
  for (const key of Object.keys(frontmatter)) {
    assert(!LEGACY_KEYS.has(key), `${path}: legacy field ${key} fails pi-herdsman discovery`);
  }
  assert.equal(frontmatter.systemPromptMode, "replace", `${path}: systemPromptMode must be explicit replace`);
  assert(Array.isArray(frontmatter.tools) && frontmatter.tools.length > 0, `${path}: tools must be a non-empty array`);
  for (const tool of frontmatter.tools) assert(typeof tool === "string" && tool.length > 0);
  assert(Array.isArray(frontmatter.agents), `${path}: agents must be an array`);
  assert.deepEqual([...frontmatter.agents].sort(), [...expectedAgents].sort(), `${path}: delegation allowlist mismatch`);
  assert.equal(frontmatter.noSkills, false, `${path}: children must keep ambient skill loading`);
  assert.equal(frontmatter.noExtensions, false, `${path}: children must keep ambient extension loading`);
  assert.equal(frontmatter.inheritProjectContext, true);
  assert.equal(frontmatter.inheritGlobalContext, true);
  assert(typeof frontmatter.name === "string" && frontmatter.name.length > 0);
  assert(typeof frontmatter.description === "string" && frontmatter.description.length > 0);
}

const implementer = parseFixture(implementerFixture);
assertHerdsmanShape(implementerFixture, implementer, []);
assert.equal(implementer.name, "implementer");
assert.equal(implementer.skills, undefined, "default implementer must not pin a skills list");

const orchestrator = parseFixture(orchestratorFixture);
assertHerdsmanShape(orchestratorFixture, orchestrator, [
  "scout",
  "implementer",
  "standards-reviewer",
  "deep-reviewer",
]);
assert.equal(orchestrator.name, "orchestrator");
assert.equal(orchestrator.thinking, "high");
assert.equal(orchestrator.model, "omniroute/personal/worker");
