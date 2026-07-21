{
  description = "Declarative Pi Home Manager configuration";

  inputs = {
    nixpkgs-unstable.url = "github:NixOS/nixpkgs/nixos-unstable";

    home-manager = {
      url = "github:nix-community/home-manager";
      inputs.nixpkgs.follows = "nixpkgs-unstable";
    };
  };

  outputs =
    { nixpkgs-unstable, home-manager, ... }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs-unstable.legacyPackages.${system};
      piModule = import ./modules/pi-coding-agent.nix { inherit nixpkgs-unstable; };
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
