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
  expectedWritingGreatSkills = default.config.programs.pi-coding-agent.skills.writing-great-skills;
  secretWrappedMcpConfig =
    secretWrappedMcp.config.home.file."${secretWrappedMcp.config.programs.pi-coding-agent.configDir}/mcp.json".source;
in
{
  diet-lsp = expectedDietLsp;
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
        ];
      };
    assert
      default.config.programs.pi-coding-agent.keybindings == {
        "app.tools.expand" = "ctrl+o";
        "tui.editor.cursorLeft" = "left";
      };
    assert default.config.programs.pi-coding-agent.models == { };
    assert default.config.programs.pi-coding-agent.context == ./config/AGENTS.md;
    assert default.config.programs.pi-coding-agent.plugins.pi-mcp-adapter.enableMcpIntegration;
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
    assert overridden.config.programs.pi-coding-agent.package == overridePackage;
    assert builtins.elem overridePackage overridden.config.home.packages;
    assert settingsOverridden.config.programs.pi-coding-agent.settings.theme == "light";
    assert settingsOverridden.config.programs.pi-coding-agent.settings.retry.maxRetries == 3;
    assert
      settingsOverridden.config.programs.pi-coding-agent.settings.packages == [
        expectedDietLspPath
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
        nixfmt --check ${./flake.nix} ${./checks.nix} ${./modules/pi-coding-agent.nix} ${./modules/pi-coding-agent/agents.nix} ${./modules/pi-coding-agent/default-agents.nix} ${./modules/pi-coding-agent/pi-subagents.nix} ${./packages/pi-diet-lsp.nix} ${./packages/pi-mcp-adapter.nix} ${./packages/pi-playwright.nix} ${./packages/pix-optimizer.nix} ${./packages/pi-vcc.nix} ${./packages/pi-prompt-template-model.nix} ${./packages/rpiv-todo.nix} ${./packages/pi-rules.nix} ${./packages/pi-searxng.nix} ${./packages/pi-subagents.nix} ${./packages/supi-context.nix}
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
