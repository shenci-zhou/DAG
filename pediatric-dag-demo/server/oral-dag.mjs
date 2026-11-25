/** ClinGraph v4.1 Oral — immutable, doctor-reviewed Question / Choice / Outcome DAG. */
const clone=value=>structuredClone(value);
const nonempty=(v,label,max=2500)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw Error(`${label} 必须是非空文本（最多 ${max} 字）`);return v;};
const strings=(v,label)=>{if(v===undefined)return [];if(!Array.isArray(v)||v.length>150||v.some(x=>typeof x!=='string'||x.length>1000))throw Error(`${label} 必须是文本列表`);return v;};
const qId=/^Q\d+[A-Za-z0-9_-]*$/;
const qMap=dag=>new Map(dag.nodes.map(q=>[q.name,q]));
export const choiceKey=(q,id)=>`c:${q}:${id}`;
export const getChoice=(dag,q,id)=>{const question=dag.nodes.find(n=>n.name===q);if(!question)throw Error(`找不到问题 ${q}`);const c=question.choices.find(x=>x.id===id);if(!c)throw Error(`找不到选项 ${q}/${id}`);return c;};
export const getQuestion=(dag,q)=>{const n=dag.nodes.find(n=>n.name===q);if(!n)throw Error(`找不到问题 ${q}`);return n;};
export function outcomeNames(dag){const questionIds=new Set(dag.nodes.map(n=>n.name));const outcomes=new Set(Object.keys(dag.outcome_metadata||{}));for(const n of dag.nodes)for(const c of n.choices){if(c.next && !questionIds.has(c.next) && !qId.test(c.next))outcomes.add(c.next);}return [...outcomes];}
/** Validates native oral JSON exactly; choices are unique within their parent question. */
export function validateDAG(input,{allowDraft=true}={}){
  if(!input||typeof input!=='object'||!Array.isArray(input.nodes)||input.nodes.length>500)throw Error('DAG 需要 nodes 数组（最多 500 个问题）');
  const dag=clone(input);nonempty(dag.root,'root',100);
  if(dag.evidence_status!==undefined)nonempty(dag.evidence_status,'evidence_status',80);
  if(dag.source!==undefined)nonempty(dag.source,'source',600);
  if(dag.outcome_metadata!==undefined && (!dag.outcome_metadata||typeof dag.outcome_metadata!=='object'||Array.isArray(dag.outcome_metadata)))throw Error('outcome_metadata 应当是对象');
  const names=new Set(),warnings=[];
  for(const n of dag.nodes){
    if(!n || typeof n!=='object')throw Error('发现无效 Question');
    nonempty(n.name,'Question ID',100);if(!qId.test(n.name))throw Error(`问题 ID 应类似 Q1、Q13 或 Q5A：${n.name}`);
    if(names.has(n.name))throw Error(`Question ID 重复：${n.name}`);names.add(n.name);
    nonempty(n.question,`${n.name}.question`,2000);
    strings(n.medical_notes,`${n.name}.medical_notes`);
    if(!Array.isArray(n.choices)||n.choices.length>100)throw Error(`${n.name} 必须包含 choices 数组`);
    if(!n.choices.length)warnings.push(`${n.name} 暂无 Choice`);
    const localIds=new Set();
    for(const c of n.choices){
      if(!c||typeof c!=='object')throw Error(`${n.name} 存在无效 Choice`);
      nonempty(c.id,`${n.name}.choice.id`,100);
      if(localIds.has(c.id))throw Error(`${n.name} 内 Choice ID 重复：${c.id}`);localIds.add(c.id);
      nonempty(c.text,`${n.name}/${c.id}.text`,2500);
      strings(c.evidence,`${n.name}/${c.id}.evidence`);strings(c.medical_notes,`${n.name}/${c.id}.medical_notes`);
      if(c.next===null||c.next===undefined){if(!allowDraft)throw Error(`${n.name}/${c.id} 尚未连接下游，不能发布`);warnings.push(`${n.name}/${c.id} 暂未连接下游`);}
      else nonempty(c.next,`${n.name}/${c.id}.next`,140);
    }
  }
  if(!names.has(dag.root))throw Error(`根节点 ${dag.root} 不存在`);
  const metadata=dag.outcome_metadata||{};
  for(const [name,value] of Object.entries(metadata)){
    nonempty(name,'Outcome 名称',140);if(names.has(name)||qId.test(name))throw Error(`Outcome 名称与 Question ID 冲突：${name}`);
    if(!value||typeof value!=='object'||Array.isArray(value))throw Error(`${name} 的 Outcome 属性无效`);
    strings(value.medical_notes,`${name}.medical_notes`);
  }
  const adj=new Map(dag.nodes.map(n=>[n.name,[]]));
  for(const n of dag.nodes)for(const c of n.choices){if(c.next===undefined||c.next===null)continue;
    if(names.has(c.next))adj.get(n.name).push(c.next);
    else if(qId.test(c.next))throw Error(`${n.name}/${c.id} 指向不存在的 Question：${c.next}`);
  }
  const active=new Set(),visited=new Set();function dfs(id){if(active.has(id))throw Error(`DAG 出现环：${id}`);if(visited.has(id))return;active.add(id);for(const to of adj.get(id))dfs(to);active.delete(id);visited.add(id);}for(const id of names)dfs(id);
  const reachable=new Set();function walk(id){if(reachable.has(id))return;reachable.add(id);for(const to of adj.get(id))walk(to);}walk(dag.root);
  for(const id of names)if(!reachable.has(id))warnings.push(`${id} 尚不能从根节点到达（草稿）`);
  const counts={questions:dag.nodes.length,choices:dag.nodes.reduce((n,q)=>n+q.choices.length,0),outcomes:outcomeNames(dag).length};
  return {dag,counts,warnings};
}
const assertQuestionFree=(dag,name)=>{nonempty(name,'Question ID');if(dag.nodes.some(n=>n.name===name))throw Error(`Question ${name} 已存在`);if(outcomeNames(dag).includes(name))throw Error(`该名字已经用作 Outcome：${name}`);};
const assertChoiceFree=(dag,q,id)=>{nonempty(id,'Choice ID');if(getQuestion(dag,q).choices.some(c=>c.id===id))throw Error(`${q} 的 Choice ${id} 已存在`);};
const assertOutcomeFree=(dag,name)=>{nonempty(name,'Outcome 名称');if(qId.test(name)||outcomeNames(dag).includes(name))throw Error(`Outcome ${name} 已存在或保留为 Question ID`);};
const existingTargets=dag=>new Set([...dag.nodes.map(n=>n.name),...outcomeNames(dag)]);
/** Normalize a model's missing target only for a NEW choice, with explicit warning. */
export function normalizeAgentPatch(dag,raw){
 if(!Array.isArray(raw)||raw.length>40)throw Error('Agent 的 operations 必须是数组（最多 40 项）');
 const operations=clone(raw),targets=existingTargets(dag),notes=[];
 for(const p of operations){if(p?.op==='add_question'&&p.question?.name)targets.add(p.question.name);
  if(p?.op==='insert_question_after_choice'&&p.new_question?.name)targets.add(p.new_question.name);
  if(p?.op==='add_outcome'&&p.outcome_name)targets.add(p.outcome_name);
  if(p?.op==='rename_outcome'&&p.new_name)targets.add(p.new_name);
 }
 for(const p of operations){
  if(p?.op==='add_choice'&&p.choice&&typeof p.choice.next==='string'&&!targets.has(p.choice.next)){
    const old=p.choice.next;p.choice.next=null;
    notes.push(`${p.question_name}/${p.choice.id} 原本指向未创建的「${old}」，已安全改为“待连接”草稿；请医生确认后指定实际下游。`);
  }
 }
 return {operations,notes};
}
/** Apply atomic changes to a clone, leaving original immutable. */
export function applyPatch(original,operations,{allowDraft=true}={}){
 let dag=validateDAG(original).dag;if(!Array.isArray(operations)||operations.length>40)throw Error('Patch 操作格式错误（最多 40 项）');
 const diff=[];
 // A Patch is one atomic transaction: references to a target added later in the
 // same batch are valid, but any dangling reference after application is rejected.
 const planned=new Set();for(const operation of operations){
  if(operation?.op==='add_question' && operation.question?.name)planned.add(operation.question.name);
  if(operation?.op==='insert_question_after_choice' && operation.new_question?.name)planned.add(operation.new_question.name);
  if(operation?.op==='add_outcome' && operation.outcome_name)planned.add(operation.outcome_name);
  if(operation?.op==='rename_outcome' && operation.new_name)planned.add(operation.new_name);
 }
 const assertNext=(name)=>{if(name!==null && name!==undefined && !existingTargets(dag).has(name) && !planned.has(name))throw Error(`下游目标不存在：${name}，请先创建 Question/Outcome`);};
 for(const p of operations){if(!p ||typeof p!=='object')throw Error('Patch 中含无效操作');const id=p.question_name, cid=p.choice_id;
  switch(p.op){
   case 'add_question':{const n=clone(p.question);if(!n||!Array.isArray(n.choices))throw Error('add_question 需要 question 对象');assertQuestionFree(dag,n.name);dag.nodes.push(n);diff.push(`新增临床问题 ${n.name}：${n.question}`);break;}
   case 'insert_question_after_choice':{
     const prev=getChoice(dag,id,cid),old=prev.next??null,n=clone(p.new_question);
     if(!n||!Array.isArray(n.choices))throw Error('插入操作需要完整 new_question');assertQuestionFree(dag,n.name);
     if(old!==null&&!n.choices.some(c=>c.next===old))throw Error(`插入 ${n.name} 必须保留至少一条通向原目标「${old}」的分支`);
     dag.nodes.push(n);prev.next=n.name;diff.push(`在 ${id}/${cid} 后插入 ${n.name}，原目标 ${old||'未连接'} 的路径保留`);break;}
   case 'update_question':{const n=getQuestion(dag,id);n.question=nonempty(p.new_text,'问题文本');diff.push(`修改问题 ${id} 的文字`);break;}
   case 'delete_question':{
     const n=getQuestion(dag,id);if(n.name===dag.root)throw Error('不能删除根问题');
     if(dag.nodes.some(q=>q.choices.some(c=>c.next===id)))throw Error(`问题 ${id} 仍有上游引用，请先重连`);
     dag.nodes=dag.nodes.filter(q=>q.name!==id);diff.push(`删除问题 ${id} 及其 Choice`);break;}
   case 'add_choice':{
     const q=getQuestion(dag,id),c=clone(p.choice);if(!c||typeof c!=='object')throw Error('缺少新增 Choice');assertChoiceFree(dag,id,c.id);
     assertNext(c.next??null);c.next=c.next??null;c.evidence=c.evidence??[];q.choices.push(c);diff.push(`为 ${id} 新增 Choice ${c.id} → ${c.next||'待连接'}`);break;}
   case 'update_choice':{getChoice(dag,id,cid).text=nonempty(p.new_text,'Choice 文本');diff.push(`修改 ${id}/${cid} 的回答文字`);break;}
   case 'delete_choice':{const q=getQuestion(dag,id);getChoice(dag,id,cid);q.choices=q.choices.filter(c=>c.id!==cid);diff.push(`删除 Choice ${id}/${cid}`);break;}
   case 'set_choice_next':{const c=getChoice(dag,id,cid);assertNext(p.next??null);const old=c.next;c.next=p.next??null;diff.push(`重连 ${id}/${cid}：${old||'未连接'} → ${c.next||'未连接'}`);break;}
   case 'add_evidence':{const c=getChoice(dag,id,cid);const add=strings(p.items,'新增 Evidence').map(x=>nonempty(x,'Evidence',300));if(!add.length)throw Error('Evidence 不能为空');const prior=c.evidence||[];const added=[...new Set(add)].filter(x=>!prior.includes(x));c.evidence=[...prior,...added];diff.push(`为 ${id}/${cid} 添加 ${added.length} 条 Evidence`);break;}
   case 'remove_evidence':{const c=getChoice(dag,id,cid);const remove=strings(p.items,'删除 Evidence');c.evidence=(c.evidence||[]).filter(x=>!remove.includes(x));diff.push(`从 ${id}/${cid} 移除 Evidence：${remove.join('、')}`);break;}
   case 'set_choice_evidence':{const c=getChoice(dag,id,cid);c.evidence=strings(p.items,'Evidence');diff.push(`更新 ${id}/${cid} 的完整 Evidence 列表`);break;}
   case 'add_outcome':{const name=p.outcome_name;assertOutcomeFree(dag,name);dag.outcome_metadata??={};dag.outcome_metadata[name]={medical_notes:strings(p.medical_notes,'疾病备注')};diff.push(`新增疾病 Outcome ${name}`);break;}
   case 'rename_outcome':{
     const from=p.old_name,to=nonempty(p.new_name,'新疾病名称');if(!outcomeNames(dag).includes(from))throw Error(`找不到疾病 ${from}`);if(from===to){diff.push(`疾病名称未变化：${from}`);break;}assertOutcomeFree(dag,to);
     for(const q of dag.nodes)for(const c of q.choices)if(c.next===from)c.next=to;
     if(dag.outcome_metadata?.[from]){dag.outcome_metadata[to]=dag.outcome_metadata[from];delete dag.outcome_metadata[from];}
     diff.push(`疾病重命名 ${from} → ${to}，所有引用同步更新`);break;}
   case 'delete_outcome':{
     const name=p.outcome_name;if(!outcomeNames(dag).includes(name))throw Error(`找不到疾病 ${name}`);
     if(dag.nodes.some(q=>q.choices.some(c=>c.next===name)))throw Error(`疾病 ${name} 仍有 Choice 指向它，请先修改连接`);
     if(dag.outcome_metadata)delete dag.outcome_metadata[name];diff.push(`删除孤立疾病 ${name}`);break;}
   case 'set_medical_notes':{
     const notes=strings(p.medical_notes,'医学备注');let object;
     if(p.target_type==='question')object=getQuestion(dag,id);
     else if(p.target_type==='choice')object=getChoice(dag,id,cid);
     else if(p.target_type==='outcome'){if(!outcomeNames(dag).includes(p.outcome_name))throw Error(`找不到疾病 ${p.outcome_name}`);dag.outcome_metadata??={};object=dag.outcome_metadata[p.outcome_name]??={};}
     else throw Error('备注的目标类型无效');object.medical_notes=notes;diff.push(`更新 ${p.target_type} 的医学备注`);break;}
   case 'set_root':{getQuestion(dag,id);dag.root=id;diff.push(`根问题改为 ${id}`);break;}
   default:throw Error(`不支持的 Patch：${p.op}`);
  }
 }
 const result=validateDAG(dag,{allowDraft});return {...result,diff};
}
/** Structural audit in offline mode (no invented clinical claims). */
export function offlineAudit(dag,revision=0){const suggestions=[];for(const q of dag.nodes)for(const c of q.choices){
 if(c.next===null||c.next===undefined)suggestions.push({id:`S${suggestions.length+1}`,category:'unconnected',target:{type:'choice',question_name:q.name,choice_id:c.id},observation:`${q.name}/${c.id} 尚未连接到下游。`,proposed_change:'请医生补充问题或疾病连接。',rationale:'不完整的路径需要人工完善。'});
 if(!c.evidence?.length)suggestions.push({id:`S${suggestions.length+1}`,category:'evidence',target:{type:'choice',question_name:q.name,choice_id:c.id},observation:`${q.name}/${c.id} 还没有 Evidence。`,proposed_change:'医生可以补充对应的临床线索。',rationale:'便于医学知识审核。'});
}
if(!suggestions.length){const q=dag.nodes.find(n=>n.name==='Q3')||dag.nodes[0];suggestions.push({id:'S1',category:'branch_expansion',target:{type:'question',question_name:q.name},observation:'当前图结构完整；仍可由医生讨论是否细化某个鉴别分支。',proposed_change:`如有需要，可选中 ${q.name} 添加 Choice 或在其下游插入 Question。`,rationale:'演示性图结构建议，不是医学有效性评价。'});}return {mode:'audit',base_revision:revision,source:'offline',reply:'以下为离线结构检查结果，非模型医学审查。',suggestions:suggestions.slice(0,8)};}
export function offlineAgent({mode,dag,selected,instruction='',base_revision=0}){
 if(mode==='audit')return offlineAudit(dag,base_revision);
 if(mode==='generate')return {mode:'generate',base_revision,source:'offline',reply:'离线模式不生成整图；配置 LLM API 后可使用。',dag:null};
 const ops=[];const s=selected||{};
 if(s.type==='question'&&/choice|选项|回答|分支/i.test(instruction)){
  const q=getQuestion(dag,s.question_name||s.name);let i=1;while(q.choices.some(c=>c.id===`a${i}`))i++;
  ops.push({op:'add_choice',question_name:q.name,choice:{id:`a${i}`,text:'待医生完善的新回答',next:null,evidence:[]}});
 }else if(s.type==='choice'&&/插入|问题|细化/i.test(instruction)){
  const c=getChoice(dag,s.question_name,s.choice_id);let i=14;while(dag.nodes.some(q=>q.name===`Q${i}`))i++;
  const name=`Q${i}`;ops.push({op:'insert_question_after_choice',question_name:s.question_name,choice_id:s.choice_id,new_question:{name,question:'请医生补充需要进一步鉴别的临床问题？',choices:[{id:'a1',text:'原有候选路径（请审核文字）',next:c.next||null,evidence:[]},{id:'a2',text:'其他情况（待补充）',next:null,evidence:[]}]}});
 }else if(s.type==='choice'&&/evidence|线索|证据/i.test(instruction)){
  ops.push({op:'add_evidence',question_name:s.question_name,choice_id:s.choice_id,items:['待医生确认的临床线索']});
 }
 return {mode:'edit',base_revision,source:'offline',reply:ops.length?'离线结构演示：已生成待医生确认的修改草案（新医学文字需审核）。':'离线模式仅支持部分结构操作。可选择 Question 点击“新增 Choice”，或选中 Choice 点击“插入问题 / 补充 Evidence”；自由语言修改请配置 LLM API。',operations:ops,suggestions:[]};
}
