{
  fetchurl,
  lib,
  runCommand,
}:
let
  src = fetchurl {
    url = "https://registry.npmjs.org/@nehlis/pi-effort/-/pi-effort-0.1.0.tgz";
    hash = "sha256-m4AssLpv+/u3J0cFtCC8OXx836/AH4yyab0Y2mD6/iE=";
  };
in
runCommand "pi-effort-0.1.0"
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
