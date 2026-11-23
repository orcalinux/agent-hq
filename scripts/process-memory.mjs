import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export function processMemory(rootPid) {
  if (!Number.isSafeInteger(rootPid) || rootPid < 1) throw new Error('Expected a positive process ID.');
  const pending = [rootPid];
  const seen = new Set();
  const processes = [];
  const unavailable = [];
  while (pending.length) {
    const pid = pending.pop();
    if (seen.has(pid)) continue;
    seen.add(pid);
    try {
      const taskDir = `/proc/${pid}/task`;
      for (const thread of fs.readdirSync(taskDir)) {
        try {
          const children = fs.readFileSync(`${taskDir}/${thread}/children`, 'utf8').trim();
          pending.push(...children.split(/\s+/).filter(Boolean).map(Number));
        } catch {
          continue;
        }
      }
      const text = fs.readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8');
      const pss = Number(/^Pss:\s+(\d+)/m.exec(text)?.[1] || 0);
      const rss = Number(/^Rss:\s+(\d+)/m.exec(text)?.[1] || 0);
      const command = fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim();
      processes.push({ pid, command, pssKiB: pss, rssKiB: rss });
    } catch (error) {
      unavailable.push({ pid, reason: error.code ?? error.message });
    }
  }
  return {
    at: new Date().toISOString(), rootPid, processes, unavailable,
    pssMiB: processes.reduce((sum, entry) => sum + entry.pssKiB, 0) / 1024,
    rssMiB: processes.reduce((sum, entry) => sum + entry.rssKiB, 0) / 1024,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(processMemory(Number(process.argv[2])), null, 2));
}
