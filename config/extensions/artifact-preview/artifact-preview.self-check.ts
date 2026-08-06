import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startArtifactHost } from "./artifact-preview-core.ts";

const root = await mkdtemp(join(tmpdir(), "pi-artifact-preview-"));
const site = join(root, "site");
await mkdir(site);
await writeFile(join(site, "index.html"), "<h1>preview</h1>");
await writeFile(join(site, "style.css"), "h1 { color: red; }");
await writeFile(join(root, "single.html"), "<p>single</p>");
await writeFile(join(root, "secret.txt"), "secret");
await symlink(join(root, "secret.txt"), join(site, "outside.txt"));

const host = await startArtifactHost("127.0.0.1");
try {
  const single = await host.register(join(root, "single.html"));
  assert.equal(await (await fetch(single.url)).text(), "<p>single</p>");
  assert.equal((await fetch(single.url.replace("single.html", "secret.txt"))).status, 404);

  const directory = await host.register(site);
  assert.equal(await (await fetch(directory.url)).text(), "<h1>preview</h1>");
  assert.equal(await (await fetch(new URL("style.css", directory.url))).text(), "h1 { color: red; }");
  assert.equal((await fetch(new URL("outside.txt", directory.url))).status, 404);
  assert.equal((await fetch(directory.url, { method: "POST" })).status, 405);
  const head = await fetch(new URL("style.css", directory.url), { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
} finally {
  await host.close();
}
