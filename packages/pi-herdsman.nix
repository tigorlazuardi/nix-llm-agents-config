{
  fetchurl,
  lib,
  nodejs,
  stdenvNoCC,
}:
let
  lock = (import ./pi-plugin-lock.nix)."pi-herdsman";
in
stdenvNoCC.mkDerivation {
  pname = "pi-herdsman";
  version = lock.version;

  # The registry pins the compressed tarball (lock.src/lock.hash); stdenv
  # unpacks it before the build phases run.
  src = fetchurl {
    url = lock.src;
    hash = lock.hash;
  };

  # ponytail: Pi 1.1+ provides the extension peers; upstream declares the
  # @earendil-works packages and typebox as peerDependency "*" and never
  # imports the optional @howaboua/pi-codex-conversion peer in dist, so ship
  # a dependency-free package (no npm install, no vendored copies).
  # Upstream defect (0.26.0): markdownFiles() classifies agent-definition
  # candidates with Dirent.isFile(), which is false for symlinks. Home-manager
  # renders every fleet agent as a symlink into ~/.pi/agent/agents, so the
  # user/layer silently contributes zero definitions and the roster degrades
  # to the bundled five. Patch the walk to stat() candidates so symlinked
  # .md files are followed; real files and nested dirs keep upstream
  # behavior. ponytail: dist replacement until upstream fixes the walk.
  patches = [ ./pi-herdsman-markdown-symlinks.patch ];

  postPatch = ''
    ${nodejs}/bin/node -e 'const fs = require("fs"); const p = require("./package.json"); delete p.devDependencies; delete p.peerDependencies; delete p.peerDependenciesMeta; fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n")'
    # Expose discovery for herdsman-load: pi --list-models never initializes
    # extensions, so the check drives the shipped discovery walk directly.
    ${nodejs}/bin/node -e 'const fs = require("fs"); const f = "dist/index.js"; let s = fs.readFileSync(f, "utf8"); if (!s.includes("discoverEffectiveDefinitions")) process.exit(1); const before = "export {\n  extension_default as default\n};"; const after = "export {\n  extension_default as default,\n  discoverEffectiveDefinitions\n};"; if (!s.includes(before)) process.exit(1); s = s.replace(before, after); fs.writeFileSync(f, s)'
    rm -rf node_modules
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p "$out/lib/node_modules/pi-herdsman"
    cp -R . "$out/lib/node_modules/pi-herdsman/"
    runHook postInstall
  '';

  meta = {
    description = "Asynchronous Pi subagents and agent fleet orchestration with supervision in herdr";
    homepage = "https://github.com/boadij/pi-herdsman";
    license = lib.licenses.asl20;
  };
}
