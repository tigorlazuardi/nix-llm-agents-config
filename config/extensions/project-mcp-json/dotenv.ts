// ponytail: copy of env-loader/index.ts parseDotEnv; extensions are installed as
// separate directories, so they cannot import each other. Dedupe when a shared dir exists.
export function parseDotEnv(content: string): Record<string, string> {
	const vars: Record<string, string> = {};
	for (const rawLine of content.split("\n")) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const withoutExport = line.startsWith("export ") ? line.slice(7).trim() : line;
		const eq = withoutExport.indexOf("=");
		if (eq <= 0) continue;
		const key = withoutExport.slice(0, eq).trim();
		let value = withoutExport.slice(eq + 1).trim();
		const quote = value[0];
		if ((quote === '"' || quote === "'") && value.length > 1 && value.endsWith(quote)) {
			value = value.slice(1, -1);
		}
		if (key) vars[key] = value;
	}
	return vars;
}
