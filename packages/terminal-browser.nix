{
  electron_43,
  fetchurl,
  lib,
  patchelf,
  stdenv,
}:
stdenv.mkDerivation {
  pname = "terminal-browser";
  version = "0.8.1";

  src = fetchurl {
    url = "https://terminal-browser.sh/install/dl/stable/v0.8.1/terminal-browser-linux-x64.tar.gz";
    hash = "sha256-NeeAidEIncT0krvX0qA9V+1VQ7Q5S0/d875Xx1t3dH4=";
  };
  sourceRoot = "terminal-browser";

  nativeBuildInputs = [ patchelf ];
  dontBuild = true;

  # ponytail: fixed to upstream v0.8.1's CLI/launcher layout; disables mutable setup, self-upgrade, and automatic AppArmor-profile writes; remove or replace when upstream exposes non-mutating Nix-managed controls for all three.
  postPatch = ''
    substituteInPlace cli/dist/main.js \
      --replace-fail 'if (command !== "setup") ensureSetup();' \
        '// Setup is managed declaratively by Nix.' \
      --replace-fail 'if (command === "setup") {' \
        'if (command === "setup") fail("setup is managed by Nix; configure programs.pi-coding-agent.terminalBrowser and programs.herdr instead"); if (false) {' \
      --replace-fail 'if (command === "upgrade") return upgradeCommand();' \
        'if (command === "upgrade") fail("upgrades are managed by Nix; update packages/terminal-browser.nix instead");' \
      --replace-fail \
        'AppArmor blocks unprivileged user namespaces, which the chromium sandbox needs. Run: terminal-browser setup' \
        'AppArmor blocks unprivileged user namespaces; configure a userns profile for this Nix store Electron path or enable unprivileged user namespaces'

    substituteInPlace bin/terminal-browser \
      --replace-fail 'export ELECTRON_RUN_AS_NODE=1' \
        'export ELECTRON_RUN_AS_NODE=1
    export TERMINAL_BROWSER_SKIP_APPARMOR=1'
  '';

  installPhase = ''
    runHook preInstall

    root=$out/libexec/terminal-browser
    mkdir -p "$root" "$out/bin"
    cp -r . "$root"
    ln -s "$root/bin/terminal-browser" "$out/bin/terminal-browser"

    runHook postInstall
  '';

  postFixup = ''
    root=$out/libexec/terminal-browser
    electronRpath="$(${patchelf}/bin/patchelf --print-rpath ${electron_43}/libexec/electron/electron)"
    interpreter="$(cat $NIX_CC/nix-support/dynamic-linker)"

    ${patchelf}/bin/patchelf \
      --set-interpreter "$interpreter" \
      --set-rpath "\$ORIGIN:$electronRpath" \
      "$root/electron/electron" \
      "$root/electron/chrome_crashpad_handler"
    ${patchelf}/bin/patchelf \
      --set-interpreter "$interpreter" \
      "$root/agent-browser/bin/agent-browser"
    ${patchelf}/bin/patchelf \
      --set-rpath "${lib.makeLibraryPath [ stdenv.cc.cc ]}" \
      "$root/browser/native/pixel.node"
  '';

  passthru = {
    upstreamTag = "v0.8.1";
    upstreamRev = "b16b8574a026ba0ef451e7e377e12b5747c47706";
  };

  meta = {
    description = "Visible terminal browser for human-agent co-browsing";
    homepage = "https://github.com/zenbu-labs/terminal-browser";
    license = lib.licenses.mit;
    mainProgram = "terminal-browser";
    platforms = [ "x86_64-linux" ];
    sourceProvenance = with lib.sourceTypes; [ binaryNativeCode ];
  };
}
