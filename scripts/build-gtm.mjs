import { readFileSync, writeFileSync } from 'node:fs';
import { EVENTS, PARAMS } from '../src/lib/tracking.js';

const original = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const cv = original.containerVersion;
const identity = {accountId:cv.accountId,containerId:cv.containerId};
const param = (key,value,type='TEMPLATE') => ({type,key,value});
const table = (key,entries,left,right) => ({type:'LIST',key,list:entries.map(([a,b])=>({type:'MAP',map:[param(left,a),param(right,b)]}))});
const fields = ['page_location','page_referrer','page_group','content_slug','tracking_version','ai_source','campaign_source','campaign_medium','campaign_name','campaign_content','campaign_id',...PARAMS];
const value = key => '{{AQ - ' + key + '}}';
cv.variable = fields.map((key,i)=>({...identity,variableId:String(100+i),name:'AQ - '+key,type:'v',parameter:[param('name',key),param('dataLayerVersion','2','INTEGER'),param('setDefaultValue','false','BOOLEAN')]}));
cv.trigger = [
  { ...identity,triggerId:'20',name:'AQ - consented production ready',type:'CUSTOM_EVENT',customEventFilter:[{type:'EQUALS',parameter:[param('arg0','{{_event}}'),param('arg1','aq_ready')]}],filter:[{type:'MATCH_REGEX',parameter:[param('arg0','{{Page Hostname}}'),param('arg1','^(www\\.)?agenquest\\.com$')]}] },
  { ...identity,triggerId:'21',name:'AQ - approved production events',type:'CUSTOM_EVENT',customEventFilter:[{type:'MATCH_REGEX',parameter:[param('arg0','{{_event}}'),param('arg1','^('+EVENTS.filter(e=>e!=='page_view').join('|')+')$')]}],filter:[{type:'MATCH_REGEX',parameter:[param('arg0','{{Page Hostname}}'),param('arg1','^(www\\.)?agenquest\\.com$')]}] },
];
const base = cv.tag[0];
delete base.fingerprint;
base.parameter = [param('destinationId','G-DD18JLWTDD'),table('configSettingsTable',[
  ...['page_location','page_referrer','campaign_source','campaign_medium','campaign_name','campaign_content','campaign_id'].map(k=>[k,value(k)]),
  ['send_page_view','true'],['allow_google_signals','false'],['allow_ad_personalization_signals','false'],['allow_enhanced_conversions','false'],
], 'parameter','parameterValue'),table('eventSettingsTable',['page_group','content_slug','tracking_version','ai_source'].map(k=>[k,value(k)]),'parameter','parameterValue')];
base.firingTriggerId=['20'];
const event = {...identity,tagId:'6',name:'Agenquest - approved GA4 funnel events',type:'gaawe',parameter:[param('eventName','{{Event}}'),param('measurementIdOverride','G-DD18JLWTDD'),table('eventSettingsTable',['page_location','page_referrer','page_group','content_slug','tracking_version','ai_source',...PARAMS].map(k=>[k,value(k)]),'parameter','parameterValue')],firingTriggerId:['21'],tagFiringOption:'ONCE_PER_EVENT',consentSettings:{consentStatus:'NOT_SET'}};
const clarityHtml = `<script>(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};c[a]('consentv2',{analytics_Storage:'granted',ad_Storage:'denied'});t=l.createElement(r);t.async=1;t.src='https://www.clarity.ms/tag/'+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,'clarity','script','yyh6q0ibct');</script>`;
const clarity = {...identity,tagId:'7',name:'Agenquest - consented masked Clarity',type:'html',parameter:[param('html',clarityHtml),param('supportDocumentWrite','false','BOOLEAN')],firingTriggerId:['20'],tagFiringOption:'ONCE_PER_EVENT',consentSettings:{consentStatus:'NOT_SET'}};
cv.tag=[base,event,clarity];
// New destination tags enable automatic form / contact collection by default.
// Explicitly disable every automatic collector; only approved event data is sent.
for (const settings of cv.gtagConfig || []) for (const p of settings.parameter || []) if (p.type === 'BOOLEAN') p.value='false';
delete cv.fingerprint;
writeFileSync(process.argv[3], JSON.stringify(original,null,2)+'\n');
console.log(`Generated ${cv.tag.length} tags, ${cv.trigger.length} triggers, ${cv.variable.length} safe variables`);
