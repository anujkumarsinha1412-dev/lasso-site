import test from 'node:test';
import assert from 'node:assert/strict';
import { trafficIntent, submissionClass } from '../src/lib/traffic-policy.js';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as contract from '../src/lib/tracking.js';

test('explicit QA, owner and preview visits are internal, ordinary campaigns and privacy rejection are not', () => {
  for (const query of ['aq_qa=1','aq_test=1','aq_internal=1','noanalytics=1','utm_source=QA','utm_medium=internal','gtm_debug=x','gtm_preview=env-4'])
    assert.equal(trafficIntent('https://agenquest.com/?'+query).internal,true,query);
  assert.equal(trafficIntent('https://agenquest.com/','https://tagassistant.google.com/').internal,true);
  for (const query of ['', 'utm_source=linkedin&utm_medium=social','utm_campaign=testing-product','noanalytics=0'])
    assert.equal(trafficIntent('https://agenquest.com/?'+query).internal,false,query);
  assert.equal(submissionClass({analytics_consent:false},''),'new');
  assert.equal(submissionClass({},'aq_optout=1'),'internal');
  assert.equal(submissionClass({},'aq_test=1; aq_internal=1'),'test');
});

// Execute the real browser runtime with an in-memory DOM: no analytics requests.
function browserRun(search='', stored={}, hostname='agenquest.com') {
  const values=new Map(Object.entries(stored)),cookies=new Map(),scripts=[],nodes=[];
  const document={referrer:'',readyState:'complete',visibilityState:'visible',addEventListener(){},querySelector:()=>null,querySelectorAll:()=>[],getElementById:()=>null,
    createElement:tag=>({tagName:tag,setAttribute(key,value){this[key]=value;},addEventListener(){}}),
    head:{appendChild(node){scripts.push(node);}},body:{appendChild(node){nodes.push(node);}}};
  Object.defineProperty(document,'cookie',{get:()=>[...cookies].map(([k,v])=>`${k}=${v}`).join('; '),set:value=>{const [pair,...flags]=value.split('; ');const [key,...rest]=pair.split('=');if(flags.includes('Max-Age=0'))cookies.delete(key);else cookies.set(key,rest.join('='));}});
  const window={addEventListener(){}};
  const ctx={...contract,trafficIntent,window,document,URL,URLSearchParams,location:{hostname,href:`https://${hostname}/${search}`,search,pathname:'/',hash:'',reload(){}},localStorage:{getItem:key=>values.get(key)||null,setItem:(key,v)=>values.set(key,v),removeItem:key=>values.delete(key)},history:{state:null,replaceState(){}},setTimeout:fn=>fn(),setInterval:()=>1,clearInterval(){},clearTimeout(){},performance:{now:()=>0},IntersectionObserver:class{observe(){} disconnect(){}},innerHeight:800,scrollY:0};
  const source=readFileSync(new URL('../src/scripts/tracking-runtime.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
  vm.runInNewContext(source,ctx);
  return {window,scripts,values,nodes};
}
const granted=()=>JSON.stringify({value:'granted',expires:Date.now()+86400000});

test('production QA and persistent owner exclusion load no GTM, Clarity or Cloudflare scripts despite prior consent',()=>{
  for(const query of ['?aq_qa=1','?aq_test=1','?utm_source=qa&utm_medium=internal','?noanalytics=1','?gtm_debug=x']){
    const b=browserRun(query,{aq_consent_v1:granted(),aq_attribution_v1:'private'});
    assert.equal(b.scripts.length,0,query);assert.equal(b.window.aqAnalytics.allowed(),false);assert.equal(b.values.has('aq_attribution_v1'),false);
    assert.ok(['test','internal'].includes(b.window.aqAnalytics.trafficClass()));
  }
  assert.equal(browserRun('',{aq_optout:'1',aq_consent_v1:granted()}).scripts.length,0);
});

test('real consented visitors load GTM and exactly one RUM beacon; preview hosts and undecided visitors do not',()=>{
  const visitor=browserRun('',{aq_consent_v1:granted()});
  assert.equal(visitor.scripts.length,2);assert.equal(visitor.window.aqAnalytics.allowed(),true);
  assert.equal(visitor.scripts.filter(x=>x.src.includes('beacon.min.js')).length,1);
  assert.equal(browserRun('').scripts.length,0);
  assert.equal(browserRun('',{aq_consent_v1:granted()},'preview.lasso-site.pages.dev').scripts.length,0);
  const reset=browserRun('?noanalytics=0',{aq_optout:'1',aq_internal:'1',aq_test:'1',aq_consent_v1:granted()});
  assert.equal(reset.scripts.length,2);assert.equal(reset.window.aqAnalytics.trafficClass(),'visitor');
});
