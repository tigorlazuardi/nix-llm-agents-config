{
  lib,
  stdenv,
  fetchurl,
  autoPatchelfHook,
  sqlite,
  gmp,
}:
stdenv.mkDerivation {
  pname = "c2c";
  version = "0.14.4";

  src = fetchurl {
    url = "https://github.com/clankercode/c2c/releases/download/v0.14.4/c2c-0.14.4-linux-x64.tar.gz";
    hash = "sha256-JrgVPt9L9nA9wAqsxV4wo6mzP2YrCYPQZjYLsqNjxyI=";
  };

  nativeBuildInputs = [ autoPatchelfHook ];
  sourceRoot = ".";
  buildInputs = [
    sqlite
    gmp
  ];

  installPhase = ''
    runHook preInstall
    install -Dm755 c2c -t $out/bin
    runHook postInstall
  '';

  meta = {
    description = "Secure, end-to-end encrypted agent-to-agent communication";
    homepage = "https://github.com/clankercode/c2c";
    license = lib.licenses.mit;
    mainProgram = "c2c";
    platforms = [ "x86_64-linux" ];
  };
}
