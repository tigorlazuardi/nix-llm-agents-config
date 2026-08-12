{
  buildNpmPackage,
  fetchurl,
  lib,
}:
buildNpmPackage {
  pname = "remote-pi";
  version = "0.7.0";

  src = fetchurl {
    url = "https://registry.npmjs.org/remote-pi/-/remote-pi-0.7.0.tgz";
    hash = "sha256-YhImMDS77zPxcDpkpaFPhHDyAxqI2VjADmIjSm7EIKM=";
  };

  postPatch = ''
    cp ${./remote-pi-package-lock.json} package-lock.json
  '';

  npmDepsHash = "sha256-cDhgcLZd7urYouDPhlS6E8ZRP29GHChCu78BEgPm5Sk=";
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
