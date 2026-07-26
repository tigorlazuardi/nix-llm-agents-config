{
  buildNpmPackage,
  fetchFromGitHub,
  lib,
}:
buildNpmPackage {
  pname = "pi-searxng";
  version = "1.0.4";

  src = fetchFromGitHub {
    owner = "jcha0713";
    repo = "pi-searxng";
    rev = "864cd18970c090d769fd4328f69ff9d8b7ddcdce";
    hash = "sha256-jkJrCJrJjFDlAjluMCDYdrz1sayN+7XHMWl+jW8O+FY=";
  };

  # ponytail: strip Pi peers from npm metadata; offline load check proves host Pi supplies them.
  postPatch = ''
    cp ${./pi-searxng-package-lock.json} package-lock.json
    substituteInPlace package.json --replace-fail '  "peerDependencies": {
        "@mariozechner/pi-coding-agent": "*",
        "@mariozechner/pi-tui": "*",
        "@sinclair/typebox": "*"
      },
    ' ""
  '';

  npmDepsHash = "sha256-OArjLaDa7nWgbo2sAN7sSF1DmudBEobRNaDjj9wyeLI=";
  npmInstallFlags = [ "--omit=dev" ];
  dontNpmBuild = true;

  meta = {
    description = "SearXNG web search extension for Pi with GitHub repository cloning";
    homepage = "https://github.com/jcha0713/pi-searxng";
    license = lib.licenses.mit;
  };
}
