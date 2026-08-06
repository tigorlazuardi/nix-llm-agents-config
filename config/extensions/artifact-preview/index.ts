import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolve } from "node:path";
import { defaultArtifactHost, startArtifactHost, type ArtifactHost } from "./artifact-preview-core.ts";

function configuredPort(): number {
  const value = process.env.PI_ARTIFACT_PORT;
  if (value === undefined || value === "") return 0;
  if (!/^\d+$/.test(value)) throw new Error("PI_ARTIFACT_PORT must be an integer from 0 to 65535.");
  return Number(value);
}

export default function (pi: ExtensionAPI) {
  let runtime: ArtifactHost | undefined;
  let starting: Promise<ArtifactHost> | undefined;
  const getRuntime = () => {
    if (runtime) return Promise.resolve(runtime);
    return starting ??= startArtifactHost(
      process.env.PI_ARTIFACT_HOST?.trim() || defaultArtifactHost(),
      configuredPort(),
    ).then((host) => runtime = host).finally(() => starting = undefined);
  };

  pi.registerTool({
    name: "host_artifact",
    label: "Host Artifact",
    description: "Host one generated file or directory over HTTP for browser preview. Returns a session-scoped URL; directory roots serve index.html and relative assets.",
    promptSnippet: "Host generated HTML, PDF, image, or report artifacts for browser preview",
    promptGuidelines: ["Use host_artifact after generating a browser-viewable artifact when the user asks for a preview or hosted report."],
    parameters: Type.Object({
      path: Type.String({ description: "Artifact file or directory, absolute or relative to current working directory" }),
    }),
    async execute(_id, params, signal, _update, ctx) {
      if (signal?.aborted) throw new Error("Artifact hosting cancelled.");
      const input = params.path.startsWith("@") ? params.path.slice(1) : params.path;
      const host = await getRuntime();
      const result = await host.register(resolve(ctx.cwd, input));
      ctx.ui.setStatus("artifact-preview", `preview ${host.host}:${host.port}`);
      return {
        content: [{ type: "text", text: `Preview: ${result.url}` }],
        details: { ...result, path: resolve(ctx.cwd, input) },
      };
    },
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    ctx.ui.setStatus("artifact-preview", undefined);
    if (!runtime && !starting) return;
    const host = runtime ?? await starting;
    runtime = undefined;
    starting = undefined;
    await host?.close();
  });
}
