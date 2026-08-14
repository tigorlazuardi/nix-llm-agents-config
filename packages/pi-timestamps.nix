{
  fetchurl,
  lib,
  runCommand,
}:
let
  lock = (import ./pi-plugin-lock.nix)."pi-timestamps";
  src = fetchurl {
    url = lock.src;
    hash = lock.hash;
  };
in
runCommand "pi-timestamps-${lock.version}"
  {
    meta = {
      description = "Message timing widget and timeline browser for Pi";
      homepage = "https://github.com/eengad/pi-timestamps";
      license = lib.licenses.mit;
    };
  }
  ''
    package="$out/lib/node_modules/pi-timestamps"
    mkdir -p "$package"
    tar -xzf ${src} --strip-components=1 -C "$package"
  ''
