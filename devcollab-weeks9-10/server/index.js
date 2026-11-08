'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'public');
const dataPath = process.env.DATA_FILE || path.join(root, 'data', 'projects.json');
const PORT = Number(process.env.PORT || 3000);
const contentTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
let queue = Promise.resolve();
const sample = [
 {id:'sample-web', name:'Web Programming Project', description:'Build a collaborative class website', visibility:'private', language:'JavaScript', createdAt:'2026-11-01T10:00:00.000Z'},
 {id:'sample-portfolio', name:'Personal Portfolio', description:'Personal portfolio design and components', visibility:'private', language:'HTML/CSS', createdAt:'2026-11-01T12:00:00.000Z'},
 {id:'sample-ecom', name:'E-commerce App', description:'Frontend storefront prototype', visibility:'public', language:'JavaScript', createdAt:'2026-11-02T09:00:00.000Z'}
];
async function readProjects(){
 try {const data = JSON.parse(await fs.readFile(dataPath, 'utf8')); if (!Array.isArray(data)) throw Error('Invalid data file'); return data; }
 catch(err){ if(err.code !== 'ENOENT') throw err; await fs.mkdir(path.dirname(dataPath),{recursive:true}); await fs.writeFile(dataPath, JSON.stringify(sample,null,2)); return structuredClone(sample); }
}
async function writeProjects(projects){ await fs.mkdir(path.dirname(dataPath),{recursive:true}); const tmp = dataPath+'.tmp'; await fs.writeFile(tmp,JSON.stringify(projects,null,2)); await fs.rename(tmp,dataPath); }
function send(res,status,payload){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(payload));}
async function bodyJSON(req){let text='';for await(const chunk of req){text+=chunk;if(text.length>20000){const e=Error('Request body too large');e.status=413;throw e;}}try{return JSON.parse(text);}catch{const e=Error('Invalid JSON');e.status=400;throw e;}}
function validate(obj,patch=false){if(!obj || typeof obj !== 'object' || Array.isArray(obj))return 'Invalid project object';if(!patch || Object.hasOwn(obj,'name')){if(typeof obj.name!=='string'||obj.name.trim().length<3||obj.name.trim().length>60)return 'Project name must be 3–60 characters';}if(Object.hasOwn(obj,'description')&&(typeof obj.description!=='string'||obj.description.length>240))return 'Description must be 240 characters or fewer';if(Object.hasOwn(obj,'visibility')&&!['private','public'].includes(obj.visibility))return 'Invalid visibility';if(patch&&!['name','description','visibility'].some(k=>Object.hasOwn(obj,k)))return 'No editable fields supplied';return null;}
async function handleAPI(req,res,url){
 if(url.pathname==='/api/health'&&req.method==='GET')return send(res,200,{status:'ok'});
 if(!url.pathname.startsWith('/api/projects'))return send(res,404,{error:'API route not found'});
 const parts = url.pathname.split('/').filter(Boolean);
const id = parts[2];

// API for project files
if (parts.length === 4 && parts[3] === 'files' && id) {

  if (req.method !== 'GET' && req.method !== 'PUT') {
    return send(res, 405, { error: 'Method not allowed' });
  }

  const projects = await readProjects();
  const project = projects.find(p => p.id === id);

  if (!project) {
    return send(res, 404, { error: 'Project not found' });
  }

  // Read project files
  if (req.method === 'GET') {
    return send(res, 200, {
      files: project.files || {}
    });
  }

  // Save project files
  if (req.method === 'PUT') {
    const input = await bodyJSON(req);

    const keys = ['app', 'css', 'html'];

    if (
      !input.files ||
      typeof input.files !== 'object' ||
      Array.isArray(input.files) ||
      !keys.every(key =>
        typeof input.files[key] === 'string' &&
        input.files[key].length <= 15000
      )
    ) {
      return send(res, 400, {
        error: 'Invalid project files'
      });
    }

    project.files = Object.fromEntries(
      keys.map(key => [key, input.files[key]])
    );

    await writeProjects(projects);

    return send(res, 200, {
      message: 'Files saved successfully',
      files: project.files
    });
  }
}

if (parts.length > 3) {
  return send(res, 404, { error: 'Not found' });
}
 if(!id&&req.method==='GET'){const projects=await readProjects();return send(res,200,{projects});}
 if(!id&&req.method==='POST'){const input=await bodyJSON(req);const error=validate(input);if(error)return send(res,400,{error}); const project={id:randomUUID(),name:input.name.trim(),description:(input.description||'').trim(),visibility:input.visibility||'private',language:'JavaScript',createdAt:new Date().toISOString()}; const projects=await readProjects();projects.unshift(project);await writeProjects(projects);return send(res,201,{project});}
 if(id&&['GET','PATCH','DELETE'].includes(req.method)){
 const projects=await readProjects();const i=projects.findIndex(p=>p.id===id);if(i<0)return send(res,404,{error:'Project not found'});
 if(req.method==='GET')return send(res,200,{project:projects[i]});
 if(req.method==='DELETE'){projects.splice(i,1);await writeProjects(projects);return send(res,200,{deleted:true});}
 const input=await bodyJSON(req);const error=validate(input,true);if(error)return send(res,400,{error});for(const key of ['name','description','visibility'])if(Object.hasOwn(input,key))projects[i][key]=typeof input[key]==='string'?input[key].trim():input[key];await writeProjects(projects);return send(res,200,{project:projects[i]});
 }
 return send(res,405,{error:'Method not allowed'});
}
async function serveStatic(req,res,url){if(req.method!=='GET')return send(res,405,{error:'Method not allowed'});let relative=decodeURIComponent(url.pathname);if(relative==='/' )relative='/index.html';const target=path.resolve(publicDir,'.'+relative);if(target!==publicDir&&!target.startsWith(publicDir+path.sep))return send(res,403,{error:'Forbidden'});try{const data=await fs.readFile(target);res.writeHead(200,{'Content-Type':contentTypes[path.extname(target)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});res.end(data);}catch(e){if(e.code==='ENOENT'||e.code==='EISDIR')return send(res,404,{error:'Page not found'});throw e;}}
const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost'); const work=async()=>{try{if(url.pathname.startsWith('/api/'))await handleAPI(req,res,url);else await serveStatic(req,res,url);}catch(e){send(res,e.status||500,{error:e.status?e.message:'Internal server error'});console.error(e);}};if(['POST','PATCH','DELETE','PUT'].includes(req.method)&&url.pathname.startsWith('/api/projects')){queue=queue.then(work,work);}else work();});
if(require.main===module)server.listen(PORT,()=>console.log(`DevCollab running at http://localhost:${PORT}`));
module.exports={server};
