{
  deep-reviewer = {
    description = "Deep reviewer; spec axis";
    prompt = ../../config/agents/reviewer.md;
    model = "zai/glm-5.3";
    effort = "high";
    tools.allow = [
      "read"
      "grep"
      "find"
      "bash"
      "write"
    ];
  };
  implementer = {
    description = "Implementation worker";
    prompt = ../../config/agents/implementer.md;
    model = "zai/glm-5.3-flash";
    effort = "high";
    tools.allow = [
      "read"
      "bash"
      "edit"
      "write"
      "grep"
      "find"
    ];
  };
  orchestrator = {
    description = "Deterministic black-box one-shot state machine";
    prompt = ../../config/agents/orchestrator.md;
    model = "zai/glm-5.3-flash";
    effort = "high";
    tools.allow = [
      "read"
      "bash"
      "subagent"
    ];
  };
  planner = {
    description = "Planner and SCOPE/ADR drafter";
    prompt = ../../config/agents/planner.md;
    model = "zai/glm-5.3";
    effort = "high";
    tools.allow = [
      "read"
      "grep"
      "find"
      "bash"
      "write"
    ];
  };
  standards-reviewer = {
    description = "Standards reviewer; standards axis";
    prompt = ../../config/agents/reviewer.md;
    model = "zai/glm-5.3-flash";
    effort = "high";
    tools.allow = [
      "read"
      "grep"
      "find"
      "bash"
      "write"
    ];
  };
  scout = {
    description = "Fast read-only code locator";
    prompt = ../../config/agents/scout.md;
    model = "zai/glm-5.3-flash";
    effort = "high";
    tools.allow = [
      "read"
      "grep"
      "find"
      "bash"
    ];
  };
  support = {
    description = "Docs, research, and synthesis";
    prompt = ../../config/agents/support.md;
    model = "zai/glm-5.3-flash";
    effort = "high";
    tools.allow = [
      "read"
      "bash"
      "grep"
      "find"
      "write"
    ];
  };
}
