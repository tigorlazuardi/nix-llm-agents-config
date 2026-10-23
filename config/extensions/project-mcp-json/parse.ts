/**
 * Parse a Claude Code-style `.mcp.json` into entries for `pi.registerMcpServer`.
 * Pure (no imports) so the self-check runs without Pi's runtime.
 *
 * ponytail: entries pass through unchanged; Pi validates each one on register
 * (`${VAR}` expansion, `type`, `sse` rejection). Add translation when a real
 * `.mcp.json` needs it.
 */

export interface ParsedMcpJson {
	servers: Array<{ name: string; config: Record<string, unknown> }>;
	warnings: string[];
}

export function parseMcpJson(content: string): ParsedMcpJson {
	let data: unknown;
	try {
		data = JSON.parse(content);
	} catch {
		return { servers: [], warnings: [".mcp.json is not valid JSON"] };
	}
	const table = (data as { mcpServers?: unknown } | null)?.mcpServers;
	if (!table || typeof table !== "object" || Array.isArray(table)) {
		return { servers: [], warnings: [".mcp.json has no mcpServers object"] };
	}
	const servers: ParsedMcpJson["servers"] = [];
	const warnings: string[] = [];
	for (const [name, config] of Object.entries(table)) {
		if (config && typeof config === "object" && !Array.isArray(config)) {
			servers.push({ name, config: config as Record<string, unknown> });
		} else {
			warnings.push(`.mcp.json server "${name}" is not an object`);
		}
	}
	return { servers, warnings };
}
