{
  fetchurl,
  lib,
  stdenvNoCC,
}:
let
  lock = (import ./pi-plugin-lock.nix)."pi-herdr-rename";
in
stdenvNoCC.mkDerivation {
  pname = "pi-herdr-rename";
  version = lock.version;

  src = fetchurl {
    url = lock.src;
    hash = lock.hash;
  };

  installPhase = ''
    runHook preInstall
    mkdir -p "$out/lib/node_modules/pi-herdr-rename"
    cp -R . "$out/lib/node_modules/pi-herdr-rename"
    runHook postInstall
  '';

  meta = {
    description = "Keep current Herdr tab named after Pi's primary work scope";
    homepage = "https://github.com/tigorlazuardi/pi-herdr-rename";
    license = lib.licenses.mit;
  };
}
