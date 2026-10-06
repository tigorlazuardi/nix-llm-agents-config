{
  mattpocock-skills,
  nixpkgs-unstable,
  pi-messaging-relay,
}:
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.programs.pi-coding-agent;
  localUpdater = cfg.localUpdater;
  idleCompact = cfg.idleCompact;
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
    wizard = mattpocock-skills + "/skills/engineering/wizard";
    grill-me = mattpocock-skills + "/skills/productivity/grill-me";
    grilling = mattpocock-skills + "/skills/productivity/grilling";
    handoff = mattpocock-skills + "/skills/productivity/handoff";
    teach = mattpocock-skills + "/skills/productivity/teach";
    to-questionnaire = mattpocock-skills + "/skills/productivity/to-questionnaire";
    wait-what = mattpocock-skills + "/skills/productivity/wait-what";
    writing-for-agents = mattpocock-skills + "/skills/productivity/writing-for-agents";
  };
  patchedMattSkills = mattSkills // {
    # ponytail: v1.2 grilling uses frontier rounds; keep local stop patch disabled.
    # grilling = appendMattSkillInstruction "grilling" mattSkills.grilling grillingStopInstruction;
  };
  defaultModels = builtins.fromJSON (builtins.readFile ../config/models.json);
  mcpPlugin = cfg.plugins.pi-mcp-adapter;
  bashJudgePlugin = cfg.plugins.bash-judge;
  optimizerPlugin = cfg.plugins.pix-optimizer;
  vccPlugin = cfg.plugins.pi-vcc;
  webAccessPlugin = cfg.plugins.pi-web-access;
  visionHandoffPlugin = cfg.plugins.pi-vision-handoff;
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
  commandCodeProvider = pinnedPkgs.callPackage ../packages/pi-commandcode-provider.nix { };
  effort = pinnedPkgs.callPackage ../packages/pi-effort.nix { };
  timestamps = pinnedPkgs.callPackage ../packages/pi-timestamps.nix { };
  piHerdr = pinnedPkgs.callPackage ../packages/pi-herdr.nix { };
  herdrSudoTask = pinnedPkgs.callPackage ../packages/pi-herdr-sudo-task.nix { };
  askHerdr = pinnedPkgs.callPackage ../packages/pi-ask-herdr.nix { };
  herdrRename = pinnedPkgs.callPackage ../packages/pi-herdr-rename.nix { };
  piBg = pinnedPkgs.callPackage ../packages/pi-bg.nix { };
  messagingRelayConfigUpdater =
    pinnedPkgs.callPackage ../packages/pi-messaging-relay-config-updater.nix
      { };
  visionHandoffConfigUpdater =
    pinnedPkgs.callPackage ../packages/pi-vision-handoff-config-updater.nix
      { };
  vimMode = pinnedPkgs.callPackage ../packages/pi-vimmode.nix { };
  usage = pinnedPkgs.callPackage ../packages/pi-usage.nix { };
  cacheOptimizer = pinnedPkgs.callPackage ../packages/pi-cache-optimizer.nix { };
  mcpAdapter = pinnedPkgs.callPackage ../packages/pi-mcp-adapter.nix { };
  browserGoblin = pinnedPkgs.callPackage ../packages/browser-goblin.nix {
    browserExecutable = cfg.plugins.browser-goblin.executablePath;
  };
  pixOptimizer = pinnedPkgs.callPackage ../packages/pix-optimizer.nix { };
  toon = pinnedPkgs.callPackage ../packages/toon.nix { };
  pixTools = pinnedPkgs.callPackage ../packages/pix-tools.nix { };
  pixToolsRoot = "${pixTools}/lib/node_modules/pix-tools/node_modules/@xynogen";
  pixToolNames = [
    "pretty"
    "data"
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
  todoHerdr = pinnedPkgs.callPackage ../packages/pi-todo-herdr.nix { };
  rules = pinnedPkgs.callPackage ../packages/pi-rules.nix { };
  webAccess = pinnedPkgs.callPackage ../packages/pi-web-access.nix { };
  herdrSubagents = pinnedPkgs.callPackage ../packages/pi-herdr-subagents.nix { };
  visionHandoff = pinnedPkgs.callPackage ../packages/pi-vision-handoff.nix { };
  supiContext = pinnedPkgs.callPackage ../packages/supi-context.nix { };
  supiExtras = pinnedPkgs.callPackage ../packages/supi-extras.nix { };
  pluginPackages = [
    {
      name = "pi-messaging-relay";
      package = "${pi-messaging-relay.packages.${pkgs.stdenv.hostPlatform.system}.pi-messaging-relay-extension
      }";
      # consumer library: needs a reachable relay server + pairing flow; hosts opt in.
      default = false;
    }
    {
      name = "diet-lsp";
      package = "${dietLsp}";
      # ponytail: rarely used; consumer can re-enable without restoring package wiring.
      default = false;
    }
    {
      name = "command-code";
      package = "${commandCodeProvider}/lib/node_modules/pi-commandcode-provider";
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
      name = "pi-bg";
      package = "${piBg}/lib/node_modules/pi-bg";
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
      name = "pi-cache-optimizer";
      package = "${cacheOptimizer}/lib/node_modules/pi-cache-optimizer";
      default = true;
    }
    {
      name = "pi-mcp-adapter";
      package = "${mcpAdapter}/lib/node_modules/pi-mcp-adapter";
      default = true;
    }
    {
      name = "browser-goblin";
      package = "${browserGoblin}/lib/node_modules/browser-goblin";
      default = true;
    }
    {
      name = "pix-optimizer";
      package = "${pixOptimizer}/lib/node_modules/@xynogen/pix-optimizer";
      # ponytail: static AGENTS rules cover current behavior; opt in when optimizer proves net token savings.
      default = false;
    }
  ]
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
      name = "pi-todo-herdr";
      package = "${todoHerdr}/lib/node_modules/pi-todo-herdr";
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
      name = "pi-herdr-subagents";
      package = "${herdrSubagents}/lib/node_modules/pi-herdr-subagents";
      default = true;
    }
    {
      name = "pi-vision-handoff";
      package = "${visionHandoff}/lib/node_modules/pi-vision-handoff";
      default = true;
    }
    {
      name = "supi-context";
      package = "${supiContext}/lib/node_modules/@mrclrchtr/supi-context/src/extension.ts";
      default = true;
    }
    {
      name = "supi-extras";
      package = "${supiExtras}/lib/node_modules/@mrclrchtr/supi-extras";
      default = true;
    }
  ]
  ++ pixToolPackages;
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
    defaultProvider = "omniroute";
    defaultModel = "personal/worker";
    defaultThinkingLevel = "high";
    quietStartup = true;
    theme = "dark";
    hideThinkingBlock = false;
    showCacheMissNotices = false;
    # pi-mcp-adapter: allow project-scoped MCP servers in trusted headless
    # sessions without the per-server approval prompt (user decision: trust).
    projectServers = "allow";
    # pi 1.0 ships a native built-in MCP extension; this config uses the
    # lazy pi-mcp-adapter plugin instead. Disable the builtin so they do not
    # run side by side. The adapter checks this entry before writing
    # settings.json itself, so a read-only (home-manager) settings file no
    # longer triggers its EROFS warning.
    extensions = [ "-builtin:mcp" ];
    compaction = {
      enabled = true;
      reserveTokens = 128000;
      keepRecentTokens = 20000;
    };
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
  localUpdaterStateDirectory = "${config.home.homeDirectory}/.local/state/pi-coding-agent-local-update";
  localUpdaterRecoveryPrompt = ../scripts/local-update-recovery.md;
  localUpdaterSshWrapper = pkgs.writeShellApplication {
    name = "pi-coding-agent-local-update-ssh";
    text = ''
      exec ${lib.getExe pkgs.openssh} \
        -F ${lib.escapeShellArg localUpdater.ssh.configFile} \
        -o BatchMode=yes \
        "$@"
    '';
  };
  localUpdaterPackage = pkgs.writeShellApplication {
    name = "pi-coding-agent-local-update";
    runtimeInputs = [
      cfg.package
      pkgs.coreutils
      pkgs.git
      pkgs.gnutar
      pkgs.gzip
      pkgs.jq
      pkgs.nix
      pkgs.nodejs
      pkgs.openssh
      pkgs.util-linux
    ];
    text = builtins.readFile ../scripts/local-update.sh;
  };
in
{
  imports = [
    (import ./remote-pi-relay.nix { inherit nixpkgs-unstable; })
    ./pi-coding-agent/agents.nix
    ./pi-coding-agent/pi-herdr-subagents.nix
  ];

  options.programs.pi-coding-agent.localUpdater = {
    enable = lib.mkEnableOption "the Linux user timer for deterministic local updates with one-shot Pi recovery";

    ssh.configFile = lib.mkOption {
      type = lib.types.nullOr (lib.types.strMatching "/.*");
      default = null;
      example = "/home/user/.ssh/config";
      description = ''
        Absolute runtime SSH configuration path used by Git in the local updater.
        The path is passed to packaged OpenSSH with `-F`; its contents remain outside the Nix store.
      '';
    };

    recoveryModel = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = ''
        Explicit model for the recovery Pi invocation, forwarded as
        `--model <value>`. When null, the invocation omits `--model` and
        inherits the Pi settings default provider and model.
      '';
    };
  };

  options.programs.pi-coding-agent.idleCompact = {
    enable = lib.mkEnableOption "idle-debounced auto-compaction via the pi-idle-compact extension";

    thresholdTokens = lib.mkOption {
      type = lib.types.int;
      default = 150000;
      description = ''
        Context token count at or above which a settled agent arms the
        compaction timer. Exported to the extension as PI_IDLE_COMPACT_THRESHOLD_TOKENS.
      '';
    };

    delayMs = lib.mkOption {
      type = lib.types.int;
      default = 5000;
      description = ''
        Idle debounce after agent_settled before compacting. Any agent activity
        cancels the pending compact; compaction is also skipped while pi-bg
        background jobs are pending. Exported as PI_IDLE_COMPACT_DELAY_MS.
      '';
    };
  };

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

        bash-judge = {
          # Local extension (config/extensions/bash-judge), NOT a settings
          # package — it links via extensions/home.file when enabled. Deliberately
          # absent from pluginPackages: a registry entry would push an entry into
          # settings.packages, and pi rejects non-loadable package entries at
          # startup (every session would fail to boot).
          enable = lib.mkOption {
            type = lib.types.bool;
            default = false;
            description = "Gate bash tool calls through the local laya-judge service.";
          };

          baseUrl = lib.mkOption {
            type = lib.types.nullOr (lib.types.strMatching "https?://[^/?#[:space:]]+");
            default = null;
            description = ''
              Origin of the laya-judge service (POST /v1/systemone). Required
              when plugins.bash-judge.enable — enforced by module assertion.
              Host value: http://127.0.0.1:8765.
            '';
          };

          threshold = lib.mkOption {
            type = lib.types.float;
            default = 0.75;
            description = ''
              Minimum answer_confidence for a `yes` answer to count as a block.
              Tuned against the homelab bash safety bench; re-tune the bench if
              the judge questions change.
            '';
          };

          timeoutMs = lib.mkOption {
            type = lib.types.int;
            default = 2500;
            description = "Abort the judge call after this long; timeout blocks (fail-safe).";
          };

          mode = lib.mkOption {
            type = lib.types.enum [
              "block"
              "log"
            ];
            default = "block";
            description = ''
              block = enforce verdicts; log = shadow mode, log would-be blocks
              and pass everything (rollout).
            '';
          };

          failOpen = lib.mkOption {
            type = lib.types.bool;
            default = true;
            description = ''
              Only judge-unavailability in mode "block" (fetch error, HTTP
              non-2xx, timeout, malformed answers, truncated usage): true =
              visible warning + allow, false = block (fail-safe). Deny-list
              hits and verdict blocks are availability-independent and always
              block.
            '';
          };
        };

        pi-messaging-relay.url = lib.mkOption {
          type = lib.types.strMatching "https?://[^/?#[:space:]]+[^[:space:]]*";
          default = "http://127.0.0.1:43127";
          description = "Relay origin written into the client config file. The extension accepts HTTP loopback origins or HTTPS origins; override to an HTTPS relay when the server is exposed through a reverse proxy.";
        };

        pi-messaging-relay.secretFile = lib.mkOption {
          type = lib.types.nullOr (
            lib.types.addCheck lib.types.str (
              value: lib.isString value && lib.hasPrefix "/" value && !lib.hasPrefix "/nix/store/" value
            )
          );
          default = null;
          description = ''
            Optional absolute host path to the relay shared secret, read verbatim
            (no trimming, 1-512 bytes) into the client config file at activation
            time. The path is passed through and never copied into or read from
            the Nix store; rotate by rewriting the file and re-running the
            activation. When null, the rendered config carries only the url and
            connects to relays running with authentication off.
          '';
        };

        browser-goblin.executablePath = lib.mkOption {
          type = lib.types.str;
          # ponytail: reuse system browser instead of agent-browser downloads; override for other Chromium builds.
          default =
            if pinnedPkgs.stdenv.hostPlatform.isDarwin then
              "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
            else
              "${pinnedPkgs.chromium}/bin/chromium";
          description = "Chromium-compatible browser executable used by browser-goblin.";
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

        pi-vision-handoff.visionModel = lib.mkOption {
          type = lib.types.strMatching "[^/[:space:]]+/[^[:space:]]+";
          default = "omniroute/cc/claude-haiku-4-5-20251001";
          description = "Vision-capable provider/model used to describe images for text-only models.";
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
        assertion = !(bashJudgePlugin.enable && bashJudgePlugin.baseUrl == null);
        message = "programs.pi-coding-agent.plugins.bash-judge.baseUrl is required when bash-judge is enabled (no default guess).";
      }
      {
        # Env vars are gone by design (user env must stay clean); the extension
        # reads ~/.pi/agent/bash-judge.json generated by this module instead.
        assertion =
          bashJudgePlugin.enable -> !builtins.hasAttr "PI_BASH_JUDGE_BASE_URL" config.home.sessionVariables;
        message = "bash-judge must not leak config through user env; use plugins.bash-judge.* options.";
      }
      {
        assertion =
          lib.intersectLists webAccessCredentialNames (builtins.attrNames webAccessPlugin.settings) == [ ];
        message = "pi-web-access credentials must use credentialFiles so secret values never enter the Nix store.";
      }
    ];

    programs.mcp.enable = lib.mkIf (cfg.enable && mcpPlugin.enable) (lib.mkDefault true);

    home.activation.localUpdaterState =
      lib.mkIf (cfg.enable && localUpdater.enable && pkgs.stdenv.hostPlatform.isLinux)
        (
          lib.hm.dag.entryAfter [ "writeBoundary" ] ''
            run ${pkgs.coreutils}/bin/install -d -m 0700 -- ${lib.escapeShellArg localUpdaterStateDirectory}
          ''
        );

    systemd.user.services.pi-coding-agent-local-update =
      lib.mkIf (cfg.enable && localUpdater.enable && pkgs.stdenv.hostPlatform.isLinux)
        {
          Unit = {
            Description = "Update nix-llm-agents-config with deterministic checks and bounded Pi recovery";
            Wants = [ "network-online.target" ];
            After = [ "network-online.target" ];
          };
          Service = {
            Type = "oneshot";
            ExecStart = lib.getExe localUpdaterPackage;
            Environment = [
              "LOCAL_UPDATE_RECOVERY_PROMPT=${localUpdaterRecoveryPrompt}"
              "LOCAL_UPDATE_STATE_DIR=${localUpdaterStateDirectory}"
              "XDG_CACHE_HOME=${localUpdaterStateDirectory}/cache"
              "npm_config_cache=${localUpdaterStateDirectory}/cache/npm"
              "PI_OFFLINE=1"
              "PI_TELEMETRY=0"
            ]
            ++ lib.optional (
              localUpdater.ssh.configFile != null
            ) "GIT_SSH_COMMAND=${lib.getExe localUpdaterSshWrapper}"
            ++ lib.optional (
              localUpdater.recoveryModel != null
            ) "LOCAL_UPDATE_RECOVERY_MODEL=${localUpdater.recoveryModel}";
            TimeoutStartSec = "6h";
            UMask = "0077";
            ProtectSystem = "strict";
            ProtectHome = "read-only";
            ReadWritePaths = [
              localUpdaterStateDirectory
              cfg.configDir
            ];
            PrivateTmp = true;
            NoNewPrivileges = true;
            LockPersonality = true;
            RestrictSUIDSGID = true;
          };
        };

    systemd.user.timers.pi-coding-agent-local-update =
      lib.mkIf (cfg.enable && localUpdater.enable && pkgs.stdenv.hostPlatform.isLinux)
        {
          Unit.Description = "Daily nix-llm-agents-config update";
          Timer = {
            OnCalendar = "*-*-* 03:00:00";
            Persistent = true;
            Unit = "pi-coding-agent-local-update.service";
          };
          Install.WantedBy = [ "timers.target" ];
        };

    # ponytail: merge only managed default so /vision-handoff can persist every other setting.
    home.activation.visionHandoffConfig = lib.mkIf (cfg.enable && visionHandoffPlugin.enable) (
      lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        run ${lib.getExe visionHandoffConfigUpdater} \
          ${lib.escapeShellArg "${cfg.configDir}/extensions/pi-vision-handoff.json"} \
          ${lib.escapeShellArg visionHandoffPlugin.visionModel}
      ''
    );

    home.activation.messagingRelayConfig =
      lib.mkIf (cfg.enable && cfg.plugins.pi-messaging-relay.enable)
        (
          lib.hm.dag.entryAfter [ "writeBoundary" ] ''
            run ${lib.getExe messagingRelayConfigUpdater} \
              ${lib.escapeShellArg "${config.home.homeDirectory}/.config/pi/pi-messaging-relay.json"} \
              ${lib.escapeShellArg cfg.plugins.pi-messaging-relay.url} \
              ${lib.optionalString (cfg.plugins.pi-messaging-relay.secretFile != null) (
                lib.escapeShellArg cfg.plugins.pi-messaging-relay.secretFile
              )}
          ''
        );

    home = {
      packages = lib.mkIf cfg.enable (
        [ pinnedPkgs.oscclip ]
        ++ lib.optional optimizerPlugin.enable pinnedPkgs.rtk
        ++ lib.optional optimizerPlugin.enable toon
      );
      sessionVariables = lib.mkIf cfg.enable (
        {
          # ponytail: Nix/CI owns Pi and plugin updates; skip redundant startup network checks.
          PI_OFFLINE = lib.mkDefault "1";
        }
        // lib.optionalAttrs vccPlugin.enable {
          PI_VCC_CONFIG_PATH = lib.mkDefault "${cfg.configDir}/pi-vcc-config.json";
        }
        // lib.optionalAttrs idleCompact.enable {
          PI_IDLE_COMPACT_THRESHOLD_TOKENS = lib.mkDefault (toString idleCompact.thresholdTokens);
          PI_IDLE_COMPACT_DELAY_MS = lib.mkDefault (toString idleCompact.delayMs);
        }
        // lib.optionalAttrs cfg.plugins.browser-goblin.enable {
          # ponytail: reuse browser-goblin's Nix Chromium for project Playwright; override per project when needed.
          PLAYWRIGHT_EXECUTABLE_PATH = lib.mkDefault cfg.plugins.browser-goblin.executablePath;
        }
      );
    };

    programs.pi-coding-agent = {
      enable = lib.mkDefault true;
      idleCompact.enable = lib.mkDefault true;
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
      extensions = lib.mkMerge [
        {
          artifact-preview = lib.mkDefault ../config/extensions/artifact-preview;
          dev-journal = lib.mkDefault ../config/extensions/dev-journal;
          env-loader = lib.mkDefault ../config/extensions/env-loader;
          lazy-tools = lib.mkDefault ../config/extensions/lazy-tools;
          no-until-loop = lib.mkDefault ../config/extensions/no-until-loop;
        }
        (lib.mkIf idleCompact.enable {
          pi-idle-compact = lib.mkDefault ../config/extensions/pi-idle-compact;
        })
        (lib.mkIf cfg.plugins.bash-judge.enable {
          bash-judge = lib.mkDefault ../config/extensions/bash-judge;
        })
      ];
      skills = lib.mapAttrs (_: lib.mkDefault) (repoSkills // patchedMattSkills);
    };

    home.file = lib.mkIf cfg.enable {
      "${cfg.configDir}/extensions/artifact-preview" = {
        source = cfg.extensions.artifact-preview;
        force = true;
      };
      "${cfg.configDir}/extensions/dev-journal" = {
        source = cfg.extensions.dev-journal;
        force = true;
      };
      "${cfg.configDir}/extensions/env-loader" = {
        source = cfg.extensions.env-loader;
        force = true;
      };
      "${cfg.configDir}/extensions/pi-idle-compact" = lib.mkIf idleCompact.enable {
        source = cfg.extensions.pi-idle-compact;
        force = true;
      };
      "${cfg.configDir}/extensions/lazy-tools" = {
        source = cfg.extensions.lazy-tools;
        force = true;
      };
      "${cfg.configDir}/extensions/no-until-loop" = {
        source = cfg.extensions.no-until-loop;
        force = true;
      };
      "${cfg.configDir}/extensions/bash-judge" = lib.mkIf cfg.plugins.bash-judge.enable {
        source = cfg.extensions.bash-judge;
        force = true;
      };
      "${cfg.configDir}/prompts" = {
        source = ../config/prompts;
        force = true;
      };
      "${cfg.configDir}/rules" = {
        source = ../config/rules;
        force = true;
      };
      "${cfg.configDir}/templates/drain" = {
        source = ../config/templates/drain;
        force = true;
      };
      "${cfg.configDir}/mcp-adapter.json" = lib.mkIf (mcpPlugin.enable && renderedMcpConfig != { }) {
        source = jsonFormat.generate "pi-mcp-adapter.json" renderedMcpConfig;
      };
      # ponytail: immutable config disables /optimizer persistence; change module options and switch.
      "${cfg.configDir}/optimizer.json" = lib.mkIf optimizerPlugin.enable {
        source = optimizerStateFile;
      };
      "${cfg.configDir}/pi-vcc-config.json" = lib.mkIf vccPlugin.enable { source = vccConfigFile; };
      # bash-judge reads its wiring from this config file (no env vars).
      "${cfg.configDir}/bash-judge.json" = lib.mkIf cfg.plugins.bash-judge.enable {
        source = jsonFormat.generate "bash-judge.json" {
          inherit (bashJudgePlugin)
            baseUrl
            threshold
            timeoutMs
            mode
            failOpen
            ;
        };
      };
      # ponytail: immutable config disables /curator persistence; change module options and switch.
      "${cfg.configDir}/web-search.json" = lib.mkIf (webAccessPlugin.enable && webAccessConfig != { }) {
        source = webAccessConfigFile;
      };
    };
  };
}
