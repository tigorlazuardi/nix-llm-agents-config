{
  buildNpmPackage,
  fetchFromGitHub,
  lib,
  nodejs,
}:
let
  lock = (import ./pi-plugin-lock.nix)."pi-mcp-adapter";
in
buildNpmPackage {
  pname = "pi-mcp-adapter";
  version = lock.version;

  src = fetchFromGitHub {
    owner = lock.owner;
    repo = lock.repo;
    rev = lock.rev;
    hash = lock.hash;
  };

  # Upstream lock can omit integrity and spell the same pkg.pr.new dependency with different URLs.
  postPatch = ''
    ${lib.getExe nodejs} -e '
      const fs = require("fs");
      const manifest = JSON.parse(fs.readFileSync("package.json", "utf8"));
      delete manifest.devDependencies;
      const core = "@modelcontextprotocol/core";
      manifest.overrides = { ...(manifest.overrides || {}), [core]: manifest.dependencies[core] };
      fs.writeFileSync("package.json", JSON.stringify(manifest, null, 2) + "\n");
    '
    cp ${./pi-mcp-adapter-package-lock.json} package-lock.json

    # Upstream ignores settings.projectServers = "allow" in TUI sessions, so every
    # herdr subagent tab (TUI) blocks on an approval dialog. Honour the user-global
    # policy there too; Pi's project trust gate (projectTrusted) still applies.
    # --replace-fail: an upstream change to this line breaks the build instead of
    # silently bringing the dialog back. ponytail: drop when upstream allows it in TUI.
    substituteInPlace project-server-trust.ts \
      --replace-fail '(!interactive && loaded.projectServerPolicy === "allow")' \
                     '(loaded.projectServerPolicy === "allow")'
  '';

  npmDepsHash = lock.npmDepsHash;
  npmInstallFlags = [
    "--omit=dev"
    "--omit=peer"
    "--legacy-peer-deps"
  ];
  npmPackFlags = [ "--ignore-scripts" ];
  dontNpmBuild = true;
  dontNpmPrune = true;

  meta = {
    description = "MCP adapter extension for Pi";
    homepage = "https://github.com/nicobailon/pi-mcp-adapter";
    license = lib.licenses.mit;
    mainProgram = "pi-mcp-adapter";
  };
}
