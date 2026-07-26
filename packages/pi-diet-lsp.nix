{
  fetchzip,
  lib,
}:
fetchzip {
  pname = "pi-diet-lsp";
  version = "0.1.6";

  url = "https://registry.npmjs.org/pi-diet-lsp/-/pi-diet-lsp-0.1.6.tgz";
  hash = "sha256-xTYJUhKRcTu8nPT0RLAHqK494hjVreDGcF35Mx7MBWo=";

  meta = {
    description = "On-demand LSP code-intelligence tools for Pi";
    homepage = "https://github.com/ProbabilityEngineer/pi-diet-lsp";
    license = lib.licenses.mit;
  };
}
