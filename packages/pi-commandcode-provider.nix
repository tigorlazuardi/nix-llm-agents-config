{
  fetchurl,
  lib,
  runCommand,
}:
let
  lock = (import ./pi-plugin-lock.nix)."pi-commandcode-provider";
  src = fetchurl {
    url = lock.src;
    hash = lock.hash;
  };
in
runCommand "pi-commandcode-provider-${lock.version}"
  {
    meta = {
      description = "Command Code model provider for Pi";
      homepage = "https://github.com/patlux/pi-commandcode-provider";
      license = lib.licenses.mit;
    };
  }
  ''
    package="$out/lib/node_modules/pi-commandcode-provider"
    mkdir -p "$package"
    tar -xzf ${src} --strip-components=1 -C "$package"
  ''
