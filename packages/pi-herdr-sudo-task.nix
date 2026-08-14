{
  fetchurl,
  lib,
  stdenvNoCC,
}:
let
  lock = (import ./pi-plugin-lock.nix)."pi-herdr-sudo-task";
in
stdenvNoCC.mkDerivation {
  pname = "pi-herdr-sudo-task";
  version = lock.version;

  src = fetchurl {
    url = lock.src;
    hash = lock.hash;
  };

  installPhase = ''
    runHook preInstall
    mkdir -p "$out/lib/node_modules/pi-herdr-sudo-task"
    cp -R . "$out/lib/node_modules/pi-herdr-sudo-task"
    runHook postInstall
  '';

  meta = {
    description = "Reviewed privileged tasks in a dedicated Herdr pane";
    homepage = "https://github.com/tigorlazuardi/pi-herdr-sudo-task";
    license = lib.licenses.mit;
  };
}
