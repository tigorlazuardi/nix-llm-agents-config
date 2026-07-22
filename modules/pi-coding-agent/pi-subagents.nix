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

  pluginAgents = cfg.plugins.pi-subagents.agents;
  pluginAgentNames = builtins.attrNames pluginAgents;
  unknownPluginAgents = builtins.filter (name: !(builtins.hasAttr name cfg.agents)) pluginAgentNames;
  renderablePluginAgents = lib.filterAttrs (name: _: builtins.hasAttr name cfg.agents) pluginAgents;
  renderablePluginAgentNames = builtins.attrNames renderablePluginAgents;

  resolveTools =
    agent:
    if agent.tools.allow == null then
      null
    else if agent.tools.noBuiltins == true then
      builtins.filter (tool: !(builtins.elem tool builtinTools)) agent.tools.allow
    else
      agent.tools.allow;
  resolveExtensions = names: map (name: toString cfg.extensions.${name}) names;

  renderAgent =
    name:
    let
      agent = cfg.agents.${name};
      plugin = pluginAgents.${name};
      tools = resolveTools agent;
      prompt = if builtins.isPath agent.prompt then builtins.readFile agent.prompt else agent.prompt;
      lines = [
        "---"
        "name: ${name}"
        "description: ${agent.description}"
      ]
      ++ lib.optional (tools != null) "tools: ${lib.concatStringsSep ", " tools}"
      ++ lib.optional (agent.model != null) "model: ${agent.model}"
      ++ lib.optional (agent.effort != null) "thinking: ${agent.effort}"
      ++ lib.optional (agent.skills != null) "skills: ${lib.concatStringsSep ", " agent.skills}"
      ++ lib.optional (
        agent.extensions != null
      ) "extensions: ${lib.concatStringsSep ", " (resolveExtensions agent.extensions)}"
      ++ lib.optional (plugin.systemPromptMode != null) "systemPromptMode: ${plugin.systemPromptMode}"
      ++ lib.optional (
        plugin.inheritProjectContext != null
      ) "inheritProjectContext: ${lib.boolToString plugin.inheritProjectContext}"
      ++ lib.optional (
        plugin.inheritSkills != null
      ) "inheritSkills: ${lib.boolToString plugin.inheritSkills}"
      ++ lib.optional (plugin.defaultContext != null) "defaultContext: ${plugin.defaultContext}"
      ++ lib.optional (plugin.async != null) "async: ${lib.boolToString plugin.async}"
      ++
        lib.optional (plugin.subagentOnlyExtensions != null)
          "subagentOnlyExtensions: ${lib.concatStringsSep ", " (resolveExtensions plugin.subagentOnlyExtensions)}"
      ++ [ "---" ];
    in
    lib.concatStringsSep "\n" lines + "\n" + prompt;

  referencedSkills = lib.concatMap (
    name:
    let
      skills = cfg.agents.${name}.skills;
    in
    if skills == null then [ ] else skills
  ) renderablePluginAgentNames;
  referencedExtensions = lib.concatMap (
    name:
    let
      agentExtensions = cfg.agents.${name}.extensions;
      pluginExtensions = pluginAgents.${name}.subagentOnlyExtensions;
    in
    (if agentExtensions == null then [ ] else agentExtensions)
    ++ (if pluginExtensions == null then [ ] else pluginExtensions)
  ) renderablePluginAgentNames;
  unknownSkills = builtins.filter (name: !(builtins.hasAttr name cfg.skills)) referencedSkills;
  unknownExtensions = builtins.filter (
    name: !(builtins.hasAttr name cfg.extensions)
  ) referencedExtensions;
  invalidLists = builtins.filter (
    name:
    let
      agent = cfg.agents.${name};
      plugin = pluginAgents.${name};
    in
    agent.tools.allow == [ ]
    || agent.tools.exclude == [ ]
    || agent.skills == [ ]
    || agent.extensions == [ ]
    || plugin.subagentOnlyExtensions == [ ]
    || resolveTools agent == [ ]
  ) renderablePluginAgentNames;
in
{
  options.programs.pi-coding-agent.plugins.pi-subagents.agents = lib.mkOption {
    type = lib.types.attrsOf (
      lib.types.submodule {
        options = {
          systemPromptMode = lib.mkOption {
            type = lib.types.nullOr (
              lib.types.enum [
                "append"
                "replace"
              ]
            );
            default = null;
          };
          inheritProjectContext = lib.mkOption {
            type = lib.types.nullOr lib.types.bool;
            default = null;
          };
          inheritSkills = lib.mkOption {
            type = lib.types.nullOr lib.types.bool;
            default = null;
          };
          defaultContext = lib.mkOption {
            type = lib.types.nullOr (
              lib.types.enum [
                "fresh"
                "fork"
              ]
            );
            default = null;
          };
          async = lib.mkOption {
            type = lib.types.nullOr lib.types.bool;
            default = null;
          };
          subagentOnlyExtensions = lib.mkOption {
            type = lib.types.nullOr (lib.types.listOf lib.types.str);
            default = null;
          };
        };
      }
    );
    default = { };
    description = "pi-subagents fields augmenting existing portable agents by name.";
  };

  config = {
    assertions = [
      {
        assertion = unknownPluginAgents == [ ];
        message = "pi-subagents agents must exist in programs.pi-coding-agent.agents: ${lib.concatStringsSep ", " unknownPluginAgents}";
      }
      {
        assertion = unknownSkills == [ ];
        message = "Pi agents reference undefined skills: ${lib.concatStringsSep ", " unknownSkills}";
      }
      {
        assertion = unknownExtensions == [ ];
        message = "Pi agents reference undefined extensions: ${lib.concatStringsSep ", " unknownExtensions}";
      }
      {
        assertion = invalidLists == [ ];
        message = "Pi agent lists must be null or non-empty and tool resolution must not produce an empty allowlist: ${lib.concatStringsSep ", " invalidLists}";
      }
    ];

    warnings =
      lib.mapAttrsToList (
        name: _: "pi-subagents agent ${name}: ignored unsupported capability tools.exclude"
      ) (lib.filterAttrs (name: _: cfg.agents.${name}.tools.exclude != null) renderablePluginAgents)
      ++
        lib.mapAttrsToList
          (
            name: _:
            "pi-subagents agent ${name}: ignored unsupported capability tools.noBuiltins without tools.allow"
          )
          (
            lib.filterAttrs (
              name: _: cfg.agents.${name}.tools.noBuiltins == true && cfg.agents.${name}.tools.allow == null
            ) renderablePluginAgents
          );

    programs.pi-coding-agent.plugins.pi-subagents.agents = lib.mapAttrsRecursive (_: lib.mkDefault) (
      lib.genAttrs (builtins.attrNames defaultAgents) (_: {
        systemPromptMode = "replace";
        inheritProjectContext = true;
        inheritSkills = false;
        defaultContext = "fresh";
        async = true;
      })
    );

    home.file = lib.mkIf cfg.enable (
      lib.mapAttrs' (
        name: _: lib.nameValuePair "${cfg.configDir}/agents/${name}.md" { text = renderAgent name; }
      ) renderablePluginAgents
    );
  };
}
