{
  implementer = {
    description = "Sol implementation worker";
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
    description = "Sol planner and SCOPE/ADR drafter";
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
  reviewer = {
    description = "Sol reviewer; spec axis";
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
  standards-reviewer = {
    description = "Terra reviewer; standards axis";
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
  scout = {
    description = "Fast read-only code locator; Luna leaf";
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
    description = "Terra docs, research, and synthesis";
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
