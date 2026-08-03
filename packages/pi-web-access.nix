{
  buildNpmPackage,
  fetchurl,
  lib,
  nodejs,
}:
buildNpmPackage {
  pname = "pi-web-access";
  version = "0.18.0";

  src = fetchurl {
    url = "https://registry.npmjs.org/pi-web-access/-/pi-web-access-0.18.0.tgz";
    hash = "sha256-Zli4WFssK92+0qgGPXW7Kg5SK7fxgrhzweVNvui0L20=";
  };

  # ponytail: omit build-only and host Pi packages; offline load check proves peer resolution.
  postPatch = ''
    cp ${./pi-web-access-package-lock.json} package-lock.json
    ${nodejs}/bin/node -e 'const fs = require("fs"); const p = require("./package.json"); delete p.devDependencies; delete p.peerDependencies; fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n")'
  '';

  npmDepsHash = "sha256-WONkigK8jxWThjbgwqCF2J25Zn5+y1p07gaF0EMvhyI=";
  npmInstallFlags = [
    "--omit=dev"
    "--omit=peer"
  ];
  dontNpmBuild = true;

  meta = {
    description = "Web search and content extraction extension for Pi";
    homepage = "https://github.com/nicobailon/pi-web-access";
    license = lib.licenses.mit;
  };
}
