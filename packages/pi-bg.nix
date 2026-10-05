{
  fetchurl,
  lib,
  stdenvNoCC,
}:
let
  lock = (import ./pi-plugin-lock.nix)."pi-bg";
in
stdenvNoCC.mkDerivation {
  pname = "pi-bg";
  version = lock.version;

  src = fetchurl {
    url = lock.src;
    hash = lock.hash;
  };

  installPhase = ''
    runHook preInstall
    mkdir -p "$out/lib/node_modules/pi-bg"
    cp -R . "$out/lib/node_modules/pi-bg"
    runHook postInstall
  '';

  meta = {
    description = "Background command, monitor, and agent tools for Pi (Claude Code parity)";
    homepage = "https://github.com/iefnaf/pi-bg";
    license = lib.licenses.mit;
  };
}
