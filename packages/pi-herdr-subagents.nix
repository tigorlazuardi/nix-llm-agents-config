{
  fetchurl,
  lib,
  stdenvNoCC,
}:
let
  lock = (import ./pi-plugin-lock.nix)."pi-herdr-subagents";
in
stdenvNoCC.mkDerivation {
  pname = "pi-herdr-subagents";
  version = lock.version;

  src = fetchurl {
    url = lock.src;
    hash = lock.hash;
  };

  patches = [ ./pi-herdr-subagents-tools-hardening.patch ];

  installPhase = ''
    runHook preInstall
    mkdir -p "$out/lib/node_modules/@asermax/pi-herdr-subagents"
    cp -R . "$out/lib/node_modules/@asermax/pi-herdr-subagents"
    runHook postInstall
  '';

  meta = {
    description = "Herdr-tab subagent delegation extension for Pi";
    homepage = "https://github.com/asermax/herdr-subagents";
    license = lib.licenses.mit;
  };
}
