{
  buildNpmPackage,
  fetchurl,
  lib,
  nodejs,
}:
buildNpmPackage {
  pname = "supi-context";
  version = "2.6.1";

  src = fetchurl {
    url = "https://registry.npmjs.org/@mrclrchtr/supi-context/-/supi-context-2.6.1.tgz";
    hash = "sha256-AKKWvDaxx6rEVRAlSKPA9BkpHBXeEO2citXNzLm/csQ=";
  };

  # ponytail: lock runtime deps only; managed Pi supplies optional peer packages.
  postPatch = ''
    cp ${./supi-context-package-lock.json} package-lock.json
    ${nodejs}/bin/node -e 'const fs = require("fs"); const p = require("./package.json"); delete p.peerDependencies; delete p.peerDependenciesMeta; fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n")'
  '';

  npmDepsHash = "sha256-I6NmyT/zpHoK7zCWau51ym+Y6sUqQq5CIVvj2IlIMXk=";
  npmInstallFlags = [ "--omit=dev" ];
  dontNpmBuild = true;

  meta = {
    description = "Context-window usage report for Pi";
    homepage = "https://github.com/mrclrchtr/supi/tree/main/packages/supi-context";
    license = lib.licenses.mit;
  };
}
