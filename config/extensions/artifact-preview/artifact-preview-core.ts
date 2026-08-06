import { createReadStream } from "node:fs";
import { lstat, realpath, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { networkInterfaces } from "node:os";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";

const MIME = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".htm", "text/html; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".webp", "image/webp"],
]);

type Artifact = { kind: "file" | "directory"; path: string; name: string };

export type ArtifactHost = {
  host: string;
  port: number;
  register(path: string): Promise<{ kind: Artifact["kind"]; url: string }>;
  close(): Promise<void>;
};

export function defaultArtifactHost(): string {
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    if (!/^tailscale/i.test(name)) continue;
    const address = addresses?.find((item) => item.family === "IPv4" && !item.internal)?.address;
    if (address) return address;
  }
  return "127.0.0.1";
}

export async function startArtifactHost(host: string, port = 0): Promise<ArtifactHost> {
  if (!host || host === "0.0.0.0" || host === "::") throw new Error("PI_ARTIFACT_HOST must be a concrete loopback or Tailscale address, not a wildcard.");
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("PI_ARTIFACT_PORT must be an integer from 0 to 65535.");

  const artifacts = new Map<string, Artifact>();
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff");
    try {
      if (request.method !== "GET" && request.method !== "HEAD") return send(response, 405, "Method not allowed");
      const parts = new URL(request.url ?? "/", "http://artifact.local").pathname.split("/").filter(Boolean).map(decodeURIComponent);
      const artifact = artifacts.get(parts.shift() ?? "");
      if (!artifact || parts.some((part) => part === "." || part === ".." || part.includes("/") || part.includes("\\"))) return send(response, 404, "Not found");

      let candidate: string;
      if (artifact.kind === "file") {
        if (parts.length !== 1 || parts[0] !== artifact.name) return send(response, 404, "Not found");
        candidate = artifact.path;
      } else {
        candidate = resolve(artifact.path, ...parts);
        if (!inside(artifact.path, candidate)) return send(response, 404, "Not found");
        candidate = await realpath(candidate);
        if (!inside(artifact.path, candidate)) return send(response, 404, "Not found");
        if ((await stat(candidate)).isDirectory()) candidate = await realpath(join(candidate, "index.html"));
        if (!inside(artifact.path, candidate)) return send(response, 404, "Not found");
      }

      const info = await stat(candidate);
      if (!info.isFile()) return send(response, 404, "Not found");
      response.writeHead(200, {
        "Content-Length": info.size,
        "Content-Type": MIME.get(extname(candidate).toLowerCase()) ?? "application/octet-stream",
      });
      if (request.method === "HEAD") return response.end();
      createReadStream(candidate).on("error", () => response.destroy()).pipe(response);
    } catch {
      if (!response.headersSent) send(response, 404, "Not found");
      else response.destroy();
    }
  });

  await listen(server, host, port);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Artifact host did not expose a TCP address.");
  const urlHost = host.includes(":") ? `[${host}]` : host;

  return {
    host,
    port: address.port,
    async register(input) {
      if (artifacts.size >= 128) throw new Error("Artifact host registration limit reached (128 per session).");
      const path = await realpath(input);
      const info = await lstat(path);
      if (!info.isFile() && !info.isDirectory()) throw new Error("Artifact path must be a regular file or directory.");
      const kind = info.isDirectory() ? "directory" : "file";
      const name = basename(path);
      const token = randomBytes(18).toString("base64url");
      artifacts.set(token, { kind, path, name });
      const suffix = kind === "directory" ? "/" : `/${encodeURIComponent(name)}`;
      return { kind, url: `http://${urlHost}:${address.port}/${token}${suffix}` };
    },
    close: () => close(server),
  };
}

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}

function send(response: import("node:http").ServerResponse, status: number, body: string): void {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(body);
}

function listen(server: Server, host: string, port: number): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolvePromise();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    server.closeAllConnections();
    server.close((error) => error ? reject(error) : resolvePromise());
  });
}
