{ nixpkgs-unstable }:
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.services.remote-pi-relay;
  pinnedPkgs = nixpkgs-unstable.legacyPackages.${pkgs.stdenv.hostPlatform.system};
  defaultPackage = pinnedPkgs.callPackage ../packages/remote-pi-relay.nix { };
  stateDirectory =
    if cfg.stateDirectory != null then
      cfg.stateDirectory
    else if pkgs.stdenv.hostPlatform.isDarwin then
      "${config.home.homeDirectory}/Library/Application Support/remote-pi-relay"
    else
      "${config.xdg.stateHome}/remote-pi-relay";
  logDirectory = "${config.home.homeDirectory}/Library/Logs/remote-pi-relay";
  environment = {
    REMOTEPI_RELAY_HOST = cfg.bindHost;
    REMOTEPI_RELAY_PORT = toString cfg.port;
    REMOTEPI_MESH_DB_PATH = "${stateDirectory}/mesh.db";
    RUST_LOG = cfg.logLevel;
    RELAY_MAX_CT_MIB = toString cfg.maxCtMiB;
  };
in
{
  options.services.remote-pi-relay = {
    enable = lib.mkEnableOption "the self-hosted Remote Pi relay";

    package = lib.mkOption {
      type = lib.types.package;
      default = defaultPackage;
      defaultText = lib.literalExpression "the pinned remote-pi-relay package";
      description = "Remote Pi relay package to run.";
    };

    bindHost = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      description = "Address on which the relay listens. Keep loopback-only when using a reverse proxy.";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 3000;
      description = "TCP port serving WebSocket, health, and mesh endpoints.";
    };

    stateDirectory = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      example = "/srv/remote-pi-relay";
      description = "Persistent state directory. Null selects the platform-native user state directory.";
    };

    logLevel = lib.mkOption {
      type = lib.types.str;
      default = "info";
      description = "Relay tracing filter passed through RUST_LOG.";
    };

    maxCtMiB = lib.mkOption {
      type = lib.types.ints.positive;
      default = 4;
      description = "Maximum decoded encrypted-envelope size in MiB.";
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = cfg.bindHost != "";
        message = "services.remote-pi-relay.bindHost must not be empty.";
      }
    ];

    home.activation.remotePiRelayDirectories = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
      run ${pkgs.coreutils}/bin/install -d -m 0700 -- ${lib.escapeShellArg stateDirectory}
      ${lib.optionalString pkgs.stdenv.hostPlatform.isDarwin "run ${pkgs.coreutils}/bin/install -d -m 0700 -- ${lib.escapeShellArg logDirectory}"}
    '';

    systemd.user.services.remote-pi-relay = lib.mkIf pkgs.stdenv.hostPlatform.isLinux {
      Unit = {
        Description = "Remote Pi self-hosted relay";
        Documentation = "https://github.com/jacobaraujo7/remote_pi";
      };
      Install.WantedBy = [ "default.target" ];
      Service = {
        Type = "simple";
        ExecStart = lib.getExe cfg.package;
        Environment = lib.mapAttrsToList (name: value: "${name}=${value}") environment;
        Restart = "on-failure";
        RestartSec = 5;
        UMask = "0077";
        NoNewPrivileges = true;
        PrivateTmp = true;
        ProtectSystem = "strict";
        ProtectHome = "read-only";
        ReadWritePaths = [ stateDirectory ];
        RestrictSUIDSGID = true;
        LockPersonality = true;
        RestrictAddressFamilies = [
          "AF_INET"
          "AF_INET6"
        ];
      };
    };

    launchd.agents.remote-pi-relay = lib.mkIf pkgs.stdenv.hostPlatform.isDarwin {
      enable = true;
      config = {
        ProgramArguments = [ (lib.getExe cfg.package) ];
        RunAtLoad = true;
        KeepAlive = {
          Crashed = true;
          SuccessfulExit = false;
        };
        ProcessType = "Background";
        EnvironmentVariables = environment;
        StandardOutPath = "${logDirectory}/stdout.log";
        StandardErrorPath = "${logDirectory}/stderr.log";
      };
    };
  };
}
