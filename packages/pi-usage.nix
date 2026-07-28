{
  fetchurl,
  lib,
  runCommand,
}:
let
  src = fetchurl {
    url = "https://registry.npmjs.org/@narumitw/pi-usage/-/pi-usage-0.34.0.tgz";
    hash = "sha256-WclnloM/u3ka1q2oD+Xp2jXrEIoiaLSGYUhDNxc43a4=";
  };
in
runCommand "pi-usage-0.34.0"
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
