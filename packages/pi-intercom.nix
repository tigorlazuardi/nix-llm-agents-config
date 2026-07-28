{
  buildNpmPackage,
  fetchurl,
  lib,
}:
buildNpmPackage {
  pname = "pi-intercom";
  version = "0.6.0";

  src = fetchurl {
    url = "https://registry.npmjs.org/pi-intercom/-/pi-intercom-0.6.0.tgz";
    hash = "sha256-dsDVKEZhqsQ3JIu2x6Moef6GMpa9FctTN1GyfK/ESBg=";
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

  npmDepsHash = "sha256-zhw4TSMs+JnSoaBU/ZBXba7+fdmnQe9YM6+QLOzSKZk=";
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
