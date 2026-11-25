import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateDAG,applyPatch,normalizeAgentPatch,choiceKey,outcomeNames,offlineAgent} from '../server/oral-dag.mjs';
const data=JSON.parse(readFileSync(new URL('../data/oral_original.json',import.meta.url),'utf8'));
const find=(d,q,c)=>d.nodes.find(n=>n.name===q).choices.find(x=>x.id===c);

test('source is exact oral root & provenance, and 13/32/15/64 graph counts',()=>{
 const r=validateDAG(data);
 assert.equal(r.dag.root,'Q1');assert.equal(r.dag.evidence_status,'clinician_verified');
 assert.equal(r.dag.source,'Final user-confirmed Q1-Q13 evidence graph');
 assert.deepEqual(r.counts,{questions:13,choices:32,outcomes:15});assert.equal(r.counts.choices*2,64);
 assert.equal(r.warnings.length,0);
});
test('local Choice a1/a2 IDs repeat freely across different questions',()=>{
 assert.notEqual(choiceKey('Q1','a1'),choiceKey('Q2','a1'));
 assert.notEqual(choiceKey('Q3','a2'),choiceKey('Q10','a2'));
 assert.deepEqual(find(data,'Q8','a2').evidence,['触碰刺激痛','食物刺激痛','冷热刺激痛','敏感发酸']);
 assert.equal(find(data,'Q2','a1').next,'阻生智齿');
});
test('duplicate choice ID within same question is rejected',()=>{
 const d=structuredClone(data);d.nodes[0].choices.push({...d.nodes[0].choices[0]});assert.throws(()=>validateDAG(d),/重复/);
});
test('shared outcome: acute pulpitis has two Q9 branches, wedge defect has three',()=>{
 assert.equal(data.nodes.flatMap(n=>n.choices).filter(c=>c.next==='急性牙髓炎').length,2);
 assert.equal(data.nodes.flatMap(n=>n.choices).filter(c=>c.next==='牙齿楔状缺损').length,3);
 assert.equal(new Set(outcomeNames(data)).size,15);
});
test('add Q2/a3, even though Q1 and Q3 already have an a3',()=>{
 const ops=[{op:'add_choice',question_name:'Q2',choice:{id:'a3',text:'待细化的智齿鉴别',next:null,evidence:['需要医生审核']}}];
 const r=applyPatch(data,ops);assert.deepEqual(r.counts,{questions:13,choices:33,outcomes:15});assert.equal(find(r.dag,'Q2','a3').next,null);
 assert.equal(find(data,'Q2','a3'),undefined);assert.equal(find(r.dag,'Q3','a3').next,'Q6');
});
test('model invented Q14 in add_choice → safe null and explicit notes',()=>{
 const raw=[{op:'add_choice',question_name:'Q2',choice:{id:'a3',text:'其他情况',next:'Q14',evidence:[]}}];
 const fix=normalizeAgentPatch(data,raw);assert.equal(fix.operations[0].choice.next,null);assert.match(fix.notes[0],/Q14/);
 assert.equal(raw[0].choice.next,'Q14');assert.equal(applyPatch(data,fix.operations).counts.choices,33);
});
test('if Q14 is created in same batch, preserve reference Q2/a3 → Q14',()=>{
 const operations=[{op:'add_choice',question_name:'Q2',choice:{id:'a3',text:'新问题线索',next:'Q14',evidence:[]}},{op:'add_question',question:{name:'Q14',question:'新问题？',choices:[{id:'a1',text:'原有路径',next:'阻生智齿',evidence:[]}]}}];
 const fix=normalizeAgentPatch(data,operations);assert.equal(fix.operations[0].choice.next,'Q14');
 const r=applyPatch(data,fix.operations);assert.equal(r.counts.questions,14);assert.equal(find(r.dag,'Q2','a3').next,'Q14');
});
test('insert question after Q11/a2 without losing original Q12 path',()=>{
 const r=applyPatch(data,[{op:'insert_question_after_choice',question_name:'Q11',choice_id:'a2',new_question:{name:'Q14',question:'病程是否具有复发性？',choices:[{id:'a1',text:'继续原分支',next:'Q12',evidence:[]},{id:'a2',text:'待完善',next:null,evidence:[]}]}}]);
 assert.equal(find(r.dag,'Q11','a2').next,'Q14');assert.equal(find(r.dag,'Q14','a1').next,'Q12');assert.equal(find(data,'Q11','a2').next,'Q12');
});
test('cannot insert a question while deleting the old connected outcome path',()=>{
 assert.throws(()=>applyPatch(data,[{op:'insert_question_after_choice',question_name:'Q2',choice_id:'a1',new_question:{name:'Q14',question:'新增',choices:[{id:'a1',text:'空',next:null,evidence:[]}]}}]),/保留/);
});
test('update only Q8/a2 Evidence; Q9/a2 and Q11/a2 remain unchanged',()=>{
 const old1=structuredClone(find(data,'Q9','a2'));
 const r=applyPatch(data,[{op:'add_evidence',question_name:'Q8',choice_id:'a2',items:['新临床线索']}]);
 assert.deepEqual(find(r.dag,'Q9','a2'),old1);
 assert.ok(find(r.dag,'Q8','a2').evidence.includes('新临床线索'));
 assert.equal(find(r.dag,'Q8','a2').next,'Q10');
});
test('rename shared outcome updates all references without duplicating disease',()=>{
 const r=applyPatch(data,[{op:'rename_outcome',old_name:'急性牙髓炎',new_name:'急性牙髓炎（讨论用名称）'}]);
 assert.equal(r.counts.outcomes,15);assert.equal(find(r.dag,'Q9','a2').next,'急性牙髓炎（讨论用名称）');assert.equal(find(r.dag,'Q9','a3').next,'急性牙髓炎（讨论用名称）');
});
test('cycle, missing question, still-referenced outcome deletion are rejected',()=>{
 assert.throws(()=>applyPatch(data,[{op:'set_choice_next',question_name:'Q3',choice_id:'a1',next:'Q1'}]),/环/);
 assert.throws(()=>applyPatch(data,[{op:'set_choice_next',question_name:'Q3',choice_id:'a1',next:'Q99'}]),/不存在/);
 assert.throws(()=>applyPatch(data,[{op:'delete_outcome',outcome_name:'急性牙髓炎'}]),/仍有/);
});
test('offline Agent and audit are proposals only, never mutate original',()=>{
 const before=JSON.stringify(data);const a=offlineAgent({mode:'audit',dag:data,base_revision:3,instruction:'审阅'});
 assert.equal(a.mode,'audit');assert.equal(Object.hasOwn(a,'operations'),false);
 const b=offlineAgent({mode:'edit',dag:data,selected:{type:'question',name:'Q2'},instruction:'添加 choice',base_revision:3});
 assert.equal(b.operations[0].op,'add_choice');assert.equal(b.operations[0].choice.id,'a3');assert.equal(b.operations[0].choice.next,null);
 assert.equal(JSON.stringify(data),before);
});
