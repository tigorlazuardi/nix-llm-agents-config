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

  resolveTools =
    agent:
    if agent.tools.allow == null then
      null
    else if agent.tools.noBuiltins == true then
      builtins.filter (tool: !(builtins.elem tool builtinTools)) agent.tools.allow
    else
      agent.tools.allow;

  renderAgent =
    name:
    let
      agent = cfg.agents.${name};
      tools = resolveTools agent;
      prompt = if builtins.isPath agent.prompt then builtins.readFile agent.prompt else agent.prompt;
      lines = [
        "---"
        "name: ${builtins.toJSON name}"
        "description: ${builtins.toJSON agent.description}"
        "tools:"
      ]
      ++ map (tool: "  - ${builtins.toJSON tool}") tools
      ++ [ "---" ];
    in
    lib.concatStringsSep "\n" lines + "\n" + prompt;

  invalidToolLists = builtins.filter (
    name:
    let
      agent = cfg.agents.${name};
    in
    agent.tools.allow == null || agent.tools.allow == [ ] || resolveTools agent == [ ]
  ) (builtins.attrNames renderablePluginAgents);
in
{
  options.programs.pi-coding-agent.plugins.pi-herdr-subagents.agents = lib.mkOption {
    type = lib.types.attrsOf (lib.types.submodule { });
    default = { };
    description = "Named portable agents exposed to pi-herdr-subagents.";
  };

  config = lib.mkIf pluginEnabled {
    assertions = [
      {
        assertion = unknownPluginAgents == [ ];
        message = "pi-herdr-subagents agents must exist in programs.pi-coding-agent.agents: ${lib.concatStringsSep ", " unknownPluginAgents}";
      }
      {
        assertion = invalidToolLists == [ ];
        message = "pi-herdr-subagents agents require a non-empty tools allowlist after capability resolution: ${lib.concatStringsSep ", " invalidToolLists}";
      }
    ];

    warnings =
      lib.mapAttrsToList (
        name: _: "pi-herdr-subagents agent ${name}: ignored unsupported capability tools.exclude"
      ) (lib.filterAttrs (name: _: cfg.agents.${name}.tools.exclude != null) renderablePluginAgents)
      ++
        lib.mapAttrsToList
          (
            name: _:
            "pi-herdr-subagents agent ${name}: ignored unsupported capability tools.noBuiltins without tools.allow"
          )
          (
            lib.filterAttrs (
              name: _: cfg.agents.${name}.tools.noBuiltins == true && cfg.agents.${name}.tools.allow == null
            ) renderablePluginAgents
          );

    programs.pi-coding-agent.plugins.pi-herdr-subagents.agents = lib.mapAttrsRecursive (
      _: lib.mkDefault
    ) (lib.genAttrs (builtins.attrNames defaultAgents) (_: { }));

    home.file = lib.mapAttrs' (
      name: _: lib.nameValuePair ".pi/agents/${name}.md" { text = renderAgent name; }
    ) renderablePluginAgents;
  };
}
