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
  repoSkills = lib.mapAttrs (name: _: ../config/skills + "/${name}") (
    lib.filterAttrs (_: type: type == "directory") (builtins.readDir ../config/skills)
  );
  defaultModels = builtins.fromJSON (builtins.readFile ../config/models.json);
  mcpPlugin = cfg.plugins.pi-mcp-adapter;
  optimizerPlugin = cfg.plugins.pix-optimizer;
  vccPlugin = cfg.plugins.pi-vcc;
  mkPluginOptions =
    default:
    lib.mkOption {
      type = lib.types.bool;
      inherit default;
      description = "Whether to load this Pi plugin and render its integration config.";
    };
  jsonFormat = pkgs.formats.json { };
  pinnedPkgs = nixpkgs-unstable.legacyPackages.${pkgs.stdenv.hostPlatform.system};
  dietLsp = pinnedPkgs.callPackage ../packages/pi-diet-lsp.nix { };
  effort = pinnedPkgs.callPackage ../packages/pi-effort.nix { };
  piHerdr = pinnedPkgs.callPackage ../packages/pi-herdr.nix { };
  herdrSudoTask = pinnedPkgs.callPackage ../packages/pi-herdr-sudo-task.nix { };
  askHerdr = pinnedPkgs.callPackage ../packages/pi-ask-herdr.nix { };
  herdrRename = pinnedPkgs.callPackage ../packages/pi-herdr-rename.nix { };
  pattyBgTasks = pinnedPkgs.callPackage ../packages/pi-patty-bg-tasks.nix { };
  intercom = pinnedPkgs.callPackage ../packages/pi-intercom.nix { };
  vimMode = pinnedPkgs.callPackage ../packages/pi-vimmode.nix { };
  usage = pinnedPkgs.callPackage ../packages/pi-usage.nix { };
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
  supiExtras = pinnedPkgs.callPackage ../packages/supi-extras.nix { };
  pluginPackages = [
    {
      name = "diet-lsp";
      package = "${dietLsp}";
      default = true;
    }
    {
      name = "pi-effort";
      package = "${effort}/lib/node_modules/@nehlis/pi-effort";
      default = true;
    }
    {
      name = "pi-herdr";
      package = "${piHerdr}/lib/node_modules/@ogulcancelik/pi-herdr";
      default = true;
    }
    {
      name = "pi-herdr-sudo-task";
      package = "${herdrSudoTask}/lib/node_modules/pi-herdr-sudo-task";
      default = true;
    }
    {
      name = "pi-ask-herdr";
      package = "${askHerdr}/lib/node_modules/pi-ask-herdr";
      default = true;
    }
    {
      name = "pi-herdr-rename";
      package = "${herdrRename}/lib/node_modules/pi-herdr-rename";
      default = true;
    }
    {
      name = "pi-patty-bg-tasks";
      package = "${pattyBgTasks}/lib/node_modules/pi-patty-bg-tasks";
      default = true;
    }
    {
      name = "pi-intercom";
      package = "${intercom}/lib/node_modules/pi-intercom";
      default = true;
    }
    {
      name = "pi-vimmode";
      package = "${vimMode}/lib/node_modules/pi-vimmode";
      default = true;
    }
    {
      name = "pi-usage";
      package = "${usage}/lib/node_modules/@narumitw/pi-usage";
      default = true;
    }
    {
      name = "pi-mcp-adapter";
      package = "${mcpAdapter}/lib/node_modules/pi-mcp-adapter";
      default = true;
    }
    {
      name = "pi-playwright";
      package = "${playwright}/lib/node_modules/pi-playwright";
      default = true;
    }
    {
      name = "pix-optimizer";
      package = "${pixOptimizer}/lib/node_modules/@xynogen/pix-optimizer";
      default = true;
    }
    {
      name = "pi-vcc";
      package = "${piVcc}";
      default = true;
    }
    {
      name = "pi-prompt-template-model";
      package = "${promptTemplateModel}/lib/node_modules/pi-prompt-template-model";
      default = true;
    }
    {
      name = "rpiv-todo";
      package = "${rpivTodo}/lib/node_modules/@juicesharp/rpiv-todo";
      default = true;
    }
    {
      name = "pi-rules";
      package = "${rules}/lib/node_modules/@tigorhutasuhut/pi-rules";
      default = true;
    }
    {
      name = "pi-searxng";
      package = "${searxng}/lib/node_modules/pi-searxng";
      default = true;
    }
    {
      name = "pi-subagents";
      package = "${subagents}/lib/node_modules/pi-subagents";
      default = true;
    }
    {
      name = "supi-context";
      package = "${supiContext}/lib/node_modules/@mrclrchtr/supi-context";
      default = true;
    }
    {
      name = "supi-extras";
      package = "${supiExtras}/lib/node_modules/@mrclrchtr/supi-extras";
      default = true;
    }
  ];
  pluginDefaults = builtins.listToAttrs (
    map (plugin: {
      inherit (plugin) name;
      value = plugin.default;
    }) pluginPackages
  );
  enabledPluginPackages = map (plugin: plugin.package) (
    builtins.filter (plugin: cfg.plugins.${plugin.name}.enable) pluginPackages
  );
  defaultSettings = {
    defaultProvider = "openai-codex";
    defaultModel = "gpt-5.6-sol";
    defaultThinkingLevel = "medium";
    quietStartup = true;
    theme = "dark";
    hideThinkingBlock = false;
    showCacheMissNotices = false;
    subagents.disableBuiltins = true;
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
    if mcpPlugin.enable && mcpPlugin.enableMcpIntegration && config.programs.mcp.enable then
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

  options.programs.pi-coding-agent.plugins =
    lib.recursiveUpdate
      (lib.mapAttrs (_: default: { enable = mkPluginOptions default; }) pluginDefaults)
      {
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
          !(cfg.enable && mcpPlugin.enable && mcpPlugin.enableMcpIntegration && config.programs.mcp.enable)
          || disabledMcpServerNames == [ ];
        message = "pi-mcp-adapter cannot safely integrate disabled programs.mcp servers: ${lib.concatStringsSep ", " disabledMcpServerNames}";
      }
    ];

    programs.mcp = lib.mkIf (cfg.enable && mcpPlugin.enable) {
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
      packages = lib.mkIf cfg.enable [ pinnedPkgs.oscclip ];
      sessionVariables = lib.mkIf (cfg.enable && vccPlugin.enable) {
        PI_VCC_CONFIG_PATH = lib.mkDefault "${cfg.configDir}/pi-vcc-config.json";
      };
    };

    programs.pi-coding-agent = {
      enable = lib.mkDefault true;
      package = lib.mkIf cfg.enable (lib.mkDefault pinnedPkgs.pi-coding-agent);
      settings = lib.mkMerge [
        (lib.mapAttrsRecursive (_: lib.mkDefault) defaultSettings)
        {
          packages = lib.mkForce enabledPluginPackages;
        }
      ];
      keybindings = lib.mapAttrsRecursive (_: lib.mkDefault) defaultKeybindings;
      models = lib.mapAttrsRecursive (_: lib.mkDefault) defaultModels;
      context = lib.mkDefault ../config/AGENTS.md;
      skills = lib.mapAttrsRecursive (_: lib.mkDefault) (
        repoSkills
        // {
          writing-great-skills = mattpocock-skills + "/skills/productivity/writing-great-skills";
        }
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
      "${cfg.configDir}/mcp.json" = lib.mkIf (mcpPlugin.enable && renderedMcpConfig != { }) {
        source = jsonFormat.generate "pi-mcp-adapter.json" renderedMcpConfig;
      };
      # ponytail: immutable config disables /optimizer persistence; change module options and switch.
      "${cfg.configDir}/optimizer.json" = lib.mkIf optimizerPlugin.enable {
        source = optimizerStateFile;
      };
      "${cfg.configDir}/pi-vcc-config.json" = lib.mkIf vccPlugin.enable { source = vccConfigFile; };
      "${cfg.configDir}/intercom/config.json" = lib.mkIf cfg.plugins.pi-intercom.enable {
        source = jsonFormat.generate "pi-intercom-config.json" {
          brokerCommand = "${intercom}/lib/node_modules/pi-intercom/node_modules/.bin/tsx";
          brokerArgs = [ ];
          confirmSend = false;
          enabled = true;
          replyHint = true;
        };
      };
    };
  };
}
