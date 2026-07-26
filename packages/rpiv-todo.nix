{
  buildNpmPackage,
  fetchurl,
  lib,
  nodejs,
}:
buildNpmPackage {
  pname = "rpiv-todo";
  version = "2.1.0";

  src = fetchurl {
    url = "https://registry.npmjs.org/@juicesharp/rpiv-todo/-/rpiv-todo-2.1.0.tgz";
    hash = "sha256-PSK2aNmyWArxg7K0HSIosTLwKgOD3w9G4l7WtBCTmgg=";
  };

  # ponytail: keep only runtime deps; host Pi supplies peers and optional i18n falls back to English.
  postPatch = ''
    cp ${./rpiv-todo-package-lock.json} package-lock.json
    ${nodejs}/bin/node -e 'const fs = require("fs"); const p = require("./package.json"); delete p.peerDependencies; delete p.peerDependenciesMeta; fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n")'
  '';

  npmDepsHash = "sha256-9MI9RUVefTcaO2yZ+zizi9yi0WK7Kbiz7XFtfQVK1uk=";
  npmInstallFlags = [ "--omit=dev" ];
  dontNpmBuild = true;

  meta = {
    description = "Persistent todo tool and live overlay for Pi";
    homepage = "https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-todo";
    license = lib.licenses.mit;
  };
}
