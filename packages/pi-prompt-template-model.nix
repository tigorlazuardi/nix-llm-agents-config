{
  buildNpmPackage,
  fetchFromGitHub,
  lib,
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

  # ponytail: this upstream commit omits its lock; drop unused dev deps and remove the
  # brace-expansion override once fetchNpmDeps accepts 5.0.9 or newer.
  postPatch = ''
        substituteInPlace package.json --replace-fail \
          '  "devDependencies": {
        "@earendil-works/pi-agent-core": "^0.83.0",
        "@earendil-works/pi-ai": "^0.83.0",
        "@earendil-works/pi-coding-agent": "^0.83.0",
        "@earendil-works/pi-tui": "^0.83.0",
        "tsx": "^4.22.4",
        "typebox": "^1.3.10"
      },
    ' \
          ""
        substituteInPlace package.json --replace-fail \
          '  "dependencies": {
        "minimatch": "^10.2.5"
      }
    ' \
          '  "dependencies": {
        "minimatch": "^10.2.5"
      },
      "overrides": {
        "brace-expansion": "5.0.8"
      }
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
