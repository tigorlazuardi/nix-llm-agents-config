{
  fetchurl,
  lib,
  stdenvNoCC,
}:
let
  lock = (import ./pi-plugin-lock.nix)."pi-ask-herdr";
in
stdenvNoCC.mkDerivation {
  pname = "pi-ask-herdr";
  version = lock.version;

  src = fetchurl {
    url = lock.src;
    hash = lock.hash;
  };

  # ponytail: patch prompt metadata only; drop when upstream documents no-timeout default.
  postPatch = ''
    substituteInPlace src/tool.ts \
      --replace-fail \
        'Total timeout in milliseconds for the whole batch before auto-cancelling' \
        'Optional total timeout in milliseconds for the whole batch. Omit for no timeout (default).' \
      --replace-fail \
        'Use ask_user only for missing information, choices, or confirmation that cannot be inferred safely from the available context.' \
        'Use ask_user only for missing information, choices, or confirmation that cannot be inferred safely from the available context. Omit timeout unless the user explicitly requests a deadline; no timeout is the default.'
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p "$out/lib/node_modules/pi-ask-herdr"
    cp -R . "$out/lib/node_modules/pi-ask-herdr"
    runHook postInstall
  '';

  meta = {
    description = "Interactive Pi ask_user tool with optional Herdr integration";
    homepage = "https://github.com/leset0ng/pi-ask-herdr";
    license = lib.licenses.mit;
  };
}
