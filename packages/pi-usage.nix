{
  fetchurl,
  lib,
  runCommand,
}:
let
  lock = (import ./pi-plugin-lock.nix)."pi-usage";
  src = fetchurl {
    url = lock.src;
    hash = lock.hash;
  };
in
runCommand "pi-usage-${lock.version}"
  {
    meta = {
      description = "Provider usage status for Pi";
      homepage = "https://github.com/narumiruna/pi-extensions/tree/main/extensions/pi-usage";
      license = lib.licenses.mit;
    };
  }
  ''
    package="$out/lib/node_modules/@narumitw/pi-usage"
    mkdir -p "$package"
    tar -xzf ${src} --strip-components=1 -C "$package"
  ''
