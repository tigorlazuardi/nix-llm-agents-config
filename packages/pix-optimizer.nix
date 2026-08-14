{
  fetchurl,
  lib,
  runCommand,
}:
let
  lock = (import ./pi-plugin-lock.nix)."pix-optimizer";
  optimizer = fetchurl {
    url = lock.src;
    hash = lock.hash;
  };
  pretty = fetchurl {
    url = lock.bundledSources."pix-pretty".src;
    hash = lock.bundledSources."pix-pretty".hash;
  };
in
runCommand "pix-optimizer-${lock.version}"
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
