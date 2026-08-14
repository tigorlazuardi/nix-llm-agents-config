{
  fetchurl,
  lib,
  runCommand,
}:
let
  lock = (import ./pi-plugin-lock.nix)."pi-effort";
  src = fetchurl {
    url = lock.src;
    hash = lock.hash;
  };
in
runCommand "pi-effort-${lock.version}"
  {
    meta = {
      description = "Reasoning effort command for Pi";
      homepage = "https://github.com/niels-bosman/pi-effort";
      license = lib.licenses.mit;
    };
  }
  ''
    package="$out/lib/node_modules/@nehlis/pi-effort"
    mkdir -p "$package"
    tar -xzf ${src} --strip-components=1 -C "$package"
  ''
