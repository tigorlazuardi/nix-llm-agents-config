{
  fetchurl,
  buildNpmPackage,
  lib,
  nodejs,
}:
let
  lock = (import ./pi-plugin-lock.nix)."pi-sensitive-guard";
in
buildNpmPackage {
  pname = "pi-sensitive-guard";
  version = lock.version;

  src = fetchurl {
    url = lock.src;
    hash = lock.hash;
  };

  # Source-shipped extension (main ./index.ts); only @aliou/sh is a runtime
  # dep (shell parser for command analysis). Peers are supplied by pi itself.
  postPatch = ''
    cp ${./pi-sensitive-guard-package-lock.json} package-lock.json
    ${nodejs}/bin/node -e 'const fs = require("fs"); const p = require("./package.json"); delete p.devDependencies; delete p.peerDependencies; delete p.peerDependenciesMeta; fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n")'
  '';

  npmDepsHash = lock.npmDepsHash;
  npmInstallFlags = [
    "--omit=dev"
    "--omit=peer"
  ];
  npmPackFlags = [ "--ignore-scripts" ];
  dontNpmBuild = true;
  dontNpmPrune = true;

  meta = {
    description = "Sensitive-file protection + secret-pattern redaction for Pi";
    homepage = "https://github.com/MasuRii/pi-sensitive-guard";
    license = lib.licenses.mit;
  };
}
