import { isBashToolResult, type ExtensionAPI, type ExtensionContext, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { details, hasCommitEvidence, initialState, isRecordResult, normalizeRecordInput, nudgeState, parseState, projectFrom, recall, record, type JournalState } from "./dev-journal-core.ts";

const ROOT = join(homedir(), "journal"), exec = promisify(execFile);
async function git(...args: string[]): Promise<string> { return (await exec("git", ["-C", ROOT, ...args], { encoding: "utf8", maxBuffer: 1024 * 1024 })).stdout; }
async function syncedRecord(input: Parameters<typeof record>[1]): Promise<{ ref: string; commit: string }> {
  const dirty = await git("status", "--porcelain", "--untracked-files=all");
  if (dirty.trim()) throw new Error(`Journal repo has pending changes; sync them first: ${dirty.trim().split("\n").slice(0, 8).join(", ")}`);
  await git("pull", "--ff-only");
  const [behind, ahead] = (await git("rev-list", "--left-right", "--count", "@{upstream}...HEAD")).trim().split(/\s+/).map(Number);
  if (behind) throw new Error("Journal repo remains behind upstream after pull.");
  if (ahead) { await git("push"); return { ref: "", commit: "Synced existing local journal commit; no duplicate record written." }; }
  const out = await record(ROOT, input), paths = [out.ref, `${input.project}/index.md`, "index.md", "skills-inventory.md"];
  await git("add", "--", ...paths);
  const staged = (await git("diff", "--cached", "--name-only", "-z")).split("\0").filter(Boolean).sort();
  if (staged.join("\0") !== [...paths].sort().join("\0")) throw new Error(`Unexpected staged journal paths: ${staged.join(", ")}`);
  const slug = basename(out.ref, ".md").replace(/^\d{4}-\d{2}-\d{2}-/, "").slice(0, 40);
  const committed = await git("commit", "-m", `docs(${input.project}): journal ${slug}`);
  await git("push");
  return { ref: out.ref, commit: committed.trim().split("\n")[0] ?? "committed" };
}
function isJournalStateEntry(entry: SessionEntry): entry is Extract<SessionEntry, { type: "custom" }> { return entry.type === "custom" && entry.customType === "dev-journal-state"; }
function restore(ctx: ExtensionContext): JournalState { for (const entry of [...ctx.sessionManager.getEntries()].reverse()) if (isJournalStateEntry(entry)) return parseState(entry.data); return initialState(); }
function textContent(content: readonly { type: string; text?: string }[]): string { return content.filter((item): item is { type: "text"; text: string } => item.type === "text" && typeof item.text === "string").map((item) => item.text).join("\n"); }

export default function (pi: ExtensionAPI) {
  let state: JournalState = initialState(), lock = Promise.resolve();
  const persist = () => { try { pi.appendEntry("dev-journal-state", state); } catch {} };
  const nudge = () => {
    const next = nudgeState(state); if (!next) return;
    state = next; // ponytail: mark before host delivery; failed host calls must not loop this session.
    persist();
    try { pi.sendMessage({ customType: "dev-journal-nudge", content: "DEV-JOURNAL CHECK: commit evidence exists. Decide if work notable; if notable ask exact `Journal ini?`; otherwise stay silent.", display: true }, { deliverAs: "followUp", triggerTurn: true }); } catch {}
  };
  pi.on("session_start", (_event, ctx) => { try { state = restore(ctx); } catch { state = initialState(); } });
  pi.on("session_compact", () => { state = initialState(); persist(); });
  pi.registerTool({
    name: "dev_journal", label: "Dev Journal", description: "Recall journal digest, read one entry, or record approved notable work locally.",
    promptSnippet: "Recall precedent or record user-approved notable work in local dev journal",
    promptGuidelines: ["Use dev_journal recall for relevant precedent. Use dev_journal record only after user explicitly says Journal ini? and approved:true; record syncs, triages, writes, commits, and pushes the journal repo."],
    parameters: Type.Object({ action: StringEnum(["recall", "details", "record"] as const), project: Type.Optional(Type.String()), query: Type.Optional(Type.String()), ref: Type.Optional(Type.String()), approved: Type.Optional(Type.Boolean()), company: Type.Optional(Type.String()), type: Type.Optional(StringEnum(["feature", "design-decision", "fix", "incident", "learning", "milestone"] as const)), title: Type.Optional(Type.String()), skills: Type.Optional(Type.Array(Type.String())), impact: Type.Optional(Type.String()), cv_ready: Type.Optional(Type.Boolean()), body: Type.Optional(Type.String()), date: Type.Optional(Type.String()), related: Type.Optional(Type.String()) }),
    async execute(_id, p, _signal, _update, ctx) {
      try {
        if (p.action === "recall") return { content: [{ type: "text", text: await recall(ROOT, projectFrom(ctx.cwd, p.project) ?? "", p.query) }], details: {} };
        if (p.action === "details") return { content: [{ type: "text", text: await details(ROOT, p.ref ?? "") }], details: {} };
        const input = normalizeRecordInput({ approved: p.approved === true, project: projectFrom(ctx.cwd, p.project) ?? "", company: p.company ?? "", type: p.type ?? "", title: p.title ?? "", skills: p.skills ?? [], impact: p.impact ?? "", cv_ready: p.cv_ready === true, body: p.body ?? "", date: p.date, related: p.related });
        const run = lock.then(() => syncedRecord(input)); lock = run.catch(() => undefined); const out = await run; state.decided = true; persist(); return { content: [{ type: "text", text: out.ref ? `Recorded and pushed ${out.ref}. ${out.commit}` : out.commit }], details: { ref: out.ref } };
      } catch (error) { if (p.action === "record") { state.decided = true; persist(); } throw error; }
    },
  });
  pi.registerCommand("journal", { description: "Triage, write, and sync an approved dev-journal record", handler: async (_args, _ctx) => { try { pi.sendUserMessage("For notable completed work, ask exact: Journal ini? On approval, use dev_journal record with approved:true; it triages placement, writes indexes, commits, and pushes. Do not duplicate writing outside tool."); } catch {} } });
  pi.on("tool_result", (event) => { if (isRecordResult(event)) { state.decided = true; persist(); return; } if (isBashToolResult(event) && hasCommitEvidence(event.input.command, textContent(event.content), event)) { state.commit = true; persist(); } });
  pi.on("agent_settled", nudge);
}
