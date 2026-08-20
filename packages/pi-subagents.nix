{
  buildNpmPackage,
  fetchurl,
  lib,
  nodejs,
}:
let
  lock = (import ./pi-plugin-lock.nix)."pi-subagents";
in
buildNpmPackage {
  pname = "pi-subagents";
  version = lock.version;

  src = fetchurl {
    url = lock.src;
    hash = lock.hash;
  };

  # ponytail: omit test-only Pi copies; keep upstream runtime dependencies in this package's closure.
  postPatch = ''
    cp ${./pi-subagents-package-lock.json} package-lock.json
    ${nodejs}/bin/node -e 'const fs = require("fs"); const p = require("./package.json"); delete p.devDependencies; fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n")'
  '';

  npmDepsHash = lock.npmDepsHash;
  npmInstallFlags = [
    "--omit=dev"
    "--omit=peer"
  ];
  dontNpmBuild = true;

  meta = {
    description = "Subagent delegation extension for Pi";
    homepage = "https://www.npmjs.com/package/pi-subagents";
    license = lib.licenses.mit;
    mainProgram = "pi-subagents";
  };
}
