// Level generator and solvers, run in Node straight from source/index.html.
// Every level must be valid and solvable under the game's own move rules.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ROOT, suite } = require('./harness');

const LEVELS = Number(process.env.LEVELS || 300);
const PAR_LEVELS = 120;
const CAP = 4;

const html = fs.readFileSync(path.join(ROOT, 'source', 'index.html'), 'utf8');
const script = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
const t = suite('levels: generator and solvers');

try {
  new vm.Script(script);
  t.ok('game script parses', true);
} catch (e) {
  t.ok('game script parses', false, e.message);
}

const pure = `const CAP = ${CAP};\n` +
  script.slice(script.indexOf('function rng(seed)'), script.indexOf('// Heavy searches run in a background worker')) +
  '\nthis.api = { genLevel, solve, computePar, levelColors, levelEmpties, levelKind, isDone, runLen };';
const ctx = {};
vm.runInNewContext(pure, ctx);
const { genLevel, solve, computePar, levelColors, levelEmpties, levelKind, isDone, runLen } = ctx.api;

// Replays a solution with the game's move rules (see canMove/doMove in index.html).
function replay(spec, path) {
  const tubes = spec.tubes.map(a => a.slice());
  let frozen = spec.frozen ?? -1;
  for (const [i, j] of path) {
    if (i === j || !tubes[i].length || tubes[j].length >= CAP) return 'illegal move';
    if (isDone(tubes[i])) return 'moved from a completed tube';
    if (frozen >= 0 && (i === frozen || j === frozen)) return 'touched the frozen tube';
    const cnt = Math.min(runLen(tubes[i]), CAP - tubes[j].length);
    tubes[j].push(...tubes[i].splice(tubes[i].length - cnt, cnt));
    if (frozen >= 0 && tubes.some((a, k) => k !== frozen && isDone(a))) frozen = -1;
  }
  return tubes.every(a => !a.length || isDone(a)) ? 'ok' : 'not solved';
}

const problems = [];
let slowGen = { ms: 0 }, slowPar = { ms: 0 };
for (let l = 1; l <= LEVELS; l++) {
  const t0 = performance.now();
  const spec = genLevel(l);
  const genMs = performance.now() - t0;
  if (genMs > slowGen.ms) slowGen = { l, ms: genMs };
  if (!spec) { problems.push(`L${l}: no level generated`); continue; }
  const n = levelColors(l), balls = spec.tubes.flat();
  if (spec.tubes.length !== n + levelEmpties(l)) problems.push(`L${l}: ${spec.tubes.length} tubes`);
  for (let c = 0; c < n; c++) if (balls.filter(b => b === c).length !== CAP) problems.push(`L${l}: color ${c} count`);
  if (spec.tubes.some(isDone)) problems.push(`L${l}: starts with a completed tube`);
  if (spec.frozen >= 0 && !spec.tubes[spec.frozen].length) problems.push(`L${l}: frozen tube is empty`);
  const sol = solve(spec.tubes, 400000, spec.frozen);
  if (!sol) { problems.push(`L${l}: not solvable (${levelKind(l)})`); continue; }
  const r = replay(spec, sol);
  if (r !== 'ok') problems.push(`L${l}: solution replay: ${r}`);
  if (l <= PAR_LEVELS) {
    const p0 = performance.now();
    if (computePar(spec) == null) problems.push(`L${l}: no par`);
    const ms = performance.now() - p0;
    if (ms > slowPar.ms) slowPar = { l, ms };
  }
}
t.ok(`levels 1-${LEVELS} are valid and solvable`, problems.length === 0, problems.slice(0, 5).join('; '));
console.log(`      slowest genLevel: L${slowGen.l} ${slowGen.ms.toFixed(0)}ms, slowest par: L${slowPar.l} ${slowPar.ms.toFixed(0)}ms`);
t.finish();
