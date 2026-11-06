{
  config,
  lib,
  ...
}:
let
  cfg = config.programs.pi-coding-agent;
  defaultAgents = import ./default-agents.nix;
  supportedTools = [
    "read"
    "bash"
    "edit"
    "write"
    "grep"
    "find"
    "ls"
    "subagent"
  ];

  pluginEnabled = cfg.enable && cfg.plugins.pi-herdr-agents.enable;
  pluginAgents = cfg.plugins.pi-herdr-agents.agents;
  pluginAgentNames = builtins.attrNames pluginAgents;
  unknownPluginAgents = builtins.filter (name: !(builtins.hasAttr name cfg.agents)) pluginAgentNames;
  renderablePluginAgents = lib.filterAttrs (name: _: builtins.hasAttr name cfg.agents) pluginAgents;
  renderablePluginAgentNames = builtins.attrNames renderablePluginAgents;

  resolveTools =
    agent:
    if agent.tools.allow == null then [ ] else lib.intersectLists supportedTools agent.tools.allow;
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
      # 3.7.2's frontmatter reader does not unquote values: a quoted name, model
      # or thinking level arrives with literal quotes and breaks role lookup and
      # model resolution, and tools/skills are capability scalars that reject
      # quotes outright. So every launch-relevant value is emitted as an
      # unquoted plain scalar. Only description stays JSON-quoted: it is not
      # parsed for behavior and may carry newlines and `#`.
      lines = [
        "---"
        "name: ${name}"
        "description: ${builtins.toJSON agent.description}"
      ]
      ++ lib.optional (agent.model != null) "model: ${resolveModel agent.model}"
      ++ lib.optional (agent.effort != null) "thinking: ${agent.effort}"
      ++ [
        "tools: ${lib.concatStringsSep ", " (resolveTools agent)}"
        "system-prompt: replace"
        "session-mode: ${plugin.sessionMode}"
        "spawning: ${lib.boolToString plugin.spawning}"
        "auto-exit: ${lib.boolToString plugin.autoExit}"
      ]
      ++ lib.optional (agent.skills != null) "skills: ${lib.concatStringsSep ", " agent.skills}"
      ++ lib.optional (plugin.interactive != null) "interactive: ${lib.boolToString plugin.interactive}"
      ++ [ "---" ];
    in
    lib.concatStringsSep "\n" lines + "\n" + prompt;
in
{
  options.programs.pi-coding-agent.plugins.pi-herdr-agents.agents = lib.mkOption {
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
    description = "Portable agents exposed to the non-scoped pi-herdr-agents plugin.";
  };

  config = lib.mkIf pluginEnabled {
    assertions = [
      {
        assertion = unknownPluginAgents == [ ];
        message = "pi-herdr-agents agents must exist in programs.pi-coding-agent.agents: ${lib.concatStringsSep ", " unknownPluginAgents}";
      }
      {
        assertion = unknownSkills == [ ];
        message = "Pi agents reference undefined skills: ${lib.concatStringsSep ", " unknownSkills}";
      }
      {
        assertion = invalidToolLists == [ ];
        message = "pi-herdr-agents agents require at least one native Pi tool: ${lib.concatStringsSep ", " invalidToolLists}";
      }
    ];

    warnings =
      lib.mapAttrsToList
        (
          name: _:
          "pi-herdr-agents agent ${name}: extensions and tools.exclude are not supported by this plugin"
        )
        (
          lib.filterAttrs (
            name: _: cfg.agents.${name}.extensions != null || cfg.agents.${name}.tools.exclude != null
          ) renderablePluginAgents
        );

    programs.pi-coding-agent.plugins.pi-herdr-agents.agents = lib.mapAttrsRecursive (_: lib.mkDefault) (
      lib.genAttrs (builtins.attrNames defaultAgents) (name: {
        spawning = name == "orchestrator";
      })
    );

    home.file = lib.mapAttrs' (
      name: _: lib.nameValuePair "${cfg.configDir}/agents/${name}.md" { text = renderAgent name; }
    ) renderablePluginAgents;
  };
}
