{
  fetchurl,
  lib,
  stdenvNoCC,
}:
stdenvNoCC.mkDerivation {
  pname = "pi-herdr";
  version = "0.4.0";

  src = fetchurl {
    url = "https://registry.npmjs.org/@ogulcancelik/pi-herdr/-/pi-herdr-0.4.0.tgz";
    hash = "sha256-B9xw6mLpOwaEvSZPADJI5SbTlBJCfasUxXTURTXVnLQ=";
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
