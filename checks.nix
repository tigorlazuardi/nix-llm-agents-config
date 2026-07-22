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
    };
    programs.pi-coding-agent.keybindings."app.tools.expand" = "ctrl+e";
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
in
{
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
      };
    assert
      default.config.programs.pi-coding-agent.keybindings == {
        "app.tools.expand" = "ctrl+o";
        "tui.editor.cursorLeft" = "left";
      };
    assert default.config.programs.pi-coding-agent.models == { };
    assert default.config.programs.pi-coding-agent.context == ./config/AGENTS.md;
    assert
      default.config.home.file."${default.config.programs.pi-coding-agent.configDir}/AGENTS.md".source
      == ./config/AGENTS.md;
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
      !(disabled.config.home.file ? "${disabled.config.programs.pi-coding-agent.configDir}/prompts");
    assert
      !(
        disabled.config.home.file ? "${disabled.config.programs.pi-coding-agent.configDir}/templates/fleet"
      );
    assert overridden.config.programs.pi-coding-agent.package == overridePackage;
    assert builtins.elem overridePackage overridden.config.home.packages;
    assert settingsOverridden.config.programs.pi-coding-agent.settings.theme == "light";
    assert settingsOverridden.config.programs.pi-coding-agent.settings.retry.maxRetries == 3;
    assert
      settingsOverridden.config.programs.pi-coding-agent.keybindings == {
        "app.tools.expand" = "ctrl+e";
        "tui.editor.cursorLeft" = "left";
      };
    pkgs.runCommandLocal "pi-home-manager-module-evaluation" { } "touch $out";

  formatting =
    pkgs.runCommandLocal "pi-home-manager-formatting" { nativeBuildInputs = [ pkgs.nixfmt ]; }
      ''
        nixfmt --check ${./flake.nix} ${./checks.nix} ${./modules/pi-coding-agent.nix} ${./modules/pi-coding-agent/agents.nix} ${./modules/pi-coding-agent/default-agents.nix} ${./modules/pi-coding-agent/pi-subagents.nix}
        touch $out
      '';

  prompt-templates =
    pkgs.runCommandLocal "pi-prompt-templates" { nativeBuildInputs = [ pkgs.nodejs_22 ]; }
      ''
        set -- ${./config/prompts}/*.md
        test "$#" -eq 3
        ! grep -RE '^(model|skill|thinking|chain|loop|subagent|deterministic):' ${./config/prompts}
        mkdir -p run/dags/d1
        cp ${./config/templates/fleet/fleet.template.json} run/fleet.json
        cp ${./config/templates/fleet/state.template.json} run/dags/d1/state.json
        node ${./config/templates/fleet/validate.mjs} run
        touch $out
      '';
}
