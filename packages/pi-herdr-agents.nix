{
  fetchurl,
  lib,
  nodejs,
  stdenvNoCC,
}:
let
  lock = (import ./pi-plugin-lock.nix)."pi-herdr-agents";
in
stdenvNoCC.mkDerivation {
  pname = "pi-herdr-agents";
  version = lock.version;

  # The registry pins the compressed tarball (lock.src/lock.hash); stdenv
  # unpacks it before the build phases run.
  src = fetchurl {
    url = lock.src;
    hash = lock.hash;
  };

  # ponytail: Pi 1.0+ provides extension peers; the package ships no runtime
  # dependencies, so strip the declared dev/peer closures instead of installing
  # them (no npm install, no vendored copies).
  postPatch = ''
    ${nodejs}/bin/node -e 'const fs = require("fs"); const p = require("./package.json"); delete p.devDependencies; delete p.peerDependencies; fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n")'
    rm -rf node_modules
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p "$out/lib/node_modules/pi-herdr-agents"
    cp -R . "$out/lib/node_modules/pi-herdr-agents/"
    runHook postInstall
  '';

  meta = {
    description = "Async Pi subagents in Herdr, with optional isolated Git worktrees";
    homepage = "https://github.com/giuseppecrj/pi-herdr-agents";
    license = lib.licenses.mit;
  };
}
