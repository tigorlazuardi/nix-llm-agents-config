{
  fetchzip,
  stdenvNoCC,
}:
let
  lock = (import ./pi-plugin-lock.nix)."pi-vcc";
in
stdenvNoCC.mkDerivation {
  pname = "pi-vcc";
  version = lock.version;

  src = fetchzip {
    pname = "pi-vcc";
    version = lock.version;

    url = lock.src;
    hash = lock.hash;
    postFetch = ''
      rm "$out/demo.gif"
    '';
  };

  installPhase = ''
    runHook preInstall
    mkdir -p "$out"
    cp -R . "$out/"
    runHook postInstall
  '';

  meta = {
    description = "Algorithmic conversation compactor for Pi";
    homepage = "https://github.com/sting8k/pi-vcc";
  };
}
