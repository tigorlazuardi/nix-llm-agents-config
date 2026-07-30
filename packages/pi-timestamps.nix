{
  fetchurl,
  lib,
  runCommand,
}:
let
  src = fetchurl {
    url = "https://registry.npmjs.org/pi-timestamps/-/pi-timestamps-0.1.0.tgz";
    hash = "sha256-ZKKKEBvLSij2vHJ9zJa4CwUkQYjYUMXh3hiPhl7sKlI=";
  };
in
runCommand "pi-timestamps-0.1.0"
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
