{
  buildNpmPackage,
  fetchurl,
  lib,
  nodejs,
}:
let
  lock = (import ./pi-plugin-lock.nix)."rpiv-todo";
in
buildNpmPackage {
  pname = "rpiv-todo";
  version = lock.version;

  src = fetchurl {
    url = lock.src;
    hash = lock.hash;
  };

  # ponytail: keep only runtime deps; host Pi supplies peers and optional i18n falls back to English.
  postPatch = ''
    cp ${./rpiv-todo-package-lock.json} package-lock.json
    ${nodejs}/bin/node -e 'const fs = require("fs"); const p = require("./package.json"); delete p.peerDependencies; delete p.peerDependenciesMeta; fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n")'
  '';

  npmDepsHash = lock.npmDepsHash;
  npmInstallFlags = [ "--omit=dev" ];
  dontNpmBuild = true;

  meta = {
    description = "Persistent todo tool and live overlay for Pi";
    homepage = "https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-todo";
    license = lib.licenses.mit;
  };
}
