{
  fetchurl,
  lib,
  runCommand,
}:
let
  src = fetchurl {
    url = "https://registry.npmjs.org/pi-commandcode-provider/-/pi-commandcode-provider-0.5.1.tgz";
    hash = "sha256-KjEOIFPJSY+vSrxWzlM2J/jkIvhok8vnFlSXrdqABgQ=";
  };
in
runCommand "pi-commandcode-provider-0.5.1"
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
