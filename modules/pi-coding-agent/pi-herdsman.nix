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
  ];

  pluginEnabled = cfg.enable && cfg.plugins.pi-herdsman.enable;
  pluginAgents = cfg.plugins.pi-herdsman.agents;
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
  referencedDelegateTargets = lib.concatMap (
    name:
    let
      targets = pluginAgents.${name}.agents;
    in
    if targets == null then [ ] else targets
  ) renderablePluginAgentNames;
  unknownDelegateTargets = builtins.filter (name: !(builtins.elem name renderablePluginAgentNames)) (
    lib.unique referencedDelegateTargets
  );

  # pi-herdsman merges user-layer frontmatter over its bundled definitions of
  # the same name (implementer, scout, reviewer). Emitting every capability
  # field explicitly pins the fleet to this module's semantics instead of
  # inheriting upstream defaults that drift with upstream releases.
  yamlArray = values: builtins.toJSON values;

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
      ++ [ "tools: ${yamlArray (resolveTools agent)}" ]
      ++ [ "systemPromptMode: ${builtins.toJSON "replace"}" ]
      ++ [ "agents: ${yamlArray (if plugin.agents == null then [ ] else plugin.agents)}" ]
      ++ [
        "noSkills: false"
        "noExtensions: false"
        "inheritProjectContext: true"
        "inheritGlobalContext: true"
      ]
      ++ lib.optional (agent.skills != null) "skills: ${yamlArray agent.skills}"
      ++ lib.optional (agent.extensions != null) "extensions: ${yamlArray agent.extensions}"
      ++ lib.optional (agent.tools.exclude != null) "excludeTools: ${yamlArray agent.tools.exclude}"
      ++ lib.optional (
        agent.tools.noBuiltins != null
      ) "noBuiltinTools: ${lib.boolToString agent.tools.noBuiltins}"
      ++ [ "---" ];
    in
    lib.concatStringsSep "\n" lines + "\n" + prompt;
in
{
  options.programs.pi-coding-agent.plugins.pi-herdsman.agents = lib.mkOption {
    type = lib.types.attrsOf (
      lib.types.submodule {
        options = {
          agents = lib.mkOption {
            type = lib.types.nullOr (lib.types.listOf lib.types.str);
            default = null;
            description = "Agent definitions this agent may delegate to; null disables delegation.";
          };
        };
      }
    );
    default = { };
    description = "Portable agents exposed to the pi-herdsman plugin.";
  };

  config = lib.mkIf pluginEnabled {
    assertions = [
      {
        assertion = unknownPluginAgents == [ ];
        message = "pi-herdsman agents must exist in programs.pi-coding-agent.agents: ${lib.concatStringsSep ", " unknownPluginAgents}";
      }
      {
        assertion = unknownSkills == [ ];
        message = "Pi agents reference undefined skills: ${lib.concatStringsSep ", " unknownSkills}";
      }
      {
        assertion = invalidToolLists == [ ];
        message = "pi-herdsman agents require at least one native Pi tool: ${lib.concatStringsSep ", " invalidToolLists}";
      }
      {
        assertion = unknownDelegateTargets == [ ];
        message = "pi-herdsman delegation targets must be rendered plugin agents: ${lib.concatStringsSep ", " unknownDelegateTargets}";
      }
    ];

    programs.pi-coding-agent.plugins.pi-herdsman.agents = lib.mapAttrsRecursive (_: lib.mkDefault) (
      lib.genAttrs (builtins.attrNames defaultAgents) (name: {
        agents =
          if name == "orchestrator" then
            [
              "scout"
              "implementer"
              "standards-reviewer"
              "deep-reviewer"
            ]
          else
            null;
      })
    );

    home.file = lib.mapAttrs' (
      name: _: lib.nameValuePair "${cfg.configDir}/agents/${name}.md" { text = renderAgent name; }
    ) renderablePluginAgents;
  };
}
