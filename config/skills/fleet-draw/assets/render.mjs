#!/usr/bin/env node
// fleet-draw renderer — zero-dependency, Node >=20.
// Reads a fleet run dir (.fleet/<run>/), embeds fleet.json + every dags/*/state.json
// into template.html, writes one self-contained HTML report.
//
// Usage: node render.mjs <run-dir> [out.html]
// Default out: <run-dir>/report/status-<ISO-timestamp>.html

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function computeSummary(fleet, dagStates) {
  let totalTasks = 0;
  let passedTasks = 0;
  let errorSpans = 0;
  let runningDags = 0;

  for (const dag of fleet.dags ?? []) {
    if (dag.status === 'running') runningDags++;
    for (const span of dag.audit ?? []) {
      if (span.status === 'error') errorSpans++;
    }
    const state = dagStates[dag.id];
    for (const node of state?.nodes ?? []) {
      totalTasks++;
      if (node.runtime?.status === 'passed') passedTasks++;
      for (const span of node.audit ?? []) {
        if (span.status === 'error') errorSpans++;
      }
    }
  }

  return { totalTasks, passedTasks, errorSpans, runningDags };
}

async function main() {
  const [, , runDirArg, outArg] = process.argv;
  if (!runDirArg) {
    console.error('usage: node render.mjs <run-dir> [out.html]');
    process.exit(1);
  }

  const runDir = path.resolve(runDirArg);
  const fleet = JSON.parse(await readFile(path.join(runDir, 'fleet.json'), 'utf8'));

  const dagStates = {};
  for (const dag of fleet.dags ?? []) {
    const statePath = path.join(runDir, dag.statePath);
    dagStates[dag.id] = JSON.parse(await readFile(statePath, 'utf8'));
  }

  const generatedAt = new Date().toISOString();
  const data = {
    runName: fleet.meta?.runName ?? path.basename(runDir),
    generatedAt,
    fleet,
    dagStates,
  };

  const template = await readFile(path.join(__dirname, 'template.html'), 'utf8');
  // \u003c-escape '<' so no literal "</script>" can ever appear inside the embedded
  // JSON, regardless of what user data contains. JSON.parse decodes \u003c back to '<'.
  const jsonStr = JSON.stringify(data).replace(/</g, '\\u003c');
  const html = template.replace('__FLEET_DATA_JSON__', () => jsonStr);

  const outPath = outArg
    ? path.resolve(outArg)
    : path.join(runDir, 'report', `status-${generatedAt.replace(/:/g, '-')}.html`);

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, html, 'utf8');

  const s = computeSummary(fleet, dagStates);
  console.log(outPath);
  console.log(
    `${s.passedTasks}/${s.totalTasks} task passed, ${s.errorSpans} error span(s), ${s.runningDags} DAG running.`
  );
}

main().catch((err) => {
  console.error(err.stack ?? err.message);
  process.exit(1);
});
