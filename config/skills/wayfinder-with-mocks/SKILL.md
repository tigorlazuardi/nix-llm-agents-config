---
name: wayfinder-with-mocks
description: Chart work breadth-first through accepted boundary mocks before internal implementation decisions enter the map.
disable-model-invocation: true
---

Run a `/wayfinder` session, using the `/prototype` skill for mocks.

Chart breadth-first from the boundary user's viewpoint:

- For UI-bearing work, make broad user-flow questions lead to UI mock tickets, then derive user-facing requirements from accepted mocks.
- For service-to-service work, make consumer scenarios lead to mocked input/output contracts or APIs. When one operation depends on multiple contracts or API calls, map their relationships and process flow in a flowchart.

Keep internal implementation concerns in **Not yet specified** until accepted mocks make those questions precise; internal decision tickets enter the map afterward.
