{
  fetchurl,
  lib,
  runCommand,
}:
let
  lock = (import ./pi-plugin-lock.nix)."pi-vimmode";
  src = fetchurl {
    url = lock.src;
    hash = lock.hash;
  };
in
runCommand "pi-vimmode-${lock.version}"
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
