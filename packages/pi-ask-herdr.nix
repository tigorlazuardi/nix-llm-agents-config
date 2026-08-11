{
  fetchurl,
  lib,
  stdenvNoCC,
}:
stdenvNoCC.mkDerivation {
  pname = "pi-ask-herdr";
  version = "0.2.2";

  src = fetchurl {
    url = "https://registry.npmjs.org/pi-ask-herdr/-/pi-ask-herdr-0.2.2.tgz";
    hash = "sha256-kJG33jskQGWP6MH+OizscjKGgqt8TQQ3CsgyL9gPeww=";
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
