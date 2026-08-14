import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

const GROUP_MARKERS = {
  browser: "browser-goblin",
  subagents: "subagents",
} as const;
type Group = keyof typeof GROUP_MARKERS;

export default function (pi: ExtensionAPI) {
  const groupTools = (group: Group) => pi.getAllTools()
    .filter((tool) => tool.name !== "load_tools" && tool.sourceInfo.path.includes(GROUP_MARKERS[group]))
    .map((tool) => tool.name);

  pi.registerTool({
    name: "load_tools",
    label: "Load Tools",
    description: "Enable an installed tool group for this session. Use browser for browser automation; use subagents only for /supervise, delegation, or explicit subagent work.",
    promptSnippet: "Enable browser or subagent tools when needed",
    promptGuidelines: ["Use load_tools before browser automation or explicit subagent delegation when those tools are unavailable."],
    parameters: Type.Object({
      group: StringEnum(["browser", "subagents"] as const),
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
    const deferred = new Set((Object.keys(GROUP_MARKERS) as Group[]).flatMap(groupTools));
    pi.setActiveTools([...new Set([
      ...pi.getActiveTools().filter((name) => !deferred.has(name)),
      "load_tools",
    ])]);
  });
}
