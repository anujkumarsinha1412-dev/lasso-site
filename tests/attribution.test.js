import test from 'node:test';
import assert from 'node:assert/strict';
import { acquisition, attributionRecord, pageContext } from '../src/lib/tracking.js';

test('explicit campaign wins over a conflicting AI referrer',()=>{
  const touch=acquisition('https://agenquest.com/?utm_source=linkedin&utm_medium=social','https://chatgpt.com/');
  assert.equal(touch.source,'linkedin');assert.equal(touch.ai_source,'none');
  assert.equal(acquisition('https://agenquest.com/?utm_source=chatgpt&utm_medium=referral','https://linkedin.com/').ai_source,'chatgpt');
});
test('a campaign ID change starts a new private attribution touch',()=>{
  const now=Date.now(),url='https://agenquest.com/?utm_source=newsletter&utm_medium=email&utm_campaign=weekly&utm_id=';
  const first=attributionRecord(null,acquisition(url+'a','',now),now);
  const next=attributionRecord(first,acquisition(url+'b','',now+1),now+1);
  assert.equal(next.first.campaign_id,'a');assert.equal(next.session.campaign_id,'b');
});
test('consultation pages have distinct groups without leaking query contents',()=>{
  for(const path of ['contact','how-we-help','who-aeo-is-for']){
    assert.equal(pageContext(`https://agenquest.com/${path}/?email=private`).page_group,path);
    assert.equal(pageContext(`https://agenquest.com/${path}/?email=private`).page_location,`https://agenquest.com/${path}/`);
  }
});
