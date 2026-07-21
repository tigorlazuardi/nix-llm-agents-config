{ nixpkgs-unstable }:
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.programs.pi-coding-agent;
  pinnedPkgs = nixpkgs-unstable.legacyPackages.${pkgs.stdenv.hostPlatform.system};
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
in
{
  programs.pi-coding-agent = {
    enable = lib.mkDefault true;
    package = lib.mkIf cfg.enable (lib.mkDefault pinnedPkgs.pi-coding-agent);
    settings = lib.mapAttrsRecursive (_: lib.mkDefault) defaultSettings;
    keybindings = lib.mapAttrsRecursive (_: lib.mkDefault) defaultKeybindings;
  };
}
