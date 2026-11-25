/** Zero-dependency ClinGraph Oral v4.1 server. Run: node standalone/server.mjs */
import http from 'node:http';
import {readFileSync,readFile} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateDAG,applyPatch,offlineAgent,normalizeAgentPatch} from '../server/oral-dag.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.dirname(here);
try{for(const line of readFileSync(path.join(root,'.env'),'utf8').split(/\r?\n/)){
 const m=line.trim().match(/^([A-Z_][A-Z_0-9]*)\s*=\s*(.*)$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].trim().replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/,'$1$2');
}}catch{/* no .env needed for offline use */}
const key=(process.env.OPENAI_API_KEY||process.env.LLM_API_KEY||'').trim();
const base=(process.env.OPENAI_BASE_URL||process.env.LLM_API_HOST||'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/+$/,'');
const model=process.env.OPENAI_MODEL||process.env.LLM_MODEL||'qwen-plus';
const port=Number(process.env.PORT||3001),host=process.env.HOST||'127.0.0.1';
const seed=validateDAG(JSON.parse(readFileSync(path.join(root,'data/oral_original.json'),'utf8'))).dag;
const system=`你是 ClinGraph 的口腔科临床鉴别诊断知识 DAG 协作编辑助手，帮助医生逐步完善知识图。你不是病例自动诊断器。
数据 JSON 有 root、nodes，每个 Question 包含 name、question、choices，每条 Choice 包含 id、text、next、evidence。Outcome 是指向的疾病名称，不必独立存为 nodes。每个 Question 的 Choice ID 仅在该 Question 内唯一，例如 Q1/a1 与 Q2/a1 是不同选项；所有修改必须同时使用 question_name 和 choice_id 指定目标。
三个可视节点 Question→Choice→Question/Outcome；evidence 是 Choice 上的临床线索，只能在属性栏展示；medical_notes 允许附在 Question/Choice/Outcome 上。
这是医生已经确认的 Q1-Q13 原始口腔科知识图；不要重写无关节点，不要添加未经要求的疾病，用户明确指示时可增加新问题、Choice、Evidence 和 Outcome。医学新增内容必须由医生审核，不得编造引用、诊断阈值、概率或指南结论。不能替患者自动确诊。
edit 模式：只返回最小的 Patch operations，医生确认才应用；audit 模式：只返回可定位建议，禁止修改图；generate 模式：仅按医生明确要求生成完整新图，须医生二次确认。
回答简体中文，仅输出一个合法 JSON 对象，不要 Markdown。`; 
const tasks={
 edit:`输出 JSON {"mode":"edit","base_revision":整数,"reply":"说明","operations":[...],"suggestions":[]}。允许操作：add_question{question:{name,question,choices}},insert_question_after_choice{question_name,choice_id,new_question:{name,question,choices}},update_question{question_name,new_text},delete_question{question_name},add_choice{question_name,choice:{id,text,next,evidence}},update_choice{question_name,choice_id,new_text},delete_choice{question_name,choice_id},set_choice_next{question_name,choice_id,next},add_evidence{question_name,choice_id,items},remove_evidence{question_name,choice_id,items},add_outcome{outcome_name,medical_notes?},rename_outcome{old_name,new_name},delete_outcome{outcome_name},set_medical_notes{target_type,question_name?,choice_id?,outcome_name?,medical_notes},set_root{question_name}。
注意：Choice ID 如 a1/a2 在不同 Question 中允许重复，必须使用所属问题 ID 定位。新增 Choice 的 next 只能引用当前实际存在的 Question/Outcome，或同一操作批次新建的目标；尚无明确目标时 next:null；不能捏造尚未创建的 Q14。插入新问题时必须保留至少一条通向原 next 的路径。新增问题内的 Choice 同样需要合法目标或 null。只返回当前用户要求的局部 Patch，不重写原图。`,
 audit:`只返回 JSON {"mode":"audit","base_revision":整数,"reply":"说明","suggestions":[{"id":"S1","category":"branch_expansion|evidence|clarity|path|other","target":{"type":"question|choice|outcome","question_name":"Q1","choice_id":"a1","outcome_name":"疾病名称"},"observation":"观察","proposed_change":"可执行的修改建议","rationale":"原因"}]}，不得包含 operations 或 dag。关注具体节点的 Question / Choice / Evidence / 备注是否值得扩展，不把未经证实的医学主张当成事实。`,
 generate:`仅明确要求新建/重建全图时使用，输出 JSON {"mode":"generate","base_revision":整数,"reply":"说明","dag":{"root":"Q1","nodes":[完整 Question]},"suggestions":[]}。新的问答图仍使用局部 Choice ID、显式 Question 和隐式疾病 Outcome。必须有可审阅的临床文本；不得直接替换旧图。`
};
function reply(res,status,data){const body=JSON.stringify(data);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(body);}
function incoming(req){return new Promise((resolve,reject)=>{let body='',len=0;req.on('data',x=>{len+=x.length;if(len>2500000){reject(Error('请求超过 2.5 MB'));req.destroy();return;}body+=x;});req.on('end',()=>{try{resolve(JSON.parse(body));}catch{reject(Error('请求 JSON 无效'));}});req.on('error',reject);});}
function parseModel(v){if(typeof v!=='string')throw Error('模型未返回文本');const s=v.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');try{return JSON.parse(s);}catch{const start=s.indexOf('{'),end=s.lastIndexOf('}');if(start>=0&&end>start)return JSON.parse(s.slice(start,end+1));throw Error('模型没有返回有效 JSON');}}
function recommendations(items){if(!Array.isArray(items))return [];return items.slice(0,12).map((v,i)=>({id:String(v?.id||`S${i+1}`),category:String(v?.category||'other'),target:typeof v?.target==='object'?v.target:{},observation:String(v?.observation||''),proposed_change:String(v?.proposed_change||''),rationale:String(v?.rationale||'')}));}
async function agent(body){
 const mode=body.mode||'edit';if(!['edit','audit','generate'].includes(mode))throw Error('未知 Agent 模式');
 const dag=validateDAG(body.dag).dag,revision=body.base_revision,selected=body.selected||null,instruction=String(body.instruction||'').trim();
 if(!Number.isSafeInteger(revision)||revision<0)throw Error('base_revision 格式无效');
 if(!instruction||instruction.length>4000)throw Error('请填写不超过4000字的指令');
 if(!key)return offlineAgent({mode,dag,selected,instruction,base_revision:revision});
 const history=Array.isArray(body.history)?body.history.slice(-6).map(m=>({role:m.role==='agent'?'assistant':'user',content:String(m.content||'').slice(0,600)})):[];
 const control=new AbortController(),timer=setTimeout(()=>control.abort(),75000);
 try{
  const r=await fetch(`${base}/chat/completions`,{method:'POST',signal:control.signal,headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},body:JSON.stringify({model,temperature:0.15,response_format:{type:'json_object'},messages:[{role:'system',content:system},{role:'system',content:tasks[mode]},{role:'user',content:JSON.stringify({mode,base_revision:revision,selected,instruction,current_dag:dag,recent_history:history})}]})});
  if(!r.ok)throw Error(`模型请求 HTTP ${r.status}：${(await r.text()).slice(0,650)}`);
  const data=await r.json(),msg=data.choices?.[0]?.message;if(msg?.refusal)throw Error('模型拒绝本次请求');const out=parseModel(msg?.content);
  if(out.mode!==mode)throw Error('模型返回了错误的工作模式');
  if(mode==='edit'){
    const normalized=normalizeAgentPatch(dag,out.operations);if(normalized.operations.length)applyPatch(dag,normalized.operations);
    return {mode,base_revision:revision,reply:[String(out.reply||'已提出局部编辑建议'),...normalized.notes].join('\n\n'),operations:normalized.operations,repair_notes:normalized.notes,suggestions:recommendations(out.suggestions),source:'live'};
  }
  if(mode==='audit'){if(Object.hasOwn(out,'operations'))throw Error('Audit 不允许返回修改操作');return {mode,base_revision:revision,reply:String(out.reply||'审查完成'),suggestions:recommendations(out.suggestions),source:'live'};}
  return {mode,base_revision:revision,reply:String(out.reply||'已生成整图草案'),dag:validateDAG(out.dag).dag,suggestions:recommendations(out.suggestions),source:'live'};
 }finally{clearTimeout(timer);}
}
const assets={'/':'standalone/index.html','/app.js':'standalone/app.js','/app.css':'standalone/app.css'};
http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,`http://${host}:${port}`).pathname;
  if(url==='/api/status'&&req.method==='GET')return reply(res,200,{mode:key?'live':'offline',model:key?model:null,service:'ClinGraph v4.1 · Oral DAG'});
  if(url==='/api/bootstrap'&&req.method==='GET')return reply(res,200,validateDAG(seed));
  if(url==='/api/validate'&&req.method==='POST')return reply(res,200,validateDAG((await incoming(req)).dag));
  if(url==='/api/patch/preview'&&req.method==='POST'){const b=await incoming(req);return reply(res,200,applyPatch(b.dag,b.operations));}
  if(url==='/api/agent'&&req.method==='POST')return reply(res,200,await agent(await incoming(req)));
  if(req.method!=='GET'||!Object.hasOwn(assets,url))return reply(res,404,{error:'Not found'});
  const filename=path.join(root,assets[url]),mime=url.endsWith('js')?'text/javascript; charset=utf-8':url.endsWith('css')?'text/css; charset=utf-8':'text/html; charset=utf-8';
  readFile(filename,(err,content)=>{if(err)return reply(res,500,{error:'读取资源失败'});res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(content);});
 }catch(e){console.error('[ClinGraph]',e.message);if(!res.headersSent)reply(res,422,{error:e.message||'请求失败'});}
}).listen(port,host,()=>console.log(`ClinGraph v4.1 口腔 DAG: http://${host}:${port} | ${key?'LLM '+model:'离线模式'}`));
