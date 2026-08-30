{
  fetchurl,
  lib,
  runCommand,
}:
let
  lock = (import ./pi-plugin-lock.nix)."pi-diet-lsp";
  src = fetchurl {
    url = lock.src;
    hash = lock.hash;
  };
in
runCommand "pi-diet-lsp-${lock.version}"
  {
    meta = {
      description = "On-demand LSP code-intelligence tools for Pi";
      homepage = "https://github.com/ProbabilityEngineer/pi-diet-lsp";
      license = lib.licenses.mit;
    };
  }
  ''
    mkdir -p "$out"
    tar -xzf ${src} --strip-components=1 -C "$out"
  ''
