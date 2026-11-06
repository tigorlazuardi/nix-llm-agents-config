{
  deep-reviewer = {
    description = "Deep reviewer; spec axis";
    prompt = ../../config/agents/reviewer.md;
    model = "omniroute/personal/deep-reviewer";
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
    model = "omniroute/personal/implementer";
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
  standards-reviewer = {
    description = "Standards reviewer; standards axis";
    prompt = ../../config/agents/reviewer.md;
    model = "omniroute/personal/standards-reviewer";
    effort = "high";
    tools.allow = [
      "read"
      "grep"
      "find"
      "bash"
      "write"
    ];
  };
}
