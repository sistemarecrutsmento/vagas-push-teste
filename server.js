const express=require('express');
const cors=require('cors');
const webpush=require('web-push');
const WebSocket=require('ws');
const crypto=require('crypto');
const app=express();
app.use(cors());
app.use(express.json({limit:'32kb'}));
const subs=new Map();
if(process.env.VAPID_PUBLIC_KEY&&process.env.VAPID_PRIVATE_KEY) webpush.setVapidDetails(process.env.VAPID_SUBJECT||'mailto:teste@vagasio.com.br',process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);
app.get('/health',(req,res)=>res.json({ok:true,assinaturas:subs.size,video:true}));
app.get('/public-key',(req,res)=>res.json({publicKey:process.env.VAPID_PUBLIC_KEY||null}));
app.post('/subscribe',(req,res)=>{const s=req.body;if(!s?.endpoint||!s?.keys?.p256dh||!s?.keys?.auth)return res.status(400).json({erro:'Assinatura inválida'});subs.set(s.endpoint,s);res.json({ok:true});});
app.post('/send-test',async(req,res)=>{if(!process.env.VAPID_PUBLIC_KEY||!process.env.VAPID_PRIVATE_KEY)return res.status(503).json({erro:'VAPID não configurado'});const payload=JSON.stringify({title:'VagasIO — teste real',body:'Notificação enviada pelo backend de teste.'});let enviados=0;for(const [endpoint,s] of subs){try{await webpush.sendNotification(s,payload);enviados++}catch(e){if(e.statusCode===404||e.statusCode===410)subs.delete(endpoint)}}res.json({ok:true,enviados});});
const rooms=new Map();
const TTL=15*60*1000;
function newRoom(req){const room='entrevista-'+crypto.randomBytes(4).toString('hex');const item={room,tokens:{recrutador:crypto.randomBytes(24).toString('hex'),candidato:crypto.randomBytes(24).toString('hex')},expiresAt:Date.now()+TTL,ended:false,peers:new Map()};rooms.set(room,item);return item}
app.post('/create-room',(req,res)=>{const item=newRoom(req);const base='https://sistemarecrutsmento.github.io/vagas-push-teste/video.html';const q=(role,name)=>base+'?room='+encodeURIComponent(item.room)+'&token='+item.tokens[role]+'&role='+role+'&nome='+encodeURIComponent(String(name||role).slice(0,80));res.json({ok:true,room:item.room,recrutador_url:q('recrutador',req.body?.recrutador||'Recrutador'),candidato_url:q('candidato',req.body?.candidato||'Candidato'),expira_em:new Date(item.expiresAt).toISOString()});});
function send(s,m){if(s&&s.readyState===WebSocket.OPEN)s.send(JSON.stringify(m))}
function broadcast(item,m,except){for(const s of item.peers.values())if(s!==except)send(s,m)}
function reject(s,code,reason){send(s,{type:code,reason});setTimeout(()=>{try{s.close(1008,reason)}catch(_){ }},20)}
const server=app.listen(process.env.PORT||3000,()=>console.log('push/video reconnect test online'));
const wss=new WebSocket.Server({server});
wss.on('connection',socket=>{
 let item=null,role=null,joined=false;
 socket.on('message',raw=>{
  let msg;try{msg=JSON.parse(raw)}catch(_){return}
  if(msg.type==='join'){
   if(joined||!msg.room||!msg.token)return reject(socket,'unauthorized','join-required');
   const room=rooms.get(String(msg.room).slice(0,80));const r=String(msg.role||'').toLowerCase();
   if(!room)return reject(socket,'unauthorized','unknown-room');
   if(Date.now()>=room.expiresAt){rooms.delete(room.room);return reject(socket,'expired','room-expired')}
   if(room.ended)return reject(socket,'ended','room-ended');
   if(!['recrutador','candidato'].includes(r)||msg.token!==room.tokens[r])return reject(socket,'unauthorized','invalid-role-token');
   if(room.peers.has(r))return reject(socket,'full','role-already-connected');
   if(room.peers.size>=2)return reject(socket,'full','room-full');
   item=room;role=r;joined=true;socket.info={nome:String(msg.nome||'Participante').slice(0,80),perfil:r};room.peers.set(r,socket);
   const other=[...room.peers.entries()].find(([x])=>x!==r);
   send(socket,{type:'joined',role:r,expiresAt:room.expiresAt});
   if(other){send(socket,{type:'peer-info',...other[1].info});send(other[1],{type:'peer-info',...socket.info});send(other[1],{type:'ready'});send(socket,{type:'ready'});}
   else send(socket,{type:'waiting'});
   return;
  }
  if(!joined||!item)return;
  if(msg.type==='end-call'){
   if(role!=='recrutador'){send(socket,{type:'unauthorized',reason:'recruiter-only-end-call'});return;}
   if(item.ended)return;
   item.ended=true;broadcast(item,{type:'call-ended',by:'recrutador'});send(socket,{type:'call-ended',by:'recrutador'});
   for(const p of item.peers.values())try{p.close(1000,'call-ended')}catch(_){ }
   item.peers.clear();return;
  }
  if(['offer','answer','candidate','chat'].includes(msg.type))broadcast(item,msg,socket);
 });
 socket.on('close',()=>{if(!item||!joined)return;if(item.peers.get(role)===socket)item.peers.delete(role);broadcast(item,{type:'peer-left',role});if(item.peers.size===0&&item.ended)rooms.delete(item.room);});
});
setInterval(()=>{const now=Date.now();for(const [id,r] of rooms){if(now>=r.expiresAt){broadcast(r,{type:'expired'});for(const p of r.peers.values())try{p.close(1000,'expired')}catch(_){ }rooms.delete(id)}}},30*1000).unref();
