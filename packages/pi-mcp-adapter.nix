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

  # Upstream lock can omit integrity on nested registry dependencies.
  postPatch = ''
    ${lib.getExe nodejs} -e '
      const fs = require("fs");
      const manifest = JSON.parse(fs.readFileSync("package.json", "utf8"));
      delete manifest.devDependencies;
      fs.writeFileSync("package.json", JSON.stringify(manifest, null, 2) + "\n");
    '
    cp ${./pi-mcp-adapter-package-lock.json} package-lock.json
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
