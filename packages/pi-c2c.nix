{
  fetchurl,
  gnupatch,
  lib,
  runCommand,
}:
let
  extension = fetchurl {
    url = "https://registry.npmjs.org/pi-c2c/-/pi-c2c-0.4.18.tgz";
    hash = "sha256-tk+zZ6fddyTqYbWRI1XvbSLAd9lef8TFIp2mi9MDTdE=";
  };
  resolver = fetchurl {
    url = "https://registry.npmjs.org/@clanker-code/c2c/-/c2c-0.14.4.tgz";
    hash = "sha256-VMpvXYXaeqiLUZNT550mFktBoxqsEB07iVW0/Gfs+e0=";
  };
in
runCommand "pi-c2c-0.4.18"
  {
    nativeBuildInputs = [ gnupatch ];
    meta = {
      description = "Native c2c integration for Pi";
      homepage = "https://github.com/clankercode/pi-c2c";
      license = lib.licenses.mit;
    };
  }
  ''
    package="$out/lib/node_modules/pi-c2c"
    mkdir -p "$package/node_modules/@clanker-code/c2c"
    tar -xzf ${extension} --strip-components=1 -C "$package"
    patch -d "$package" -p1 < ${./pi-c2c-hardening.patch}
    # ponytail: C2C_BIN supplies patched native binary; omit duplicate optional platform packages.
    tar -xzf ${resolver} --strip-components=1 -C "$package/node_modules/@clanker-code/c2c"
  ''
