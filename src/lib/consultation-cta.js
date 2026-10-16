export default function consultationCta(){return(tree)=>{
const label=node=>(node.children||[]).map(n=>n.value||label(n)).join('');
let index=tree.children.findIndex(n=>n.type==='heading'&&n.depth===2&&/what we would|what we'd|our plan|action plan|prioriti|what to change|next steps/i.test(label(n)));
if(index<0)index=tree.children.findIndex((n,i)=>i>4&&n.type==='heading'&&n.depth===2&&/method|disclosure|limitations|sources/i.test(label(n)));
if(index<0)return;
tree.children.splice(index,0,{type:'html',value:'<aside class="article-cta contextual-cta"><h2>What would this look like for your business?</h2><p>Share your website. We’ll review the public information and discuss initial findings and a tailored AEO plan on a free 30-minute call.</p><a class="button" href="/contact/">Get my free AEO plan</a></aside>'});
};}
