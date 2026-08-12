{
  fetchFromGitHub,
  lib,
  rustPlatform,
}:
rustPlatform.buildRustPackage {
  pname = "remote-pi-relay";
  version = "0.3.1";

  src = fetchFromGitHub {
    owner = "jacobaraujo7";
    repo = "remote_pi";
    rev = "b1e09cf68208c76b2ebae26a2ecb619791e43389";
    hash = "sha256-6t4/+bNO+klePXPmQ15iWQOY7qgj2CeA6cCSebi+vAc=";
  };

  sourceRoot = "source/relay";
  cargoHash = "sha256-ovrWVN/3DuhtJtk5rTY/g6bxmpQV9OBm1Ux7z8c/vAw=";

  postPatch = ''
        substituteInPlace src/main.rs \
          --replace-fail \
            '    let port: u16 = std::env::var("REMOTEPI_RELAY_PORT")' \
            $'    let host = std::env::var("REMOTEPI_RELAY_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());\n\n    let port: u16 = std::env::var("REMOTEPI_RELAY_PORT")' \
          --replace-fail \
            '    let addr = format!("0.0.0.0:{port}");' \
            '    let addr = format!("{host}:{port}");' \
          --replace-fail \
            '        tokio::signal::ctrl_c()' \
            '        shutdown_signal()' \
          --replace-fail \
            '        info!("ctrl_c received, shutting down");' \
            '        info!("shutdown signal received");'

        cat >> src/main.rs <<'EOF'

    #[cfg(unix)]
    async fn shutdown_signal() -> std::io::Result<()> {
        use tokio::signal::unix::{signal, SignalKind};

        let mut terminate = signal(SignalKind::terminate())?;
        tokio::select! {
            result = tokio::signal::ctrl_c() => result,
            _ = terminate.recv() => Ok(()),
        }
    }

    #[cfg(not(unix))]
    async fn shutdown_signal() -> std::io::Result<()> {
        tokio::signal::ctrl_c().await
    }
    EOF
  '';

  postInstall = ''
    mv "$out/bin/relay" "$out/bin/remote-pi-relay"
  '';

  meta = {
    description = "Self-hosted WebSocket relay for Remote Pi";
    homepage = "https://github.com/jacobaraujo7/remote_pi";
    license = lib.licenses.mit;
    mainProgram = "remote-pi-relay";
  };
}
