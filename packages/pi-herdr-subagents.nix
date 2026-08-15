{
  buildNpmPackage,
  fetchurl,
  lib,
  nodejs,
}:
let
  lock = (import ./pi-plugin-lock.nix)."pi-herdr-subagents";
in
buildNpmPackage {
  pname = "pi-herdr-subagents";
  version = lock.version;

  src = fetchurl {
    url = lock.src;
    hash = lock.hash;
  };

  patches = [ ./pi-herdr-subagents-managed-policy.patch ];

  # ponytail: Pi provides extension peers; retain missing legacy TypeBox import locally.
  postPatch = ''
    cp ${./pi-herdr-subagents-package-lock.json} package-lock.json
    ${nodejs}/bin/node -e 'const fs = require("fs"); const p = require("./package.json"); delete p.devDependencies; delete p.peerDependencies; p.dependencies = { "@sinclair/typebox": "0.34.52" }; fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n")'
  '';

  npmDepsHash = lock.npmDepsHash;
  npmInstallFlags = [
    "--omit=dev"
    "--omit=peer"
  ];
  dontNpmBuild = true;

  meta = {
    description = "Async Herdr subagents for Pi";
    homepage = "https://github.com/0xRichardH/pi-herdr-subagents";
    license = lib.licenses.mit;
  };
}
