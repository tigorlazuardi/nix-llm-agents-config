import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

const GROUP_NAMES = ["browser", "subagents", "research", "herdr", "background", "mesh", "journal", "artifact", "todo"] as const;
type Group = typeof GROUP_NAMES[number];
const GROUP_MARKERS: Record<Group, readonly string[]> = {
  browser: ["browser-goblin"],
  subagents: ["pi-herdr-subagents"],
  research: ["pi-web-access", "pi-mcp-adapter"],
  herdr: ["pi-herdr"],
  background: ["pi-patty-bg-tasks"],
  mesh: ["remote-pi"],
  journal: ["dev-journal"],
  artifact: ["artifact-preview"],
  todo: ["rpiv-todo"],
};
const ALWAYS_ACTIVE = new Set(["bash", "ask_user", "rename_herdr_tab", "load_tools"]);

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

  pi.registerTool({
    name: "load_tools",
    label: "Load Tools",
    description: "Enable an installed tool group for this session. Groups: browser, subagents, research/web/MCP, Herdr/elevation, background jobs, mesh peers, journal, artifact hosting, todo.",
    promptSnippet: "Enable deferred tool groups when needed",
    promptGuidelines: ["Use load_tools before browser automation; /supervise or delegation; web/current-source/MCP research; explicit Herdr or elevated work; background/streaming work; mesh coordination; journal access; artifact preview; or todo tracking for 3+ steps."],
    parameters: Type.Object({
      group: StringEnum(GROUP_NAMES),
    }),
    async execute(_id, { group }) {
      const matches = groupTools(group);
      const active = pi.getActiveTools();
      const added = matches.filter((name) => !active.includes(name));
      pi.setActiveTools([...new Set([...active, ...added])]);
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

  pi.on("session_start", () => {
    const deferred = new Set(GROUP_NAMES.flatMap(groupTools));
    const active = pi.getActiveTools().filter((name) =>
      childAllowedTools ? childAllowedTools.has(name) : !deferred.has(name));
    pi.setActiveTools([...new Set([
      ...active,
      ...(childAllowedTools ? [] : ["load_tools"]),
    ])]);
  });
}
