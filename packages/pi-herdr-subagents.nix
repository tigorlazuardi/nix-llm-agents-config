{
  fetchurl,
  lib,
  nodejs,
  stdenvNoCC,
}:
let
  lock = (import ./pi-plugin-lock.nix)."pi-herdr-subagents";
in
stdenvNoCC.mkDerivation {
  pname = "pi-herdr-subagents";
  version = lock.version;

  # The registry pins the compressed tarball (lock.src/lock.hash); stdenv
  # unpacks it before the build phases run.
  src = fetchurl {
    url = lock.src;
    hash = lock.hash;
  };

  patches = [
    ./pi-herdr-subagents-managed-policy.patch
    ./pi-herdr-subagents-lifecycle-compatibility.patch
  ];

  # ponytail: Pi 1.0+ provides extension peers; upstream 0.2.0 declares
  # @sinclair/typebox as peerDependency "*" and has no other runtime deps, so
  # ship a dependency-free package (no npm install, no vendored copies).
  postPatch = ''
    ${nodejs}/bin/node -e 'const fs = require("fs"); const p = require("./package.json"); delete p.devDependencies; delete p.peerDependencies; delete p.dependencies; fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n")'
    rm -rf node_modules
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p "$out/lib/node_modules/pi-herdr-subagents"
    cp -R . "$out/lib/node_modules/pi-herdr-subagents/"
    runHook postInstall
  '';

  meta = {
    description = "Async Herdr subagents for Pi";
    homepage = "https://github.com/0xRichardH/pi-herdr-subagents";
    license = lib.licenses.mit;
  };
}
