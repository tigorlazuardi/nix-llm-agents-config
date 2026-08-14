{
  buildNpmPackage,
  fetchurl,
  lib,
}:
let
  lock = (import ./pi-plugin-lock.nix)."remote-pi";
in
buildNpmPackage {
  pname = "remote-pi";
  version = lock.version;

  src = fetchurl {
    url = lock.src;
    hash = lock.hash;
  };

  postPatch = ''
    cp ${./remote-pi-package-lock.json} package-lock.json
  '';

  npmDepsHash = lock.npmDepsHash;
  npmDepsFetcherVersion = 2;
  npmInstallFlags = [ "--omit=dev" ];
  dontNpmBuild = true;

  meta = {
    description = "Mobile remote control and cross-machine agent mesh for Pi";
    homepage = "https://github.com/jacobaraujo7/remote_pi";
    license = lib.licenses.mit;
    mainProgram = "remote-pi";
  };
}
