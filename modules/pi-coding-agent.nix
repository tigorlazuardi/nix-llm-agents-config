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
    # ponytail: temporarily exclude tuxedo-todo; remove name check to restore it.
    lib.filterAttrs (name: type: type == "directory" && name != "tuxedo-todo") (
      builtins.readDir ../config/skills
    )
  );
  grillingStopInstruction = "Stop asking questions when we reach a shared understanding and big decision was already made, because relatively smaller decisions would automatically derive.";
  appendMattSkillInstruction =
    name: source: instruction:
    pkgs.runCommand "mattpocock-skill-${name}" { } ''
      cp -R ${source} "$out"
      chmod -R u+w "$out"
      printf '\n%s\n' ${lib.escapeShellArg instruction} >> "$out/SKILL.md"
    '';
  mattSkills = {
    ask-matt = mattpocock-skills + "/skills/engineering/ask-matt";
    code-review = mattpocock-skills + "/skills/engineering/code-review";
    codebase-design = mattpocock-skills + "/skills/engineering/codebase-design";
    diagnosing-bugs = mattpocock-skills + "/skills/engineering/diagnosing-bugs";
    domain-modeling = mattpocock-skills + "/skills/engineering/domain-modeling";
    grill-with-docs = mattpocock-skills + "/skills/engineering/grill-with-docs";
    implement = mattpocock-skills + "/skills/engineering/implement";
    improve-codebase-architecture =
      mattpocock-skills + "/skills/engineering/improve-codebase-architecture";
    prototype = mattpocock-skills + "/skills/engineering/prototype";
    research = mattpocock-skills + "/skills/engineering/research";
    resolving-merge-conflicts = mattpocock-skills + "/skills/engineering/resolving-merge-conflicts";
    setup-matt-pocock-skills = mattpocock-skills + "/skills/engineering/setup-matt-pocock-skills";
    tdd = mattpocock-skills + "/skills/engineering/tdd";
    to-spec = mattpocock-skills + "/skills/engineering/to-spec";
    to-tickets = mattpocock-skills + "/skills/engineering/to-tickets";
    triage = mattpocock-skills + "/skills/engineering/triage";
    wayfinder = mattpocock-skills + "/skills/engineering/wayfinder";
    grill-me = mattpocock-skills + "/skills/productivity/grill-me";
    grilling = mattpocock-skills + "/skills/productivity/grilling";
    handoff = mattpocock-skills + "/skills/productivity/handoff";
    teach = mattpocock-skills + "/skills/productivity/teach";
    writing-great-skills = mattpocock-skills + "/skills/productivity/writing-great-skills";
  };
  patchedMattSkills = mattSkills // {
    grilling = appendMattSkillInstruction "grilling" mattSkills.grilling grillingStopInstruction;
  };
  defaultModels = builtins.fromJSON (builtins.readFile ../config/models.json);
  mcpPlugin = cfg.plugins.pi-mcp-adapter;
  optimizerPlugin = cfg.plugins.pix-optimizer;
  vccPlugin = cfg.plugins.pi-vcc;
  webAccessPlugin = cfg.plugins.pi-web-access;
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
  timestamps = pinnedPkgs.callPackage ../packages/pi-timestamps.nix { };
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
  toon = pinnedPkgs.callPackage ../packages/toon.nix { };
  pixTools = pinnedPkgs.callPackage ../packages/pix-tools.nix { };
  pixToolsRoot = "${pixTools}/lib/node_modules/pix-tools/node_modules/@xynogen";
  pixToolNames = [
    "pretty"
    "read"
    "write"
    "edit"
    "ls"
    "find"
    "footer"
    "grep"
  ];
  pixToolPackages = map (name: {
    name = "pix-${name}";
    package = "${pixToolsRoot}/pix-${name}";
    default = true;
  }) pixToolNames;
  piVcc = pinnedPkgs.callPackage ../packages/pi-vcc.nix { };
  promptTemplateModel = pinnedPkgs.callPackage ../packages/pi-prompt-template-model.nix { };
  rpivTodo = pinnedPkgs.callPackage ../packages/rpiv-todo.nix { };
  rules = pinnedPkgs.callPackage ../packages/pi-rules.nix { };
  webAccess = pinnedPkgs.callPackage ../packages/pi-web-access.nix { };
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
      name = "pi-timestamps";
      package = "${timestamps}/lib/node_modules/pi-timestamps";
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
  ]
  ++ pixToolPackages
  ++ [
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
      name = "pi-web-access";
      package = "${webAccess}/lib/node_modules/pi-web-access";
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
  webAccessCredentialNames = [
    "anysearchApiKey"
    "braveApiKey"
    "brightdataApiKey"
    "cloudflareApiKey"
    "exaApiKey"
    "firecrawlApiKey"
    "geminiApiKey"
    "kagiApiKey"
    "ollamaApiKey"
    "openaiApiKey"
    "parallelApiKey"
    "perplexityApiKey"
    "queritApiKey"
    "search1apiApiKey"
    "searchinfinityApiKey"
    "serpbaseApiKey"
    "serpdiveApiKey"
    "tavilyApiKey"
    "tinyfishApiKey"
    "xaiApiKey"
  ];
  webAccessCredentialConfig = lib.mapAttrs (
    _: path: "!${pkgs.coreutils}/bin/cat ${lib.escapeShellArg (toString path)}"
  ) webAccessPlugin.credentialFiles;
  webAccessConfig = webAccessPlugin.settings // webAccessCredentialConfig;
  webAccessConfigFile = jsonFormat.generate "web-search.json" webAccessConfig;
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

        pi-web-access = {
          credentialFiles = lib.mkOption {
            type = lib.types.attrsOf (lib.types.either lib.types.path lib.types.str);
            default = { };
            example.openaiApiKey = "/run/secrets/openai-api-key";
            description = "Provider credential files rendered as request-time !cat commands in web-search.json. Use string paths for runtime secrets; Nix path values are copied to the store.";
          };
          settings = lib.mkOption {
            inherit (jsonFormat) type;
            default = { };
            description = "Non-secret pi-web-access settings written to web-search.json.";
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
      {
        assertion = lib.all (name: builtins.elem name webAccessCredentialNames) (
          builtins.attrNames webAccessPlugin.credentialFiles
        );
        message = "pi-web-access credentialFiles contains unsupported keys; use provider API-key field names.";
      }
      {
        assertion =
          lib.intersectLists webAccessCredentialNames (builtins.attrNames webAccessPlugin.settings) == [ ];
        message = "pi-web-access credentials must use credentialFiles so secret values never enter the Nix store.";
      }
    ];

    programs.mcp.enable = lib.mkIf (cfg.enable && mcpPlugin.enable) (lib.mkDefault true);

    home = {
      packages = lib.mkIf cfg.enable (
        [ pinnedPkgs.oscclip ]
        ++ lib.optional optimizerPlugin.enable pinnedPkgs.rtk
        ++ lib.optional optimizerPlugin.enable toon
      );
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
      extensions.dev-journal = lib.mkDefault ../config/extensions/dev-journal;
      skills = lib.mapAttrs (_: lib.mkDefault) (repoSkills // patchedMattSkills);
    };

    home.file = lib.mkIf cfg.enable {
      "${cfg.configDir}/extensions/dev-journal" = {
        source = cfg.extensions.dev-journal;
        force = true;
      };
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
      # ponytail: immutable config disables /curator persistence; change module options and switch.
      "${cfg.configDir}/web-search.json" = lib.mkIf (webAccessPlugin.enable && webAccessConfig != { }) {
        source = webAccessConfigFile;
      };
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
