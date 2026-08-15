{
  config,
  lib,
  ...
}:
let
  cfg = config.programs.pi-coding-agent;
  defaultAgents = import ./default-agents.nix;
  builtinTools = [
    "read"
    "bash"
    "edit"
    "write"
    "grep"
    "find"
    "ls"
  ];

  pluginEnabled = cfg.enable && cfg.plugins.pi-herdr-subagents.enable;
  pluginAgents = cfg.plugins.pi-herdr-subagents.agents;
  pluginAgentNames = builtins.attrNames pluginAgents;
  unknownPluginAgents = builtins.filter (name: !(builtins.hasAttr name cfg.agents)) pluginAgentNames;
  renderablePluginAgents = lib.filterAttrs (name: _: builtins.hasAttr name cfg.agents) pluginAgents;
  renderablePluginAgentNames = builtins.attrNames renderablePluginAgents;

  resolveTools =
    agent: if agent.tools.allow == null then [ ] else lib.intersectLists builtinTools agent.tools.allow;
  resolveModel =
    model: if lib.hasInfix "/" model then model else "${cfg.settings.defaultProvider}/${model}";
  referencedSkills = lib.concatMap (
    name: if cfg.agents.${name}.skills == null then [ ] else cfg.agents.${name}.skills
  ) renderablePluginAgentNames;
  unknownSkills = builtins.filter (name: !(builtins.hasAttr name cfg.skills)) referencedSkills;
  invalidToolLists = builtins.filter (
    name: cfg.agents.${name}.tools.allow == null || resolveTools cfg.agents.${name} == [ ]
  ) renderablePluginAgentNames;

  renderAgent =
    name:
    let
      agent = cfg.agents.${name};
      plugin = pluginAgents.${name};
      prompt = if builtins.isPath agent.prompt then builtins.readFile agent.prompt else agent.prompt;
      lines = [
        "---"
        "name: ${builtins.toJSON name}"
        "description: ${builtins.toJSON agent.description}"
      ]
      ++ lib.optional (agent.model != null) "model: ${builtins.toJSON (resolveModel agent.model)}"
      ++ lib.optional (agent.effort != null) "thinking: ${builtins.toJSON agent.effort}"
      ++ [
        "tools: ${builtins.toJSON (lib.concatStringsSep ", " (resolveTools agent))}"
        "system-prompt: replace"
        "session-mode: ${plugin.sessionMode}"
        "spawning: ${lib.boolToString plugin.spawning}"
        "auto-exit: ${lib.boolToString plugin.autoExit}"
      ]
      ++ lib.optional (
        agent.skills != null
      ) "skills: ${builtins.toJSON (lib.concatStringsSep ", " agent.skills)}"
      ++ lib.optional (plugin.interactive != null) "interactive: ${lib.boolToString plugin.interactive}"
      ++ [ "---" ];
    in
    lib.concatStringsSep "\n" lines + "\n" + prompt;
in
{
  options.programs.pi-coding-agent.plugins.pi-herdr-subagents.agents = lib.mkOption {
    type = lib.types.attrsOf (
      lib.types.submodule {
        options = {
          sessionMode = lib.mkOption {
            type = lib.types.enum [
              "standalone"
              "lineage-only"
              "fork"
            ];
            default = "standalone";
          };
          spawning = lib.mkOption {
            type = lib.types.bool;
            default = false;
          };
          autoExit = lib.mkOption {
            type = lib.types.bool;
            default = true;
          };
          interactive = lib.mkOption {
            type = lib.types.nullOr lib.types.bool;
            default = null;
          };
        };
      }
    );
    default = { };
    description = "Portable agents exposed to the non-scoped pi-herdr-subagents plugin.";
  };

  config = lib.mkIf pluginEnabled {
    assertions = [
      {
        assertion = unknownPluginAgents == [ ];
        message = "pi-herdr-subagents agents must exist in programs.pi-coding-agent.agents: ${lib.concatStringsSep ", " unknownPluginAgents}";
      }
      {
        assertion = unknownSkills == [ ];
        message = "Pi agents reference undefined skills: ${lib.concatStringsSep ", " unknownSkills}";
      }
      {
        assertion = invalidToolLists == [ ];
        message = "pi-herdr-subagents agents require at least one native Pi tool: ${lib.concatStringsSep ", " invalidToolLists}";
      }
    ];

    warnings =
      lib.mapAttrsToList
        (
          name: _:
          "pi-herdr-subagents agent ${name}: extensions and tools.exclude are not supported by this plugin"
        )
        (
          lib.filterAttrs (
            name: _: cfg.agents.${name}.extensions != null || cfg.agents.${name}.tools.exclude != null
          ) renderablePluginAgents
        );

    programs.pi-coding-agent.plugins.pi-herdr-subagents.agents =
      lib.mapAttrsRecursive (_: lib.mkDefault)
        (
          lib.genAttrs (builtins.attrNames defaultAgents) (name: {
            spawning = name == "orchestrator";
          })
        );

    home.file = lib.mapAttrs' (
      name: _: lib.nameValuePair "${cfg.configDir}/agents/${name}.md" { text = renderAgent name; }
    ) renderablePluginAgents;
  };
}
