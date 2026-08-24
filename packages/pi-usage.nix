{
  buildNpmPackage,
  fetchurl,
  lib,
  nodejs,
}:
let
  lock = (import ./pi-plugin-lock.nix)."pi-usage";
in
buildNpmPackage {
  pname = "pi-usage";
  version = lock.version;

  src = fetchurl {
    url = lock.src;
    hash = lock.hash;
  };

  # Pi supplies the extension peers; package only runtime dependencies.
  postPatch = ''
    cp ${./pi-usage-package-lock.json} package-lock.json
    ${nodejs}/bin/node -e 'const fs = require("fs"); const p = require("./package.json"); delete p.devDependencies; delete p.peerDependencies; fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n")'
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
    description = "Provider usage status for Pi";
    homepage = "https://github.com/narumiruna/pi-extensions/tree/main/extensions/pi-usage";
    license = lib.licenses.mit;
  };
}
