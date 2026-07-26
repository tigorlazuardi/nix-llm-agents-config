{
  fetchurl,
  lib,
  runCommand,
}:
let
  optimizer = fetchurl {
    url = "https://registry.npmjs.org/@xynogen/pix-optimizer/-/pix-optimizer-1.1.19.tgz";
    hash = "sha256-SXLKA/MzuuUplQGGGInu8Xypo8kJ5ol6HcZhNyMmkoU=";
  };
  pretty = fetchurl {
    url = "https://registry.npmjs.org/@xynogen/pix-pretty/-/pix-pretty-1.7.24.tgz";
    hash = "sha256-iQjFGgoQsjhBDFnyUO38+hdqGZbyX6h/eS0ksber4i8=";
  };
in
runCommand "pix-optimizer-1.1.19"
  {
    meta = {
      description = "Token optimization suite for Pi";
      homepage = "https://github.com/xynogen/pix-mono/tree/main/packages/pix-optimizer";
      license = lib.licenses.mit;
    };
  }
  ''
    package="$out/lib/node_modules/@xynogen/pix-optimizer"
    mkdir -p "$package/node_modules/@xynogen/pix-pretty"
    tar -xzf ${optimizer} --strip-components=1 -C "$package"
    # ponytail: optimizer imports only these dependency subpaths; skip pix-pretty's unused 53-package closure.
    tar -xzf ${pretty} --strip-components=1 -C "$package/node_modules/@xynogen/pix-pretty"
  ''
