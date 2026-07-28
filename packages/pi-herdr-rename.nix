{
  fetchurl,
  lib,
  stdenvNoCC,
}:
stdenvNoCC.mkDerivation {
  pname = "pi-herdr-rename";
  version = "0.1.0";

  src = fetchurl {
    url = "https://registry.npmjs.org/pi-herdr-rename/-/pi-herdr-rename-0.1.0.tgz";
    hash = "sha256-k5Zw9eH8+IeoLPmMneGRUbUKWOPAinvu8YCOZCw18ns=";
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
