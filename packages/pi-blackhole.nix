{
  fetchurl,
  lib,
  stdenvNoCC,
}:
let
  lock = (import ./pi-plugin-lock.nix)."pi-blackhole";
in
stdenvNoCC.mkDerivation {
  pname = "pi-blackhole";
  version = lock.version;

  src = fetchurl {
    url = lock.src;
    hash = lock.hash;
  };

  # dist/ is prebuilt in the tarball. Sole bare import outside node builtins is
  # typebox, which Pi 1.0+ host-aliases through its extension loader (same as
  # supi-context), so no node_modules install is needed.
  installPhase = ''
    runHook preInstall
    mkdir -p "$out/lib/node_modules/pi-blackhole"
    cp -R . "$out/lib/node_modules/pi-blackhole"
    runHook postInstall
  '';

  meta = {
    description = "Deterministic compaction + observational memory for Pi";
    homepage = "https://github.com/k0valik/pi-blackhole";
    license = lib.licenses.mit;
  };
}
