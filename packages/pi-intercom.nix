{
  buildNpmPackage,
  fetchurl,
  lib,
}:
buildNpmPackage {
  pname = "pi-intercom";
  version = "0.6.0";

  src = fetchurl {
    url = "https://registry.npmjs.org/pi-intercom/-/pi-intercom-0.6.0.tgz";
    hash = "sha256-dsDVKEZhqsQ3JIu2x6Moef6GMpa9FctTN1GyfK/ESBg=";
  };

  postPatch = ''
    # ponytail: Nix package closure uses Pi-managed peers; restore upstream metadata when standalone peer bundling is needed.
    node -e 'const fs = require("fs"); const pkg = JSON.parse(fs.readFileSync("package.json")); delete pkg.peerDependencies; fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\\n");'
    cp ${./pi-intercom-package-lock.json} package-lock.json
  '';

  npmDepsHash = lib.fakeHash;
  npmInstallFlags = [
    "--omit=dev"
    "--omit=peer"
  ];
  dontNpmBuild = true;

  meta = {
    description = "Same-machine direct Pi session communication";
    homepage = "https://www.npmjs.com/package/pi-intercom";
    license = lib.licenses.mit;
  };
}
