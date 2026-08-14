{
  fetchzip,
  lib,
}:
let
  lock = (import ./pi-plugin-lock.nix)."pi-diet-lsp";
in
fetchzip {
  pname = "pi-diet-lsp";
  version = lock.version;

  url = lock.src;
  hash = lock.hash;

  meta = {
    description = "On-demand LSP code-intelligence tools for Pi";
    homepage = "https://github.com/ProbabilityEngineer/pi-diet-lsp";
    license = lib.licenses.mit;
  };
}
