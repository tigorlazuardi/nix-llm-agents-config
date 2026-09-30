{
  description = "Declarative Pi Home Manager configuration";

  inputs = {
    nixpkgs-unstable.url = "github:NixOS/nixpkgs/nixos-unstable";
    mattpocock-skills = {
      url = "github:mattpocock/skills";
      flake = false;
    };

    pi-messaging-relay.url = "github:tigorlazuardi/pi-messaging-relay";

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
      pi-messaging-relay,
      ...
    }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-darwin"
      ];
      forAllSystems =
        f:
        builtins.listToAttrs (
          map (system: {
            name = system;
            value = f system;
          }) systems
        );
      piModule = import ./modules/pi-coding-agent.nix {
        inherit mattpocock-skills nixpkgs-unstable pi-messaging-relay;
      };
    in
    {
      homeManagerModules.default = piModule;

      checks = forAllSystems (
        system:
        import ./checks.nix {
          inherit
            home-manager
            nixpkgs-unstable
            piModule
            ;
          pkgs = nixpkgs-unstable.legacyPackages.${system};
        }
      );

      formatter = forAllSystems (system: nixpkgs-unstable.legacyPackages.${system}.nixfmt);
    };
}
