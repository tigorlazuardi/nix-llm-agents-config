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
    # ponytail: root prompt waits forever by default (herdr shows blocked + notifies);
    # set PIX_SUDO_PROMPT_TIMEOUT_MS=<ms> for a dead-man's switch. Make an option when a second consumer exists.
    substituteInPlace src/index.ts \
      --replace-fail 'const ROOT_PROMPT_TIMEOUT_MS = 60_000;' \
      'const ROOT_PROMPT_TIMEOUT_MS = Number(process.env.PIX_SUDO_PROMPT_TIMEOUT_MS ?? 0);'
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
