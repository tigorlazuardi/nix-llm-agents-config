{
  buildNpmPackage,
  fetchFromGitHub,
  lib,
  nodejs,
}:
let
  lock = (import ./pi-plugin-lock.nix)."pi-prompt-template-model";
in
buildNpmPackage {
  pname = "pi-prompt-template-model";
  version = lock.version;

  src = fetchFromGitHub {
    owner = lock.owner;
    repo = lock.repo;
    rev = lock.rev;
    hash = lock.hash;
  };

  # ponytail: upstream omits its lock; drop unused dev deps and remove the
  # brace-expansion override once fetchNpmDeps accepts 5.0.9 or newer.
  postPatch = ''
    ${lib.getExe nodejs} -e '
      const fs = require("fs");
      const manifest = JSON.parse(fs.readFileSync("package.json", "utf8"));
      delete manifest.devDependencies;
      manifest.overrides = { ...(manifest.overrides || {}), "brace-expansion": "5.0.8" };
      fs.writeFileSync("package.json", JSON.stringify(manifest, null, 2) + "\n");
    '
    cp ${./pi-prompt-template-model-package-lock.json} package-lock.json
  '';

  npmDepsHash = lock.npmDepsHash;
  npmInstallFlags = [
    "--omit=dev"
    "--legacy-peer-deps"
  ];
  dontNpmBuild = true;
  dontNpmPrune = true;

  meta = {
    description = "Prompt template model, thinking, and skill selector for Pi";
    homepage = "https://github.com/nicobailon/pi-prompt-template-model";
    license = lib.licenses.mit;
  };
}
