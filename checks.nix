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
        nixfmt --check ${./flake.nix} ${./checks.nix} ${./modules/pi-coding-agent.nix}
        touch $out
      '';
}
