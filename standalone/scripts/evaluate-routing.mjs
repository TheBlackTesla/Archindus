import {build} from 'esbuild';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
await mkdir(path.join(root,'outputs'),{recursive:true});
await build({stdin:{contents:"export * from './lib/inference/learning-policy';export * from './lib/inference/quality-benchmark';",resolveDir:root},bundle:true,platform:'node',format:'esm',outfile:path.join(root,'outputs/learning-policy.mjs'),logLevel:'silent'});
const policy=await import('../outputs/learning-policy.mjs');
const fixtures=JSON.parse(await readFile(path.join(root,'tests/fixtures/routing-learning.json'),'utf8'));
const cases=fixtures.map(f=>({name:f.name,selected:policy.policyOrder(f.routes,policy.SHADOW_ROUTING_POLICY)[0],expected:f.expected})).map(c=>({...c,passed:c.selected===c.expected}));
const regressions=cases.filter(c=>!c.passed).length;
let quality=null;try{const trial=JSON.parse(await readFile(path.join(root,'docs/evaluations/controlled-trial.json'),'utf8'));if(trial.suiteVersion===policy.SUITE_VERSION&&trial.graderVersion===policy.GRADER_VERSION)quality=policy.summarizeQuality(trial.observations)}catch{}
const report={quality,active:policy.ACTIVE_ROUTING_POLICY,shadow:policy.SHADOW_ROUTING_POLICY,evaluatedAt:new Date().toISOString(),evidence:'Routing invariants plus optional fixed synthetic response grades; not a representative causal policy estimate',cases,promotion:policy.promotionGate({regressions:regressions+(quality&&(quality.completedPairs<policy.QUALITY_CASES.length||quality.challengerAvailability<quality.championAvailability)?1:0),qualitySamples:quality?.holdoutSamples??0,qualityLowerBound:quality?.qualityLowerBound??NaN,costRatio:quality?.costRatio??NaN,latencyRatio:quality?.latencyRatio??NaN})};
await writeFile(path.join(root,'outputs/routing-evaluation.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:cases.length-regressions,total:cases.length,promotion:report.promotion},null,2));
if(regressions||(policy.ACTIVE_ROUTING_POLICY!=='operational-v1'&&!report.promotion.eligible))process.exitCode=1;
