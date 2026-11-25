/** ClinGraph v4.1 Oral: zero-dependency UI, native oral Q1–Q13 JSON. */
(()=>{'use strict';
const $=id=>document.getElementById(id),clone=x=>structuredClone(x),list=s=>String(s||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
const escapeHTML=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),choiceKey=(q,id)=>`c:${q}:${id}`;
const SAVE='clingraph-oral-dag-v41',LAYOUT='clingraph-oral-panel-layout-v41';
let dag=null,seed=null,revision=0,selected=null,history=[],redoHistory=[],chat=[],suggestions=[],pending=null,working=false,showLeft=true,showRight=true,activeTab='detail';
let nodes=[],edges=[],nodeMap=new Map(),positions={},graphWidth=1100,graphHeight=950,zoom=1,lastGraphShape='';let noticeTimer=null;
function alertBar(message,error=false){const el=$('toast');el.textContent=(error?'⚠ ':'✓ ')+message;el.hidden=false;el.classList.toggle('error',error);clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{el.hidden=true;},error?8500:3800);}
async function post(path,data){const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});let value;try{value=await r.json();}catch{throw Error('服务器未返回有效 JSON');}if(!r.ok)throw Error(value.error||`HTTP ${r.status}`);return value;}
function qById(id){return dag?.nodes.find(n=>n.name===id)||null;}
function cById(q,id){return qById(q)?.choices.find(c=>c.id===id)||null;}
function outcomes(){const ids=new Set(dag.nodes.map(n=>n.name)),out=new Set(Object.keys(dag.outcome_metadata||{}));for(const q of dag.nodes)for(const c of q.choices)if(c.next&&!ids.has(c.next))out.add(c.next);return [...out];}
function current(){if(!selected)return null;if(selected.type==='question')return qById(selected.name);if(selected.type==='choice')return cById(selected.question_name,selected.choice_id);if(selected.type==='outcome')return outcomes().includes(selected.name)?{name:selected.name,medical_notes:dag.outcome_metadata?.[selected.name]?.medical_notes||[]}:null;return null;}
function selectionKey(s=selected){return s?(s.type==='choice'?choiceKey(s.question_name,s.choice_id):`${s.type==='question'?'q':'o'}:${s.name}`):null;}
function save(){if(!dag)return;try{localStorage.setItem(SAVE,JSON.stringify({dag,revision,chat:chat.slice(-40),positions}));}catch{alertBar('浏览器存储空间不足，请导出 JSON 备份',true);}}
function updateHistory(){$('undo').disabled=history.length===0;$('redo').disabled=redoHistory.length===0;$('revision').textContent=`修订 #${revision}`;}
function pushHistory(){history.push({dag:clone(dag),positions:clone(positions)});if(history.length>60)history.shift();redoHistory=[];}
function graphShape(d){return d.nodes.map(q=>`${q.name}:${q.choices.map(c=>`${c.id}>${c.next}`).join(',')}`).join('|')+'#'+(d.outcome_metadata?Object.keys(d.outcome_metadata).join(','):'');}
function commit(next,{msg='',resetPosition=false}={}){if(dag)pushHistory();const last=dag;dag=clone(next);revision++;
 if(resetPosition||!last||graphShape(last)!==graphShape(dag))positions={};
 if(selected&&!current())selected=null;pending=null;suggestions=[];renderAll();save();if(msg)alertBar(msg);
}
function undo(){if(!history.length)return;redoHistory.push({dag:clone(dag),positions:clone(positions)});const last=history.pop();dag=last.dag;positions=last.positions;revision++;selected=null;pending=null;suggestions=[];renderAll();save();alertBar('已撤销');}
function redo(){if(!redoHistory.length)return;history.push({dag:clone(dag),positions:clone(positions)});const next=redoHistory.pop();dag=next.dag;positions=next.positions;revision++;selected=null;pending=null;suggestions=[];renderAll();save();alertBar('已重做');}
async function manual(ops,msg){try{const result=await post('/api/patch/preview',{dag,operations:ops});commit(result.dag,{msg:msg||result.diff[0]||'修改已保存'});}catch(e){alertBar(e.message,true);}}
function select(key,{open=true}={}){const n=nodeMap.get(key);if(!n)return;selected=clone(n.selection);document.querySelectorAll('.dag-node').forEach(e=>e.classList.toggle('selected',e.dataset.key===key));renderContext();renderDetails();renderChanges();if(open)showTab('detail');}
function renderContext(){$('selected-context').textContent=selected?`已选中 ${selected.type.toUpperCase()}：${selected.type==='choice'?`${selected.question_name}/${selected.choice_id}`:selected.name}`:'当前未选中节点 · 可以审阅整图';}
function createVisual(){nodes=[];edges=[];nodeMap=new Map();const add=(key,type,label,eyebrow,selection,extras={})=>{
  const count=Array.from(label).length,chars=type==='outcome'?12:19,w=type==='outcome'?230:296,h=type==='outcome'?84:Math.max(108,58+Math.ceil(count/chars)*22);
  const n={key,type,label,eyebrow,selection,w,h,...extras};nodes.push(n);nodeMap.set(key,n);
};const qset=new Set(dag.nodes.map(q=>q.name));for(const q of dag.nodes){
 const qkey=`q:${q.name}`;add(qkey,'question',q.question,q.name,{type:'question',name:q.name});
 for(const c of q.choices){const ck=choiceKey(q.name,c.id);add(ck,'choice',c.text,`${q.name} · ${c.id}`,{type:'choice',question_name:q.name,choice_id:c.id},{evidenceCount:c.evidence?.length||0,unlinked:c.next==null});edges.push({from:qkey,to:ck});if(c.next)edges.push({from:ck,to:qset.has(c.next)?`q:${c.next}`:`o:${c.next}`});}
}for(const name of outcomes())add(`o:${name}`,'outcome',name,'OUTCOME · 疾病',{type:'outcome',name});}
function computeLayout({force=false}={}){createVisual();const incoming=new Map(nodes.map(n=>[n.key,[]])),outgoing=new Map(nodes.map(n=>[n.key,[]])),inDegree=new Map(nodes.map(n=>[n.key,0]));
 for(const e of edges){if(!incoming.has(e.to))continue;incoming.get(e.to).push(e.from);outgoing.get(e.from).push(e.to);inDegree.set(e.to,inDegree.get(e.to)+1);}
 const depth=new Map(nodes.map(n=>[n.key,0])),queue=nodes.filter(n=>inDegree.get(n.key)===0).map(n=>n.key);
 for(let i=0;i<queue.length;i++){const parent=queue[i];for(const to of outgoing.get(parent)){depth.set(to,Math.max(depth.get(to),depth.get(parent)+1));inDegree.set(to,inDegree.get(to)-1);if(inDegree.get(to)===0)queue.push(to);}}
 const levels=new Map();for(const n of nodes){const layer=depth.get(n.key);if(!levels.has(layer))levels.set(layer,[]);levels.get(layer).push(n);}const allLevels=[...levels].sort((a,b)=>a[0]-b[0]);
 let previousOrder=new Map();for(const [layer,group] of allLevels){if(layer>0)group.sort((a,b)=>{
   const mean=n=>{const parents=incoming.get(n.key).map(k=>previousOrder.get(k)).filter(x=>x!==undefined);return parents.length?parents.reduce((x,y)=>x+y,0)/parents.length:9999;};return mean(a)-mean(b);});
  for(let i=0;i<group.length;i++)previousOrder.set(group[i].key,i);
 }
 graphWidth=Math.max(950,...allLevels.map(([l,g])=>g.length*320+110));let y=104;const calculated={};for(const [level,group] of allLevels){const w=(group.length-1)*320+296,x0=(graphWidth-w)/2;for(let i=0;i<group.length;i++)calculated[group[i].key]={x:Math.round(x0+i*320+(296-group[i].w)/2),y};y+=Math.max(...group.map(n=>n.h))+75;}graphHeight=Math.max(660,y+70);
 if(force)positions={};for(const n of nodes)if(!positions[n.key]||!Number.isFinite(positions[n.key].x))positions[n.key]=calculated[n.key];for(const key of Object.keys(positions))if(!nodeMap.has(key))delete positions[key];
 for(const n of nodes){graphWidth=Math.max(graphWidth,positions[n.key].x+n.w+85);graphHeight=Math.max(graphHeight,positions[n.key].y+n.h+95);}
 const canvas=$('canvas');canvas.style.width=`${graphWidth}px`;canvas.style.height=`${graphHeight}px`;
}
function drawEdges(){const svg=$('edges');svg.replaceChildren();svg.setAttribute('width',graphWidth);svg.setAttribute('height',graphHeight);svg.setAttribute('viewBox',`0 0 ${graphWidth} ${graphHeight}`);
 const NS='http://www.w3.org/2000/svg';const elem=(name,props={})=>{const e=document.createElementNS(NS,name);for(const [k,v] of Object.entries(props))e.setAttribute(k,String(v));return e;};
 const defs=elem('defs'),marker=elem('marker',{id:'end-arrow',viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:7,markerHeight:7,orient:'auto'});marker.append(elem('path',{d:'M1 1L9 5L1 9',fill:'none',stroke:'#8f8da9','stroke-width':1.3}));defs.append(marker);svg.append(defs);
 for(const e of edges){const p=nodeMap.get(e.from),q=nodeMap.get(e.to),a=positions[e.from],b=positions[e.to];if(!p||!q||!a||!b)continue;
 const x=a.x+p.w/2,y=a.y+p.h,x2=b.x+q.w/2,y2=b.y,dy=Math.max(30,(y2-y)*.5);let d;
 if(y2>y+15)d=`M ${x} ${y} C ${x} ${y+dy}, ${x2} ${y2-dy}, ${x2} ${y2-7}`;
 else {const bend=y+95;d=`M ${x} ${y} C ${x} ${bend}, ${x2} ${bend}, ${x2} ${y2-7}`;}
 svg.append(elem('path',{d,fill:'none',stroke:'#a39fb6','stroke-width':1.7,'marker-end':'url(#end-arrow)'}));
 }
}
function drawNodes(){const layer=$('node-layer');layer.replaceChildren();for(const n of nodes){const p=positions[n.key],div=document.createElement('div');div.className=`dag-node ${n.type}${n.unlinked?' unlinked':''}${selectionKey()===n.key?' selected':''}`;div.style.cssText=`left:${p.x}px;top:${p.y}px;width:${n.w}px;height:${n.h}px`;div.dataset.key=n.key;div.tabIndex=0;div.setAttribute('role','button');div.setAttribute('aria-label',`${n.type} ${n.eyebrow} ${n.label}`);
 const heading=document.createElement('div');heading.className='node-type';const name=document.createElement('span');name.textContent=n.eyebrow;heading.append(name);if(n.type==='choice'){const ev=document.createElement('span');ev.className='ev-count';ev.textContent=`Evidence ${n.evidenceCount}`;heading.append(ev);}const label=document.createElement('div');label.className='node-label';label.textContent=n.label;div.append(heading,label);if(n.unlinked){const note=document.createElement('div');note.className='node-meta';note.textContent='⚠ 该分支暂未连接';div.append(note);}
 div.addEventListener('click',()=>select(n.key));div.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select(n.key);}});
 div.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.stopPropagation();select(n.key);div.setPointerCapture(e.pointerId);let dragged=false;const begin={x:e.clientX,y:e.clientY},old={...positions[n.key]};
 const move=ev=>{const dx=(ev.clientX-begin.x)/zoom,dy=(ev.clientY-begin.y)/zoom;if(Math.abs(dx)+Math.abs(dy)>5)dragged=true;if(!dragged)return;positions[n.key]={x:Math.max(5,old.x+dx),y:Math.max(5,old.y+dy)};div.style.left=positions[n.key].x+'px';div.style.top=positions[n.key].y+'px';drawEdges();};
 const stop=()=>{div.removeEventListener('pointermove',move);div.removeEventListener('pointerup',stop);div.removeEventListener('pointercancel',stop);if(dragged){const prev=zoom;graphWidth=Math.max(graphWidth,positions[n.key].x+n.w+60);graphHeight=Math.max(graphHeight,positions[n.key].y+n.h+60);$('canvas').style.width=graphWidth+'px';$('canvas').style.height=graphHeight+'px';drawEdges();setZoom(prev);save();}};
 div.addEventListener('pointermove',move);div.addEventListener('pointerup',stop,{once:true});div.addEventListener('pointercancel',stop,{once:true});});layer.append(div);
}}
function setZoom(z){zoom=Math.min(3.1,Math.max(.07,z));const area=$('viewport'),canvas=$('canvas'),left=Math.max(0,(area.clientWidth-graphWidth*zoom)/2);canvas.style.left=left+'px';canvas.style.transform=`scale(${zoom})`;area.style.setProperty('--scroll-w',Math.max(area.clientWidth,graphWidth*zoom+left)+'px');area.style.setProperty('--scroll-h',Math.max(area.clientHeight,graphHeight*zoom)+'px');$('zoom-percent').textContent=Math.round(zoom*100)+'%';}
function zoomAround(z,clientX,clientY){const area=$('viewport'),r=area.getBoundingClientRect(),x=clientX-r.left,y=clientY-r.top;const oldLeft=parseFloat($('canvas').style.left)||0,anchorX=(area.scrollLeft+x-oldLeft)/zoom,anchorY=(area.scrollTop+y)/zoom;setZoom(z);const nextLeft=parseFloat($('canvas').style.left)||0;area.scrollLeft=anchorX*zoom+nextLeft-x;area.scrollTop=anchorY*zoom-y;}
function zoomCenter(f){const r=$('viewport').getBoundingClientRect();zoomAround(zoom*f,r.left+r.width/2,r.top+r.height/2);}
function fitAll(){const a=$('viewport');setZoom(Math.min((a.clientWidth-35)/graphWidth,(a.clientHeight-40)/graphHeight,1.2));a.scrollLeft=0;a.scrollTop=0;}
function fitWidth(){const a=$('viewport');setZoom(Math.min((a.clientWidth-35)/graphWidth,1.25));a.scrollLeft=0;a.scrollTop=0;}
function centerOn(key){const n=nodeMap.get(key),p=positions[key];if(!n||!p)return;const v=$('viewport');if(zoom<.65)setZoom(.8);v.scrollLeft=Math.max(0,(p.x+n.w/2)*zoom+(parseFloat($('canvas').style.left)||0)-v.clientWidth/2);v.scrollTop=Math.max(0,(p.y+n.h/2)*zoom-v.clientHeight/2);select(key);}
function renderGraph(){computeLayout();drawEdges();drawNodes();setZoom(zoom);$('stats').textContent=`${dag.nodes.length} Question · ${dag.nodes.reduce((n,q)=>n+q.choices.length,0)} Choice · ${outcomes().length} Outcome`;
 const jump=$('jump'),last=jump.value;jump.innerHTML='<option value="">⌕ 定位节点…</option>'+nodes.map(n=>`<option value="${escapeHTML(n.key)}">${escapeHTML(n.eyebrow)} · ${escapeHTML(n.label.slice(0,12))}</option>`).join('');if([...jump.options].some(o=>o.value===last))jump.value=last;
}
function choiceOptions(currentNext){const items=[...dag.nodes.map(q=>({value:q.name,label:`Q · ${q.name}`})),...outcomes().map(s=>({value:s,label:`疾病 · ${s}`}))];return '<option value="">— 未连接（草稿）—</option>'+items.map(o=>`<option value="${escapeHTML(o.value)}" ${currentNext===o.value?'selected':''}>${escapeHTML(o.label)}</option>`).join('');}
function detailHeader(type,text,heading=''){return `<div class="detail-header"><small>${escapeHTML(type)}</small>${heading?`<strong>${escapeHTML(heading)}</strong>`:''}</div>`;}
function renderDetails(){const el=$('details'),n=current();if(!n){el.innerHTML='<div class="empty"><strong>请选择 DAG 上的节点</strong>点击黄色 Question、蓝色 Choice 或绿色 Outcome，查看或修改医学属性。Evidence 只有点击 Choice 才会显示。</div>';return;}
 const notes=(n.medical_notes||[]).join('\n');let body='';
 if(selected.type==='question'){body=detailHeader(`QUESTION · ${n.name}`,n.question,n.question)+`<label class="field-label" for="edit-main">临床问题</label><textarea id="edit-main" class="field textarea">${escapeHTML(n.question)}</textarea><label class="field-label" for="edit-notes">医学备注（每行一条）</label><textarea id="edit-notes" class="field textarea">${escapeHTML(notes)}</textarea><p class="helper">包含 ${n.choices.length} 个 Choice。Question ID 不因修改文字而改变。</p><div class="detail-actions"><button class="btn violet" id="save-detail">✓ 保存医生修改</button><button class="btn" id="detail-add-choice">＋ Choice</button><button class="btn danger" id="delete-detail">删除问题</button></div><h3 class="section-title" style="margin-top:23px">下游选项</h3>`+n.choices.map(c=>`<button class="btn" data-select="${escapeHTML(choiceKey(n.name,c.id))}" style="display:block;width:100%;text-align:left;white-space:normal;margin:7px 0">${escapeHTML(c.id)} · ${escapeHTML(c.text.slice(0,68))}</button>`).join('');
 }else if(selected.type==='choice'){body=detailHeader(`CHOICE · ${selected.question_name}/${selected.choice_id}`)+`<textarea class="field textarea choice-text" id="edit-main" aria-label="Choice 回答内容" title="编辑 Choice 的回答文字">${escapeHTML(n.text)}</textarea><div class="choice-next-row"><span aria-hidden="true">↳</span><select class="field" id="edit-next" aria-label="下一节点" title="选择这条 Choice 后连接的节点">${choiceOptions(n.next)}</select></div><label class="field-label" for="edit-evidence">Evidence 临床线索（每行一条）</label><textarea id="edit-evidence" class="field textarea evidence-field" placeholder="每行一条，不在 DAG 画布展开">${escapeHTML((n.evidence||[]).join('\n'))}</textarea><label class="field-label" for="edit-notes">医学备注（每行一条）</label><textarea id="edit-notes" class="field textarea">${escapeHTML(notes)}</textarea><div class="detail-actions"><button class="btn violet" id="save-detail">✓ 保存修改</button><button class="btn" id="insert-question">＋ 后插 Question</button><button class="btn danger" id="delete-detail">删除 Choice</button></div>`;
 }else{body=detailHeader('OUTCOME · 疾病终点',n.name,n.name)+`<label class="field-label" for="edit-main">疾病名称（会同步修改所有引用）</label><input class="field" id="edit-main" value="${escapeHTML(n.name)}"><label class="field-label" for="edit-notes">医学备注（每行一条）</label><textarea id="edit-notes" class="field textarea">${escapeHTML(notes)}</textarea><p class="helper">多条 Choice 允许汇合到同一种疾病；图中只生成一个 Outcome。</p><div class="detail-actions"><button class="btn violet" id="save-detail">✓ 保存修改</button><button class="btn danger" id="delete-detail">删除疾病</button></div>`;}
 el.innerHTML=body;
}
function auditCards(){const el=$('suggestions');if(!suggestions.length){el.innerHTML='<h3 class="section-title">Agent 知识缺口建议</h3><div class="info-card"><b>建议不是已应用的修改</b><p class="helper">点击“检查当前 DAG”，Agent 会针对现有 Question、Choice、Evidence 和分支提出进一步完善的意见。</p></div><button class="btn violet" id="audit-now">✦ 检查当前 DAG</button>';return;}el.innerHTML=`<h3 class="section-title">建议列表（${suggestions.length} 条）</h3>`+suggestions.map((s,i)=>`<div class="suggestion-card"><span class="pill">${escapeHTML(s.category)}</span><strong style="margin-top:9px">${escapeHTML(s.observation)}</strong><p><b>建议：</b>${escapeHTML(s.proposed_change)}</p><p><b>原因：</b>${escapeHTML(s.rationale)}</p><div class="detail-actions"><button class="btn small" data-suggest-locate="${i}">定位节点</button><button class="btn small" data-suggest-edit="${i}">生成修改提案</button></div></div>`).join('');}
function findPaths(destination){const result=[],active=new Set();function visit(name,steps){if(result.length>=25||active.has(name))return;active.add(name);const q=qById(name);if(!q){if(name===destination)result.push([...steps,`Outcome：${name}`]);active.delete(name);return;}for(const c of q.choices)if(c.next)visit(c.next,[...steps,`${q.name}：${q.question}`,`↳ ${c.text}`]);active.delete(name);}visit(dag.root,[]);return result;}
function renderChanges(){let html='<h3 class="section-title">修改差异与鉴别路径</h3>';if(pending){html+=`<div class="diff-card"><b>待医生确认 · 修订 #${pending.base_revision}</b><p>${escapeHTML(pending.reply)}</p>`+(pending.kind==='patch'?`<ul>${pending.diff.map(d=>`<li>${escapeHTML(d)}</li>`).join('')}</ul>`:`<p>整图草案：${pending.dag.nodes.length} 个问题、${pending.dag.nodes.reduce((x,q)=>x+q.choices.length,0)} 个选项。</p>`)+`<div class="detail-actions"><button id="change-accept" class="btn violet">接受修改</button><button id="change-reject" class="btn">拒绝</button></div></div>`;}
 else html+='<div class="info-card">当前没有待确认的 Agent Patch。只有医生接受后，图才会被更新。</div>';
 if(selected?.type==='outcome'){const paths=findPaths(selected.name);html+=`<h3 class="section-title">通向 ${escapeHTML(selected.name)} 的路径</h3>`+(paths.length?paths.map((path,i)=>`<div class="path-card"><b>路径 ${i+1}</b><ol>${path.map(t=>`<li>${escapeHTML(t)}</li>`).join('')}</ol></div>`).join(''):'<p class="helper">该疾病暂未接入根节点。</p>');}
 else if(selected?.type==='choice'){const c=current();html+=`<div class="path-card">${escapeHTML(selected.question_name)} → ${escapeHTML(selected.choice_id)} → ${escapeHTML(c?.next||'未连接')}</div>`;}
 else html+='<p class="helper">点击某个 Outcome 可查看多条 Choice 汇合到该疾病的完整路径。</p>';
 $('changes').innerHTML=html;$('proposal-bar').hidden=!pending;if(pending)$('proposal-title').textContent=`Agent 生成了 ${pending.kind==='patch'?pending.operations.length+' 项局部变更':'整图草案'}，尚未应用到 DAG`;
}
function showTab(name){activeTab=name;if(!showRight){showRight=true;setPanels(false);}for(const t of ['detail','suggestions','changes']){$(`tab-${t}`).classList.toggle('active',name===t);$({detail:'details',suggestions:'suggestions',changes:'changes'}[t]).hidden=t!==name;}if(name==='detail')renderDetails();else if(name==='suggestions')auditCards();else renderChanges();}
function renderChat(){const area=$('messages');area.replaceChildren();for(const m of chat){const div=document.createElement('div');div.className='message '+(m.role==='doctor'?'doctor':'');const sp=document.createElement('span');sp.className='speaker';sp.textContent=m.role==='doctor'?'医生':'ClinGraph Agent'+(m.source==='offline'?' · 离线示例':'');const text=document.createElement('div');text.textContent=m.text;div.append(sp,text);area.append(div);}if(working){const w=document.createElement('div');w.className='message';w.textContent='Agent 正在分析当前 DAG…';area.append(w);}if(chat.length>1)area.parentElement.scrollTop=area.parentElement.scrollHeight;}
function renderAll(){renderGraph();renderContext();renderDetails();auditCards();renderChanges();renderChat();updateHistory();}
function setPanels(fit=true){const w=$('workspace');w.classList.toggle('hide-left',!showLeft);w.classList.toggle('hide-right',!showRight);$('toggle-left').textContent=showLeft?'◧ 收起对话':'◨ 显示对话';$('toggle-right').textContent=showRight?'◨ 收起详情':'◧ 显示详情';$('focus').textContent=!showLeft&&!showRight?'⤡ 恢复三栏':'⛶ 专注 DAG';try{localStorage.setItem(LAYOUT,JSON.stringify({showLeft,showRight}));}catch{}if(fit)requestAnimationFrame(()=>requestAnimationFrame(fitWidth));}
function modeInfo(){const desc={edit:'Agent 只提出局部修改；医生确认后才更新 DAG。',audit:'只分析知识缺口、给出建议，不修改 DAG。',generate:'生成新的完整图，医生二次确认后才替换旧图。'};$('mode-help').textContent=desc[$('agent-mode').value];}
async function send(message,mode){if(working)return;const instruction=String(message??$('chat-input').value).trim();if(!instruction)return;mode=mode||$('agent-mode').value;const baseRevision=revision,currentDag=clone(dag),sel=selected?clone(selected):null;chat.push({role:'doctor',text:instruction});$('chat-input').value='';working=true;$('send').disabled=true;renderChat();save();
 try{const r=await post('/api/agent',{mode,instruction,selected:sel,dag:currentDag,base_revision:baseRevision,history:chat.slice(-8).map(m=>({role:m.role,content:m.text}))});if(revision!==baseRevision){chat.push({role:'agent',text:'此时医生已经修改了图，之前的提案已过期，未应用。'});return;}
  chat.push({role:'agent',text:r.reply||'已完成。',source:r.source});
  if(mode==='audit'){suggestions=r.suggestions||[];showTab('suggestions');}
  else if(mode==='edit'){
    if(Array.isArray(r.operations)&&r.operations.length){const result=await post('/api/patch/preview',{dag,operations:r.operations});pending={kind:'patch',base_revision:baseRevision,reply:r.reply,operations:r.operations,dag:result.dag,diff:result.diff,warnings:result.warnings};showTab('changes');alertBar('修改仅为提案，尚未保存到 DAG');}
    else alertBar('本轮没有候选修改，请查看 Agent 回复');if(r.suggestions?.length)suggestions=r.suggestions;
  }else if(mode==='generate'&&r.dag){const result=await post('/api/validate',{dag:r.dag});pending={kind:'generate',base_revision:baseRevision,reply:r.reply,dag:result.dag};showTab('changes');}
 }catch(e){chat.push({role:'agent',text:'本轮操作未应用到 DAG：'+e.message});alertBar(e.message,true);}finally{working=false;$('send').disabled=false;renderChat();renderChanges();auditCards();save();}
}
function acceptPending(){if(!pending)return;if(pending.base_revision!==revision){alertBar('DAG 已发生其他修改，此提案已过期',true);pending=null;renderChanges();return;}
 if(pending.kind==='generate'&&!confirm('这会用整图草案替换当前 DAG。确认继续？'))return;const p=pending;commit(p.dag,{msg:'医生已确认应用 '+(p.kind==='patch'?'局部 Patch':'整图草案'),resetPosition:true});fitAll();chat.push({role:'agent',text:'医生已审核并应用本次修改。'});renderChat();save();}
function rejectPending(){pending=null;renderChanges();alertBar('已拒绝候选修改，现有 DAG 不变');}
function nextQuestionId(){let i=14;while(qById('Q'+i))i++;return 'Q'+i;}
function nextChoiceId(q){let i=1;while(cById(q,'a'+i))i++;return 'a'+i;}
async function addQuestion(){if(selected?.type==='choice'){const value=prompt('在选中 Choice 后插入什么临床问题？','请医生补充待鉴别的临床问题？');if(value!==null)insertQuestion(value);return;}
 const value=prompt('新临床问题：','请医生补充待鉴别的临床问题？');if(value===null)return;const id=nextQuestionId();await manual([{op:'add_question',question:{name:id,question:value.trim()||'待填写的临床问题',choices:[]}}],`已创建 ${id}（待接入路径）`);}
function insertQuestion(value){if(selected?.type!=='choice'){alertBar('请先选择蓝色 Choice',true);return;}const parent=selected,id=nextQuestionId(),old=current()?.next||null,newQ={name:id,question:value.trim()||'待填写的临床问题',choices:[{id:'a1',text:'原有候选路径（请医生完善文字）',next:old,evidence:[]},{id:'a2',text:'其他情况（待补充分支）',next:null,evidence:[]}]};manual([{op:'insert_question_after_choice',question_name:parent.question_name,choice_id:parent.choice_id,new_question:newQ}],`已在 ${parent.question_name}/${parent.choice_id} 后插入 ${id}`);}
function addChoice(){const id=selected?.type==='question'?selected.name:selected?.type==='choice'?selected.question_name:null;if(!id){alertBar('先选择 Question 或它下方的 Choice',true);return;}const text=prompt('新增 Choice 的回答文本：','待医生完善的新回答');if(text===null)return;const cId=nextChoiceId(id);manual([{op:'add_choice',question_name:id,choice:{id:cId,text:text.trim()||'待补充回答',next:null,evidence:[]}}],`已为 ${id} 新增 ${cId}（尚未连接）`);}
function addOutcome(){const input=prompt('新候选疾病名称：','');if(input===null)return;const name=input.trim();if(!name){alertBar('疾病名称不能为空',true);return;}const ops=[{op:'add_outcome',outcome_name:name}];if(selected?.type==='choice'&&!current()?.next&&confirm(`把选中 Choice 连接到新增疾病「${name}」吗？`))ops.push({op:'set_choice_next',question_name:selected.question_name,choice_id:selected.choice_id,next:name});manual(ops,`已新增疾病 ${name}`);}
function saveDetail(){const n=current();if(!n)return;const value=$('edit-main')?.value.trim();if(!value){alertBar('节点文本不能为空',true);return;}const note=list($('edit-notes')?.value),ops=[],s=selected;
 if(s.type==='question'){
  if(value!==n.question)ops.push({op:'update_question',question_name:s.name,new_text:value});
  if(!same(note,n.medical_notes||[]))ops.push({op:'set_medical_notes',target_type:'question',question_name:s.name,medical_notes:note});
 }else if(s.type==='choice'){
  if(value!==n.text)ops.push({op:'update_choice',question_name:s.question_name,choice_id:s.choice_id,new_text:value});
  const target=$('edit-next').value||null;if(target!==(n.next??null))ops.push({op:'set_choice_next',question_name:s.question_name,choice_id:s.choice_id,next:target});
  const ev=list($('edit-evidence').value);if(!same(ev,n.evidence||[]))ops.push({op:'set_choice_evidence',question_name:s.question_name,choice_id:s.choice_id,items:ev});
  if(!same(note,n.medical_notes||[]))ops.push({op:'set_medical_notes',target_type:'choice',question_name:s.question_name,choice_id:s.choice_id,medical_notes:note});
 }else{
  if(value!==n.name)ops.push({op:'rename_outcome',old_name:n.name,new_name:value});
  if(!same(note,n.medical_notes||[]))ops.push({op:'set_medical_notes',target_type:'outcome',outcome_name:value,medical_notes:note});
 }
 if(!ops.length){alertBar('没有修改内容');return;}if(s.type==='outcome')selected={...s,name:value};manual(ops,'医生的修改已保存');
}
function deleteDetail(){if(!selected||!confirm('删除当前节点？被其他分支引用的节点会受到保护。'))return;let op;
 if(selected.type==='question')op={op:'delete_question',question_name:selected.name};
 else if(selected.type==='choice')op={op:'delete_choice',question_name:selected.question_name,choice_id:selected.choice_id};
 else op={op:'delete_outcome',outcome_name:selected.name};manual([op],'已删除节点');}
function selectSuggestion(i,edit){const s=suggestions[i];if(!s)return;const t=s.target||{};const k=t.type==='choice'?choiceKey(t.question_name,t.choice_id):t.type==='question'?`q:${t.question_name||t.name}`:`o:${t.outcome_name||t.name}`;if(nodeMap.has(k))centerOn(k);
 if(edit){const instruction=`请根据这条知识图建议，只提出最小修改 Patch（等待医生审核）：\n目标：${JSON.stringify(t)}\n观察：${s.observation}\n建议：${s.proposed_change}\n理由：${s.rationale}`;send(instruction,'edit');}
}
function download(filename,value){const obj=new Blob([JSON.stringify(value,null,2)],{type:'application/json'}),url=URL.createObjectURL(obj),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
async function importFile(file){if(!file)return;try{const text=await file.text(),json=JSON.parse(text),incoming=json.dag||json,checked=await post('/api/validate',{dag:incoming});if(!confirm(`导入包含 ${checked.counts.questions} 个问题、${checked.counts.choices} 个选项、${checked.counts.outcomes} 种疾病的 DAG？将替换当前图。`))return;selected=null;commit(checked.dag,{msg:'已导入口腔问答 DAG',resetPosition:true});fitAll();}catch(e){alertBar('导入失败：'+e.message,true);}finally{$('import-file').value='';}}
async function restore(){if(!confirm('恢复最初提供的口腔科 Q1–Q13？请先导出重要修改。当前图可以撤销恢复。'))return;selected=null;commit(seed,{msg:'已恢复 Q1–Q13 原始口腔科图',resetPosition:true});fitAll();}
function setupQuick(){const buttons=[
 ['检查当前 DAG','audit','请从口腔科鉴别知识图谱角度审阅 Q1–Q13 的问题、分支和 Evidence，提出具体可定位的完善建议，不修改现有图。'],
 ['给 Question 加 Choice','edit','请为选中 Question 增加一个合理的 Choice，保留已有分支。尚无下游时 next:null。',['question']],
 ['在 Choice 后插入问题','edit','请在选中的 Choice 与其原目标间插入新的 Question，至少有一条选项保留原结局路径。',['choice']],
 ['补充 Choice Evidence','edit','只补充选中 Choice 的临床线索 Evidence，不删除原有条目、不改 next。',['choice']],
 ['增加新疾病分支','edit','在选中的问题或 Choice 附近设计可用于鉴别的新疾病 Outcome 和必要的问题/回答分支，不限制疾病数量。',['question','choice']],
 ['优化节点文字/备注','edit','只改选中节点文本或医学备注，保留其他节点、Evidence 和连线。',['question','choice','outcome']]];
 const area=$('quick-list');area.replaceChildren();for(const [name,mode,promptText,allowed] of buttons){const btn=document.createElement('button');btn.textContent=name;btn.title=promptText;btn.onclick=()=>{if(allowed&&!allowed.includes(selected?.type)){alertBar('请先选中相应类型的 DAG 节点',true);return;}$('agent-mode').value=mode;modeInfo();send(promptText,mode);};area.append(btn);}
}
function setup(){
 $('toggle-left').onclick=()=>{showLeft=!showLeft;setPanels();};$('toggle-right').onclick=()=>{showRight=!showRight;setPanels();};$('focus').onclick=()=>{const isFocused=!showLeft&&!showRight;showLeft=isFocused;showRight=isFocused;setPanels();};
 $('undo').onclick=undo;$('redo').onclick=redo;$('reset').onclick=restore;$('export-btn').onclick=()=>{download('ClinGraph_口腔科_Q1-Q13_DAG.json',dag);alertBar('已导出当前图（包含 Evidence）');};$('import-btn').onclick=()=>$('import-file').click();$('import-file').onchange=e=>importFile(e.target.files?.[0]);
 $('tab-detail').onclick=()=>showTab('detail');$('tab-suggestions').onclick=()=>showTab('suggestions');$('tab-changes').onclick=()=>showTab('changes');
 $('add-question').onclick=addQuestion;$('add-choice').onclick=addChoice;$('add-outcome').onclick=addOutcome;$('reflow').onclick=()=>{positions={};renderGraph();fitAll();save();alertBar('已重新排列 DAG');};
 $('zoom-in').onclick=()=>zoomCenter(1.2);$('zoom-out').onclick=()=>zoomCenter(1/1.2);$('fit-btn').onclick=fitAll;$('fit-all').onclick=fitAll;$('fit-width').onclick=fitWidth;
 $('jump').onchange=e=>{if(e.target.value)centerOn(e.target.value);};
 $('agent-mode').onchange=modeInfo;modeInfo();$('send').onclick=()=>send();$('chat-input').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}};
 $('proposal-view').onclick=()=>showTab('changes');$('proposal-accept').onclick=acceptPending;$('proposal-reject').onclick=rejectPending;
 $('right-body').addEventListener('click',e=>{const btn=e.target.closest('button');if(!btn)return;const id=btn.id;if(id==='save-detail')saveDetail();else if(id==='detail-add-choice')addChoice();else if(id==='insert-question'){const s=prompt('插入什么临床问题？','请医生补充进一步鉴别的问题？');if(s!==null)insertQuestion(s);}else if(id==='delete-detail')deleteDetail();else if(id==='audit-now')send('请检查当前口腔科 DAG 的知识缺口、临床问题、Choice 和 Evidence 是否需要进一步完善；不要改动图。','audit');else if(id==='change-accept')acceptPending();else if(id==='change-reject')rejectPending();else if(btn.dataset.select)select(btn.dataset.select);else if(btn.dataset.suggestLocate!==undefined)selectSuggestion(Number(btn.dataset.suggestLocate),false);else if(btn.dataset.suggestEdit!==undefined)selectSuggestion(Number(btn.dataset.suggestEdit),true);});
 const viewport=$('viewport');$('graph-wrapper').addEventListener('wheel',e=>{if(!e.ctrlKey&&!e.metaKey)return;e.preventDefault();const factor=e.deltaMode===1?16:e.deltaMode===2?viewport.clientHeight:1;zoomAround(zoom*Math.exp(-e.deltaY*factor*.0016),e.clientX,e.clientY);},{passive:false});
 viewport.addEventListener('pointerdown',e=>{if(e.button!==0&&e.button!==1)return;if(![viewport,$('canvas'),$('node-layer'),$('edges')].includes(e.target))return;const x=e.clientX,y=e.clientY,left=viewport.scrollLeft,top=viewport.scrollTop;viewport.setPointerCapture(e.pointerId);viewport.classList.add('dragging');const move=ev=>{viewport.scrollLeft=left-(ev.clientX-x);viewport.scrollTop=top-(ev.clientY-y);};const stop=()=>{viewport.removeEventListener('pointermove',move);viewport.removeEventListener('pointerup',stop);viewport.removeEventListener('pointercancel',stop);viewport.classList.remove('dragging');};viewport.addEventListener('pointermove',move);viewport.addEventListener('pointerup',stop,{once:true});viewport.addEventListener('pointercancel',stop,{once:true});});
 viewport.addEventListener('click',e=>{if([viewport,$('canvas'),$('node-layer'),$('edges')].includes(e.target)){selected=null;document.querySelectorAll('.dag-node.selected').forEach(x=>x.classList.remove('selected'));renderContext();renderDetails();renderChanges();}});
 document.addEventListener('keydown',e=>{if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();}});
 window.addEventListener('resize',()=>requestAnimationFrame(fitWidth));setupQuick();
}
async function init(){setup();try{const flags=JSON.parse(localStorage.getItem(LAYOUT)||'null');if(flags){showLeft=flags.showLeft!==false;showRight=flags.showRight!==false;}}catch{}setPanels(false);
 try{const [r1,r2]=await Promise.all([fetch('/api/bootstrap'),fetch('/api/status')]);if(!r1.ok)throw Error('无法读取口腔科初始数据');const boot=await r1.json(),status=await r2.json();seed=boot.dag;let old;try{old=JSON.parse(localStorage.getItem(SAVE)||'null');}catch{}
  if(old?.dag?.root&&Array.isArray(old.dag.nodes)){try{const v=await post('/api/validate',{dag:old.dag});dag=v.dag;revision=old.revision||0;positions=old.positions||{};chat=Array.isArray(old.chat)?old.chat:[];}catch{dag=clone(seed);}}
  else dag=clone(seed);
  $('service-status').textContent=status.mode==='live'?`● Agent 已配置 · ${status.model}`:'● 离线模式 · 可直接编辑';
  if(!chat.length)chat=[{role:'agent',text:'口腔科 Q1–Q13 已载入，包含 13 个临床问题、32 个回答和 15 种候选疾病。点击蓝色 Choice 查看/修改 Evidence；Agent 的所有修改需要医生确认。'}];
  renderAll();requestAnimationFrame(fitAll);
 }catch(e){alertBar('启动失败：'+e.message,true);}
}
init();
})();
