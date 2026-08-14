{
  buildNpmPackage,
  fetchurl,
  lib,
}:
let
  lock = (import ./pi-plugin-lock.nix)."pi-intercom";
in
buildNpmPackage {
  pname = "pi-intercom";
  version = lock.version;

  src = fetchurl {
    url = lock.src;
    hash = lock.hash;
  };

  postPatch = ''
        # ponytail: Nix package closure uses Pi-managed peers; restore upstream metadata when standalone peer bundling is needed.
        substituteInPlace package.json \
          --replace-fail '  "peerDependencies": {
        "@mariozechner/pi-coding-agent": "*",
        "@mariozechner/pi-tui": "*"
      },
    ' ""
        cp ${./pi-intercom-package-lock.json} package-lock.json
  '';

  npmDepsHash = lock.npmDepsHash;
  npmInstallFlags = [
    "--omit=dev"
    "--omit=peer"
  ];
  dontNpmBuild = true;

  meta = {
    description = "Same-machine direct Pi session communication";
    homepage = "https://www.npmjs.com/package/pi-intercom";
    license = lib.licenses.mit;
  };
}
