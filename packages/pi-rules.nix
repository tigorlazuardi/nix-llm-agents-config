{
  buildNpmPackage,
  fetchurl,
  lib,
  nodejs,
}:
buildNpmPackage {
  pname = "pi-rules";
  version = "0.4.1";

  src = fetchurl {
    url = "https://registry.npmjs.org/@tigorhutasuhut/pi-rules/-/pi-rules-0.4.1.tgz";
    hash = "sha256-VhpzroS8aiYGs+hEnwGrBslA9XqCbecQfsHvC6J6mbI=";
  };

  # ponytail: omit build-only and host Pi packages; offline load check proves peer resolution.
  postPatch = ''
    cp ${./pi-rules-package-lock.json} package-lock.json
    ${nodejs}/bin/node -e 'const fs = require("fs"); const p = require("./package.json"); delete p.devDependencies; delete p.peerDependencies; fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n")'
  '';

  npmDepsHash = "sha256-zWyYcMMeBM77FHLI22pv5pBalapWNcBGTOtcDl0MTc8=";
  npmInstallFlags = [
    "--omit=dev"
    "--omit=peer"
  ];
  npmPackFlags = [ "--ignore-scripts" ];
  dontNpmBuild = true;

  meta = {
    description = "Claude-compatible project rules for Pi agents and subagents";
    homepage = "https://github.com/tigorlazuardi/pi-rules";
    license = lib.licenses.mit;
  };
}
