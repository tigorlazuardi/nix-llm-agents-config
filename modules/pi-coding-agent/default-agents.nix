{
  fleet-draw = {
    description = "Render fleet status HTML; Luna leaf";
    prompt = ../../config/agents/fleet-draw.md;
    model = "gpt-5.6-terra";
    effort = "medium";
    tools.allow = [
      "read"
      "bash"
      "write"
    ];
  };
  frontier-implementer = {
    description = "Sol implementation for low-tolerance code";
    prompt = ../../config/agents/frontier-implementer.md;
    model = "gpt-5.6-sol";
    effort = "medium";
    tools.allow = [
      "read"
      "bash"
      "edit"
      "write"
      "grep"
      "find"
    ];
  };
  frontier-reviewer = {
    description = "Sol reviewer for low-tolerance diffs; standards or spec axis";
    prompt = ../../config/agents/frontier-reviewer.md;
    model = "gpt-5.6-sol";
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
    description = "Standard Terra implementation worker";
    prompt = ../../config/agents/implementer.md;
    model = "gpt-5.6-terra";
    effort = "medium";
    tools.allow = [
      "read"
      "bash"
      "edit"
      "write"
      "grep"
      "find"
    ];
  };
  judge = {
    description = "Sol post-orchestration terminal gate";
    prompt = ../../config/agents/judge.md;
    model = "gpt-5.6-sol";
    effort = "high";
    tools.allow = [
      "read"
      "grep"
      "find"
      "write"
    ];
  };
  orchestrator = {
    description = "Deterministic black-box one-shot and fleet state machine";
    prompt = ../../config/agents/orchestrator.md;
    model = "gpt-5.6-terra";
    effort = "medium";
    tools.allow = [
      "read"
      "bash"
      "subagent"
    ];
  };
  planner = {
    description = "Sol planner and SCOPE/ADR drafter";
    prompt = ../../config/agents/planner.md;
    model = "gpt-5.6-sol";
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
    description = "Standard Terra reviewer; standards or spec axis";
    prompt = ../../config/agents/reviewer.md;
    model = "gpt-5.6-terra";
    effort = "medium";
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
    model = "gpt-5.6-luna";
    effort = "medium";
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
    model = "gpt-5.6-terra";
    effort = "medium";
    tools.allow = [
      "read"
      "bash"
      "grep"
      "find"
      "write"
    ];
  };
}
