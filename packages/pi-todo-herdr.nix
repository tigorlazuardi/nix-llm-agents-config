{
  fetchurl,
  lib,
  runCommand,
}:
let
  lock = (import ./pi-plugin-lock.nix)."pi-todo-herdr";
  src = fetchurl {
    url = lock.src;
    hash = lock.hash;
  };
in
runCommand "pi-todo-herdr-${lock.version}"
  {
    meta = {
      description = "Hierarchical task tools for Pi with a live widget and Herdr sidebar integration";
      homepage = "https://github.com/leset0ng/pi-todo-herdr";
      license = lib.licenses.mit;
    };
  }
  ''
    package="$out/lib/node_modules/pi-todo-herdr"
    mkdir -p "$package"
    tar -xzf ${src} --strip-components=1 -C "$package"
  ''
