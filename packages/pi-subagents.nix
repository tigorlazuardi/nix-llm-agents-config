{
  buildNpmPackage,
  fetchurl,
  lib,
  nodejs,
}:
buildNpmPackage {
  pname = "pi-subagents";
  version = "0.35.1";

  src = fetchurl {
    url = "https://registry.npmjs.org/pi-subagents/-/pi-subagents-0.35.1.tgz";
    hash = "sha256-R8+/NJunyEGUPam3fF27sEOaxf1vTKQp0ErzVM9O8/g=";
  };

  # ponytail: omit test-only Pi copies; keep runner-loaded typebox in this package's closure.
  postPatch = ''
    cp ${./pi-subagents-package-lock.json} package-lock.json
    ${nodejs}/bin/node -e 'const fs = require("fs"); const p = require("./package.json"); delete p.devDependencies; p.dependencies.typebox = "1.3.8"; fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n")'
  '';

  npmDepsHash = "sha256-ZXvyRRXIO2mtpOoBuyKPpQtKGo2Sd55cRF3nijNJXVw=";
  npmInstallFlags = [
    "--omit=dev"
    "--omit=peer"
  ];
  dontNpmBuild = true;

  meta = {
    description = "Subagent delegation extension for Pi";
    homepage = "https://www.npmjs.com/package/pi-subagents";
    license = lib.licenses.mit;
    mainProgram = "pi-subagents";
  };
}
