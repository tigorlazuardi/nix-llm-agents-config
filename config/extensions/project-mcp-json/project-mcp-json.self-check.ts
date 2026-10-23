import assert from "node:assert/strict";
import { parseMcpJson } from "./parse.ts";

const ok = parseMcpJson('{"mcpServers":{"a":{"command":"x","args":["1"]},"b":{"url":"http://h/mcp"}}}');
assert.deepEqual(ok.warnings, []);
assert.deepEqual(ok.servers.map((s) => s.name), ["a", "b"]);
assert.deepEqual(ok.servers[0].config, { command: "x", args: ["1"] });

assert.equal(parseMcpJson("{nope").servers.length, 0);
assert.equal(parseMcpJson("{nope").warnings.length, 1);
assert.equal(parseMcpJson("{}").warnings.length, 1);
assert.equal(parseMcpJson('{"mcpServers":[]}').warnings.length, 1);

const mixed = parseMcpJson('{"mcpServers":{"good":{"command":"x"},"bad":"str","arr":[]}}');
assert.deepEqual(mixed.servers.map((s) => s.name), ["good"]);
assert.equal(mixed.warnings.length, 2);
