{
  mattpocock-skills,
  nixpkgs-unstable,
}:
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.programs.pi-coding-agent;
  mcpPlugin = cfg.plugins.pi-mcp-adapter;
  optimizerPlugin = cfg.plugins.pix-optimizer;
  vccPlugin = cfg.plugins.pi-vcc;
  jsonFormat = pkgs.formats.json { };
  pinnedPkgs = nixpkgs-unstable.legacyPackages.${pkgs.stdenv.hostPlatform.system};
  dietLsp = pinnedPkgs.callPackage ../packages/pi-diet-lsp.nix { };
  mcpAdapter = pinnedPkgs.callPackage ../packages/pi-mcp-adapter.nix { };
  playwright = pinnedPkgs.callPackage ../packages/pi-playwright.nix { };
  pixOptimizer = pinnedPkgs.callPackage ../packages/pix-optimizer.nix { };
  piVcc = pinnedPkgs.callPackage ../packages/pi-vcc.nix { };
  promptTemplateModel = pinnedPkgs.callPackage ../packages/pi-prompt-template-model.nix { };
  rpivTodo = pinnedPkgs.callPackage ../packages/rpiv-todo.nix { };
  rules = pinnedPkgs.callPackage ../packages/pi-rules.nix { };
  searxng = pinnedPkgs.callPackage ../packages/pi-searxng.nix { };
  subagents = pinnedPkgs.callPackage ../packages/pi-subagents.nix { };
  supiContext = pinnedPkgs.callPackage ../packages/supi-context.nix { };
  defaultSettings = {
    defaultThinkingLevel = "medium";
    quietStartup = true;
    theme = "dark";
    hideThinkingBlock = false;
    showCacheMissNotices = false;
  };
  defaultKeybindings = {
    "app.tools.expand" = "ctrl+o";
    "tui.editor.cursorLeft" = "left";
  };
  enabledMcpServers = lib.filterAttrs (
    _: server: server.enabled != false && (server.disabled or false) != true
  ) config.programs.mcp.servers;
  disabledMcpServerNames = builtins.attrNames (
    lib.filterAttrs (name: _: !(builtins.hasAttr name enabledMcpServers)) config.programs.mcp.servers
  );
  renderedMcpServers =
    if mcpPlugin.enableMcpIntegration && config.programs.mcp.enable then
      lib.mapAttrs (
        name: server:
        lib.hm.mcp.transformMcpServer {
          inherit server;
          extraTransforms = [ (lib.hm.mcp.wrapEnvFilesCommand { inherit pkgs name; }) ];
          exclude = [
            "enabled"
            "type"
          ];
        }
      ) enabledMcpServers
    else
      { };
  renderedMcpConfig =
    lib.optionalAttrs (mcpPlugin.settings != { }) { settings = mcpPlugin.settings; }
    // lib.optionalAttrs (renderedMcpServers != { }) { mcpServers = renderedMcpServers; };
  optimizerStateFile = jsonFormat.generate "pix-optimizer.json" {
    inherit (optimizerPlugin.settings) caveman ponytail;
    rtk = if optimizerPlugin.settings.rtk then "on" else "off";
    toon = if optimizerPlugin.settings.toon then "on" else "off";
  };
  vccConfigFile = jsonFormat.generate "pi-vcc-config.json" vccPlugin.settings;
in
{
  imports = [
    ./pi-coding-agent/agents.nix
    ./pi-coding-agent/pi-subagents.nix
  ];

  options.programs.pi-coding-agent.plugins = {
    pi-mcp-adapter = {
      enableMcpIntegration = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = "Render user-level programs.mcp servers into Pi's global MCP override.";
      };
      settings = lib.mkOption {
        inherit (jsonFormat) type;
        default = { };
        description = "pi-mcp-adapter settings written beside integrated user-level MCP servers.";
      };
    };

    pi-vcc.settings = {
      overrideDefaultCompaction = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = "Replace Pi's default manual and automatic compaction with pi-vcc.";
      };
      smartKeepTail = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = "Retain additional recent turns when their estimated token cost fits.";
      };
      continueAfterThresholdCompact = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = "Automatically continue the agent after threshold or overflow compaction.";
      };
      debug = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = "Write compaction diagnostics to /tmp/pi-vcc-debug.json.";
      };
    };

    pix-optimizer.settings = {
      caveman = lib.mkOption {
        type = lib.types.enum [
          "off"
          "lite"
          "full"
          "ultra"
          "micro"
        ];
        default = "ultra";
        description = "Caveman response-compression level.";
      };
      rtk = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = "Enable RTK prompt injection and bash rewriting.";
      };
      toon = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = "Enable JSON and TOON guidance.";
      };
      ponytail = lib.mkOption {
        type = lib.types.enum [
          "off"
          "lite"
          "full"
          "ultra"
        ];
        default = "full";
        description = "Ponytail minimal-code level.";
      };
    };
  };

  config = {
    assertions = [
      {
        assertion =
          !(cfg.enable && mcpPlugin.enableMcpIntegration && config.programs.mcp.enable)
          || disabledMcpServerNames == [ ];
        message = "pi-mcp-adapter cannot safely integrate disabled programs.mcp servers: ${lib.concatStringsSep ", " disabledMcpServerNames}";
      }
    ];

    programs.mcp = lib.mkIf cfg.enable {
      enable = lib.mkDefault true;
      # ponytail: od stays an ambient PATH dependency until its package source is migrated.
      servers.open-design = {
        command = lib.mkDefault "od";
        args = lib.mkDefault [
          "mcp"
          "--daemon-url"
          "https://open-design.tigor.web.id"
        ];
      };
    };

    home = {
      activation.piCodingAgentPixOptimizer = lib.mkIf cfg.enable (
        lib.hm.dag.entryAfter [ "writeBoundary" ] ''
          run install -D -m 0600 ${optimizerStateFile} ${lib.escapeShellArg "${cfg.configDir}/optimizer.json"}
        ''
      );
      sessionVariables = lib.mkIf cfg.enable {
        PI_VCC_CONFIG_PATH = lib.mkDefault "${cfg.configDir}/pi-vcc-config.json";
      };
    };

    programs.pi-coding-agent = {
      enable = lib.mkDefault true;
      package = lib.mkIf cfg.enable (lib.mkDefault pinnedPkgs.pi-coding-agent);
      settings = lib.mkMerge [
        (lib.mapAttrsRecursive (_: lib.mkDefault) defaultSettings)
        {
          packages = lib.mkForce [
            "${dietLsp}"
            "${mcpAdapter}/lib/node_modules/pi-mcp-adapter"
            "${playwright}/lib/node_modules/pi-playwright"
            "${pixOptimizer}/lib/node_modules/@xynogen/pix-optimizer"
            "${piVcc}"
            "${promptTemplateModel}/lib/node_modules/pi-prompt-template-model"
            "${rpivTodo}/lib/node_modules/@juicesharp/rpiv-todo"
            "${rules}/lib/node_modules/@tigorhutasuhut/pi-rules"
            "${searxng}/lib/node_modules/pi-searxng"
            "${subagents}/lib/node_modules/pi-subagents"
            "${supiContext}/lib/node_modules/@mrclrchtr/supi-context"
          ];
        }
      ];
      keybindings = lib.mapAttrsRecursive (_: lib.mkDefault) defaultKeybindings;
      context = lib.mkDefault ../config/AGENTS.md;
      # ponytail: expose only required skill; add allowlist adapter when another target or override exists.
      skills.writing-great-skills = lib.mkDefault (
        mattpocock-skills + "/skills/productivity/writing-great-skills"
      );
    };

    home.file = lib.mkIf cfg.enable {
      "${cfg.configDir}/prompts" = {
        source = ../config/prompts;
        force = true;
      };
      "${cfg.configDir}/templates/fleet" = {
        source = ../config/templates/fleet;
        force = true;
      };
      "${cfg.configDir}/templates/drain" = {
        source = ../config/templates/drain;
        force = true;
      };
      "${cfg.configDir}/mcp.json" = lib.mkIf (renderedMcpConfig != { }) {
        source = jsonFormat.generate "pi-mcp-adapter.json" renderedMcpConfig;
      };
      "${cfg.configDir}/pi-vcc-config.json".source = vccConfigFile;
    };
  };
}
