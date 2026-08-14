{
  fetchurl,
  lib,
  stdenvNoCC,
}:
let
  lock = (import ./pi-plugin-lock.nix)."pi-patty-bg-tasks";
in
stdenvNoCC.mkDerivation {
  pname = "pi-patty-bg-tasks";
  version = lock.version;

  src = fetchurl {
    url = lock.src;
    hash = lock.hash;
  };

  patches = [ ./pi-patty-bg-tasks-hardening.patch ];

  installPhase = ''
    runHook preInstall
    mkdir -p "$out/lib/node_modules/pi-patty-bg-tasks"
    cp -R . "$out/lib/node_modules/pi-patty-bg-tasks"
    runHook postInstall
  '';

  meta = {
    description = "Background command, monitor, and agent tools for Pi";
    homepage = "https://github.com/patty-io/pi-patty-bg-tasks";
    license = lib.licenses.mit;
  };
}
