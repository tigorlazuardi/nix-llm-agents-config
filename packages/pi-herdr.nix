{
  fetchurl,
  lib,
  stdenvNoCC,
}:
let
  lock = (import ./pi-plugin-lock.nix)."pi-herdr";
in
stdenvNoCC.mkDerivation {
  pname = "pi-herdr";
  version = lock.version;

  src = fetchurl {
    url = lock.src;
    hash = lock.hash;
  };

  installPhase = ''
    runHook preInstall
    mkdir -p "$out/lib/node_modules/@ogulcancelik/pi-herdr"
    cp -R . "$out/lib/node_modules/@ogulcancelik/pi-herdr"
    runHook postInstall
  '';

  meta = {
    description = "Pi tools for controlling Herdr layouts, panes, and coding agents";
    homepage = "https://github.com/ogulcancelik/pi-extensions/tree/main/packages/pi-herdr";
    license = lib.licenses.mit;
  };
}
