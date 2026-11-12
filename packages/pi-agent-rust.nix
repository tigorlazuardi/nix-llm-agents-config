# Prebuilt Rust port of pi (Dicklesworthstone/pi_agent_rust), installed as `pi-rs`
# so it can run beside the TypeScript `pi`, wrapped to use ~/.pi-rs/agent. ponytail: upstream release binary,
# pinned to v0.8.0; build from source when a nix-friendly toolchain story exists.
{
  autoPatchelfHook,
  fetchurl,
  lib,
  makeWrapper,
  stdenv,
}:
let
  version = "0.8.0";
  base = "https://github.com/Dicklesworthstone/pi_agent_rust/releases/download/v${version}";
  sources = {
    x86_64-linux = fetchurl {
      url = "${base}/pi-linux-amd64.tar.xz";
      hash = "sha256-wE5/hzkb7LF8sex1RND9dnIx37WoNhZE6ohwuj05BW0=";
    };
    aarch64-darwin = fetchurl {
      url = "${base}/pi-darwin-arm64.tar.xz";
      hash = "sha256-mZnuWwUoOnmydxYvc535/zay/w+Nymzx1sxOGq5dBdk=";
    };
  };
in
stdenv.mkDerivation {
  pname = "pi-agent-rust";
  inherit version;
  src = sources.${stdenv.hostPlatform.system};
  sourceRoot = ".";
  nativeBuildInputs = [
    makeWrapper
  ]
  ++ lib.optional stdenv.hostPlatform.isLinux autoPatchelfHook;
  buildInputs = lib.optional stdenv.hostPlatform.isLinux stdenv.cc.cc.lib;
  dontConfigure = true;
  dontBuild = true;
  installPhase = ''
    runHook preInstall
    install -Dm755 pi $out/libexec/pi-rs
    # Default to an isolated agent dir: pi 1.x settings/extensions/models in
    # ~/.pi/agent are not compatible with pi-rs. Only a default; an existing
    # PI_CODING_AGENT_DIR (or any other PI_* override) wins.
    makeWrapper $out/libexec/pi-rs $out/bin/pi-rs \
      --run 'export PI_CODING_AGENT_DIR="''${PI_CODING_AGENT_DIR:-$HOME/.pi-rs/agent}"'
    install -Dm644 LICENSE $out/share/doc/pi-agent-rust/LICENSE
    runHook postInstall
  '';
  meta = {
    description = "Native Rust port of the Pi coding agent (binary renamed to pi-rs)";
    homepage = "https://github.com/Dicklesworthstone/pi_agent_rust";
    # MIT + OpenAI/Anthropic rider
    license = lib.licenses.unfree;
    mainProgram = "pi-rs";
    platforms = builtins.attrNames sources;
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
  };
}
