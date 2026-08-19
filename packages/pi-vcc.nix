{
  applyPatches,
  fetchzip,
}:
let
  lock = (import ./pi-plugin-lock.nix)."pi-vcc";
  source = fetchzip {
    pname = "pi-vcc";
    version = lock.version;

    url = lock.src;
    hash = lock.hash;
    postFetch = ''
      rm "$out/demo.gif"
    '';

    meta = {
      description = "Algorithmic conversation compactor for Pi";
      homepage = "https://github.com/sting8k/pi-vcc";
    };
  };
in
applyPatches {
  name = "pi-vcc-${lock.version}";
  src = source;
  patches = [ ./pi-vcc-settled-compaction.patch ];
}
