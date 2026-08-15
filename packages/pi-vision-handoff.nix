{
  fetchurl,
  lib,
  stdenvNoCC,
}:
let
  lock = (import ./pi-plugin-lock.nix)."pi-vision-handoff";
in
stdenvNoCC.mkDerivation {
  pname = "pi-vision-handoff";
  version = lock.version;

  src = fetchurl {
    url = lock.src;
    hash = lock.hash;
  };

  installPhase = ''
    runHook preInstall
    mkdir -p "$out/lib/node_modules/pi-vision-handoff"
    cp -R . "$out/lib/node_modules/pi-vision-handoff"
    runHook postInstall
  '';

  meta = {
    description = "Vision-model handoff for text-only Pi models";
    homepage = "https://github.com/monotykamary/pi-vision-handoff";
    license = lib.licenses.mit;
  };
}
