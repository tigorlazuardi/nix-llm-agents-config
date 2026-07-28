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
  disabled = evaluate { programs.pi-coding-agent.enable = false; };
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
  optimizerActivation = optimizerConfigured.config.home.activation.piCodingAgentPixOptimizer.data;
  vccConfigured = evaluate {
    programs.pi-coding-agent.plugins.pi-vcc.settings = {
      overrideDefaultCompaction = false;
      smartKeepTail = false;
      continueAfterThresholdCompact = false;
      debug = true;
    };
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
      pi-mcp-adapter.enable = false;
      pix-optimizer.enable = false;
      pi-vcc.enable = false;
      pi-intercom.enable = false;
      pi-subagents = {
        enable = false;
        agents.missing = { };
      };
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
        tools = {
          allow = [
            "read"
            "custom-tool"
          ];
          noBuiltins = true;
        };
        skills = [ "demo" ];
        extensions = [ "demo" ];
      };
      plugins.pi-subagents.agents.custom = {
        async = false;
        defaultContext = "fork";
      };
    };
  };
  invalidPlugin = evaluate {
    programs.pi-coding-agent.plugins.pi-subagents.agents.missing = { };
  };
  invalidPluginEvaluation = builtins.tryEval (
    builtins.deepSeq invalidPlugin.config.home.activationPackage true
  );
  invalidDisabledMcp = evaluate { programs.mcp.servers.open-design.enabled = false; };
  invalidDisabledMcpEvaluation = builtins.tryEval (
    builtins.deepSeq invalidDisabledMcp.config.home.activationPackage true
  );
  expectedOrchestrator = ''
    ---
    name: orchestrator
    description: Deterministic black-box one-shot and fleet state machine
    tools: read, bash, subagent
    model: gpt-5.6-terra
    thinking: medium
    systemPromptMode: replace
    inheritProjectContext: true
    inheritSkills: false
    defaultContext: fresh
    async: true
    ---
    ${builtins.readFile ./config/agents/orchestrator.md}'';

  expectedPackage = nixpkgs-unstable.legacyPackages.x86_64-linux.pi-coding-agent;
  expectedDietLsp =
    nixpkgs-unstable.legacyPackages.x86_64-linux.callPackage ./packages/pi-diet-lsp.nix
      { };
  expectedDietLspPath = "${expectedDietLsp}";
  expectedEffort =
    nixpkgs-unstable.legacyPackages.x86_64-linux.callPackage ./packages/pi-effort.nix
      { };
  expectedEffortPath = "${expectedEffort}/lib/node_modules/@nehlis/pi-effort";
  expectedPiHerdr =
    nixpkgs-unstable.legacyPackages.x86_64-linux.callPackage ./packages/pi-herdr.nix
      { };
  expectedPiHerdrPath = "${expectedPiHerdr}/lib/node_modules/@ogulcancelik/pi-herdr";
  expectedHerdrSudoTask =
    nixpkgs-unstable.legacyPackages.x86_64-linux.callPackage ./packages/pi-herdr-sudo-task.nix
      { };
  expectedHerdrSudoTaskPath = "${expectedHerdrSudoTask}/lib/node_modules/pi-herdr-sudo-task";
  expectedAskHerdr =
    nixpkgs-unstable.legacyPackages.x86_64-linux.callPackage ./packages/pi-ask-herdr.nix
      { };
  expectedAskHerdrPath = "${expectedAskHerdr}/lib/node_modules/pi-ask-herdr";
  expectedHerdrRename =
    nixpkgs-unstable.legacyPackages.x86_64-linux.callPackage ./packages/pi-herdr-rename.nix
      { };
  expectedHerdrRenamePath = "${expectedHerdrRename}/lib/node_modules/pi-herdr-rename";
  expectedPattyBgTasks =
    nixpkgs-unstable.legacyPackages.x86_64-linux.callPackage ./packages/pi-patty-bg-tasks.nix
      { };
  expectedPattyBgTasksPath = "${expectedPattyBgTasks}/lib/node_modules/pi-patty-bg-tasks";
  expectedIntercom =
    nixpkgs-unstable.legacyPackages.x86_64-linux.callPackage ./packages/pi-intercom.nix
      { };
  expectedIntercomPath = "${expectedIntercom}/lib/node_modules/pi-intercom";
  expectedIntercomConfig = (pkgs.formats.json { }).generate "pi-intercom-config.json" {
    brokerCommand = "${expectedIntercomPath}/node_modules/.bin/tsx";
    brokerArgs = [ ];
    confirmSend = false;
    enabled = true;
    replyHint = true;
  };
  expectedVimMode =
    nixpkgs-unstable.legacyPackages.x86_64-linux.callPackage ./packages/pi-vimmode.nix
      { };
  expectedVimModePath = "${expectedVimMode}/lib/node_modules/pi-vimmode";
  expectedUsage =
    nixpkgs-unstable.legacyPackages.x86_64-linux.callPackage ./packages/pi-usage.nix
      { };
  expectedUsagePath = "${expectedUsage}/lib/node_modules/@narumitw/pi-usage";
  expectedMcpAdapter =
    nixpkgs-unstable.legacyPackages.x86_64-linux.callPackage ./packages/pi-mcp-adapter.nix
      { };
  expectedMcpAdapterPath = "${expectedMcpAdapter}/lib/node_modules/pi-mcp-adapter";
  expectedPlaywright =
    nixpkgs-unstable.legacyPackages.x86_64-linux.callPackage ./packages/pi-playwright.nix
      { };
  expectedPlaywrightPath = "${expectedPlaywright}/lib/node_modules/pi-playwright";
  expectedPixOptimizer =
    nixpkgs-unstable.legacyPackages.x86_64-linux.callPackage ./packages/pix-optimizer.nix
      { };
  expectedPixOptimizerPath = "${expectedPixOptimizer}/lib/node_modules/@xynogen/pix-optimizer";
  expectedPiVcc = nixpkgs-unstable.legacyPackages.x86_64-linux.callPackage ./packages/pi-vcc.nix { };
  expectedPiVccPath = "${expectedPiVcc}";
  expectedPromptTemplateModel =
    nixpkgs-unstable.legacyPackages.x86_64-linux.callPackage ./packages/pi-prompt-template-model.nix
      { };
  expectedPromptTemplateModelPath = "${expectedPromptTemplateModel}/lib/node_modules/pi-prompt-template-model";
  expectedRpivTodo =
    nixpkgs-unstable.legacyPackages.x86_64-linux.callPackage ./packages/rpiv-todo.nix
      { };
  expectedRpivTodoPath = "${expectedRpivTodo}/lib/node_modules/@juicesharp/rpiv-todo";
  expectedRules =
    nixpkgs-unstable.legacyPackages.x86_64-linux.callPackage ./packages/pi-rules.nix
      { };
  expectedRulesPath = "${expectedRules}/lib/node_modules/@tigorhutasuhut/pi-rules";
  expectedSearxng =
    nixpkgs-unstable.legacyPackages.x86_64-linux.callPackage ./packages/pi-searxng.nix
      { };
  expectedSearxngPath = "${expectedSearxng}/lib/node_modules/pi-searxng";
  expectedSubagents =
    nixpkgs-unstable.legacyPackages.x86_64-linux.callPackage ./packages/pi-subagents.nix
      { };
  expectedSubagentsPath = "${expectedSubagents}/lib/node_modules/pi-subagents";
  expectedSupiContext =
    nixpkgs-unstable.legacyPackages.x86_64-linux.callPackage ./packages/supi-context.nix
      { };
  expectedSupiContextPath = "${expectedSupiContext}/lib/node_modules/@mrclrchtr/supi-context";
  expectedSupiExtras =
    nixpkgs-unstable.legacyPackages.x86_64-linux.callPackage ./packages/supi-extras.nix
      { };
  expectedSupiExtrasPath = "${expectedSupiExtras}/lib/node_modules/@mrclrchtr/supi-extras";
  expectedOscclip = nixpkgs-unstable.legacyPackages.x86_64-linux.oscclip;
  expectedWritingGreatSkills = default.config.programs.pi-coding-agent.skills.writing-great-skills;
  secretWrappedMcpConfig =
    secretWrappedMcp.config.home.file."${secretWrappedMcp.config.programs.pi-coding-agent.configDir}/mcp.json".source;
in
{
  diet-lsp = expectedDietLsp;
  pi-effort = expectedEffort;
  pi-herdr = expectedPiHerdr;
  pi-herdr-sudo-task = expectedHerdrSudoTask;
  pi-ask-herdr = expectedAskHerdr;
  pi-herdr-rename = expectedHerdrRename;
  pi-patty-bg-tasks = expectedPattyBgTasks;
  pi-intercom = expectedIntercom;
  pi-vimmode = expectedVimMode;
  pi-usage = expectedUsage;
  mcp-adapter = expectedMcpAdapter;
  playwright = expectedPlaywright;
  pix-optimizer = expectedPixOptimizer;
  pi-vcc = expectedPiVcc;
  prompt-template-model = expectedPromptTemplateModel;
  rpiv-todo = expectedRpivTodo;
  rules = expectedRules;
  searxng = expectedSearxng;
  subagents = expectedSubagents;
  supi-context = expectedSupiContext;
  supi-extras = expectedSupiExtras;

  module-evaluation =
    assert default.config.programs.pi-coding-agent.enable;
    assert !disabled.config.programs.pi-coding-agent.enable;
    assert default.config.programs.pi-coding-agent.package == expectedPackage;
    assert
      default.config.programs.pi-coding-agent.settings == {
        defaultThinkingLevel = "medium";
        quietStartup = true;
        theme = "dark";
        hideThinkingBlock = false;
        showCacheMissNotices = false;
        packages = [
          expectedDietLspPath
          expectedEffortPath
          expectedPiHerdrPath
          expectedHerdrSudoTaskPath
          expectedAskHerdrPath
          expectedHerdrRenamePath
          expectedPattyBgTasksPath
          expectedIntercomPath
          expectedVimModePath
          expectedUsagePath
          expectedMcpAdapterPath
          expectedPlaywrightPath
          expectedPixOptimizerPath
          expectedPiVccPath
          expectedPromptTemplateModelPath
          expectedRpivTodoPath
          expectedRulesPath
          expectedSearxngPath
          expectedSubagentsPath
          expectedSupiContextPath
          expectedSupiExtrasPath
        ];
      };
    assert builtins.elem expectedOscclip default.config.home.packages;
    assert
      default.config.home.file."${default.config.programs.pi-coding-agent.configDir}/intercom/config.json".source
      == expectedIntercomConfig;
    assert !(default.config.home.sessionVariables ? C2C_BIN);
    assert
      default.config.programs.pi-coding-agent.keybindings == {
        "app.tools.expand" = "ctrl+o";
        "tui.editor.cursorLeft" = "left";
      };
    assert default.config.programs.pi-coding-agent.models == { };
    assert default.config.programs.pi-coding-agent.context == ./config/AGENTS.md;
    assert default.config.programs.pi-coding-agent.plugins.pi-mcp-adapter.enable;
    assert default.config.programs.pi-coding-agent.plugins.pi-mcp-adapter.enableMcpIntegration;
    assert default.config.programs.pi-coding-agent.plugins.pi-vcc.enable;
    assert default.config.programs.pi-coding-agent.plugins.pix-optimizer.enable;
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
    assert pkgs.lib.hasInfix (builtins.unsafeDiscardStringContext "${expectedOptimizerStateFile}") (
      builtins.unsafeDiscardStringContext optimizerActivation
    );
    assert pkgs.lib.hasInfix "/home/test/.pi/agent/optimizer.json" optimizerActivation;
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
    assert
      vccConfigured.config.home.sessionVariables.PI_VCC_CONFIG_PATH
      == "/home/test/.pi/agent/pi-vcc-config.json";
    assert default.config.programs.mcp.enable;
    assert default.config.programs.mcp.servers.open-design.command == "od";
    assert
      default.config.programs.mcp.servers.open-design.args == [
        "mcp"
        "--daemon-url"
        "https://open-design.tigor.web.id"
      ];
    assert
      default.config.home.file."${default.config.programs.pi-coding-agent.configDir}/AGENTS.md".source
      == ./config/AGENTS.md;
    assert builtins.pathExists (
      default.config.programs.pi-coding-agent.skills.writing-great-skills + "/SKILL.md"
    );
    assert
      default.config.home.file."${default.config.programs.pi-coding-agent.configDir}/skills/writing-great-skills".source
      == default.config.programs.pi-coding-agent.skills.writing-great-skills;
    assert builtins.length (builtins.attrNames default.config.programs.pi-coding-agent.agents) == 10;
    assert
      default.config.home.file."${default.config.programs.pi-coding-agent.configDir}/agents/orchestrator.md".text
      == expectedOrchestrator;
    assert
      resolvedAgent.config.home.file."${resolvedAgent.config.programs.pi-coding-agent.configDir}/agents/custom.md".text
      == ''
        ---
        name: custom
        description: Resolver check
        tools: custom-tool
        skills: demo
        extensions: ${toString ./config/AGENTS.md}
        defaultContext: fork
        async: false
        ---
        Custom prompt.'';
    assert
      resolvedAgent.config.home.file."${resolvedAgent.config.programs.pi-coding-agent.configDir}/skills/demo".source
      == ./config/agents;
    assert !invalidPluginEvaluation.success;
    assert !invalidDisabledMcpEvaluation.success;
    assert
      default.config.home.file."${default.config.programs.pi-coding-agent.configDir}/prompts".source
      == ./config/prompts;
    assert
      default.config.home.file."${default.config.programs.pi-coding-agent.configDir}/prompts".force;
    assert
      default.config.home.file."${default.config.programs.pi-coding-agent.configDir}/templates/fleet".source
      == ./config/templates/fleet;
    assert
      default.config.home.file."${default.config.programs.pi-coding-agent.configDir}/templates/fleet".force;
    assert
      default.config.home.file."${default.config.programs.pi-coding-agent.configDir}/templates/drain".source
      == ./config/templates/drain;
    assert
      default.config.home.file."${default.config.programs.pi-coding-agent.configDir}/templates/drain".force;
    assert default.config.home.file ? "${default.config.programs.pi-coding-agent.configDir}/mcp.json";
    assert default.config.xdg.configFile ? "mcp/mcp.json";
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
    assert !(disabled.config.home.activation ? piCodingAgentPixOptimizer);
    assert !(disabled.config.home.sessionVariables ? C2C_BIN);
    assert
      !(
        disabled.config.home.file
        ? "${disabled.config.programs.pi-coding-agent.configDir}/intercom/config.json"
      );
    assert !(disabled.config.home.sessionVariables ? PI_VCC_CONFIG_PATH);
    assert
      !(
        disabled.config.home.file
        ? "${disabled.config.programs.pi-coding-agent.configDir}/skills/writing-great-skills"
      );
    assert
      !(disabled.config.home.file ? "${disabled.config.programs.pi-coding-agent.configDir}/prompts");
    assert
      !(
        disabled.config.home.file ? "${disabled.config.programs.pi-coding-agent.configDir}/templates/fleet"
      );
    assert
      !(
        disabled.config.home.file ? "${disabled.config.programs.pi-coding-agent.configDir}/templates/drain"
      );
    assert
      !(builtins.elem expectedMcpAdapterPath pluginsDisabled.config.programs.pi-coding-agent.settings.packages);
    assert
      !(builtins.elem expectedPixOptimizerPath pluginsDisabled.config.programs.pi-coding-agent.settings.packages);
    assert
      !(builtins.elem expectedPiVccPath pluginsDisabled.config.programs.pi-coding-agent.settings.packages);
    assert
      !(builtins.elem expectedIntercomPath pluginsDisabled.config.programs.pi-coding-agent.settings.packages);
    assert
      !(builtins.elem expectedSubagentsPath pluginsDisabled.config.programs.pi-coding-agent.settings.packages);
    assert
      !(builtins.elem expectedRpivTodoPath pluginsDisabled.config.programs.pi-coding-agent.settings.packages);
    assert
      !(
        pluginsDisabled.config.home.file
        ? "${pluginsDisabled.config.programs.pi-coding-agent.configDir}/mcp.json"
      );
    assert !(pluginsDisabled.config.home.activation ? piCodingAgentPixOptimizer);
    assert !(pluginsDisabled.config.home.sessionVariables ? PI_VCC_CONFIG_PATH);
    assert
      !(
        pluginsDisabled.config.home.file
        ? "${pluginsDisabled.config.programs.pi-coding-agent.configDir}/pi-vcc-config.json"
      );
    assert
      !(
        pluginsDisabled.config.home.file
        ? "${pluginsDisabled.config.programs.pi-coding-agent.configDir}/intercom/config.json"
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
        expectedDietLspPath
        expectedEffortPath
        expectedPiHerdrPath
        expectedHerdrSudoTaskPath
        expectedAskHerdrPath
        expectedHerdrRenamePath
        expectedPattyBgTasksPath
        expectedIntercomPath
        expectedVimModePath
        expectedUsagePath
        expectedMcpAdapterPath
        expectedPlaywrightPath
        expectedPixOptimizerPath
        expectedPiVccPath
        expectedPromptTemplateModelPath
        expectedRpivTodoPath
        expectedRulesPath
        expectedSearxngPath
        expectedSubagentsPath
        expectedSupiContextPath
        expectedSupiExtrasPath
      ];
    assert
      settingsOverridden.config.programs.pi-coding-agent.keybindings == {
        "app.tools.expand" = "ctrl+e";
        "tui.editor.cursorLeft" = "left";
      };
    pkgs.runCommandLocal "pi-home-manager-module-evaluation" { } "touch $out";

  formatting =
    pkgs.runCommandLocal "pi-home-manager-formatting" { nativeBuildInputs = [ pkgs.nixfmt ]; }
      ''
        nixfmt --check ${./flake.nix} ${./checks.nix} ${./modules/pi-coding-agent.nix} ${./modules/pi-coding-agent/agents.nix} ${./modules/pi-coding-agent/default-agents.nix} ${./modules/pi-coding-agent/pi-subagents.nix} ${./packages/pi-diet-lsp.nix} ${./packages/pi-effort.nix} ${./packages/pi-herdr.nix} ${./packages/pi-herdr-sudo-task.nix} ${./packages/pi-ask-herdr.nix} ${./packages/pi-herdr-rename.nix} ${./packages/pi-patty-bg-tasks.nix} ${./packages/pi-intercom.nix} ${./packages/pi-vimmode.nix} ${./packages/pi-usage.nix} ${./packages/pi-mcp-adapter.nix} ${./packages/pi-playwright.nix} ${./packages/pix-optimizer.nix} ${./packages/pi-vcc.nix} ${./packages/pi-prompt-template-model.nix} ${./packages/rpiv-todo.nix} ${./packages/pi-rules.nix} ${./packages/pi-searxng.nix} ${./packages/pi-subagents.nix} ${./packages/supi-context.nix} ${./packages/supi-extras.nix}
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

  pi-intercom-load =
    pkgs.runCommandLocal "pi-intercom-load"
      {
        nativeBuildInputs = [
          expectedPackage
          pkgs.jq
        ];
      }
      ''
        export HOME="$TMPDIR/home"
        export PI_CODING_AGENT_DIR="$HOME/.pi/agent"
        export PI_TELEMETRY=0
        mkdir -p "$PI_CODING_AGENT_DIR/intercom"
        test -f ${expectedIntercomPath}/index.ts
        test -f ${expectedIntercomPath}/broker/broker.ts
        test -x ${expectedIntercomPath}/node_modules/.bin/tsx
        test -d ${expectedIntercomPath}/node_modules/typebox
        test ! -e ${expectedIntercomPath}/node_modules/@mariozechner
        jq -e '.enabled == true and .replyHint == true and .confirmSend == false and .brokerArgs == [] and has("status") | not' ${expectedIntercomConfig}
        jq -e '.brokerCommand == "${expectedIntercomPath}/node_modules/.bin/tsx"' ${expectedIntercomConfig}
        cp ${expectedIntercomConfig} "$PI_CODING_AGENT_DIR/intercom/config.json"
        pi --offline --no-extensions --no-skills --no-prompt-templates --no-context-files \
          -e ${expectedIntercomPath} \
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
        jq -e '.mcpServers["open-design"].command == "od"' "$mcp_config"
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

  playwright-load =
    pkgs.runCommandLocal "pi-playwright-load"
      {
        nativeBuildInputs = [
          expectedPackage
          pkgs.nodejs
        ];
      }
      ''
        export HOME="$TMPDIR/home"
        export PI_CODING_AGENT_DIR="$HOME/.pi/agent"
        export PI_PLAYWRIGHT_ARTIFACTS="$TMPDIR/artifacts"
        export PI_TELEMETRY=0
        export PLAYWRIGHT_CLI_SESSION=nix-check
        export PLAYWRIGHT_MCP_HEADLESS=true
        mkdir -p "$PI_CODING_AGENT_DIR"

        skill=${expectedPlaywrightPath}/skills/playwright-browser
        test "$(node "$skill/scripts/artifact-dir.js")" = "$PI_PLAYWRIGHT_ARTIFACTS"
        node "$skill/scripts/pw.js" open about:blank
        node "$skill/scripts/pw.js" close

        pi --offline --no-extensions --no-skills --no-prompt-templates --no-context-files \
          --skill "$skill" \
          --list-models > pi.log 2>&1
        ! grep -E 'Extension issues|Failed to load extension|Cannot find module|Error:' pi.log
        touch $out
      '';

  pix-optimizer-load =
    pkgs.runCommandLocal "pix-optimizer-load" { nativeBuildInputs = [ expectedPackage ]; }
      ''
        export HOME="$TMPDIR/home"
        export PI_CODING_AGENT_DIR="$HOME/.pi/agent"
        export PI_TELEMETRY=0
        mkdir -p "$PI_CODING_AGENT_DIR"
        test -f ${expectedPixOptimizerPath}/src/index.ts
        test -f ${expectedPixOptimizerPath}/node_modules/@xynogen/pix-pretty/src/modal-frame.ts
        test ! -e ${expectedPixOptimizerPath}/node_modules/@xynogen/pix-pretty/node_modules
        cat > "$PI_CODING_AGENT_DIR/settings.json" <<EOF
        {"packages":["${expectedPixOptimizerPath}"]}
        EOF
        pi --offline --no-prompt-templates --no-context-files \
          --list-models > pi.log 2>&1
        ! grep -E 'Extension issues|Failed to load extension|Cannot find module|Error:' pi.log
        test ! -e "$PI_CODING_AGENT_DIR/optimizer.json"
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
    grep -F '"overrideDefaultCompaction": false' "$PI_VCC_CONFIG_PATH"
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
    test -d ${expectedRulesPath}/node_modules/yaml
    pi --offline --no-extensions --no-skills --no-prompt-templates --no-context-files \
      -e ${expectedRulesPath} \
      --list-models > pi.log 2>&1
    ! grep -E 'Extension issues|Failed to load extension|Cannot find module|Error:' pi.log
    touch $out
  '';

  searxng-load =
    pkgs.runCommandLocal "pi-searxng-load" { nativeBuildInputs = [ expectedPackage ]; }
      ''
        export HOME="$TMPDIR/home"
        export PI_CODING_AGENT_DIR="$HOME/.pi/agent"
        export PI_TELEMETRY=0
        mkdir -p "$PI_CODING_AGENT_DIR"
        pi --offline --no-extensions --no-skills --no-prompt-templates --no-context-files \
          -e ${expectedSearxngPath} \
          --list-models > pi.log 2>&1
        ! grep -E 'Extension issues|Failed to load extension|Cannot find module|Error:' pi.log
        touch $out
      '';

  subagents-load =
    pkgs.runCommandLocal "pi-subagents-load" { nativeBuildInputs = [ expectedPackage ]; }
      ''
        export HOME="$TMPDIR/home"
        export PI_CODING_AGENT_DIR="$HOME/.pi/agent"
        export PI_TELEMETRY=0
        mkdir -p "$PI_CODING_AGENT_DIR"
        test -d ${expectedSubagentsPath}/node_modules/jiti
        test -d ${expectedSubagentsPath}/node_modules/yaml
        pi --offline --no-extensions --no-skills --no-prompt-templates --no-context-files \
          -e ${expectedSubagentsPath} \
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
        test "$#" -eq 6
        ! grep -RE '^(model|thinking|chain|loop|subagent|deterministic):' ${./config/prompts}
        test "$(grep -RE '^skill: writing-great-skills$' ${./config/prompts} | wc -l)" -eq 2

        check-jsonschema --check-metaschema \
          ${./config/templates/drain/contract.schema.json} \
          ${./config/templates/drain/state-event.schema.json}
        check-jsonschema \
          --schemafile ${./config/templates/drain/contract.schema.json} \
          ${./config/templates/drain/contract.template.json}

        export HOME="$TMPDIR/home"
        export PI_TELEMETRY=0
        mkdir -p "$HOME"
        pi --offline --no-extensions --no-skills --no-prompt-templates --no-context-files \
          -e ${expectedPromptTemplateModelPath} \
          --skill ${expectedWritingGreatSkills} \
          --prompt-template ${./config/prompts} \
          --list-models > pi.log 2>&1
        ! grep -E 'Extension issues|Failed to load extension|Cannot find module|Error:' pi.log

        mkdir -p run/dags/d1
        cp ${./config/templates/fleet/fleet.template.json} run/fleet.json
        cp ${./config/templates/fleet/state.template.json} run/dags/d1/state.json
        node ${./config/templates/fleet/validate.mjs} run
        touch $out
      '';
}
