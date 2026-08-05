{
  buildNpmPackage,
  fetchFromGitHub,
  lib,
}:
buildNpmPackage {
  pname = "pi-prompt-template-model";
  version = "unstable-2026-08-05";

  src = fetchFromGitHub {
    owner = "nicobailon";
    repo = "pi-prompt-template-model";
    rev = "d4ed02cd65f4a53be436ad1768612b625b3dd605";
    hash = "sha256-7lyl4FCIZ7fklMTsdgWfw40ZAKAAPlLaadO22Nnb26Q=";
  };

  npmDepsHash = "sha256-5ung+ZzNQrA5jwZ7Hv58SGoZK14+Mq25Eli7VD9iIAo=";
  npmInstallFlags = [
    "--omit=dev"
    "--omit=peer"
  ];
  dontNpmBuild = true;

  meta = {
    description = "Prompt template model, thinking, and skill selector for Pi";
    homepage = "https://github.com/nicobailon/pi-prompt-template-model";
    license = lib.licenses.mit;
  };
}