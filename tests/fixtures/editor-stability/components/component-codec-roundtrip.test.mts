// This test uses synthetic resolver UUIDs only to exercise the existing serialized codec.
// It cannot certify AssetDB registration, native loading, Inspector values or lifecycle diagnostics.
import {readFileSync} from 'node:fs';
import type {ComponentFieldFixtures} from './component-field-fixtures.mts';
import type {ComponentCatalogAudit} from './component-catalog-audit.mts';
import type {IComponentValueRecipe} from './component-value-recipe.mts';
import {randomUUID} from 'node:crypto';
import {LumenPrefabDocument} from '../../../../packages/engine/modules/lumen/source/hierarchy/prefab-document.ts';
import {LumenComponentPropertySchema} from '../../../../packages/engine/modules/lumen/source/schema/component-property.ts';
import {LumenCocosVersion} from '../../../../packages/engine/modules/lumen/source/schema/cocos-version.ts';
import {ComponentDependencyPlanner} from './component-dependency-plan.mts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../../',import.meta.url));
const scratch=await import('node:fs/promises').then(m=>m.mkdtemp('/private/tmp/pod-component-codec-save-'));

for(const version of ['3.8.3','3.8.7']) test(`${version} all prepared component fields survive real codec save/reopen and reject invalid types`,async()=>{
 const audit: ReturnType<typeof ComponentCatalogAudit.create>=JSON.parse(readFileSync(`${root}/tests/fixtures/editor-stability/components/${version}/component-assembly-audit.json`,'utf8'));
 const fixture: ReturnType<typeof ComponentFieldFixtures.create>=JSON.parse(readFileSync(`${root}/tests/fixtures/editor-stability/components/${version}/component-field-fixtures.json`,'utf8'));
 const schema=new LumenComponentPropertySchema(LumenCocosVersion.parse(version));
 const failures=[];let passed=0,rejected=0,invalidRejected=0;
 for(const comp of fixture.components)for(const row of comp.cases){
  if(row.expectedWrite!=='set-and-readback'||comp.dependencyPlan.blockers.length){rejected++;continue}
  try{
   const doc=LumenPrefabDocument.createEmpty('assets/probe.prefab','Root');doc.setPropertySchema(schema);
   doc.addChildFromSpec('/Root',{name:'Target'});
   const ensure=(path: string)=>{const parts=path.split('/').filter(Boolean);let at='/Root';for(const part of parts.slice(1)){const next=at+'/'+part;try{doc.findNodeIndex(next)}catch{doc.addChildFromSpec(at,{name:part})}at=next}return at};
   const attach=(path: string,type: string)=>{ensure(path);const plan=ComponentDependencyPlanner.create(type,audit.nativeDeclarations,{"cc.UIRenderer":"cc.Sprite"});if(plan.blockers.length)throw Error(plan.blockers.join(','));for(const item of plan.attachOrder)doc.attachBuiltinComponent(path,item)};
   attach('/Root/Target',comp.componentType);
   const resolve=(r: IComponentValueRecipe): unknown=>{
    if(r.form==='literal'){if(Array.isArray(r.value)&&r.value[0]?.handler){attach('/Root/Controller','cc.Animation')}return r.value}
    if(r.form==='resource')return randomUUID();
    if(r.form==='project-file-url')return 'http://127.0.0.1:1/assets/owned-fixture';
    if(r.form==='node-reference'){if(typeof r.value!=='string')throw Error('node_path_type');ensure(r.value);return r.value}
    if(r.form==='component-reference'){if(typeof r.value!=='string'||!r.componentType)throw Error('component_path_type');attach(r.value,r.componentType);return r.value}
    if(r.form==='list'){if(!r.items)throw Error('items_missing');return r.items.map(resolve);}
    if(r.form==='object')return Object.fromEntries(Object.entries(r.properties??{}).map(([k,v])=>[k,resolve(v)]));
    throw Error('unknown recipe')
   };
   const rootKey=row.selector[0];if(!rootKey)throw Error('selector_missing');
   doc.setComponentProperty('/Root/Target',comp.componentType,{[rootKey]:resolve(row.rootValue)});
   doc.save(scratch,false,LumenCocosVersion.parse(version));
   const data=JSON.parse(readFileSync(scratch+'/assets/probe.prefab','utf8'));
   const reopened=new LumenPrefabDocument('assets/probe.prefab',data,schema);
   if(JSON.stringify(reopened.entries)!==JSON.stringify(doc.entries))throw Error('codec_save_reopen_drift');
   const before=readFileSync(scratch+'/assets/probe.prefab');
   let invalid=resolve(row.rootValue);
   if(row.selector.length===1)invalid=row.invalidValue;
   else {let at=invalid;for(const key of row.selector.slice(1,-1)){if(Array.isArray(at))at=at[0];if(!at||typeof at!=='object')throw Error('nested_container_invalid');at=(at as Record<string,unknown>)[key]}if(Array.isArray(at))at=at[0];const key=row.selector.at(-1);if(!at||typeof at!=='object'||!key)throw Error('nested_target_invalid');(at as Record<string,unknown>)[key]=row.invalidValue}
   let denied=false;try{reopened.setComponentProperty('/Root/Target',comp.componentType,{[rootKey]:invalid})}catch(e){if(!(e instanceof Error))throw e;if(!String(e.message).startsWith('lumen_property_')&&!String(e.message).startsWith('lumen_component_'))throw e;denied=true}
   if(!denied)throw Error('invalid_value_not_rejected');
   if(!before.equals(readFileSync(scratch+'/assets/probe.prefab')))throw Error('rejected_source_file_changed');
   invalidRejected++;passed++;
  }catch(e){failures.push({component:comp.componentType,field:row.selector[0],message:e instanceof Error?e.message:String(e)})}
 }
 assert.deepEqual(failures,[]);
 assert.equal(passed,version==='3.8.3'?786:789);assert.equal(invalidRejected,passed);
 assert.equal(rejected,version==='3.8.3'?9:6);
});

test.after(async()=>{await import("node:fs/promises").then(m=>m.rm(scratch,{recursive:true,force:true}))});
