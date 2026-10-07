{
  buildNpmPackage,
  fetchurl,
  lib,
  nodejs,
}:
let
  lock = (import ./pi-plugin-lock.nix)."rpiv-ask-user-question";
in
buildNpmPackage {
  pname = "rpiv-ask-user-question";
  version = lock.version;

  src = fetchurl {
    url = lock.src;
    hash = lock.hash;
  };

  # ponytail: omit host Pi packages (pi-tui/pi-coding-agent/typebox peers plus
  # the rpiv-i18n soft peer); offline load check proves peer resolution.
  postPatch = ''
    cp ${./rpiv-ask-user-question-package-lock.json} package-lock.json
    ${nodejs}/bin/node -e 'const fs = require("fs"); const p = require("./package.json"); delete p.peerDependencies; fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n")'
  '';

  npmDepsHash = lock.npmDepsHash;
  npmInstallFlags = [
    "--omit=dev"
    "--omit=peer"
    # legacy-peer-deps: npm auto-installs peer deps from transitive manifests —
    # host pi provides pi-tui/pi-coding-agent/typebox at runtime.
    "--legacy-peer-deps"
  ];
  dontNpmBuild = true;
  # npm prune re-resolves peer deps and hits the network; installed tree is
  # already correct via the --omit flags (pix-sudo precedent).
  dontNpmPrune = true;

  meta = {
    description = "Pi tool — ask_user_question structured questionnaire extension";
    homepage = "https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-ask-user-question";
    license = lib.licenses.mit;
  };
}
