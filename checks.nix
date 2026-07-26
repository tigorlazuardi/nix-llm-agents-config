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
  expectedMcpAdapter =
    nixpkgs-unstable.legacyPackages.x86_64-linux.callPackage ./packages/pi-mcp-adapter.nix
      { };
  expectedMcpAdapterPath = "${expectedMcpAdapter}/lib/node_modules/pi-mcp-adapter";
  expectedPromptTemplateModel =
    nixpkgs-unstable.legacyPackages.x86_64-linux.callPackage ./packages/pi-prompt-template-model.nix
      { };
  expectedPromptTemplateModelPath = "${expectedPromptTemplateModel}/lib/node_modules/pi-prompt-template-model";
  expectedSearxng =
    nixpkgs-unstable.legacyPackages.x86_64-linux.callPackage ./packages/pi-searxng.nix
      { };
  expectedSearxngPath = "${expectedSearxng}/lib/node_modules/pi-searxng";
  expectedWritingGreatSkills = default.config.programs.pi-coding-agent.skills.writing-great-skills;
  secretWrappedMcpConfig =
    secretWrappedMcp.config.home.file."${secretWrappedMcp.config.programs.pi-coding-agent.configDir}/mcp.json".source;
in
{
  mcp-adapter = expectedMcpAdapter;
  prompt-template-model = expectedPromptTemplateModel;
  searxng = expectedSearxng;

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
          expectedMcpAdapterPath
          expectedPromptTemplateModelPath
          expectedSearxngPath
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
    assert !(disabled.config.xdg.configFile ? "mcp/mcp.json");
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
        expectedMcpAdapterPath
        expectedPromptTemplateModelPath
        expectedSearxngPath
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
        nixfmt --check ${./flake.nix} ${./checks.nix} ${./modules/pi-coding-agent.nix} ${./modules/pi-coding-agent/agents.nix} ${./modules/pi-coding-agent/default-agents.nix} ${./modules/pi-coding-agent/pi-subagents.nix} ${./packages/pi-mcp-adapter.nix} ${./packages/pi-prompt-template-model.nix} ${./packages/pi-searxng.nix}
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
