{
  buildNpmPackage,
  fetchFromGitHub,
  lib,
}:
buildNpmPackage {
  pname = "pi-prompt-template-model";
  version = "0.10.0";

  src = fetchFromGitHub {
    owner = "nicobailon";
    repo = "pi-prompt-template-model";
    rev = "ab60d66af05c4a2196111dc7a2c468b1566481e1";
    hash = "sha256-+TDe46xLCDq2M7H9b4BTNK3ErWLR4pjDteyz+NsCBDo=";
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
