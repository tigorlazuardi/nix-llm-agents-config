{
  fetchurl,
  lib,
  stdenvNoCC,
}:
let
  lock = (import ./pi-plugin-lock.nix)."pi-cache-optimizer";
in
stdenvNoCC.mkDerivation {
  pname = "pi-cache-optimizer";
  version = lock.version;

  src = fetchurl {
    url = lock.src;
    hash = lock.hash;
  };

  installPhase = ''
    runHook preInstall
    mkdir -p "$out/lib/node_modules/pi-cache-optimizer"
    cp -R . "$out/lib/node_modules/pi-cache-optimizer"
    runHook postInstall
  '';

  meta = {
    description = "Improve Pi provider-side prompt cache hit rates";
    homepage = "https://github.com/jiangge/pi-cache-optimizer";
    license = lib.licenses.mit;
  };
}
