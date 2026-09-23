import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { join } from "node:path";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { hostname } from "node:os";
import { epoxyPath } from "@mercuryworkshop/epoxy-transport";
import { libcurlPath } from "@mercuryworkshop/libcurl-transport";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";
import { bareModulePath } from "@mercuryworkshop/bare-as-module3";
import { server as wisp } from "@mercuryworkshop/wisp-js/server";
import venus from "venus-pit";

const ROOT = process.cwd();
const app = express();
const server = createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });

app.set("view engine", "ejs");
app.set("views", join(ROOT, "views"));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(join(ROOT, "public")));
app.use("/bare-module/", express.static(bareModulePath));
app.use("/libcurl/", express.static(libcurlPath));
app.use("/baremux/", express.static(baremuxPath, { extensions:["js"], index:"index.js" }));
app.use("/epoxy/", express.static(epoxyPath, { extensions:["js"], index:"index.js", type:"application/javascript" }));

app.get("/baremux/index.js",(req,res)=>res.sendFile(join(baremuxPath,"index.js"),{headers:{"Content-Type":"application/javascript"}}));
app.get("/epoxy/index.js",(req,res)=>res.sendFile(join(epoxyPath,"index.js"),{headers:{"Content-Type":"application/javascript"}}));
app.get("/libcurl/index.js",(req,res)=>res.sendFile(join(libcurlPath,"index.js"),{headers:{"Content-Type":"application/javascript"}}));

wisp.options.dns_method="resolve";
wisp.options.dns_servers=["1.1.1.1","1.0.0.1"];
wisp.options.dns_result_order="ipv4first";

const venusPath=venus(app);
app.get("/robots.txt",(req,res)=>res.type("text/plain").send(`User-agent: *\nDisallow: ${venusPath}`));

const sessions=new Map();
const dataDir=join(ROOT,"data");
async function readJSON(file,fallback=[]){try{return JSON.parse(await fs.readFile(join(dataDir,file),"utf8"));}catch{return fallback;}}
async function writeJSON(file,data){await fs.mkdir(dataDir,{recursive:true});await fs.writeFile(join(dataDir,file),JSON.stringify(data,null,2));}
function hashPassword(password,salt= randomBytes(16).toString("hex")){return {salt,hash:scryptSync(password,salt,64).toString("hex")};}
function verifyPassword(password,user){const h=scryptSync(password,user.salt,64);return timingSafeEqual(h,Buffer.from(user.hash,"hex"));}

function auth(req,res,next){
  const token=req.headers.authorization?.replace("Bearer ","") || req.cookies?.farius;
  const username=sessions.get(token);
  if(!username) return res.status(401).json({error:"Sign in required"});
  req.user=username; next();
}

app.get("/",(req,res)=>res.render("index",{venus:venusPath}));
app.get("/games",(req,res)=>res.render("games",{venus:venusPath}));
app.get("/chat",(req,res)=>res.render("chat",{venus:venusPath}));
app.get("/leaderboard",(req,res)=>res.render("leaderboard",{venus:venusPath}));
app.get("/suggest",(req,res)=>res.render("suggest",{venus:venusPath}));
app.get("/settings",(req,res)=>res.render("settings/index"));
app.get("/settings/styles",(req,res)=>res.render("settings/styles"));
app.get("/settings/misc",(req,res)=>res.render("settings/misc"));
app.get("/search",(req,res)=>res.render("search"));

app.post("/api/auth/signup",async(req,res)=>{
  const username=String(req.body.username||"").trim().slice(0,24);
  const password=String(req.body.password||"");
  if(!/^[A-Za-z0-9_]{3,24}$/.test(username)||password.length<6)return res.status(400).json({error:"Username must be 3-24 letters/numbers/underscores and password must be 6+ characters."});
  const users=await readJSON("users.json");
  if(users.some(u=>u.username.toLowerCase()===username.toLowerCase()))return res.status(409).json({error:"Username already exists"});
  const {salt,hash}=hashPassword(password);
  users.push({username,salt,hash,createdAt:Date.now(),friends:[],requests:[]});
  await writeJSON("users.json",users);
  const token=randomBytes(32).toString("hex");sessions.set(token,username);
  res.json({ok:true,token,user:{username}});
});
app.post("/api/auth/signin",async(req,res)=>{
  const username=String(req.body.username||"").trim();
  const password=String(req.body.password||"");
  const users=await readJSON("users.json");
  const user=users.find(u=>u.username.toLowerCase()===username.toLowerCase());
  if(!user||!verifyPassword(password,user))return res.status(401).json({error:"Invalid username or password"});
  const token=randomBytes(32).toString("hex");sessions.set(token,user.username);
  res.json({ok:true,token,user:{username:user.username}});
});
app.post("/api/auth/signout",auth,(req,res)=>{for(const [k,v] of sessions)if(v===req.user)sessions.delete(k);res.json({ok:true})});
app.get("/api/me",auth,async(req,res)=>{const users=await readJSON("users.json");const u=users.find(x=>x.username===req.user);res.json({username:req.user,friends:u?.friends||[],requests:u?.requests||[]})});

app.post("/api/friends/request",auth,async(req,res)=>{
  const target=String(req.body.username||"").trim();
  if(!target||target.toLowerCase()===req.user.toLowerCase())return res.status(400).json({error:"Invalid friend"});
  const users=await readJSON("users.json");const me=users.find(u=>u.username===req.user);const other=users.find(u=>u.username.toLowerCase()===target.toLowerCase());
  if(!other)return res.status(404).json({error:"User not found"});
  if(me.friends.includes(other.username))return res.status(400).json({error:"Already friends"});
  if(!other.requests.includes(me.username))other.requests.push(me.username);
  await writeJSON("users.json",users);
  res.json({ok:true});
});
app.post("/api/friends/respond",auth,async(req,res)=>{
  const from=String(req.body.username||"");const accept=!!req.body.accept;
  const users=await readJSON("users.json");const me=users.find(u=>u.username===req.user);const other=users.find(u=>u.username===from);
  if(!me||!other||!me.requests.includes(from))return res.status(404).json({error:"Request not found"});
  me.requests=me.requests.filter(x=>x!==from);
  if(accept){if(!me.friends.includes(from))me.friends.push(from);if(!other.friends.includes(me.username))other.friends.push(me.username);}
  await writeJSON("users.json",users);res.json({ok:true});
});

app.get("/api/suggestions",async(req,res)=>res.json(await readJSON("suggestions.json")));
app.post("/api/suggestions",auth,async(req,res)=>{
  const text=String(req.body.text||"").trim().slice(0,500);if(!text)return res.status(400).json({error:"Suggestion is empty"});
  const list=await readJSON("suggestions.json");list.unshift({id:randomBytes(8).toString("hex"),text,by:req.user,createdAt:Date.now(),votes:0});
  await writeJSON("suggestions.json",list.slice(0,500));res.json({ok:true});
});

app.get("/api/leaderboard",async(req,res)=>res.json(await readJSON("leaderboard.json")));
app.post("/api/leaderboard/score",auth,async(req,res)=>{
  const game=String(req.body.game||"").trim().slice(0,80);const score=Number(req.body.score);
  if(!game||!Number.isFinite(score))return res.status(400).json({error:"Invalid score"});
  const list=await readJSON("leaderboard.json");list.push({game,username:req.user,score,createdAt:Date.now()});
  list.sort((a,b)=>b.score-a.score);await writeJSON("leaderboard.json",list.slice(0,1000));res.json({ok:true});
});
app.get("/api/stickers",async(req,res)=>{
  const dir=join(ROOT,"public/stickers");const files=(await fs.readdir(dir)).filter(x=>/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(x));res.json(files.map(x=>"/stickers/"+encodeURIComponent(x)));
});
app.get("/api/games",async(req,res)=>{
  const dir=join(ROOT,"public/games");let files=[];try{files=(await fs.readdir(dir)).filter(x=>x.endsWith(".html"));}catch{}
  res.json(files.map(x=>({name:x.replace(/\.html$/,"").replace(/[-_]/g," "),url:"/games/"+x})));
});

io.on("connection",(socket)=>{
  socket.on("auth",token=>{const username=sessions.get(token);if(username){socket.data.username=username;socket.join("global");socket.emit("ready",{username});}});
  socket.on("chat:global",(text)=>{
    const username=socket.data.username;if(!username)return;
    text=String(text||"").trim().slice(0,1000);if(!text)return;
    io.to("global").emit("chat:message",{id:randomBytes(8).toString("hex"),username,text,at:Date.now()});
  });
  socket.on("chat:dm",({to,text}={})=>{
    const from=socket.data.username;if(!from)return;text=String(text||"").trim().slice(0,1000);to=String(to||"").trim();
    if(!text||!to)return;
    for(const [id,name] of io.sockets.sockets)if(name.data.username===to)io.to(id).emit("chat:dm",{from,text,at:Date.now()});
    socket.emit("chat:dm",{from,text,to,at:Date.now(),self:true});
  });
});

const port=Number(process.env.PORT||3000);
server.on("upgrade",(req,socket,head)=>{if(req.url?.startsWith("/wisp/"))wisp.routeRequest(req,socket,head);});
server.listen(port,"0.0.0.0",()=>console.log(`Farius running on http://${hostname()}:${port}`));
