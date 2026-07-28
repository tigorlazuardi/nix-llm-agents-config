{
  fetchurl,
  lib,
  runCommand,
}:
let
  src = fetchurl {
    url = "https://registry.npmjs.org/pi-vimmode/-/pi-vimmode-0.9.0.tgz";
    hash = "sha256-plzzkhCcFVHxZ3wpUE4MiUn3YkhMfDxK//HMawF3I6U=";
  };
in
runCommand "pi-vimmode-0.9.0"
  {
    meta = {
      description = "Vim-style prompt editing for Pi";
      homepage = "https://github.com/pekochan069/pi-vimmode";
      license = lib.licenses.mit;
    };
  }
  ''
    package="$out/lib/node_modules/pi-vimmode"
    mkdir -p "$package"
    tar -xzf ${src} --strip-components=1 -C "$package"
  ''
