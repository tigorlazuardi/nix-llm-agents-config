{
  fetchurl,
  lib,
  nodejs,
  stdenvNoCC,
}:
let
  lock = (import ./pi-plugin-lock.nix)."pi-herdsman";
in
stdenvNoCC.mkDerivation {
  pname = "pi-herdsman";
  version = lock.version;

  # The registry pins the compressed tarball (lock.src/lock.hash); stdenv
  # unpacks it before the build phases run.
  src = fetchurl {
    url = lock.src;
    hash = lock.hash;
  };

  # ponytail: Pi 1.1+ provides the extension peers; upstream declares the
  # @earendil-works packages and typebox as peerDependency "*" and never
  # imports the optional @howaboua/pi-codex-conversion peer in dist, so ship
  # a dependency-free package (no npm install, no vendored copies).
  postPatch = ''
    ${nodejs}/bin/node -e 'const fs = require("fs"); const p = require("./package.json"); delete p.devDependencies; delete p.peerDependencies; delete p.peerDependenciesMeta; fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n")'
    rm -rf node_modules
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p "$out/lib/node_modules/pi-herdsman"
    cp -R . "$out/lib/node_modules/pi-herdsman/"
    runHook postInstall
  '';

  meta = {
    description = "Asynchronous Pi subagents and agent fleet orchestration with supervision in herdr";
    homepage = "https://github.com/boadij/pi-herdsman";
    license = lib.licenses.asl20;
  };
}
