import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

const GROUP_NAMES = ["browser", "subagents", "research", "herdr", "journal", "artifact", "memory"] as const;
type Group = typeof GROUP_NAMES[number];
const GROUP_MARKERS: Record<Group, readonly string[]> = {
  browser: ["browser-goblin"],
  subagents: ["pi-herdr-subagents"],
  research: ["pi-web-access", "pi-mcp-adapter"],
  herdr: ["pi-herdr", "pix-sudo"],
  journal: ["dev-journal"],
  artifact: ["artifact-preview"],
  memory: ["pi-blackhole"],
};
const ALWAYS_ACTIVE = new Set(["bash", "bash_bg", "ask_user", "rename_herdr_tab", "todo", "load_tools"]);
// Permanently hidden every session — NOT deferrable via load_tools. Models mistake
// agent_bg for a subagent/delegation tool and misfire it; background pi -p work goes
// through the subagents group instead.
const HIDDEN_TOOLS = new Set(["agent_bg"]);

export default function (pi: ExtensionAPI) {
  const childAllowedTools = process.env.PI_SUBAGENT_ALLOWED_TOOLS
    ? new Set(process.env.PI_SUBAGENT_ALLOWED_TOOLS.split(",").map((name) => name.trim()).filter(Boolean))
    : null;
  const groupTools = (group: Group) => pi.getAllTools()
    .filter((tool) =>
      !ALWAYS_ACTIVE.has(tool.name)
      && (!childAllowedTools || childAllowedTools.has(tool.name))
      && GROUP_MARKERS[group].some((marker) => tool.sourceInfo.path.includes(marker)))
    .map((tool) => tool.name);
  const groupOfTool = (name: string): Group | undefined => {
    for (const group of GROUP_NAMES) {
      if (groupTools(group).includes(name)) return group;
    }
    return undefined;
  };
  // Groups unlocked via load_tools in this session. resume/fork/reload build a fresh
  // extension instance, so previously loaded groups reset to locked.
  const unlocked = new Set<Group>();

  pi.registerTool({
    name: "load_tools",
    label: "Load Tools",
    description: "Enable an installed tool group for this session. Groups: browser, subagents, research/web/MCP, Herdr/elevation, journal, artifact hosting, memory/recall.",
    promptSnippet: "Enable deferred tool groups when needed",
    promptGuidelines: ["Use load_tools before browser automation; /supervise or delegation; web/current-source/MCP research; explicit Herdr or elevated work; journal access; artifact preview; or memory recall search."],
    parameters: Type.Object({
      group: StringEnum(GROUP_NAMES),
    }),
    async execute(_id, { group }) {
      const matches = groupTools(group);
      const active = pi.getActiveTools();
      const added = matches.filter((name) => !active.includes(name));
      pi.setActiveTools([...new Set([...active, ...added])]);
      unlocked.add(group);
      return {
        content: [{
          type: "text",
          text: matches.length === 0
            ? `No installed tools found for group: ${group}`
            : added.length === 0
              ? `Tool group already loaded: ${group}`
              : `Loaded tools: ${added.join(", ")}`,
        }],
        details: { group, matches, added },
      };
    },
  });

  // Reject calls to deferred tools that are visible but not loaded yet. The agent loop
  // answers calls to inactive tools with an opaque "Tool not found" before any tool_call
  // hook runs, so deferred tools must stay active to receive this rejection.
  pi.on("tool_call", (event) => {
    if (childAllowedTools) return;
    const group = groupOfTool(event.toolName);
    if (!group || unlocked.has(group)) return;
    return {
      block: true,
      reason: `Tool "${event.toolName}" is deferred and not loaded in this session. Call the load_tools tool with group "${group}" first, then retry.`,
    };
  });

  pi.on("session_start", (event) => {
    const active = pi.getActiveTools();
    if (childAllowedTools) {
      pi.setActiveTools(active.filter((name) =>
        !HIDDEN_TOOLS.has(name) && childAllowedTools.has(name)));
      return;
    }
    if (event.reason === "resume" || event.reason === "fork" || event.reason === "reload") {
      // Keep transcript-restored tools active so the model can call them and get the
      // "load first" rejection above instead of "Tool not found" + bash fallback.
      pi.setActiveTools([...new Set([
        ...active.filter((name) => !HIDDEN_TOOLS.has(name)),
        "load_tools",
      ])]);
      return;
    }
    const deferred = new Set(GROUP_NAMES.flatMap(groupTools));
    pi.setActiveTools([...new Set([
      ...active.filter((name) => !HIDDEN_TOOLS.has(name) && !deferred.has(name)),
      "load_tools",
    ])]);
  });
}
