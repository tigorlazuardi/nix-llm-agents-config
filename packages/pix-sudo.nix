{
  buildNpmPackage,
  fetchurl,
  lib,
  nodejs,
}:
let
  lock = (import ./pi-plugin-lock.nix)."pix-sudo";
in
buildNpmPackage {
  pname = "pix-sudo";
  version = lock.version;

  src = fetchurl {
    url = lock.src;
    hash = lock.hash;
  };

  # ponytail: omit host Pi packages; offline load check proves peer resolution.
  postPatch = ''
    cp ${./pix-sudo-package-lock.json} package-lock.json
    ${nodejs}/bin/node -e 'const fs = require("fs"); const p = require("./package.json"); delete p.peerDependencies; fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n")'
  '';

  npmDepsHash = lock.npmDepsHash;
  npmInstallFlags = [
    "--omit=dev"
    "--omit=peer"
    # legacy-peer-deps: npm auto-installs peer deps from transitive manifests
    # (pix-pretty wants @earendil-works/*) — host pi provides them at runtime.
    "--legacy-peer-deps"
  ];
  dontNpmBuild = true;
  # npm prune re-resolves peer deps (pix-pretty wants @earendil-works/*) and tries
  # the network; installed tree already correct via --omit flags.
  dontNpmPrune = true;

  meta = {
    description = "Pi tool — sudo_run with interactive PAM password prompt";
    homepage = "https://github.com/xynogen/pix-mono/tree/main/packages/pix-sudo";
    license = lib.licenses.mit;
  };
}
