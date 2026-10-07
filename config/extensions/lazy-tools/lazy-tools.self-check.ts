import assert from "node:assert/strict";
import lazyTools from "./index.ts";

type Group = "browser" | "subagents" | "research" | "herdr" | "sudo" | "journal" | "artifact" | "memory";
const core = ["read", "bash", "bash_bg", "agent_bg", "jobs", "monitor", "ask_user_question", "rename_herdr_tab", "todo", "agent_send", "list_peers"];
const grouped: Record<Group, string[]> = {
  browser: ["browser_open"],
  subagents: ["subagent", "subagent_interrupt", "subagents_list", "subagent_resume"],
  research: ["web_search", "mcp", "mcpScript"],
  herdr: ["herdr_layout"],
  sudo: ["sudo_run"],
  journal: ["dev_journal"],
  artifact: ["host_artifact"],
  memory: ["recall"],
};
const paths: Record<string, string> = {
  read: "<builtin:read>",
  bash: "/nix/store/pi-bg/index.ts",
  bash_bg: "/nix/store/pi-bg/index.ts",
  ask_user_question: "/nix/store/@juicesharp/rpiv-ask-user-question/src/index.ts",
  rename_herdr_tab: "/nix/store/pi-herdr-rename/index.ts",
  browser_open: "/nix/store/browser-goblin/index.ts",
  subagent: "/nix/store/pi-herdr-subagents/pi-extension/subagents/index.ts",
  subagent_interrupt: "/nix/store/pi-herdr-subagents/pi-extension/subagents/index.ts",
  subagents_list: "/nix/store/pi-herdr-subagents/pi-extension/subagents/index.ts",
  subagent_resume: "/nix/store/pi-herdr-subagents/pi-extension/subagents/index.ts",
  web_search: "/nix/store/pi-web-access/index.ts",
  mcp: "/nix/store/pi-mcp-adapter/index.ts",
  mcpScript: "/nix/store/pi-mcp-adapter/index.ts",
  herdr_layout: "/nix/store/pi-herdr/index.ts",
  sudo_run: "/nix/store/@xynogen/pix-sudo/src/index.ts",
  jobs: "/nix/store/pi-bg/index.ts",
  agent_bg: "/nix/store/pi-bg/index.ts",
  monitor: "/nix/store/pi-bg/index.ts",
  agent_send: "/nix/store/pi-messaging-relay-extension/index.ts",
  list_peers: "/nix/store/pi-messaging-relay-extension/index.ts",
  dev_journal: "/config/extensions/dev-journal/index.ts",
  host_artifact: "/config/extensions/artifact-preview/index.ts",
  recall: "/nix/store/pi-blackhole/index.js",
  todo: "/nix/store/pi-todo-herdr/index.ts",
};
const tools = Object.entries(paths).map(([name, path]) => ({ name, description: "", sourceInfo: { path } }));

type Harness = {
  active: string[];
  loader: { execute: (_id: string, params: { group: Group }) => Promise<unknown> };
  sessionStart: (event: { reason: string }) => void;
  toolCall: (event: { toolName: string }) => { block: boolean; reason?: string } | undefined;
};

function harness(initialActive: string[]): Harness {
  const state: Harness = {
    active: initialActive,
    loader: undefined as never,
    sessionStart: undefined as never,
    toolCall: undefined as never,
  };
  lazyTools({
    registerTool(definition: typeof state.loader) {
      state.loader = definition;
      tools.push({ name: "load_tools", description: "", sourceInfo: { path: "/config/extensions/lazy-tools/index.ts" } });
    },
    on(event: string, handler: (payload?: unknown) => unknown) {
      if (event === "session_start") state.sessionStart = handler as Harness["sessionStart"];
      if (event === "tool_call") state.toolCall = handler as Harness["toolCall"];
    },
    getAllTools: () => tools,
    getActiveTools: () => state.active,
    setActiveTools(names: string[]) {
      state.active = names;
    },
  } as never);
  assert(state.loader && state.sessionStart && state.toolCall);
  return state;
}

// --- Fresh session: deferred tools hidden, model cannot call them at all.
const fresh = harness([...core, ...Object.values(grouped).flat()]);
fresh.sessionStart({ reason: "startup" });
assert(!fresh.active.includes("agent_bg"));
assert.deepEqual(fresh.active, [...core.filter((name) => name !== "agent_bg"), "load_tools"]);
assert(!fresh.active.includes("mcpScript"));
let researchLoaded = false;
for (const group of Object.keys(grouped) as Group[]) {
  if (!researchLoaded) assert(!fresh.active.includes("mcpScript"));
  await fresh.loader.execute("x", { group });
  for (const tool of grouped[group]) assert(fresh.active.includes(tool));
  for (const tool of core) if (tool !== "agent_bg") assert(fresh.active.includes(tool));
  if (group === "research") researchLoaded = true;
  assert.equal(fresh.active.includes("mcpScript"), researchLoaded);
}
// Loaded tools are unlocked: gate must not block them.
assert(!fresh.toolCall({ toolName: "browser_open" })?.block);
assert(!fresh.toolCall({ toolName: "bash" })?.block);

// --- Reload: transcript-restored tools stay active but gated until load_tools.
const reloaded = harness([...core.filter((name) => name !== "agent_bg"), "browser_open", "web_search", "load_tools"]);
reloaded.sessionStart({ reason: "reload" });
assert(reloaded.active.includes("browser_open"));
assert(reloaded.active.includes("load_tools"));
const blockedBrowser = reloaded.toolCall({ toolName: "browser_open" });
assert.equal(blockedBrowser?.block, true);
assert.match(blockedBrowser?.reason ?? "", /load_tools/);
assert.match(blockedBrowser?.reason ?? "", /browser/);
await reloaded.loader.execute("x", { group: "browser" });
assert(!reloaded.toolCall({ toolName: "browser_open" })?.block);
// Other groups stay gated after loading only one group.
assert.equal(reloaded.toolCall({ toolName: "web_search" })?.block, true);

// --- Resume: same gating contract as reload.
const resumed = harness([...core.filter((name) => name !== "agent_bg"), "browser_open", "load_tools"]);
resumed.sessionStart({ reason: "resume" });
assert(resumed.active.includes("browser_open"));
assert.equal(resumed.toolCall({ toolName: "browser_open" })?.block, true);
await resumed.loader.execute("x", { group: "browser" });
assert(!resumed.toolCall({ toolName: "browser_open" })?.block);

// --- Subagent children: fixed allowed set, no gating.
process.env.PI_SUBAGENT_ALLOWED_TOOLS = "read,bash,agent_bg,subagent,caller_ping,subagent_done";
const child = harness(["read", "bash", "agent_bg", "subagent", "caller_ping", "subagent_done"]);
child.sessionStart({ reason: "startup" });
assert(!child.active.includes("agent_bg"));
assert.deepEqual(child.active, ["read", "bash", "subagent", "caller_ping", "subagent_done"]);
await child.loader.execute("x", { group: "browser" });
assert.deepEqual(child.active, ["read", "bash", "subagent", "caller_ping", "subagent_done"]);
assert(!child.toolCall({ toolName: "browser_open" })?.block);
delete process.env.PI_SUBAGENT_ALLOWED_TOOLS;
