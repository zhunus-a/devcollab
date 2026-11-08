'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {spawn}=require('node:child_process');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'devcollab-test-'));
const port=34000+Math.floor(Math.random()*20000);
const base=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,['server/index.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,PORT:String(port),DATA_FILE:path.join(dir,'projects.json')},stdio:'pipe'});
process.on('exit',()=>child.kill());
async function ready(){for(let i=0;i<70;i++){try{const r=await fetch(base+'/api/health');if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,70));}throw Error('Server did not start');}
test('project CRUD, input validation, persistence and static page',async()=>{try{
 await ready();const html=await fetch(base+'/');assert.equal(html.status,200);assert.match(await html.text(),/DevCollab/);
 const initial=await(await fetch(base+'/api/projects')).json();assert.equal(initial.projects.length,3);
 const bad=await fetch(base+'/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'x'})});assert.equal(bad.status,400);
 const created=await fetch(base+'/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'API Test Project',description:'Testing persistence',visibility:'private'})});assert.equal(created.status,201);const {project}=await created.json();
 const get=await(await fetch(base+'/api/projects/'+project.id)).json();assert.equal(get.project.name,'API Test Project');
 const patch=await fetch(base+'/api/projects/'+project.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Updated Project'})});assert.equal(patch.status,200);
 const persisted=JSON.parse(fs.readFileSync(path.join(dir,'projects.json'),'utf8'));assert(persisted.some(p=>p.id===project.id&&p.name==='Updated Project'));
 const removed=await fetch(base+'/api/projects/'+project.id,{method:'DELETE'});assert.equal(removed.status,200);
 const missing=await fetch(base+'/api/projects/'+project.id);assert.equal(missing.status,404);
}finally{child.kill();fs.rmSync(dir,{recursive:true,force:true});}});
