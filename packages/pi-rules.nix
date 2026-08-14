{
  buildNpmPackage,
  fetchurl,
  lib,
  nodejs,
}:
let
  lock = (import ./pi-plugin-lock.nix)."pi-rules";
in
buildNpmPackage {
  pname = "pi-rules";
  version = lock.version;

  src = fetchurl {
    url = lock.src;
    hash = lock.hash;
  };

  # ponytail: omit build-only and host Pi packages; offline load check proves peer resolution.
  postPatch = ''
    cp ${./pi-rules-package-lock.json} package-lock.json
    ${nodejs}/bin/node -e 'const fs = require("fs"); const p = require("./package.json"); delete p.devDependencies; delete p.peerDependencies; fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n")'
  '';

  npmDepsHash = lock.npmDepsHash;
  npmInstallFlags = [
    "--omit=dev"
    "--omit=peer"
  ];
  npmPackFlags = [ "--ignore-scripts" ];
  dontNpmBuild = true;

  meta = {
    description = "Claude-compatible project rules for Pi agents and subagents";
    homepage = "https://github.com/tigorlazuardi/pi-rules";
    license = lib.licenses.mit;
  };
}
