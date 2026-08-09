const express=require('express');const cors=require('cors');const webpush=require('web-push');
const app=express();app.use(cors());app.use(express.json({limit:'32kb'}));
const subs=new Map();
if(process.env.VAPID_PUBLIC_KEY&&process.env.VAPID_PRIVATE_KEY)webpush.setVapidDetails(process.env.VAPID_SUBJECT||'mailto:teste@vagasio.com.br',process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);
app.get('/health',(req,res)=>res.json({ok:true,assinaturas:subs.size}));
app.get('/public-key',(req,res)=>res.json({publicKey:process.env.VAPID_PUBLIC_KEY||null}));
app.post('/subscribe',(req,res)=>{const s=req.body;if(!s?.endpoint||!s?.keys?.p256dh||!s?.keys?.auth)return res.status(400).json({erro:'Assinatura inválida'});subs.set(s.endpoint,s);res.json({ok:true});});
app.post('/send-test',async(req,res)=>{if(!process.env.VAPID_PUBLIC_KEY||!process.env.VAPID_PRIVATE_KEY)return res.status(503).json({erro:'VAPID não configurado'});const payload=JSON.stringify({title:'VagasIO — teste real',body:'Notificação enviada pelo backend de teste.'});let enviados=0;for(const [endpoint,s] of subs){try{await webpush.sendNotification(s,payload);enviados++}catch(e){if(e.statusCode===404||e.statusCode===410)subs.delete(endpoint);}}res.json({ok:true,enviados});});
app.listen(process.env.PORT||3000,()=>console.log('push test api online'));
