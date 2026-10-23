import assert from "node:assert/strict";
import { expandServer, expandString, runShell } from "./expand.ts";
import { parseDotEnv } from "./dotenv.ts";
import { mergeServers, parseMcpJson } from "./parse.ts";

// parse
const ok = parseMcpJson('{"mcpServers":{"a":{"command":"x","args":["1"]},"b":{"url":"http://h/mcp"}}}');
assert.deepEqual(ok.warnings, []);
assert.deepEqual(ok.servers.map((s) => s.name), ["a", "b"]);
assert.equal(parseMcpJson("{nope").warnings.length, 1);
assert.equal(parseMcpJson("{}").warnings.length, 1);
assert.equal(parseMcpJson('{"mcpServers":[]}').warnings.length, 1);
const mixed = parseMcpJson('{"mcpServers":{"good":{"command":"x"},"bad":"str","arr":[]}}');
assert.deepEqual(mixed.servers.map((s) => s.name), ["good"]);
assert.equal(mixed.warnings.length, 2);

// label + merge: local overrides same name, keeps others
assert.match(parseMcpJson("{nope", ".mcp.local.json").warnings[0], /^\.mcp\.local\.json is not valid/);
const base = parseMcpJson('{"mcpServers":{"a":{"command":"base"},"b":{"command":"b"}}}').servers;
const local = parseMcpJson('{"mcpServers":{"a":{"command":"local"},"c":{"command":"c"}}}', ".mcp.local.json").servers;
const merged = mergeServers(base, local);
assert.deepEqual(merged.map((s) => s.name).sort(), ["a", "b", "c"]);
assert.equal(merged.find((s) => s.name === "a")?.config.command, "local");
assert.deepEqual(mergeServers([], local).map((s) => s.name), ["a", "c"]);

// dotenv
assert.deepEqual(parseDotEnv('A=1\n# c\nB="two words"\nexport C=3'), { A: "1", B: "two words", C: "3" });

// expand: plain fields
const env = { HOST: "example.com", EMPTY: "", T: "tok$en" };
const calls: string[] = [];
const run = (command: string) => (calls.push(command), command === "fail" ? undefined : `out(${command})`);
const plain = { env, run, native: false };
assert.equal(expandString("https://${HOST}/mcp", plain), "https://example.com/mcp");
assert.equal(expandString("${MISSING:-dflt}", plain), "dflt");
assert.equal(expandString("${EMPTY:-dflt}", plain), "dflt");
assert.equal(expandString("${HOST:-dflt}", plain), "example.com");
assert.equal(expandString("Bearer !(gh auth token)", plain), "Bearer out(gh auth token)");
assert.equal(expandString("!(echo (a) b)", plain), "out(echo (a) b)");
assert.equal(expandString("cost $$5 and $!(x)", plain), "cost $5 and !(x)");
assert.equal(expandString("plain $VAR stays", plain), "plain $VAR stays");
assert.equal(expandString("${bad name}", plain), "${bad name}");
assert.equal(expandString("unclosed !(abc", plain), "unclosed !(abc");
assert.throws(() => expandString("${MISSING}", plain), /variable MISSING is not set/);
assert.throws(() => expandString("!(fail)", plain), /shell command failed/);
assert.ok(!/tok/.test(String((() => { try { expandString("!(fail)", plain); } catch (e) { return e; } })())));

// expand: native fields leave plain ${VAR} / $VAR / $$ to Pi, handle :-default and !(...)
const native = { env, run, native: true };
assert.equal(expandString("${HOST}", native), "${HOST}");
assert.equal(expandString("$HOST", native), "$HOST");
assert.equal(expandString("${MISSING:-d}", native), "d");
assert.equal(expandString("Bearer !(gh auth token)", native), "Bearer out(gh auth token)");
assert.equal(expandString("a$$b", native), "a$$b");
assert.equal(expandString("$!(x)", native), "$!(x)");
// substituted text must not be re-expanded by Pi
assert.equal(expandString("x=${T:-n}", { env, run, native: true }), "x=tok$$en");
assert.equal(expandString("!(echo $HOME)", { env, run: () => "$HOME", native: true }), "$$HOME");
// whole value that expands to "!..." must not become a Pi command
assert.equal(expandString("!(c)", { env, run: () => "!rm", native: true }), "$!rm");

// expand: whole server
const server = expandServer(
	{ command: "run", args: ["--host", "${HOST}", "--k", "${MISSING:-z}"], url: "https://${HOST}", env: { A: "${HOST}", B: "!(tok)" }, headers: { H: "Bearer !(tok)" }, timeout: 5 },
	{ env, run },
);
assert.deepEqual(server.args, ["--host", "example.com", "--k", "z"]);
assert.equal(server.url, "https://example.com");
assert.deepEqual(server.env, { A: "${HOST}", B: "out(tok)" });
assert.deepEqual(server.headers, { H: "Bearer out(tok)" });
assert.equal(server.timeout, 5);
assert.throws(() => expandServer({ command: "x", args: ["${NOPE}"] }, { env, run }), /args\[0\]: variable NOPE is not set/);
assert.throws(() => expandServer({ command: "x", env: { K: "!(fail)" } }, { env, run }), /^Error: env\.K: shell command failed/);

// runShell: real sh, trims, failure -> undefined
assert.equal(runShell("echo hi", "/tmp"), "hi");
assert.equal(runShell("exit 3", "/tmp"), undefined);
assert.equal(runShell("true", "/tmp"), undefined);
