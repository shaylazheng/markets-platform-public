import express from 'express';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {payload} from './data.js';
export function createApp() {
 const app=express();app.use(express.json());
 app.use((req,res,next)=>{res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self' data:");next();});
 app.use('/api',(req,res)=>{
   if(req.path.startsWith('/report'))return res.status(404).json({error:'Not found'});
   const result=payload(req.path,req.query);
   if(result!==null)return res.json(result);
   if(['/claude','/ask','/insight','/brief','/concept'].includes(req.path))return res.json({text:'Synthetic demo: rising discount rates lower the present value of future cash flows. Compare the generated rates and equity charts to explore the mechanics.',answer:'This explanation accompanies synthetic data.',demo:true});
   return res.status(422).json({error:'This analysis is not included in the synthetic demo.',demo:true});
 });
 const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
 app.use(express.static(path.join(root,'dist')));
 app.get(/^(?!\/api\/).*/,(_req,res)=>res.sendFile(path.join(root,'dist/index.html')));
 return app;
}
if(process.argv[1]===fileURLToPath(import.meta.url))createApp().listen(Number(process.env.PORT||3778),'127.0.0.1',()=>console.log('Synthetic dashboard ready'));
