{
  config,
  lib,
  ...
}:
let
  cfg = config.programs.pi-coding-agent;
  defaultAgents = import ./default-agents.nix;
in
{
  options.programs.pi-coding-agent = {
    agents = lib.mkOption {
      type = lib.types.attrsOf (
        lib.types.submodule {
          options = {
            description = lib.mkOption { type = lib.types.str; };
            prompt = lib.mkOption { type = lib.types.either lib.types.lines lib.types.path; };
            model = lib.mkOption {
              type = lib.types.nullOr lib.types.str;
              default = null;
            };
            effort = lib.mkOption {
              type = lib.types.nullOr lib.types.str;
              default = null;
            };
            tools = lib.mkOption {
              default = { };
              type = lib.types.submodule {
                options = {
                  allow = lib.mkOption {
                    type = lib.types.nullOr (lib.types.listOf lib.types.str);
                    default = null;
                  };
                  exclude = lib.mkOption {
                    type = lib.types.nullOr (lib.types.listOf lib.types.str);
                    default = null;
                  };
                  noBuiltins = lib.mkOption {
                    type = lib.types.nullOr lib.types.bool;
                    default = null;
                  };
                };
              };
            };
            skills = lib.mkOption {
              type = lib.types.nullOr (lib.types.listOf lib.types.str);
              default = null;
            };
            extensions = lib.mkOption {
              type = lib.types.nullOr (lib.types.listOf lib.types.str);
              default = null;
            };
          };
        }
      );
      default = { };
      description = "Portable Pi agent definitions keyed by runtime name.";
    };

    skills = lib.mkOption {
      type = lib.types.attrsOf lib.types.path;
      default = { };
      description = "Named skill paths available to agent definitions.";
    };

    extensions = lib.mkOption {
      type = lib.types.attrsOf lib.types.path;
      default = { };
      description = "Named extension paths resolved by plugin adapters.";
    };
  };

  config = {
    programs.pi-coding-agent.agents = lib.mapAttrsRecursive (_: lib.mkDefault) defaultAgents;

    home.file = lib.mkIf cfg.enable (
      lib.mapAttrs' (
        name: path: lib.nameValuePair "${cfg.configDir}/skills/${name}" { source = path; }
      ) cfg.skills
    );
  };
}
