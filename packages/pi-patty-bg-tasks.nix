{
  fetchurl,
  lib,
  stdenvNoCC,
}:
stdenvNoCC.mkDerivation {
  pname = "pi-patty-bg-tasks";
  version = "1.1.6";

  src = fetchurl {
    url = "https://registry.npmjs.org/pi-patty-bg-tasks/-/pi-patty-bg-tasks-1.1.6.tgz";
    hash = "sha256-KFXFMqXgZE5em9hvJLyVNtn04whp9TYESKTKB5QWf3E=";
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
