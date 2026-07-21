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
in
{
  programs.pi-coding-agent = {
    enable = lib.mkDefault true;
    package = lib.mkIf cfg.enable (lib.mkDefault pinnedPkgs.pi-coding-agent);
  };
}
