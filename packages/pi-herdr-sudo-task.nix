{
  fetchurl,
  lib,
  stdenvNoCC,
}:
stdenvNoCC.mkDerivation {
  pname = "pi-herdr-sudo-task";
  version = "0.1.4";

  src = fetchurl {
    url = "https://registry.npmjs.org/pi-herdr-sudo-task/-/pi-herdr-sudo-task-0.1.4.tgz";
    hash = "sha256-aAChwZRsJs2jB3bY0jwES33wQscoYn/wHCkYIqP4UFo=";
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
