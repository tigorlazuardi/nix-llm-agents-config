{
  description = "Declarative Pi Home Manager configuration";

  inputs = {
    nixpkgs-unstable.url = "github:NixOS/nixpkgs/nixos-unstable";
    mattpocock-skills = {
      url = "github:mattpocock/skills";
      flake = false;
    };

    home-manager = {
      url = "github:nix-community/home-manager";
      inputs.nixpkgs.follows = "nixpkgs-unstable";
    };
  };

  outputs =
    {
      nixpkgs-unstable,
      home-manager,
      mattpocock-skills,
      ...
    }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs-unstable.legacyPackages.${system};
      piModule = import ./modules/pi-coding-agent.nix {
        inherit mattpocock-skills nixpkgs-unstable;
      };
    in
    {
      homeManagerModules.default = piModule;

      checks.${system} = import ./checks.nix {
        inherit
          home-manager
          nixpkgs-unstable
          piModule
          pkgs
          ;
      };

      formatter.${system} = pkgs.nixfmt;
    };
}
