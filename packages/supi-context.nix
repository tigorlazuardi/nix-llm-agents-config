{
  buildNpmPackage,
  fetchurl,
  lib,
  nodejs,
}:
let
  lock = (import ./pi-plugin-lock.nix)."supi-context";
in
buildNpmPackage {
  pname = "supi-context";
  version = lock.version;

  src = fetchurl {
    url = lock.src;
    hash = lock.hash;
  };

  # ponytail: lock runtime deps only; managed Pi supplies optional peer packages.
  postPatch = ''
    cp ${./supi-context-package-lock.json} package-lock.json
    ${nodejs}/bin/node -e 'const fs = require("fs"); const p = require("./package.json"); delete p.peerDependencies; delete p.peerDependenciesMeta; fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n")'
  '';

  npmDepsHash = lock.npmDepsHash;
  npmInstallFlags = [ "--omit=dev" ];
  dontNpmBuild = true;

  meta = {
    description = "Context-window usage report for Pi";
    homepage = "https://github.com/mrclrchtr/supi/tree/main/packages/supi-context";
    license = lib.licenses.mit;
  };
}
