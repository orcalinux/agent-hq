#!/usr/bin/env node
// Small, reproducible benchmark: each model writes a JavaScript function for a task and
// hidden tests decide pass/fail. Any OpenAI-compatible endpoint works (Magpie, OpenRouter, Ollama...).
//
//   node scripts/benchmark.mjs --base http://127.0.0.1:3425/v1 --models claude/claude-haiku-5-5,codex/gpt-6-luna --runs 3
//
// Writes docs/benchmark-results.json. Method and caveats: docs/benchmark.md.
import fs from 'node:fs';
import vm from 'node:vm';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => (value.startsWith('--') ? [...pairs, [value.slice(2), all[index + 1]]] : pairs), []));
const base = (args.base ?? 'http://127.0.0.1:3425/v1').replace(/\/$/, '');
const models = (args.models ?? 'claude/claude-haiku-5-5').split(',');
const runs = Number(args.runs ?? 3);
const key = process.env.BENCH_API_KEY ?? 'none';

export const TASKS = [
  { id: 'slugify', prompt: 'Write `slugify(text)`: lowercase, strip accents, replace runs of non-alphanumerics with a single "-", trim leading/trailing "-".', tests: [['Hello, World!', 'hello-world'], ['  Crème  brûlée ', 'creme-brulee'], ['--a__b--', 'a-b'], ['', '']], fn: 'slugify' },
  { id: 'rangeMerge', prompt: 'Write `mergeRanges(ranges)`: merge overlapping or touching [start,end] integer ranges and return them sorted. Do not mutate the input.', tests: [[[[1, 3], [2, 6], [8, 10], [10, 12]], [[1, 6], [8, 12]]], [[], []], [[[5, 5], [1, 2]], [[1, 2], [5, 5]]]], fn: 'mergeRanges' },
  { id: 'romanToInt', prompt: 'Write `romanToInt(s)` converting a valid Roman numeral (1-3999) to an integer.', tests: [['III', 3], ['LVIII', 58], ['MCMXCIV', 1994], ['IV', 4]], fn: 'romanToInt' },
  { id: 'groupAnagrams', prompt: 'Write `groupAnagrams(words)` returning an array of groups (arrays) of anagrams. Each group keeps input order; groups are ordered by the first appearance of any member.', tests: [[['eat', 'tea', 'tan', 'ate', 'nat', 'bat'], [['eat', 'tea', 'ate'], ['tan', 'nat'], ['bat']]], [[], []]], fn: 'groupAnagrams' },
  { id: 'parseDuration', prompt: 'Write `parseDuration(text)` returning milliseconds for strings like "1h 30m", "45s", "2d 1h", "500ms". Units: d,h,m,s,ms. Return null if the text has anything else.', tests: [['1h 30m', 5400000], ['45s', 45000], ['2d 1h', 176400000], ['500ms', 500], ['soon', null], ['1x', null]], fn: 'parseDuration' },
  { id: 'evalExpr', prompt: 'Write `evalExpr(text)` evaluating an arithmetic expression with + - * / ^ (right-associative, higher than * /), parentheses, unary minus and decimals. Whitespace is ignored. Return NaN for malformed input (unbalanced parens, trailing operator, empty). No eval/Function.', tests: [['1+2*3', 7], ['2^3^2', 512], ['-(2+3)*2', -10], ['2*-3', -6], ['(1+2', NaN], ['', NaN], ['10/4', 2.5], ['3+', NaN]], fn: 'evalExpr' },
  { id: 'wrapText', prompt: 'Write `wrapText(text, width)` greedily word-wrapping text to lines of at most `width` characters, returning an array of lines. Words longer than width are split into width-sized chunks. Collapse all whitespace runs; no empty lines.', tests: [[['the quick brown fox', 9], ['the quick', 'brown fox']], [['abcdefghij k', 4], ['abcd', 'efgh', 'ij k']], [['  ', 5], []]], fn: 'wrapText', spread: true },
  { id: 'buildOrder', prompt: 'Write `buildOrder(tasks)` where tasks is an object mapping a name to an array of names it depends on. Return an array with dependencies first; among ready tasks always pick the alphabetically smallest. Return null if there is a cycle. Names that appear only as dependencies are tasks with no dependencies.', tests: [[{ b: ['a'], c: ['a', 'b'], d: [] }, ['a', 'b', 'c', 'd']], [{ x: ['y'], y: ['x'] }, null], [{ m: ['z'] }, ['z', 'm']], [{}, []]], fn: 'buildOrder' },
  { id: 'minWindow', prompt: 'Write `minWindow(s, t)` returning the shortest substring of s containing every character of t including duplicates; if several have the same length return the leftmost; return "" if none.', tests: [[['ADOBECODEBANC', 'ABC'], 'BANC'], [['a', 'aa'], ''], [['aa', 'aa'], 'aa'], [['abc', ''], '']], fn: 'minWindow', spread: true },
  { id: 'lru', prompt: 'Write a function `lruRun(capacity, ops)` simulating an LRU cache. ops is an array of ["put",k,v] or ["get",k]. Return the array of results of the "get" operations (undefined becomes -1).', tests: [[[2, [['put', 1, 1], ['put', 2, 2], ['get', 1], ['put', 3, 3], ['get', 2], ['get', 3]]], [1, -1, 3]]], fn: 'lruRun', spread: true },
];

function extractCode(reply) {
  const fenced = reply.match(/```(?:js|javascript|ts|typescript)?\n([\s\S]*?)```/);
  return (fenced ? fenced[1] : reply).trim();
}

function grade(code, task) {
  try {
    const context = vm.createContext({});
    vm.runInContext(`${code}\n;globalThis.__fn = typeof ${task.fn} === 'function' ? ${task.fn} : undefined;`, context, { timeout: 2000 });
    if (!context.__fn) return false;
    return task.tests.every(([input, expected]) => {
      const out = task.spread ? context.__fn(...input) : context.__fn(JSON.parse(JSON.stringify(input)));
      const norm = (value) => JSON.stringify(value, (_key, item) => (typeof item === 'number' && Number.isNaN(item) ? 'NaN' : item));
      return norm(out) === norm(expected);
    });
  } catch {
    return false;
  }
}

async function ask(model, prompt) {
  const started = Date.now();
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, max_tokens: 2000, messages: [{ role: 'user', content: `${prompt}\nReply with one JavaScript code block containing only the function (plain JavaScript, no imports, no explanation).` }] }),
    signal: AbortSignal.timeout(180000),
  });
  if (!response.ok) throw new Error(`${model}: HTTP ${response.status}`);
  const json = await response.json();
  return { reply: json.choices?.[0]?.message?.content ?? '', ms: Date.now() - started, tokens: json.usage?.completion_tokens ?? 0 };
}

const results = [];
for (const model of models) {
  for (const task of TASKS) {
    for (let run = 1; run <= runs; run += 1) {
      try {
        const { reply, ms, tokens } = await ask(model, task.prompt);
        const pass = grade(extractCode(reply), task);
        results.push({ model, task: task.id, run, pass, ms, tokens });
        console.log(`${pass ? 'PASS' : 'FAIL'}  ${model}  ${task.id}#${run}  ${ms}ms  ${tokens}tok`);
      } catch (error) {
        results.push({ model, task: task.id, run, pass: false, ms: 0, tokens: 0, error: String(error.message ?? error) });
        console.log(`ERR   ${model}  ${task.id}#${run}  ${error.message}`);
      }
    }
  }
}

const summary = models.map((model) => {
  const own = results.filter((entry) => entry.model === model);
  const done = own.filter((entry) => !entry.error);
  const sorted = done.map((entry) => entry.ms).sort((first, second) => first - second);
  return { model, attempts: own.length, errors: own.length - done.length, passed: done.filter((entry) => entry.pass).length, medianMs: sorted[Math.floor(sorted.length / 2)] ?? null, tokens: done.reduce((sum, entry) => sum + entry.tokens, 0) };
});
console.table(summary);
fs.writeFileSync(new URL('../docs/benchmark-results.json', import.meta.url), JSON.stringify({ date: new Date().toISOString().slice(0, 10), runs, tasks: TASKS.map((task) => task.id), summary, results }, null, 2));
