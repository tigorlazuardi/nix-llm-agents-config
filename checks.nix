{
  home-manager,
  nixpkgs-unstable,
  piModule,
  pkgs,
}:
let
  evaluate =
    extraModule:
    home-manager.lib.homeManagerConfiguration {
      inherit pkgs;
      modules = [
        piModule
        {
          home.stateVersion = "26.05";
          home.username = "test";
          home.homeDirectory = "/home/test";
        }
        extraModule
      ];
    };

  default = evaluate { };
  darwin = home-manager.lib.homeManagerConfiguration {
    pkgs = nixpkgs-unstable.legacyPackages.aarch64-darwin;
    modules = [
      piModule
      {
        home.stateVersion = "26.05";
        home.username = "test";
        home.homeDirectory = "/Users/test";
        services.remote-pi-relay = {
          enable = true;
          port = 8506;
        };
      }
    ];
  };
  darwinEvaluation = builtins.tryEval darwin.config.home.activationPackage.drvPath;
  disabled = evaluate { programs.pi-coding-agent.enable = false; };
  remotePiConfigured = evaluate {
    programs.pi-coding-agent.plugins.remote-pi.relayUrl = "https://relay.consumer.example";
  };
  visionHandoffConfigured = evaluate {
    programs.pi-coding-agent.plugins.pi-vision-handoff.visionModel = "google/gemini-2.5-pro";
  };
  invalidVisionHandoffModel = evaluate {
    programs.pi-coding-agent.plugins.pi-vision-handoff.visionModel = "missing-provider";
  };
  invalidVisionHandoffModelEvaluation = builtins.tryEval (
    builtins.deepSeq invalidVisionHandoffModel.config.home.activationPackage true
  );
  visionHandoffActivation = default.config.home.activation.visionHandoffConfig.data;
  expectedVisionHandoffConfigPath = "${default.config.programs.pi-coding-agent.configDir}/extensions/pi-vision-handoff.json";
  invalidRemotePiRelayUrl = evaluate {
    programs.pi-coding-agent.plugins.remote-pi.relayUrl = "https://?";
  };
  invalidRemotePiRelayUrlEvaluation = builtins.tryEval (
    builtins.deepSeq invalidRemotePiRelayUrl.config.home.activationPackage true
  );
  relayConfigured = evaluate {
    services.remote-pi-relay = {
      enable = true;
      bindHost = "127.0.0.2";
      port = 8506;
      stateDirectory = "${
        if pkgs.stdenv.hostPlatform.isDarwin then "/Users" else "/home"
      }/test/remote-pi-relay-state";
      logLevel = "debug";
      maxCtMiB = 8;
    };
  };
  overridePackage = pkgs.writeShellScriptBin "pi" "exit 0";
  overridden = evaluate { programs.pi-coding-agent.package = overridePackage; };
  settingsOverridden = evaluate {
    programs.pi-coding-agent.settings = {
      theme = "light";
      retry.maxRetries = 3;
      packages = [ "npm:consumer-package" ];
    };
    programs.pi-coding-agent.keybindings."app.tools.expand" = "ctrl+e";
  };
  optimizerConfigured = evaluate {
    programs.pi-coding-agent.plugins.pix-optimizer.settings = {
      caveman = "micro";
      rtk = true;
      toon = false;
      ponytail = "ultra";
    };
  };
  expectedOptimizerStateFile = (pkgs.formats.json { }).generate "pix-optimizer.json" {
    caveman = "micro";
    rtk = "on";
    toon = "off";
    ponytail = "ultra";
  };
  optimizerConfigSource =
    optimizerConfigured.config.home.file."${optimizerConfigured.config.programs.pi-coding-agent.configDir}/optimizer.json".source;
  vccConfigured = evaluate {
    programs.pi-coding-agent.plugins.pi-vcc.settings = {
      overrideDefaultCompaction = false;
      smartKeepTail = false;
      continueAfterThresholdCompact = false;
      debug = true;
    };
  };
  webAccessConfigured = evaluate {
    programs.pi-coding-agent.plugins.pi-web-access = {
      credentialFiles.openaiApiKey = "/run/secrets/openai-api-key";
      settings.provider = "openai";
    };
  };
  webAccessPathConfigured = evaluate {
    programs.pi-coding-agent.plugins.pi-web-access.credentialFiles.braveApiKey = ./config/models.json;
  };
  expectedVccConfigFile = (pkgs.formats.json { }).generate "pi-vcc-config.json" {
    overrideDefaultCompaction = false;
    smartKeepTail = false;
    continueAfterThresholdCompact = false;
    debug = true;
  };
  vccConfigSource =
    vccConfigured.config.home.file."${vccConfigured.config.programs.pi-coding-agent.configDir}/pi-vcc-config.json".source;
  pluginsDisabled = evaluate {
    programs.pi-coding-agent.plugins = {
      command-code.enable = false;
      pi-mcp-adapter.enable = false;
      pix-optimizer.enable = false;
      pi-vcc.enable = false;
      remote-pi.enable = false;
      pi-herdr-subagents.enable = false;
      pi-vision-handoff.enable = false;
      rpiv-todo.enable = false;
    };
  };
  rulesEnabled = evaluate { programs.pi-coding-agent.plugins.pi-rules.enable = true; };
  secretWrappedMcp = evaluate {
    programs.mcp.servers.secret = {
      command = "/bin/secret-mcp";
      args = [ "serve" ];
      env = {
        PUBLIC = "visible";
        TOKEN.file = "/run/secrets/token";
      };
    };
  };
  resolvedAgent = evaluate {
    programs.pi-coding-agent = {
      skills.demo = ./config/agents;
      extensions.demo = ./config/AGENTS.md;
      agents.custom = {
        description = "Resolver check";
        prompt = "Custom prompt.";
        tools.allow = [ "read" ];
        skills = [ "demo" ];
      };
      plugins.pi-herdr-subagents.agents.custom = { };
    };
  };
  yamlSafeAgentName = "edge: # [] {}";
  yamlSafeAgent = evaluate {
    programs.pi-coding-agent = {
      agents.${yamlSafeAgentName} = {
        description = "line one:\nline two # []";
        prompt = "Special prompt.";
        tools = {
          allow = [
            "read"
            "bash"
          ];
          exclude = [ ];
        };
      };
      plugins.pi-herdr-subagents.agents.${yamlSafeAgentName} = { };
    };
  };
  yamlSafeAgentHomeFile =
    yamlSafeAgent.config.home.file."${yamlSafeAgent.config.programs.pi-coding-agent.configDir}/agents/${yamlSafeAgentName}.md";
  yamlSafeAgentText = yamlSafeAgentHomeFile.text;
  invalidPlugin = evaluate {
    programs.pi-coding-agent.plugins.pi-herdr-subagents.agents.missing = { };
  };
  invalidPluginEvaluation = builtins.tryEval (
    builtins.deepSeq invalidPlugin.config.home.activationPackage true
  );
  invalidDisabledMcp = evaluate { programs.mcp.servers.disabled-test.enabled = false; };
  invalidDisabledMcpEvaluation = builtins.tryEval (
    builtins.deepSeq invalidDisabledMcp.config.home.activationPackage true
  );
  invalidWebAccessCredentialName = evaluate {
    programs.pi-coding-agent.plugins.pi-web-access.credentialFiles.notAProviderKey = "/run/secrets/key";
  };
  invalidWebAccessCredentialNameEvaluation = builtins.tryEval (
    builtins.deepSeq invalidWebAccessCredentialName.config.home.activationPackage true
  );
  invalidWebAccessLiteralCredential = evaluate {
    programs.pi-coding-agent.plugins.pi-web-access.settings.openaiApiKey = "must-not-enter-store";
  };
  invalidWebAccessLiteralCredentialEvaluation = builtins.tryEval (
    builtins.deepSeq invalidWebAccessLiteralCredential.config.home.activationPackage true
  );
  expectedOrchestrator = ''
    ---
    name: "orchestrator"
    description: "Deterministic black-box one-shot state machine"
    model: "openai-codex/gpt-5.6-terra"
    thinking: "medium"
    tools: "read, bash, subagent"
    system-prompt: replace
    session-mode: standalone
    spawning: true
    auto-exit: true
    ---
    ${builtins.readFile ./config/agents/orchestrator.md}'';
  managedImplementerFixture =
    pkgs.writeText "managed-implementer.md"
      default.config.home.file."${default.config.programs.pi-coding-agent.configDir}/agents/implementer.md".text;
  managedOrchestratorFixture = pkgs.writeText "managed-orchestrator.md" expectedOrchestrator;

  expectedPackage = pkgs.pi-coding-agent;
  expectedDietLsp = pkgs.callPackage ./packages/pi-diet-lsp.nix { };
  expectedDietLspPath = "${expectedDietLsp}";
  expectedCommandCodeProvider = pkgs.callPackage ./packages/pi-commandcode-provider.nix { };
  expectedCommandCodeProviderPath = "${expectedCommandCodeProvider}/lib/node_modules/pi-commandcode-provider";
  expectedEffort = pkgs.callPackage ./packages/pi-effort.nix { };
  expectedEffortPath = "${expectedEffort}/lib/node_modules/@nehlis/pi-effort";
  expectedTimestamps = pkgs.callPackage ./packages/pi-timestamps.nix { };
  expectedTimestampsPath = "${expectedTimestamps}/lib/node_modules/pi-timestamps";
  expectedPiHerdr = pkgs.callPackage ./packages/pi-herdr.nix { };
  expectedPiHerdrPath = "${expectedPiHerdr}/lib/node_modules/@ogulcancelik/pi-herdr";
  expectedHerdrSudoTask = pkgs.callPackage ./packages/pi-herdr-sudo-task.nix { };
  expectedHerdrSudoTaskPath = "${expectedHerdrSudoTask}/lib/node_modules/pi-herdr-sudo-task";
  expectedAskHerdr = pkgs.callPackage ./packages/pi-ask-herdr.nix { };
  expectedAskHerdrPath = "${expectedAskHerdr}/lib/node_modules/pi-ask-herdr";
  expectedHerdrRename = pkgs.callPackage ./packages/pi-herdr-rename.nix { };
  expectedHerdrRenamePath = "${expectedHerdrRename}/lib/node_modules/pi-herdr-rename";
  expectedPattyBgTasks = pkgs.callPackage ./packages/pi-patty-bg-tasks.nix { };
  expectedPattyBgTasksPath = "${expectedPattyBgTasks}/lib/node_modules/pi-patty-bg-tasks";
  expectedRemotePi = pkgs.callPackage ./packages/remote-pi.nix { };
  expectedRemotePiPath = "${expectedRemotePi}/lib/node_modules/remote-pi";
  expectedRemotePiConfigUpdater = pkgs.callPackage ./packages/remote-pi-config-updater.nix { };
  expectedRemotePiRelay = pkgs.callPackage ./packages/remote-pi-relay.nix { };
  expectedVimMode = pkgs.callPackage ./packages/pi-vimmode.nix { };
  expectedVimModePath = "${expectedVimMode}/lib/node_modules/pi-vimmode";
  expectedUsage = pkgs.callPackage ./packages/pi-usage.nix { };
  expectedUsagePath = "${expectedUsage}/lib/node_modules/@narumitw/pi-usage";
  expectedCacheOptimizer = pkgs.callPackage ./packages/pi-cache-optimizer.nix { };
  expectedCacheOptimizerPath = "${expectedCacheOptimizer}/lib/node_modules/pi-cache-optimizer";
  expectedMcpAdapter = pkgs.callPackage ./packages/pi-mcp-adapter.nix { };
  expectedMcpAdapterPath = "${expectedMcpAdapter}/lib/node_modules/pi-mcp-adapter";
  expectedBrowserExecutable =
    if pkgs.stdenv.hostPlatform.isDarwin then
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    else
      "${pkgs.chromium}/bin/chromium";
  expectedBrowserGoblin = pkgs.callPackage ./packages/browser-goblin.nix {
    browserExecutable = expectedBrowserExecutable;
  };
  expectedBrowserGoblinPath = "${expectedBrowserGoblin}/lib/node_modules/browser-goblin";
  expectedPixOptimizer = pkgs.callPackage ./packages/pix-optimizer.nix { };
  expectedPixOptimizerPath = "${expectedPixOptimizer}/lib/node_modules/@xynogen/pix-optimizer";
  expectedPixTools = pkgs.callPackage ./packages/pix-tools.nix { };
  expectedPixToolsRoot = "${expectedPixTools}/lib/node_modules/pix-tools/node_modules/@xynogen";
  expectedPixToolNames = [
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
  expectedPixToolPaths = map (name: "${expectedPixToolsRoot}/pix-${name}") expectedPixToolNames;
  expectedPixPrettyPath = "${expectedPixToolsRoot}/pix-pretty";
  expectedPiVcc = pkgs.callPackage ./packages/pi-vcc.nix { };
  expectedPiVccPath = "${expectedPiVcc}";
  expectedPromptTemplateModel = pkgs.callPackage ./packages/pi-prompt-template-model.nix { };
  expectedPromptTemplateModelPath = "${expectedPromptTemplateModel}/lib/node_modules/pi-prompt-template-model";
  expectedRpivTodo = pkgs.callPackage ./packages/rpiv-todo.nix { };
  expectedRpivTodoPath = "${expectedRpivTodo}/lib/node_modules/@juicesharp/rpiv-todo";
  expectedRules = pkgs.callPackage ./packages/pi-rules.nix { };
  expectedRulesPath = "${expectedRules}/lib/node_modules/@tigorhutasuhut/pi-rules";
  expectedWebAccess = pkgs.callPackage ./packages/pi-web-access.nix { };
  expectedWebAccessPath = "${expectedWebAccess}/lib/node_modules/pi-web-access";
  expectedHerdrSubagents = pkgs.callPackage ./packages/pi-herdr-subagents.nix { };
  expectedHerdrSubagentsPath = "${expectedHerdrSubagents}/lib/node_modules/pi-herdr-subagents";
  expectedVisionHandoff = pkgs.callPackage ./packages/pi-vision-handoff.nix { };
  expectedVisionHandoffPath = "${expectedVisionHandoff}/lib/node_modules/pi-vision-handoff";
  expectedVisionHandoffConfigUpdater =
    pkgs.callPackage ./packages/pi-vision-handoff-config-updater.nix
      { };
  expectedSupiContext = pkgs.callPackage ./packages/supi-context.nix { };
  expectedSupiContextPath = "${expectedSupiContext}/lib/node_modules/@mrclrchtr/supi-context";
  expectedSupiExtras = pkgs.callPackage ./packages/supi-extras.nix { };
  expectedSupiExtrasPath = "${expectedSupiExtras}/lib/node_modules/@mrclrchtr/supi-extras";
  expectedOscclip = pkgs.oscclip;
  expectedRtk = pkgs.rtk;
  expectedToon = pkgs.callPackage ./packages/toon.nix { };
  expectedWritingForAgents = default.config.programs.pi-coding-agent.skills.writing-for-agents;
  expectedModels = builtins.fromJSON (builtins.readFile ./config/models.json);
  secretWrappedMcpConfig =
    secretWrappedMcp.config.home.file."${secretWrappedMcp.config.programs.pi-coding-agent.configDir}/mcp.json".source;
  webAccessConfigSource =
    webAccessConfigured.config.home.file."${webAccessConfigured.config.programs.pi-coding-agent.configDir}/web-search.json".source;
  expectedWebAccessConfigFile = (pkgs.formats.json { }).generate "web-search.json" {
    openaiApiKey = "!${pkgs.coreutils}/bin/cat /run/secrets/openai-api-key";
    provider = "openai";
  };
in
{
  diet-lsp = expectedDietLsp;
  command-code = expectedCommandCodeProvider;
  pi-effort = expectedEffort;
  pi-timestamps = expectedTimestamps;
  pi-herdr = expectedPiHerdr;
  pi-herdr-sudo-task = expectedHerdrSudoTask;
  pi-ask-herdr = expectedAskHerdr;
  pi-herdr-rename = expectedHerdrRename;
  pi-patty-bg-tasks = expectedPattyBgTasks;
  remote-pi = expectedRemotePi;
  remote-pi-config-updater = expectedRemotePiConfigUpdater;
  remote-pi-relay = expectedRemotePiRelay;
  pi-vimmode = expectedVimMode;
  pi-usage = expectedUsage;
  pi-cache-optimizer = expectedCacheOptimizer;
  mcp-adapter = expectedMcpAdapter;
  browser-goblin = expectedBrowserGoblin;
  pix-optimizer = expectedPixOptimizer;
  pix-tools = expectedPixTools;
  pi-vcc = expectedPiVcc;
  prompt-template-model = expectedPromptTemplateModel;
  rpiv-todo = expectedRpivTodo;
  rules = expectedRules;
  web-access = expectedWebAccess;
  herdr-subagents = expectedHerdrSubagents;
  vision-handoff = expectedVisionHandoff;
  supi-context = expectedSupiContext;
  supi-extras = expectedSupiExtras;

  module-evaluation =
    assert default.config.programs.pi-coding-agent.enable;
    assert darwinEvaluation.success;
    assert
      darwin.config.programs.pi-coding-agent.plugins.browser-goblin.executablePath
      == "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    assert darwin.config.services.remote-pi-relay.enable;
    assert darwin.config.services.remote-pi-relay.port == 8506;
    assert
      darwin.config.launchd.agents.remote-pi-relay.config.EnvironmentVariables.REMOTEPI_RELAY_HOST
      == "127.0.0.1";
    assert
      darwin.config.launchd.agents.remote-pi-relay.config.EnvironmentVariables.REMOTEPI_RELAY_PORT
      == "8506";
    assert
      darwin.config.launchd.agents.remote-pi-relay.config.EnvironmentVariables.REMOTEPI_MESH_DB_PATH
      == "/Users/test/Library/Application Support/remote-pi-relay/mesh.db";
    assert relayConfigured.config.services.remote-pi-relay.package == expectedRemotePiRelay;
    assert relayConfigured.config.services.remote-pi-relay.bindHost == "127.0.0.2";
    assert relayConfigured.config.services.remote-pi-relay.port == 8506;
    assert relayConfigured.config.services.remote-pi-relay.logLevel == "debug";
    assert relayConfigured.config.services.remote-pi-relay.maxCtMiB == 8;
    assert
      if pkgs.stdenv.hostPlatform.isLinux then
        builtins.elem "REMOTEPI_RELAY_HOST=127.0.0.2" relayConfigured.config.systemd.user.services.remote-pi-relay.Service.Environment
      else
        relayConfigured.config.launchd.agents.remote-pi-relay.config.EnvironmentVariables.REMOTEPI_RELAY_HOST
        == "127.0.0.2";
    assert expectedBrowserGoblin.agentBrowserVersion == pkgs.agent-browser.version;
    assert !disabled.config.programs.pi-coding-agent.enable;
    assert default.config.programs.pi-coding-agent.package == expectedPackage;
    assert
      default.config.programs.pi-coding-agent.settings == {
        defaultProvider = "openai-codex";
        defaultModel = "gpt-5.6-sol";
        defaultThinkingLevel = "medium";
        quietStartup = true;
        theme = "dark";
        hideThinkingBlock = false;
        showCacheMissNotices = false;
        compaction = {
          enabled = true;
          reserveTokens = 40000;
          keepRecentTokens = 20000;
        };
        subagents.disableBuiltins = true;
        packages = [
          expectedCommandCodeProviderPath
          expectedEffortPath
          expectedTimestampsPath
          expectedPiHerdrPath
          expectedHerdrSudoTaskPath
          expectedAskHerdrPath
          expectedHerdrRenamePath
          expectedPattyBgTasksPath
          expectedRemotePiPath
          expectedVimModePath
          expectedUsagePath
          expectedCacheOptimizerPath
          expectedMcpAdapterPath
          expectedBrowserGoblinPath
          expectedPixOptimizerPath
        ]
        ++ [
          expectedPiVccPath
          expectedPromptTemplateModelPath
          expectedRpivTodoPath
          expectedRulesPath
          expectedWebAccessPath
          expectedHerdrSubagentsPath
          expectedVisionHandoffPath
          expectedSupiContextPath
          expectedSupiExtrasPath
        ]
        ++ expectedPixToolPaths;
      };
    assert builtins.elem expectedOscclip default.config.home.packages;
    assert builtins.elem expectedRtk default.config.home.packages;
    assert builtins.elem expectedRtk optimizerConfigured.config.home.packages;
    assert !(builtins.elem expectedRtk pluginsDisabled.config.home.packages);
    assert builtins.elem expectedToon default.config.home.packages;
    assert builtins.elem expectedToon optimizerConfigured.config.home.packages;
    assert !(builtins.elem expectedToon pluginsDisabled.config.home.packages);
    assert !default.config.programs.pi-coding-agent.plugins.diet-lsp.enable;
    assert default.config.programs.pi-coding-agent.plugins.command-code.enable;
    assert default.config.programs.pi-coding-agent.plugins.remote-pi.enable;
    assert
      default.config.programs.pi-coding-agent.plugins.remote-pi.relayUrl
      == "https://remote-pi.tigor.web.id";
    assert
      remotePiConfigured.config.programs.pi-coding-agent.plugins.remote-pi.relayUrl
      == "https://relay.consumer.example";
    assert !invalidRemotePiRelayUrlEvaluation.success;
    assert !(default.config.home.sessionVariables ? REMOTE_PI_RELAY);
    assert default.config.home.activation ? remotePiConfig;
    assert remotePiConfigured.config.home.activation ? remotePiConfig;
    assert !(pluginsDisabled.config.home.activation ? remotePiConfig);
    assert
      default.config.programs.pi-coding-agent.plugins.pi-vision-handoff.visionModel
      == "openai-codex/gpt-5.6-luna";
    assert
      visionHandoffConfigured.config.programs.pi-coding-agent.plugins.pi-vision-handoff.visionModel
      == "google/gemini-2.5-pro";
    assert !invalidVisionHandoffModelEvaluation.success;
    assert default.config.home.activation ? visionHandoffConfig;
    assert visionHandoffConfigured.config.home.activation ? visionHandoffConfig;
    assert !(pluginsDisabled.config.home.activation ? visionHandoffConfig);
    assert pkgs.lib.hasInfix expectedVisionHandoffConfigPath visionHandoffActivation;
    assert
      !(pkgs.lib.hasInfix "${default.config.home.homeDirectory}/${expectedVisionHandoffConfigPath}" visionHandoffActivation);
    assert !(default.config.home.sessionVariables ? C2C_BIN);
    assert default.config.home.sessionVariables.PI_OFFLINE == "1";
    assert
      default.config.programs.pi-coding-agent.keybindings == {
        "app.tools.expand" = "ctrl+o";
        "tui.editor.cursorLeft" = "left";
      };
    assert default.config.programs.pi-coding-agent.models == expectedModels;
    assert default.config.programs.pi-coding-agent.context == ./config/AGENTS.md;
    assert default.config.programs.pi-coding-agent.plugins.pi-mcp-adapter.enable;
    assert default.config.programs.pi-coding-agent.plugins.pi-mcp-adapter.enableMcpIntegration;
    assert default.config.programs.pi-coding-agent.plugins.pi-vcc.enable;
    assert default.config.programs.pi-coding-agent.plugins.pix-optimizer.enable;
    assert builtins.all (
      name: default.config.programs.pi-coding-agent.plugins."pix-${name}".enable
    ) expectedPixToolNames;
    assert builtins.all (
      path: builtins.elem path default.config.programs.pi-coding-agent.settings.packages
    ) expectedPixToolPaths;
    assert default.config.programs.pi-coding-agent.plugins.pi-rules.enable;
    assert builtins.elem expectedRulesPath default.config.programs.pi-coding-agent.settings.packages;
    assert builtins.elem expectedRulesPath
      rulesEnabled.config.programs.pi-coding-agent.settings.packages;
    assert
      default.config.programs.pi-coding-agent.plugins.pix-optimizer.settings == {
        caveman = "ultra";
        rtk = false;
        toon = true;
        ponytail = "full";
      };
    assert
      optimizerConfigured.config.programs.pi-coding-agent.plugins.pix-optimizer.settings == {
        caveman = "micro";
        rtk = true;
        toon = false;
        ponytail = "ultra";
      };
    assert optimizerConfigSource == expectedOptimizerStateFile;
    assert
      default.config.programs.pi-coding-agent.plugins.pi-vcc.settings == {
        overrideDefaultCompaction = true;
        smartKeepTail = true;
        continueAfterThresholdCompact = true;
        debug = false;
      };
    assert
      vccConfigured.config.programs.pi-coding-agent.plugins.pi-vcc.settings == {
        overrideDefaultCompaction = false;
        smartKeepTail = false;
        continueAfterThresholdCompact = false;
        debug = true;
      };
    assert vccConfigSource == expectedVccConfigFile;
    assert webAccessConfigSource == expectedWebAccessConfigFile;
    assert
      webAccessPathConfigured.config.programs.pi-coding-agent.plugins.pi-web-access.credentialFiles.braveApiKey
      == ./config/models.json;
    assert
      !(
        default.config.home.file ? "${default.config.programs.pi-coding-agent.configDir}/web-search.json"
      );
    assert
      vccConfigured.config.home.sessionVariables.PI_VCC_CONFIG_PATH
      == "/home/test/.pi/agent/pi-vcc-config.json";
    assert default.config.programs.mcp.enable;
    assert !(default.config.programs.mcp.servers ? open-design);
    assert
      default.config.programs.pi-coding-agent.extensions.artifact-preview
      == ./config/extensions/artifact-preview;
    assert
      default.config.home.file."${default.config.programs.pi-coding-agent.configDir}/extensions/artifact-preview".source
      == ./config/extensions/artifact-preview;
    assert
      default.config.home.file."${default.config.programs.pi-coding-agent.configDir}/extensions/artifact-preview".force;
    assert
      default.config.programs.pi-coding-agent.extensions.dev-journal == ./config/extensions/dev-journal;
    assert
      default.config.home.file."${default.config.programs.pi-coding-agent.configDir}/extensions/dev-journal".source
      == ./config/extensions/dev-journal;
    assert
      default.config.home.file."${default.config.programs.pi-coding-agent.configDir}/extensions/dev-journal".force;
    assert
      default.config.programs.pi-coding-agent.extensions.lazy-tools == ./config/extensions/lazy-tools;
    assert
      default.config.home.file."${default.config.programs.pi-coding-agent.configDir}/extensions/lazy-tools".source
      == ./config/extensions/lazy-tools;
    assert
      default.config.home.file."${default.config.programs.pi-coding-agent.configDir}/extensions/lazy-tools".force;
    assert
      default.config.home.file."${default.config.programs.pi-coding-agent.configDir}/AGENTS.md".source
      == ./config/AGENTS.md;
    assert builtins.pathExists (
      default.config.programs.pi-coding-agent.skills.writing-for-agents + "/SKILL.md"
    );
    assert builtins.pathExists (default.config.programs.pi-coding-agent.skills.wait-what + "/SKILL.md");
    assert builtins.pathExists (default.config.programs.pi-coding-agent.skills.wizard + "/SKILL.md");
    assert builtins.pathExists (
      default.config.programs.pi-coding-agent.skills.to-questionnaire + "/SKILL.md"
    );
    # ponytail: assert required/excluded skills only; upstream additions must not block input updates.
    assert !(default.config.programs.pi-coding-agent.skills ? tuxedo-todo);
    assert !(default.config.programs.pi-coding-agent.skills ? design-an-interface);
    assert !(default.config.programs.pi-coding-agent.skills ? request-refactor-plan);
    assert !(default.config.programs.pi-coding-agent.skills ? edit-article);
    assert !(default.config.programs.pi-coding-agent.skills ? dynamic-workflow);
    assert !(default.config.programs.pi-coding-agent.skills ? codebase-pattern-preview);
    assert !(default.config.programs.pi-coding-agent.skills ? feature-contract-preview);
    assert
      default.config.home.file."${default.config.programs.pi-coding-agent.configDir}/rules".source
      == ./config/rules;
    assert builtins.pathExists (
      default.config.home.file."${default.config.programs.pi-coding-agent.configDir}/rules".source
      + "/astro-docs-authoring.md"
    );
    assert
      default.config.home.file."${default.config.programs.pi-coding-agent.configDir}/skills".source.entries.writing-for-agents
      == default.config.programs.pi-coding-agent.skills.writing-for-agents;
    assert
      default.config.home.file."${default.config.programs.pi-coding-agent.configDir}/skills".source.entries.agents-load
      == ./config/skills/agents-load;
    assert default.config.home.file."${default.config.programs.pi-coding-agent.configDir}/skills".force;
    assert builtins.length (builtins.attrNames default.config.programs.pi-coding-agent.agents) == 6;
    assert !(builtins.hasAttr "frontier-implementer" default.config.programs.pi-coding-agent.agents);
    assert !(builtins.hasAttr "frontier-reviewer" default.config.programs.pi-coding-agent.agents);
    assert default.config.programs.pi-coding-agent.agents.implementer.model == "gpt-5.6-sol";
    assert default.config.programs.pi-coding-agent.agents.reviewer.model == "gpt-5.6-sol";
    assert default.config.programs.pi-coding-agent.agents.reviewer.effort == "high";
    assert
      default.config.home.file."${default.config.programs.pi-coding-agent.configDir}/agents/orchestrator.md".text
      == expectedOrchestrator;
    assert
      resolvedAgent.config.home.file."${resolvedAgent.config.programs.pi-coding-agent.configDir}/agents/custom.md".text
      == ''
        ---
        name: "custom"
        description: "Resolver check"
        tools: "read"
        system-prompt: replace
        session-mode: standalone
        spawning: false
        auto-exit: true
        skills: "demo"
        ---
        Custom prompt.'';
    assert
      yamlSafeAgentText == ''
        ---
        name: "edge: # [] {}"
        description: "line one:\nline two # []"
        tools: "read, bash"
        system-prompt: replace
        session-mode: standalone
        spawning: false
        auto-exit: true
        ---
        Special prompt.'';
    assert
      resolvedAgent.config.home.file."${resolvedAgent.config.programs.pi-coding-agent.configDir}/skills".source.entries.demo
      == ./config/agents;
    assert !invalidPluginEvaluation.success;
    assert !invalidDisabledMcpEvaluation.success;
    assert !invalidWebAccessCredentialNameEvaluation.success;
    assert !invalidWebAccessLiteralCredentialEvaluation.success;
    assert
      default.config.home.file."${default.config.programs.pi-coding-agent.configDir}/prompts".source
      == ./config/prompts;
    assert
      default.config.home.file."${default.config.programs.pi-coding-agent.configDir}/prompts".force;
    assert
      default.config.home.file."${default.config.programs.pi-coding-agent.configDir}/templates/drain".source
      == ./config/templates/drain;
    assert
      default.config.home.file."${default.config.programs.pi-coding-agent.configDir}/templates/drain".force;
    assert
      !(default.config.home.file ? "${default.config.programs.pi-coding-agent.configDir}/mcp.json");
    assert !(default.config.xdg.configFile ? "mcp/mcp.json");
    assert builtins.elem expectedPackage default.config.home.packages;
    assert
      !(builtins.elem disabled.config.programs.pi-coding-agent.package disabled.config.home.packages);
    assert !(builtins.elem expectedOscclip disabled.config.home.packages);
    assert
      !(
        disabled.config.home.file ? "${disabled.config.programs.pi-coding-agent.configDir}/settings.json"
      );
    assert
      !(
        disabled.config.home.file ? "${disabled.config.programs.pi-coding-agent.configDir}/keybindings.json"
      );
    assert
      !(disabled.config.home.file ? "${disabled.config.programs.pi-coding-agent.configDir}/models.json");
    assert
      !(disabled.config.home.file ? "${disabled.config.programs.pi-coding-agent.configDir}/AGENTS.md");
    assert
      !(disabled.config.home.file ? "${disabled.config.programs.pi-coding-agent.configDir}/mcp.json");
    assert
      !(
        disabled.config.home.file
        ? "${disabled.config.programs.pi-coding-agent.configDir}/pi-vcc-config.json"
      );
    assert !(disabled.config.xdg.configFile ? "mcp/mcp.json");
    assert
      !(
        disabled.config.home.file ? "${disabled.config.programs.pi-coding-agent.configDir}/optimizer.json"
      );
    assert !(disabled.config.home.sessionVariables ? C2C_BIN);
    assert !(disabled.config.home.sessionVariables ? PI_OFFLINE);
    assert !(disabled.config.home.sessionVariables ? PI_VCC_CONFIG_PATH);
    assert
      !(disabled.config.home.file ? "${disabled.config.programs.pi-coding-agent.configDir}/skills");
    assert
      !(
        disabled.config.home.file
        ? "${disabled.config.programs.pi-coding-agent.configDir}/extensions/artifact-preview"
      );
    assert
      !(
        disabled.config.home.file
        ? "${disabled.config.programs.pi-coding-agent.configDir}/extensions/dev-journal"
      );
    assert
      !(disabled.config.home.file ? "${disabled.config.programs.pi-coding-agent.configDir}/prompts");
    assert
      !(
        disabled.config.home.file ? "${disabled.config.programs.pi-coding-agent.configDir}/templates/drain"
      );
    assert
      !(builtins.elem expectedCommandCodeProviderPath pluginsDisabled.config.programs.pi-coding-agent.settings.packages);
    assert
      !(builtins.elem expectedMcpAdapterPath pluginsDisabled.config.programs.pi-coding-agent.settings.packages);
    assert
      !(builtins.elem expectedPixOptimizerPath pluginsDisabled.config.programs.pi-coding-agent.settings.packages);
    assert
      !(builtins.elem expectedPiVccPath pluginsDisabled.config.programs.pi-coding-agent.settings.packages);
    assert
      !(builtins.elem expectedRemotePiPath pluginsDisabled.config.programs.pi-coding-agent.settings.packages);
    assert
      !(builtins.elem expectedHerdrSubagentsPath pluginsDisabled.config.programs.pi-coding-agent.settings.packages);
    assert
      !(builtins.elem expectedRpivTodoPath pluginsDisabled.config.programs.pi-coding-agent.settings.packages);
    assert
      !(
        pluginsDisabled.config.home.file
        ? "${pluginsDisabled.config.programs.pi-coding-agent.configDir}/mcp.json"
      );
    assert
      !(
        pluginsDisabled.config.home.file
        ? "${pluginsDisabled.config.programs.pi-coding-agent.configDir}/optimizer.json"
      );
    assert !(pluginsDisabled.config.home.sessionVariables ? PI_VCC_CONFIG_PATH);
    assert
      !(
        pluginsDisabled.config.home.file
        ? "${pluginsDisabled.config.programs.pi-coding-agent.configDir}/pi-vcc-config.json"
      );
    assert
      !(
        pluginsDisabled.config.home.file
        ? "${pluginsDisabled.config.programs.pi-coding-agent.configDir}/agents/orchestrator.md"
      );
    assert overridden.config.programs.pi-coding-agent.package == overridePackage;
    assert builtins.elem overridePackage overridden.config.home.packages;
    assert settingsOverridden.config.programs.pi-coding-agent.settings.theme == "light";
    assert settingsOverridden.config.programs.pi-coding-agent.settings.retry.maxRetries == 3;
    assert
      settingsOverridden.config.programs.pi-coding-agent.settings.packages == [
        expectedCommandCodeProviderPath
        expectedEffortPath
        expectedTimestampsPath
        expectedPiHerdrPath
        expectedHerdrSudoTaskPath
        expectedAskHerdrPath
        expectedHerdrRenamePath
        expectedPattyBgTasksPath
        expectedRemotePiPath
        expectedVimModePath
        expectedUsagePath
        expectedCacheOptimizerPath
        expectedMcpAdapterPath
        expectedBrowserGoblinPath
        expectedPixOptimizerPath
      ]
      ++ [
        expectedPiVccPath
        expectedPromptTemplateModelPath
        expectedRpivTodoPath
        expectedRulesPath
        expectedWebAccessPath
        expectedHerdrSubagentsPath
        expectedVisionHandoffPath
        expectedSupiContextPath
        expectedSupiExtrasPath
      ]
      ++ expectedPixToolPaths;
    assert
      settingsOverridden.config.programs.pi-coding-agent.keybindings == {
        "app.tools.expand" = "ctrl+e";
        "tui.editor.cursorLeft" = "left";
      };
    pkgs.runCommandLocal "pi-home-manager-module-evaluation" { } "touch $out";

  artifact-preview =
    pkgs.runCommandLocal "pi-artifact-preview"
      {
        nativeBuildInputs = [
          expectedPackage
          pkgs.nodejs_22
        ];
      }
      ''
        export HOME="$TMPDIR/home"
        export PI_CODING_AGENT_DIR="$HOME/.pi/agent"
        export PI_TELEMETRY=0
        mkdir -p "$PI_CODING_AGENT_DIR"
        test ! -e ${./config/extensions/artifact-preview}/node_modules
        node --experimental-strip-types ${./config/extensions/artifact-preview}/artifact-preview.self-check.ts
        pi --offline --no-extensions --no-skills --no-prompt-templates --no-context-files \
          -e ${./config/extensions/artifact-preview}/index.ts \
          --list-models > pi.log 2>&1
        ! grep -E 'Extension issues|Failed to load extension|Cannot find module|Error:' pi.log
        touch $out
      '';

  dev-journal =
    pkgs.runCommandLocal "pi-dev-journal"
      {
        nativeBuildInputs = [
          expectedPackage
          pkgs.nodejs_22
        ];
      }
      ''
        cp -R ${./config/extensions/dev-journal} dev-journal
        chmod -R u+w dev-journal
        mkdir -p dev-journal/node_modules/@earendil-works
        piRuntime=${expectedPackage}/lib/node_modules/pi-monorepo
        ln -s "$piRuntime" dev-journal/node_modules/@earendil-works/pi-coding-agent
        ln -s "$piRuntime/node_modules/@earendil-works/pi-ai" dev-journal/node_modules/@earendil-works/pi-ai
        ln -s "$piRuntime/node_modules/typebox" dev-journal/node_modules/typebox
        node --experimental-strip-types dev-journal/dev-journal.self-check.ts

        export HOME="$TMPDIR/home"
        export PI_CODING_AGENT_DIR="$HOME/.pi/agent"
        export PI_TELEMETRY=0
        mkdir -p "$PI_CODING_AGENT_DIR"
        pi --offline --no-extensions --no-skills --no-prompt-templates --no-context-files \
          -e ${./config/extensions/dev-journal}/index.ts \
          --list-models > pi.log 2>&1
        ! grep -E 'Extension issues|Failed to load extension|Cannot find module|Error:' pi.log
        touch $out
      '';

  lazy-tools =
    pkgs.runCommandLocal "pi-lazy-tools"
      {
        nativeBuildInputs = [
          expectedPackage
          pkgs.nodejs_22
        ];
      }
      ''
        cp -R ${./config/extensions/lazy-tools} lazy-tools
        chmod -R u+w lazy-tools
        mkdir -p lazy-tools/node_modules/@earendil-works
        piRuntime=${expectedPackage}/lib/node_modules/pi-monorepo
        ln -s "$piRuntime/node_modules/@earendil-works/pi-ai" lazy-tools/node_modules/@earendil-works/pi-ai
        ln -s "$piRuntime/node_modules/typebox" lazy-tools/node_modules/typebox
        node --experimental-strip-types lazy-tools/lazy-tools.self-check.ts

        export HOME="$TMPDIR/home"
        export PI_CODING_AGENT_DIR="$HOME/.pi/agent"
        export PI_TELEMETRY=0
        mkdir -p "$PI_CODING_AGENT_DIR"
        pi --offline --no-extensions --no-skills --no-prompt-templates --no-context-files \
          -e ${./config/extensions/lazy-tools}/index.ts \
          --list-models > pi.log 2>&1
        ! grep -E 'Extension issues|Failed to load extension|Cannot find module|Error:' pi.log
        touch $out
      '';

  formatting =
    pkgs.runCommandLocal "pi-home-manager-formatting"
      {
        nativeBuildInputs = [
          pkgs.nixfmt
          pkgs.jq
          pkgs.nodejs_22
          pkgs.gnutar
        ];
      }
      ''
        nixfmt --check ${./flake.nix} ${./checks.nix} ${./modules/pi-coding-agent.nix} ${./modules/remote-pi-relay.nix} ${./modules/pi-coding-agent/agents.nix} ${./modules/pi-coding-agent/default-agents.nix} ${./modules/pi-coding-agent/pi-herdr-subagents.nix} ${./packages/pi-diet-lsp.nix} ${./packages/pi-commandcode-provider.nix} ${./packages/pi-effort.nix} ${./packages/pi-timestamps.nix} ${./packages/pi-herdr.nix} ${./packages/pi-herdr-sudo-task.nix} ${./packages/pi-ask-herdr.nix} ${./packages/pi-herdr-rename.nix} ${./packages/pi-patty-bg-tasks.nix} ${./packages/remote-pi.nix} ${./packages/remote-pi-config-updater.nix} ${./packages/remote-pi-relay.nix} ${./packages/pi-vimmode.nix} ${./packages/pi-usage.nix} ${./packages/pi-cache-optimizer.nix} ${./packages/pi-mcp-adapter.nix} ${./packages/browser-goblin.nix} ${./packages/pix-optimizer.nix} ${./packages/pix-tools.nix} ${./packages/pi-vcc.nix} ${./packages/pi-prompt-template-model.nix} ${./packages/rpiv-todo.nix} ${./packages/pi-rules.nix} ${./packages/pi-web-access.nix} ${./packages/pi-herdr-subagents.nix} ${./packages/pi-vision-handoff.nix} ${./packages/pi-vision-handoff-config-updater.nix} ${./packages/supi-context.nix} ${./packages/supi-extras.nix} ${./packages/toon.nix}
        WORKFLOW=${./.github/workflows/daily-update.yml} UPDATER=${./scripts/daily-update.sh} REGISTRY=${./pi-plugins.json} CHECKS=${./checks.nix} bash ${./tests/daily-updater-self-check.sh}
        touch $out
      '';

  diet-lsp-load =
    pkgs.runCommandLocal "pi-diet-lsp-load" { nativeBuildInputs = [ expectedPackage ]; }
      ''
        export HOME="$TMPDIR/home"
        export PI_CODING_AGENT_DIR="$HOME/.pi/agent"
        export PI_TELEMETRY=0
        mkdir -p "$PI_CODING_AGENT_DIR"
        test -f ${expectedDietLsp}/index.ts
        test ! -e ${expectedDietLsp}/node_modules
        pi --offline --no-extensions --no-skills --no-prompt-templates --no-context-files \
          -e ${expectedDietLsp} \
          --list-models > pi.log 2>&1
        ! grep -E 'Extension issues|Failed to load extension|Cannot find module|Error:' pi.log
        touch $out
      '';

  command-code-load =
    pkgs.runCommandLocal "pi-command-code-provider-load" { nativeBuildInputs = [ expectedPackage ]; }
      ''
        export HOME="$TMPDIR/home"
        export PI_CODING_AGENT_DIR="$HOME/.pi/agent"
        export PI_TELEMETRY=0
        export COMMANDCODE_MODELS_URL="http://127.0.0.1:1/models"
        export COMMANDCODE_MODELS_TIMEOUT_MS=1
        mkdir -p "$PI_CODING_AGENT_DIR"
        provider=${expectedCommandCodeProviderPath}
        test -f "$provider/package.json"
        test -f "$provider/index.ts"
        test ! -e "$provider/node_modules"
        grep -F '"name": "pi-commandcode-provider"' "$provider/package.json"
        pi --offline --no-extensions --no-skills --no-prompt-templates --no-context-files \
          -e "$provider" \
          --list-models > pi.log 2>&1
        ! grep -E 'Extension issues|Failed to load extension|Cannot find module|Error:' pi.log
        touch $out
      '';

  pi-effort-load =
    pkgs.runCommandLocal "pi-effort-load" { nativeBuildInputs = [ expectedPackage ]; }
      ''
        export HOME="$TMPDIR/home"
        export PI_CODING_AGENT_DIR="$HOME/.pi/agent"
        export PI_TELEMETRY=0
        mkdir -p "$PI_CODING_AGENT_DIR"
        effort=${expectedEffortPath}
        test -f "$effort/package.json"
        test -f "$effort/extensions/effort.ts"
        test ! -e "$effort/node_modules"
        grep -F '"name": "@nehlis/pi-effort"' "$effort/package.json"
        grep -F '"./extensions/effort.ts"' "$effort/package.json"
        grep -F 'pi.registerCommand("effort"' "$effort/extensions/effort.ts"
        grep -F 'pi.setThinkingLevel(requested)' "$effort/extensions/effort.ts"
        pi --offline --no-extensions --no-skills --no-prompt-templates --no-context-files \
          -e "$effort" \
          --list-models > pi.log 2>&1
        ! grep -E 'Extension issues|Failed to load extension|Cannot find module|Error:' pi.log
        touch $out
      '';

  pi-timestamps-load =
    pkgs.runCommandLocal "pi-timestamps-load" { nativeBuildInputs = [ expectedPackage ]; }
      ''
        export HOME="$TMPDIR/home"
        export PI_CODING_AGENT_DIR="$HOME/.pi/agent"
        export PI_TELEMETRY=0
        mkdir -p "$PI_CODING_AGENT_DIR"
        timestamps=${expectedTimestampsPath}
        test -f "$timestamps/package.json"
        test -f "$timestamps/extensions/timestamps.ts"
        test ! -e "$timestamps/node_modules"
        grep -F '"name": "pi-timestamps"' "$timestamps/package.json"
        grep -F 'pi.registerCommand("timestamps"' "$timestamps/extensions/timestamps.ts"
        pi --offline --no-extensions --no-skills --no-prompt-templates --no-context-files \
          -e "$timestamps" \
          --list-models > pi.log 2>&1
        ! grep -E 'Extension issues|Failed to load extension|Cannot find module|Error:' pi.log
        touch $out
      '';

  pi-herdr-load = pkgs.runCommandLocal "pi-herdr-load" { nativeBuildInputs = [ expectedPackage ]; } ''
    export HOME="$TMPDIR/home"
    export PI_CODING_AGENT_DIR="$HOME/.pi/agent"
    export PI_TELEMETRY=0
    export HERDR_ENV=1
    export HERDR_PANE_ID=test-pane
    mkdir -p "$PI_CODING_AGENT_DIR"
    test -f ${expectedPiHerdrPath}/index.ts
    test ! -e ${expectedPiHerdrPath}/node_modules
    pi --offline --no-extensions --no-skills --no-prompt-templates --no-context-files \
      -e ${expectedPiHerdrPath} \
      --list-models > pi.log 2>&1
    ! grep -E 'Extension issues|Failed to load extension|Cannot find module|Error:' pi.log
    touch $out
  '';

  pi-patty-bg-tasks-load =
    pkgs.runCommandLocal "pi-patty-bg-tasks-load"
      {
        nativeBuildInputs = [
          expectedPackage
          pkgs.nodejs_22
        ];
      }
      ''
        export HOME="$TMPDIR/home"
        export PI_CODING_AGENT_DIR="$HOME/.pi/agent"
        export PI_TELEMETRY=0
        mkdir -p "$PI_CODING_AGENT_DIR"
        test -f ${expectedPattyBgTasksPath}/index.ts
        test ! -e ${expectedPattyBgTasksPath}/node_modules
        grep -F 'name: "agent_bg"' ${expectedPattyBgTasksPath}/src/tools/agent-bg.ts
        grep -F 'constants.O_NOFOLLOW' ${expectedPattyBgTasksPath}/src/spawn.ts
        grep -F 'mode: 0o600' ${expectedPattyBgTasksPath}/src/tools/agent-bg.ts
        cp ${expectedPattyBgTasksPath}/src/spawn.ts "$TMPDIR/spawn.ts"
        node --experimental-strip-types --input-type=module <<EOF
        import assert from "node:assert/strict";
        import { mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
        import { spawnWithFileOutput } from "$TMPDIR/spawn.ts";
        const dir = "$TMPDIR/runtime";
        const log = dir + "/probe.log";
        const child = spawnWithFileOutput({ command: "printf private", cwd: "$TMPDIR", logPath: log });
        const keeper = setInterval(() => {}, 1000);
        assert.equal(await child.exit, 0);
        clearInterval(keeper);
        assert.equal(statSync(dir).mode & 0o777, 0o700);
        assert.equal(statSync(log).mode & 0o777, 0o600);
        assert.equal(readFileSync(log, "utf8"), "private");
        const target = "$TMPDIR/target";
        writeFileSync(target, "keep");
        symlinkSync(target, dir + "/linked.log");
        assert.throws(() => spawnWithFileOutput({ command: "printf overwrite", cwd: "$TMPDIR", logPath: dir + "/linked.log" }));
        assert.equal(readFileSync(target, "utf8"), "keep");
        EOF
        pi --offline --no-extensions --no-skills --no-prompt-templates --no-context-files \
          -e ${expectedPattyBgTasksPath} \
          --list-models > pi.log 2>&1
        ! grep -E 'Extension issues|Failed to load extension|Cannot find module|Error:' pi.log
        touch $out
      '';

  remote-pi-config =
    pkgs.runCommandLocal "remote-pi-config"
      {
        nativeBuildInputs = [
          expectedRemotePiConfigUpdater
          pkgs.jq
        ];
      }
      ''
        config="$TMPDIR/remote/config.json"
        mkdir -p "$(dirname "$config")"
        printf '%s\n' '{"relay":"https://old.example","paired":true,"nested":{"keep":1}}' > "$config"
        chmod 0644 "$config"
        before=$(stat -c %i "$config")

        remote-pi-config-update "$config" https://relay.consumer.example
        jq -e '.relay == "https://relay.consumer.example/" and .paired == true and .nested.keep == 1' "$config"
        test "$(stat -c %a "$config")" = 600
        test "$(stat -c %i "$config")" != "$before"

        unchanged=$(stat -c %i "$config")
        remote-pi-config-update "$config" https://relay.consumer.example
        test "$(stat -c %i "$config")" = "$unchanged"

        cp "$config" valid.json
        printf '%s\n' 'not-json' > "$config"
        if remote-pi-config-update "$config" https://relay.consumer.example; then exit 1; fi
        grep -Fx not-json "$config"
        cp valid.json "$config"
        if remote-pi-config-update "$config" 'https://?'; then exit 1; fi
        cmp valid.json "$config"

        new="$TMPDIR/new/config.json"
        remote-pi-config-update "$new" http://127.0.0.1:8506
        jq -e '. == {"relay":"http://127.0.0.1:8506/"}' "$new"
        test "$(stat -c %a "$new")" = 600
        touch $out
      '';

  remote-pi-load =
    pkgs.runCommandLocal "remote-pi-load"
      {
        nativeBuildInputs = [
          expectedPackage
          pkgs.nodejs_22
        ];
      }
      ''
        export HOME="$TMPDIR/home"
        export PI_CODING_AGENT_DIR="$HOME/.pi/agent"
        export PI_TELEMETRY=0
        mkdir -p "$PI_CODING_AGENT_DIR"

        test -f ${expectedRemotePiPath}/dist/index.js
        test -x ${expectedRemotePi}/bin/remote-pi
        test -x ${expectedRemotePi}/bin/pi-supervisord
        node -e 'import("${expectedRemotePiPath}/dist/index.js")'
        pi --offline --no-extensions --no-skills --no-prompt-templates --no-context-files \
          -e ${expectedRemotePiPath} \
          --list-models > pi.log 2>&1
        ! grep -E 'Extension issues|Failed to load extension|Cannot find module|Error:' pi.log
        touch $out
      '';

  pi-vimmode-load =
    pkgs.runCommandLocal "pi-vimmode-load" { nativeBuildInputs = [ expectedPackage ]; }
      ''
        export HOME="$TMPDIR/home"
        export PI_CODING_AGENT_DIR="$HOME/.pi/agent"
        export PI_TELEMETRY=0
        mkdir -p "$PI_CODING_AGENT_DIR"
        test -f ${expectedVimModePath}/index.js
        test -f ${expectedVimModePath}/config.d.ts
        test ! -e ${expectedVimModePath}/node_modules
        grep -F '"version": "0.9.0"' ${expectedVimModePath}/package.json
        grep -aF 'registerCommand(`vimmode`' ${expectedVimModePath}/index.js
        pi --offline --no-extensions --no-skills --no-prompt-templates --no-context-files \
          -e ${expectedVimModePath} \
          --list-models > pi.log 2>&1
        ! grep -E 'Extension issues|Failed to load extension|Cannot find module|Error:' pi.log
        touch $out
      '';

  pi-cache-optimizer-load =
    pkgs.runCommandLocal "pi-cache-optimizer-load" { nativeBuildInputs = [ expectedPackage ]; }
      ''
        export HOME="$TMPDIR/home"
        export PI_CODING_AGENT_DIR="$HOME/.pi/agent"
        export PI_TELEMETRY=0
        mkdir -p "$PI_CODING_AGENT_DIR"
        optimizer=${expectedCacheOptimizerPath}
        test -f "$optimizer/package.json"
        test -f "$optimizer/index.ts"
        test ! -e "$optimizer/node_modules"
        grep -F '"name": "pi-cache-optimizer"' "$optimizer/package.json"
        grep -F '"version": "2.8.2"' "$optimizer/package.json"
        grep -F 'pi.registerCommand("cache-optimizer"' "$optimizer/index.ts"
        ! grep -F 'registerTool' "$optimizer/index.ts"
        pi --offline --no-extensions --no-skills --no-prompt-templates --no-context-files \
          -e "$optimizer" \
          --list-models > pi.log 2>&1
        ! grep -E 'Extension issues|Failed to load extension|Cannot find module|Error:' pi.log
        touch $out
      '';

  pi-usage-load =
    pkgs.runCommandLocal "pi-usage-load"
      {
        nativeBuildInputs = [
          expectedPackage
          pkgs.nodejs_22
        ];
      }
      ''
        export HOME="$TMPDIR/home"
        export PI_CODING_AGENT_DIR="$HOME/.pi/agent"
        export PI_TELEMETRY=0
        mkdir -p "$PI_CODING_AGENT_DIR"
        usage=${expectedUsagePath}
        test -f "$usage/package.json"
        test -f "$usage/src/index.ts"
        test ! -e "$usage/node_modules"
        grep -F '"name": "@narumitw/pi-usage"' "$usage/package.json"
        grep -F '"version": "0.34.0"' "$usage/package.json"
        grep -F '"./src/index.ts"' "$usage/package.json"
        grep -F 'pi.registerCommand("usage"' "$usage/src/usage.ts"

        # ponytail: .js aliases let dependency-free Node strip-types run exact packaged .ts files.
        cp -R "$usage/src" "$TMPDIR/usage-src"
        chmod -R u+w "$TMPDIR/usage-src"
        find "$TMPDIR/usage-src" -type f -name '*.ts' -print0 | while IFS= read -r -d ''' source; do
          ln -s "$(basename "$source")" "''${source%.ts}.js"
        done
        cd "$TMPDIR"
        node --experimental-strip-types --input-type=module <<'EOF'
        import assert from "node:assert/strict";
        import { redactUsageError } from "./usage-src/core.ts";
        import {
          queryProviderUsage,
          resolveUsageAuth,
          SUPPORTED_ADAPTERS,
        } from "./usage-src/query.ts";

        const originalFetch = globalThis.fetch;
        const originalSetTimeout = globalThis.setTimeout;
        const originalClearTimeout = globalThis.clearTimeout;
        const model = (provider, baseUrl) => ({ id: "test", name: "Test", provider, baseUrl });
        const context = (current, auth) => ({
          model: current,
          modelRegistry: {
            getApiKeyAndHeaders: async () => ({ ok: true, apiKey: auth }),
            getProviderAuth: async () => ({ auth: { apiKey: auth, baseUrl: current.baseUrl } }),
            getAvailable: () => [current],
            getAll: () => [current],
          },
        });

        try {
          let calls = [];
          globalThis.fetch = async (url, options) => {
            calls.push({ url: String(url), headers: options.headers, signal: options.signal });
            if (String(url) === "https://chatgpt.com/backend-api/wham/usage") {
              return Response.json({ credits: { has_credits: false } });
            }
            if (String(url) === "https://openrouter.ai/api/v1/key") {
              return Response.json({ data: { usage: 1 } });
            }
            throw new Error("unexpected endpoint: " + url);
          };

          for (const [provider, origin, endpoint] of [
            ["openai-codex", "https://chatgpt.com/backend-api", "https://chatgpt.com/backend-api/wham/usage"],
            ["openrouter", "https://openrouter.ai/api/v1", "https://openrouter.ai/api/v1/key"],
          ]) {
            const adapter = SUPPORTED_ADAPTERS.find((candidate) => candidate.id === provider);
            assert.ok(adapter);
            const auth = await resolveUsageAuth(context(model(provider, origin), "official-secret"), adapter);
            assert.ok(auth);
            await queryProviderUsage(adapter, auth, new AbortController().signal, 1_000);
            const call = calls.at(-1);
            assert.equal(call.url, endpoint);
            assert.deepEqual(call.headers, { Authorization: "Bearer official-secret", "User-Agent": "pi-usage" });
          }

          const callCount = calls.length;
          for (const [provider, origin] of [
            ["openai-codex", "https://chatgpt.example.test/backend-api"],
            ["openrouter", "https://openrouter.example.test/api/v1"],
          ]) {
            const adapter = SUPPORTED_ADAPTERS.find((candidate) => candidate.id === provider);
            await assert.rejects(
              () => resolveUsageAuth(context(model(provider, origin), "custom-secret"), adapter),
              /custom.*base URL|official/iu,
            );
          }
          assert.equal(calls.length, callCount, "custom origins must not receive Authorization");

          const openrouter = SUPPORTED_ADAPTERS.find((candidate) => candidate.id === "openrouter");
          const auth = await resolveUsageAuth(
            context(model("openrouter", "https://openrouter.ai/api/v1"), "cap-secret"),
            openrouter,
          );
          globalThis.fetch = async () => new Response("x".repeat(70_000), { status: 200 });
          await assert.rejects(
            () => queryProviderUsage(openrouter, auth, new AbortController().signal, 1_000),
            /exceeded 65536 bytes/,
          );
          globalThis.fetch = async () => new Response("x".repeat(70_000), { status: 500 });
          await assert.rejects(
            () => queryProviderUsage(openrouter, auth, new AbortController().signal, 1_000),
            (error) => error instanceof Error && error.message.length < 5_000 && /returned 500/.test(error.message),
          );

          let timeoutDelay;
          globalThis.setTimeout = (callback, delay) => {
            timeoutDelay = delay;
            queueMicrotask(callback);
            return 1;
          };
          globalThis.clearTimeout = () => {};
          globalThis.fetch = (_url, options) => new Promise((_resolve, reject) => {
            options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
          });
          await assert.rejects(
            () => queryProviderUsage(openrouter, auth, new AbortController().signal, 15_000),
            /Timed out after 15s/,
          );
          assert.equal(timeoutDelay, 15_000);

          const redacted = redactUsageError(
            'Bearer bearer-token {"access_token":"access-token","refresh_token":"refresh-token","api_key":"api-token"} exact-secret header-secret',
            ["exact-secret", "header-secret"],
          );
          for (const secret of ["bearer-token", "access-token", "refresh-token", "api-token", "exact-secret", "header-secret"]) {
            assert.ok(!redacted.includes(secret));
          }
          assert.match(redacted, /<redacted>/);
        } finally {
          globalThis.fetch = originalFetch;
          globalThis.setTimeout = originalSetTimeout;
          globalThis.clearTimeout = originalClearTimeout;
        }
        EOF

        pi --offline --no-extensions --no-skills --no-prompt-templates --no-context-files \
          -e "$usage" \
          --list-models > pi.log 2>&1
        ! grep -E 'Extension issues|Failed to load extension|Cannot find module|Error:' pi.log
        touch $out
      '';

  pi-herdr-rename-load =
    pkgs.runCommandLocal "pi-herdr-rename-load" { nativeBuildInputs = [ expectedPackage ]; }
      ''
        export HOME="$TMPDIR/home"
        export PI_CODING_AGENT_DIR="$HOME/.pi/agent"
        export PI_TELEMETRY=0
        mkdir -p "$PI_CODING_AGENT_DIR"
        test -f ${expectedHerdrRenamePath}/src/index.ts
        test ! -e ${expectedHerdrRenamePath}/node_modules
        grep -F 'name: "rename_herdr_tab"' ${expectedHerdrRenamePath}/src/index.ts
        grep -F 'pi.exec("herdr", ["tab", "rename", tabId, name]' ${expectedHerdrRenamePath}/src/index.ts
        grep -F 'if (!hasHerdrEnvironment()) return;' ${expectedHerdrRenamePath}/src/index.ts
        pi --offline --no-extensions --no-skills --no-prompt-templates --no-context-files \
          -e ${expectedHerdrRenamePath} \
          --list-models > pi.log 2>&1
        ! grep -E 'Extension issues|Failed to load extension|Cannot find module|Error:' pi.log
        touch $out
      '';

  pi-ask-herdr-load =
    pkgs.runCommandLocal "pi-ask-herdr-load" { nativeBuildInputs = [ expectedPackage ]; }
      ''
        export HOME="$TMPDIR/home"
        export PI_CODING_AGENT_DIR="$HOME/.pi/agent"
        export PI_TELEMETRY=0
        mkdir -p "$PI_CODING_AGENT_DIR"
        test -f ${expectedAskHerdrPath}/index.ts
        test ! -e ${expectedAskHerdrPath}/node_modules
        grep -F 'name: "ask_user"' ${expectedAskHerdrPath}/src/tool.ts
        grep -F 'Omit for no timeout (default).' ${expectedAskHerdrPath}/src/tool.ts
        grep -F 'Omit timeout unless the user explicitly requests a deadline; no timeout is the default.' ${expectedAskHerdrPath}/src/tool.ts
        grep -F 'if (params.timeout && params.timeout > 0)' ${expectedAskHerdrPath}/src/ui.ts
        grep -F 'if (ctx.mode !== "tui")' ${expectedAskHerdrPath}/src/tool.ts
        grep -F 'pane.report_metadata' ${expectedAskHerdrPath}/src/herdr.ts
        pi --offline --no-extensions --no-skills --no-prompt-templates --no-context-files \
          -e ${expectedAskHerdrPath} \
          --list-models > pi.log 2>&1
        ! grep -E 'Extension issues|Failed to load extension|Cannot find module|Error:' pi.log
        touch $out
      '';

  pi-herdr-sudo-task-load =
    pkgs.runCommandLocal "pi-herdr-sudo-task-load" { nativeBuildInputs = [ expectedPackage ]; }
      ''
        export HOME="$TMPDIR/home"
        export PI_CODING_AGENT_DIR="$HOME/.pi/agent"
        export PI_TELEMETRY=0
        export HERDR_ENV=1
        export HERDR_SOCKET_PATH="$TMPDIR/herdr.sock"
        export HERDR_PANE_ID=test-pane
        mkdir -p "$PI_CODING_AGENT_DIR"
        test -f ${expectedHerdrSudoTaskPath}/dist/index.js
        test ! -e ${expectedHerdrSudoTaskPath}/node_modules
        grep -F 'spawn("sudo",argv,{stdio:["inherit","pipe","pipe"]})' ${expectedHerdrSudoTaskPath}/dist/index.js
        grep -F 'if (!ctx.hasUI)' ${expectedHerdrSudoTaskPath}/dist/index.js
        grep -F 'Proceed with these exact commands? [y/n]:' ${expectedHerdrSudoTaskPath}/dist/index.js
        pi --offline --no-extensions --no-skills --no-prompt-templates --no-context-files \
          -e ${expectedHerdrSudoTaskPath} \
          --list-models > pi.log 2>&1
        ! grep -E 'Extension issues|Failed to load extension|Cannot find module|Error:' pi.log
        touch $out
      '';

  mcp-adapter-load =
    pkgs.runCommandLocal "pi-mcp-adapter-load"
      {
        nativeBuildInputs = [
          expectedPackage
          pkgs.jq
        ];
      }
      ''
        mcp_config=${secretWrappedMcpConfig}
        jq -e '.mcpServers | has("open-design") | not' "$mcp_config"
        jq -e '.mcpServers.secret.env == {"PUBLIC":"visible"}' "$mcp_config"
        jq -e '.mcpServers.secret | has("args") | not' "$mcp_config"
        ! grep -F '/run/secrets/token' "$mcp_config"

        wrapper=$(jq -r '.mcpServers.secret.command' "$mcp_config")
        test -x "$wrapper"
        grep -F '/run/secrets/token' "$wrapper"
        grep -F 'export TOKEN' "$wrapper"
        grep -F '/bin/secret-mcp' "$wrapper"

        export HOME="$TMPDIR/home"
        export PI_CODING_AGENT_DIR="$HOME/.pi/agent"
        export PI_TELEMETRY=0
        mkdir -p "$PI_CODING_AGENT_DIR"
        cp "$mcp_config" "$PI_CODING_AGENT_DIR/mcp.json"
        pi --offline --no-extensions --no-skills --no-prompt-templates --no-context-files \
          -e ${expectedMcpAdapterPath} \
          --list-models > pi.log 2>&1
        ! grep -E 'Extension issues|Failed to load extension|Cannot find module|Error:' pi.log
        touch $out
      '';

  browser-goblin-load =
    pkgs.runCommandLocal "browser-goblin-load"
      {
        nativeBuildInputs = [
          expectedBrowserGoblin
          expectedPackage
        ];
      }
      ''
        export HOME="$TMPDIR/home"
        export PI_CODING_AGENT_DIR="$HOME/.pi/agent"
        export PI_BROWSER_ARTIFACT_DIR="$TMPDIR/artifacts"
        export PI_TELEMETRY=0
        mkdir -p "$PI_CODING_AGENT_DIR"

        browser-goblin-agent-browser --version | grep -F ${pkgs.agent-browser.version}
        grep -F 'args.push("--session-name", session)' ${expectedBrowserGoblinPath}/extensions/pi-browser/index.ts
        grep -F '${expectedBrowserGoblin}/bin/browser-goblin-agent-browser' ${expectedBrowserGoblinPath}/extensions/pi-browser/index.ts

        pi --offline --no-extensions --no-skills --no-prompt-templates --no-context-files \
          -e ${expectedBrowserGoblinPath} \
          --list-models > pi.log 2>&1
        ! grep -E 'Extension issues|Failed to load extension|Cannot find module|Error:' pi.log
        touch $out
      '';

  pix-optimizer-load =
    pkgs.runCommandLocal "pix-optimizer-load"
      {
        nativeBuildInputs = [
          expectedPackage
          expectedToon
        ];
      }
      ''
        export HOME="$TMPDIR/home"
        export PI_CODING_AGENT_DIR="$HOME/.pi/agent"
        export PI_TELEMETRY=0
        mkdir -p "$PI_CODING_AGENT_DIR"
        test -f ${expectedPixOptimizerPath}/src/index.ts
        test -f ${expectedPixOptimizerPath}/node_modules/@xynogen/pix-pretty/src/modal-frame.ts
        test ! -e ${expectedPixOptimizerPath}/node_modules/@xynogen/pix-pretty/node_modules
        test "$(toon --version)" = "2.3.0"
        printf '{"answer":42}\n' | toon | grep -Fx 'answer: 42'
        cat > "$PI_CODING_AGENT_DIR/settings.json" <<EOF
        {"packages":["${expectedPixOptimizerPath}"]}
        EOF
        pi --offline --no-prompt-templates --no-context-files \
          --list-models > pi.log 2>&1
        ! grep -E 'Extension issues|Failed to load extension|Cannot find module|Error:' pi.log
        test ! -e "$PI_CODING_AGENT_DIR/optimizer.json"
        touch $out
      '';

  pix-tools-load =
    pkgs.runCommandLocal "pix-tools-load" { nativeBuildInputs = [ expectedPackage ]; }
      ''
        export HOME="$TMPDIR/home"
        export PI_CODING_AGENT_DIR="$HOME/.pi/agent"
        export PI_TELEMETRY=0
        mkdir -p "$PI_CODING_AGENT_DIR"
        test -f ${expectedPixPrettyPath}/src/index.ts
        test -d ${expectedPixTools}/lib/node_modules/pix-tools/node_modules/cli-highlight
        for tool in read write edit ls find grep; do
          test -f ${expectedPixToolsRoot}/pix-$tool/src/$tool.ts
          grep -F "name: \"$tool\"" ${expectedPixToolsRoot}/pix-$tool/src/$tool.ts
        done
        test -f ${expectedPixToolsRoot}/pix-data/src/index.ts
        grep -F 'void modelgrep.get()' ${expectedPixToolsRoot}/pix-data/src/index.ts
        test ! -e ${expectedPixToolsRoot}/pix-display
        test -f ${expectedPixToolsRoot}/pix-footer/src/extension.ts
        grep -F 'ctx.ui.setFooter' ${expectedPixToolsRoot}/pix-footer/src/footer.ts
        grep -F 'import { wrapTextWithAnsi } from "@earendil-works/pi-tui";' ${expectedPixToolsRoot}/pix-footer/src/footer.ts
        grep -F 'const line = `''${modePart}''${loc}''${markersPart}''${ctxPart}''${sep}''${model}''${otherPart}''${tokensPart}''${tpsPart}`;' ${expectedPixToolsRoot}/pix-footer/src/footer.ts
        grep -F 'return wrapTextWithAnsi(line, width);' ${expectedPixToolsRoot}/pix-footer/src/footer.ts
        cat > "$PI_CODING_AGENT_DIR/settings.json" <<'EOF'
        {"packages":${builtins.toJSON expectedPixToolPaths}}
        EOF
        pi --offline --no-prompt-templates --no-context-files \
          --list-models > pi.log 2>&1
        ! grep -E 'Extension issues|Failed to load extension|Cannot find module|Error:' pi.log
        touch $out
      '';

  pi-vcc-load = pkgs.runCommandLocal "pi-vcc-load" { nativeBuildInputs = [ expectedPackage ]; } ''
    export HOME="$TMPDIR/home"
    export PI_CODING_AGENT_DIR="$HOME/.pi/agent"
    export PI_VCC_CONFIG_PATH="$TMPDIR/pi-vcc-config.json"
    export PI_TELEMETRY=0
    mkdir -p "$PI_CODING_AGENT_DIR"
    test -f ${expectedPiVcc}/index.ts
    test ! -e ${expectedPiVcc}/demo.gif
    pi --offline --no-extensions --no-skills --no-prompt-templates --no-context-files \
      -e ${expectedPiVcc} \
      --list-models > pi.log 2>&1
    ! grep -E 'Extension issues|Failed to load extension|Cannot find module|Error:' pi.log
    grep -F '"overrideDefaultCompaction": true' "$PI_VCC_CONFIG_PATH"
    grep -F '"smartKeepTail": true' "$PI_VCC_CONFIG_PATH"
    grep -F '"continueAfterThresholdCompact": true' "$PI_VCC_CONFIG_PATH"
    grep -F '"debug": false' "$PI_VCC_CONFIG_PATH"
    touch $out
  '';

  rpiv-todo-load =
    pkgs.runCommandLocal "rpiv-todo-load" { nativeBuildInputs = [ expectedPackage ]; }
      ''
        export HOME="$TMPDIR/home"
        export XDG_CONFIG_HOME="$TMPDIR/config"
        export PI_CODING_AGENT_DIR="$HOME/.pi/agent"
        export PI_TELEMETRY=0
        mkdir -p "$PI_CODING_AGENT_DIR"
        test -d ${expectedRpivTodoPath}/node_modules/@juicesharp/rpiv-config
        test -d ${expectedRpivTodoPath}/node_modules/typebox
        pi --offline --no-extensions --no-skills --no-prompt-templates --no-context-files \
          -e ${expectedRpivTodoPath} \
          --list-models > pi.log 2>&1
        ! grep -E 'Extension issues|Failed to load extension|Cannot find module|Error:' pi.log
        test ! -e "$XDG_CONFIG_HOME/rpiv-todo/config.json"
        touch $out
      '';

  rules-load = pkgs.runCommandLocal "pi-rules-load" { nativeBuildInputs = [ expectedPackage ]; } ''
    export HOME="$TMPDIR/home"
    export PI_CODING_AGENT_DIR="$HOME/.pi/agent"
    export PI_TELEMETRY=0
    mkdir -p "$PI_CODING_AGENT_DIR"
    test -d ${expectedRulesPath}/node_modules/picomatch
    test -d ${expectedRulesPath}/node_modules/typebox
    test -d ${expectedRulesPath}/node_modules/yaml
    pi --offline --no-extensions --no-skills --no-prompt-templates --no-context-files \
      -e ${expectedRulesPath} \
      --list-models > pi.log 2>&1
    ! grep -E 'Extension issues|Failed to load extension|Cannot find module|Error:' pi.log
    touch $out
  '';

  web-access-load =
    pkgs.runCommandLocal "pi-web-access-load" { nativeBuildInputs = [ expectedPackage ]; }
      ''
        export HOME="$TMPDIR/home"
        export PI_CODING_AGENT_DIR="$HOME/.pi/agent"
        export PI_TELEMETRY=0
        mkdir -p "$PI_CODING_AGENT_DIR"
        test -d ${expectedWebAccessPath}/node_modules/@mozilla/readability
        test -d ${expectedWebAccessPath}/node_modules/unpdf
        grep -q 'webSearch: "web_search"' ${expectedWebAccessPath}/index.ts
        grep -q 'fetchContent: "fetch_content"' ${expectedWebAccessPath}/index.ts
        grep -q 'name: toolNames.webSearch' ${expectedWebAccessPath}/index.ts
        grep -q 'name: toolNames.fetchContent' ${expectedWebAccessPath}/index.ts
        pi --offline --no-extensions --no-skills --no-prompt-templates --no-context-files \
          -e ${expectedWebAccessPath} \
          --list-models > pi.log 2>&1
        ! grep -E 'Extension issues|Failed to load extension|Cannot find module|Error:' pi.log
        touch $out
      '';

  vision-handoff-config-updater =
    pkgs.runCommandLocal "pi-vision-handoff-config-updater-check"
      {
        nativeBuildInputs = [
          expectedVisionHandoffConfigUpdater
          pkgs.jq
        ];
      }
      ''
        config="$TMPDIR/pi-vision-handoff.json"
        pi-vision-handoff-config-update "$config" openai-codex/gpt-5.6-luna
        jq -e '. == {visionModel: "openai-codex/gpt-5.6-luna"}' "$config" >/dev/null
        test "$(stat -c %a "$config")" = 600

        printf '%s\n' '{"enabled":false,"cacheMax":12,"visionModel":"old/model"}' > "$config"
        pi-vision-handoff-config-update "$config" google/gemini-2.5-pro
        jq -e '. == {enabled: false, cacheMax: 12, visionModel: "google/gemini-2.5-pro"}' "$config" >/dev/null

        printf '%s\n' 'not-json' > "$config"
        cp "$config" "$TMPDIR/before"
        if pi-vision-handoff-config-update "$config" openai/gpt-4o; then
          exit 1
        fi
        cmp "$TMPDIR/before" "$config"
        touch $out
      '';

  vision-handoff-load =
    pkgs.runCommandLocal "pi-vision-handoff-load" { nativeBuildInputs = [ expectedPackage ]; }
      ''
        export HOME="$TMPDIR/home"
        export PI_CODING_AGENT_DIR="$HOME/.pi/agent"
        export PI_TELEMETRY=0
        mkdir -p "$PI_CODING_AGENT_DIR"
        package=${expectedVisionHandoffPath}
        test -f "$package/package.json"
        test -f "$package/vision-handoff.ts"
        test ! -e "$package/node_modules"
        grep -F '"./vision-handoff.ts"' "$package/package.json"
        pi --offline --no-extensions --no-skills --no-prompt-templates --no-context-files \
          -e "$package" \
          --list-models > pi.log 2>&1
        ! grep -E 'Extension issues|Failed to load extension|Cannot find module|Error:' pi.log
        test ! -e "$PI_CODING_AGENT_DIR/extensions/pi-vision-handoff.json"
        touch $out
      '';

  herdr-subagents-load =
    pkgs.runCommandLocal "pi-herdr-subagents-load"
      {
        nativeBuildInputs = [
          expectedPackage
          pkgs.nodejs_22
        ];
      }
      ''
        export HOME="$TMPDIR/home"
        export PI_CODING_AGENT_DIR="$HOME/.pi/agent"
        export PI_TELEMETRY=0
        export HERDR_ENV=1
        mkdir -p "$PI_CODING_AGENT_DIR"
        package=${expectedHerdrSubagentsPath}
        entry="$package/pi-extension/subagents/index.ts"
        test -f "$entry"
        test -f "$package/README.md"
        test -d "$package/node_modules/@sinclair/typebox"
        grep -F 'name: "subagent"' "$entry"
        grep -F 'name: "subagent_interrupt"' "$entry"
        grep -F 'name: "subagents_list"' "$entry"
        grep -F 'name: "subagent_resume"' "$entry"
        grep -F 'fire-and-forget async tool' "$entry"
        cp -R "$package" "$TMPDIR/package"
        chmod -R u+w "$TMPDIR/package"
        mkdir -p "$TMPDIR/package/node_modules/@earendil-works"
        ln -s ${expectedPackage}/lib/node_modules/pi-monorepo \
          "$TMPDIR/package/node_modules/@earendil-works/pi-coding-agent"
        ln -s ${expectedPackage}/lib/node_modules/pi-monorepo/node_modules/@earendil-works/pi-ai \
          "$TMPDIR/package/node_modules/@earendil-works/pi-ai"
        ln -s ${expectedPackage}/lib/node_modules/pi-monorepo/node_modules/@earendil-works/pi-tui \
          "$TMPDIR/package/node_modules/@earendil-works/pi-tui"
        node --experimental-strip-types ${./tests/pi-herdr-subagents-policy-self-check.mjs} \
          "$TMPDIR/package" "$TMPDIR/policy" ${managedImplementerFixture} ${managedOrchestratorFixture}
        pi --offline --no-extensions --no-skills --no-prompt-templates --no-context-files \
          -e "$package" \
          --list-models > pi.log 2>&1
        ! grep -E 'Extension issues|Failed to load extension|Cannot find module|Error:' pi.log
        touch $out
      '';

  supi-context-load =
    pkgs.runCommandLocal "supi-context-load" { nativeBuildInputs = [ expectedPackage ]; }
      ''
        export HOME="$TMPDIR/home"
        export PI_CODING_AGENT_DIR="$HOME/.pi/agent"
        export PI_TELEMETRY=0
        mkdir -p "$PI_CODING_AGENT_DIR"
        test -d ${expectedSupiContextPath}/node_modules/@mrclrchtr/supi-core
        test -d ${expectedSupiContextPath}/node_modules/typebox
        pi --offline --no-extensions --no-skills --no-prompt-templates --no-context-files \
          -e ${expectedSupiContextPath} \
          --list-models > pi.log 2>&1
        ! grep -E 'Extension issues|Failed to load extension|Cannot find module|Error:' pi.log
        test ! -e "$PI_CODING_AGENT_DIR/supi/config.json"
        touch $out
      '';

  supi-extras-load =
    pkgs.runCommandLocal "supi-extras-load"
      {
        nativeBuildInputs = [
          expectedPackage
          expectedOscclip
        ];
      }
      ''
        export HOME="$TMPDIR/home"
        export PI_CODING_AGENT_DIR="$HOME/.pi/agent"
        export PI_TELEMETRY=0
        mkdir -p "$PI_CODING_AGENT_DIR"
        test -d ${expectedSupiExtrasPath}/node_modules/@mrclrchtr/supi-core
        test ! -e ${expectedSupiExtrasPath}/node_modules/clipboardy
        grep -F 'spawn("osc-copy"' ${expectedSupiExtrasPath}/src/clipboard.ts
        ! grep -F 'import supiFooter' ${expectedSupiExtrasPath}/src/index.ts
        ! grep -F 'supiFooter(pi)' ${expectedSupiExtrasPath}/src/index.ts
        command -v osc-copy
        pi --offline --no-extensions --no-skills --no-prompt-templates --no-context-files \
          -e ${expectedSupiExtrasPath} \
          --list-models > pi.log 2>&1
        ! grep -E 'Extension issues|Failed to load extension|Cannot find module|Error:' pi.log
        test ! -e "$HOME/.pi/agent/supi/prompt-stash.json"
        touch $out
      '';

  prompt-templates =
    pkgs.runCommandLocal "pi-prompt-templates"
      {
        nativeBuildInputs = [
          expectedPackage
          pkgs.check-jsonschema
          pkgs.nodejs_22
        ];
      }
      ''
        set -- ${./config/prompts}/*.md
        test "$#" -eq 10
        ! grep -RE '^(model|thinking|chain|loop|subagent|deterministic):' ${./config/prompts}
        test "$(grep -RE '^skill: writing-for-agents$' ${./config/prompts} | wc -l)" -eq 1
        test ! -e ${./config/prompts}/setup-drain-agents.md
        grep -F 'do not load `~/.pi/agent/templates/drain/AGENTS.md` unless' \
          ${./config/prompts}/drain-wizard.md
        grep -F 'load_tools({ group: "subagents" })' ${./config/prompts}/drain-wizard.md
        grep -F '## Conditional materialization procedure' ${./config/templates/drain/AGENTS.md}
        grep -F 'continuous-bounded-rounds' ${./config/templates/drain/DRAIN-PROMPT.template.md}
        grep -F 'load_tools({ group: "subagents" })' ${./config/templates/drain/DRAIN-PROMPT.template.md}
        grep -F 'Notification failure is audited' ${./config/templates/drain/REFERENCE.md}
        test ! -e ${./config/skills}/grilling
        grep -F '**Small or short-lived app:** useful logs are enough.' \
          ${./config/skills}/telemetry-planning/SKILL.md
        grep -F '**Daemon or long-running app:** consider OpenTelemetry.' \
          ${./config/skills}/telemetry-planning/SKILL.md
        ! grep -F 'Stop asking questions when we reach a shared understanding and big decision was already made, because relatively smaller decisions would automatically derive.' \
          ${default.config.programs.pi-coding-agent.skills.grilling}/SKILL.md

        check-jsonschema --check-metaschema \
          ${./config/templates/drain/contract.schema.json} \
          ${./config/templates/drain/state-event.schema.json}
        check-jsonschema \
          --schemafile ${./config/templates/drain/contract.schema.json} \
          ${./config/templates/drain/contract.template.json}
        node -e '
          const fs = require("fs");
          const contract = JSON.parse(fs.readFileSync(process.argv[1]));
          contract.housekeeping.notifications = {
            notifierRef: "existing-notifier",
            destinationRef: "ops-channel",
            remindAfterSeconds: 7200,
            repeatEverySeconds: 86400,
            statuses: ["merge-request-open", "build-running"]
          };
          fs.writeFileSync(process.argv[2], JSON.stringify(contract));
        ' ${./config/templates/drain/contract.template.json} "$TMPDIR/notified-contract.json"
        check-jsonschema \
          --schemafile ${./config/templates/drain/contract.schema.json} \
          "$TMPDIR/notified-contract.json"
        export HOME="$TMPDIR/home"
        export PI_TELEMETRY=0
        mkdir -p "$HOME"
        pi --offline --no-extensions --no-skills --no-prompt-templates --no-context-files \
          -e ${expectedPromptTemplateModelPath} \
          --skill ${expectedWritingForAgents} \
          --prompt-template ${./config/prompts} \
          --list-models > pi.log 2>&1
        ! grep -E 'Extension issues|Failed to load extension|Cannot find module|Error:' pi.log

        touch $out
      '';
}
