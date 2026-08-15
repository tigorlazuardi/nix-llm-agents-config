import assert from "node:assert/strict";
import lazyTools from "./index.ts";

type Group = "browser" | "subagents" | "research" | "herdr" | "background" | "mesh" | "journal" | "artifact" | "todo";
const core = ["read", "bash", "ask_user", "rename_herdr_tab"];
const grouped: Record<Group, string[]> = {
  browser: ["browser_open"],
  subagents: ["subagent", "subagent_interrupt", "subagents_list", "subagent_resume"],
  research: ["web_search", "mcp"],
  herdr: ["herdr_layout", "sudo_task"],
  background: ["jobs"],
  mesh: ["agent_send"],
  journal: ["dev_journal"],
  artifact: ["host_artifact"],
  todo: ["todo"],
};
const paths: Record<string, string> = {
  read: "<builtin:read>",
  bash: "/nix/store/pi-patty-bg-tasks/index.ts",
  ask_user: "/nix/store/pi-ask-herdr/index.ts",
  rename_herdr_tab: "/nix/store/pi-herdr-rename/index.ts",
  browser_open: "/nix/store/browser-goblin/index.ts",
  subagent: "/nix/store/pi-herdr-subagents/pi-extension/subagents/index.ts",
  subagent_interrupt: "/nix/store/pi-herdr-subagents/pi-extension/subagents/index.ts",
  subagents_list: "/nix/store/pi-herdr-subagents/pi-extension/subagents/index.ts",
  subagent_resume: "/nix/store/pi-herdr-subagents/pi-extension/subagents/index.ts",
  web_search: "/nix/store/pi-web-access/index.ts",
  mcp: "/nix/store/pi-mcp-adapter/index.ts",
  herdr_layout: "/nix/store/pi-herdr/index.ts",
  sudo_task: "/nix/store/pi-herdr-sudo-task/index.ts",
  jobs: "/nix/store/pi-patty-bg-tasks/index.ts",
  agent_send: "/nix/store/remote-pi/index.ts",
  dev_journal: "/config/extensions/dev-journal/index.ts",
  host_artifact: "/config/extensions/artifact-preview/index.ts",
  todo: "/nix/store/rpiv-todo/index.ts",
};
let active = [...core, ...Object.values(grouped).flat()];
let loader: { execute: (_id: string, params: { group: Group }) => Promise<unknown> } | undefined;
let sessionStart: (() => void) | undefined;
const tools = Object.entries(paths).map(([name, path]) => ({ name, description: "", sourceInfo: { path } }));

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
assert.deepEqual(active, [...core, "load_tools"]);
for (const group of Object.keys(grouped) as Group[]) {
  await loader.execute(group, { group });
  for (const tool of grouped[group]) assert(active.includes(tool));
  for (const tool of core) assert(active.includes(tool));
}
