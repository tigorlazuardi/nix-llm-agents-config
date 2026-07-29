---
description: Systematic debugging — reproduce, isolate, diagnose, then gate execution.
argument-hint: "<symptom>"
---
Debug systematically. Symptom: $@

1. Reproduce with exact steps/command; record expected versus actual. **Complete when failure is repeatable or missing prerequisites are identified.**
2. Isolate smallest failing case, adding temporary diagnostics when needed. **Complete when failing boundary is evidence-backed.**
3. Test one hypothesis at a time; explain root cause with code-path/value/log evidence. **Complete when root cause is verified, or one full cycle records what remains ruled out.**
4. Keep project source read-only. Recommend exactly one of `/direct`, `/supervise`, or `/fleet` with one-line reason and concise alternatives, then stop. **Completion requires later explicit mode invocation; approval prose does not start execution.**
