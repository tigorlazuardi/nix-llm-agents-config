{
  fetchurl,
  lib,
  stdenvNoCC,
}:
stdenvNoCC.mkDerivation {
  pname = "pi-ask-herdr";
  version = "0.2.2";

  src = fetchurl {
    url = "https://registry.npmjs.org/pi-ask-herdr/-/pi-ask-herdr-0.2.2.tgz";
    hash = "sha256-kJG33jskQGWP6MH+OizscjKGgqt8TQQ3CsgyL9gPeww=";
  };

  installPhase = ''
    runHook preInstall
    mkdir -p "$out/lib/node_modules/pi-ask-herdr"
    cp -R . "$out/lib/node_modules/pi-ask-herdr"
    runHook postInstall
  '';

  meta = {
    description = "Interactive Pi ask_user tool with optional Herdr integration";
    homepage = "https://github.com/leset0ng/pi-ask-herdr";
    license = lib.licenses.mit;
  };
}
