import assert from "node:assert/strict";
import lazyTools from "./index.ts";

let active = ["read", "browser_open", "subagent"];
let loader: { execute: (_id: string, params: { group: "browser" | "subagents" }) => Promise<unknown> } | undefined;
let sessionStart: (() => void) | undefined;
const tools = [
  { name: "read", description: "", sourceInfo: { path: "<builtin:read>" } },
  { name: "browser_open", description: "", sourceInfo: { path: "/nix/store/browser-goblin/extensions/pi-browser/index.ts" } },
  { name: "subagent", description: "", sourceInfo: { path: "/nix/store/pi-subagents/src/index.ts" } },
];

lazyTools({
  registerTool(definition: typeof loader) {
    loader = definition;
    tools.push({ name: "load_tools", description: "", sourceInfo: { path: "/config/extensions/lazy-tools/index.ts" } });
  },
  on(event: string, handler: () => void) {
    if (event === "session_start") sessionStart = handler;
  },
  getAllTools: () => tools,
  getActiveTools: () => active,
  setActiveTools(names: string[]) {
    active = names;
  },
} as never);

assert(loader && sessionStart);
sessionStart();
assert.deepEqual(active, ["read", "load_tools"]);
await loader.execute("browser", { group: "browser" });
assert.deepEqual(active, ["read", "load_tools", "browser_open"]);
await loader.execute("subagents", { group: "subagents" });
assert.deepEqual(active, ["read", "load_tools", "browser_open", "subagent"]);
