const tokenKey="fariusToken";
const token=()=>localStorage.getItem(tokenKey);
let socket=null;

const $=s=>document.querySelector(s);
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}

async function me(){
  if(!token()) return null;
  const r=await fetch("/api/me",{headers:{Authorization:"Bearer "+token()}});
  if(!r.ok){localStorage.removeItem(tokenKey);return null}
  return r.json();
}
async function refreshAccount(){
  const u=await me();
  if($("#userLabel")) $("#userLabel").textContent=u?.username||"Guest";
  if($("#authBtn")) $("#authBtn").textContent=u?"Sign out":"Sign in";
  return u;
}

function openModal(id){$(id)?.classList.add("open")}
function closeModal(id){$(id)?.classList.remove("open")}

async function loadRequests(){
  const u=await me(); const box=$("#requestList"); if(!box)return;
  const reqs=u?.requests||[];
  box.innerHTML=reqs.length?reqs.map(x=>`<div class="row"><span><span style="display:inline-flex;width:34px;height:34px;border-radius:50%;align-items:center;justify-content:center;background:#1b2738;margin-right:8px">${esc(x[0]?.toUpperCase()||"?")}</span><b>${esc(x)}</b> wants to be your friend.</span><span><button data-user="${esc(x)}" class="accept">Accept</button> <button data-user="${esc(x)}" class="decline">Decline</button></span></div>`).join(""):'<div class="card">No pending requests.</div>';
  box.querySelectorAll(".accept,.decline").forEach(b=>b.onclick=async()=>{await fetch("/api/friends/respond",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token()},body:JSON.stringify({username:b.dataset.user,accept:b.classList.contains("accept")})});loadRequests()});
}
function setupRequests(){
  $("#friendBell")?.addEventListener("click",async()=>{if(!token()){openModal("#authModal");return}openModal("#requestModal");loadRequests()});
  $("#closeRequests")?.addEventListener("click",()=>closeModal("#requestModal"));
}

function setupAuth(){
  $("#authBtn")?.addEventListener("click",async()=>{
    if(token()){await fetch("/api/auth/signout",{method:"POST",headers:{Authorization:"Bearer "+token()}});localStorage.removeItem(tokenKey);location.reload();return}
    openModal("#authModal");
  });
  $("#closeAuth")?.addEventListener("click",()=>closeModal("#authModal"));
  let signup=false;
  $("#switchAuth")?.addEventListener("click",()=>{signup=!signup;$("#authTitle").textContent=signup?"Create account":"Sign in";$("#authSubmit").textContent=signup?"Create account":"Sign in";$("#switchAuth").textContent=signup?"I already have an account":"Create account";});
  $("#authSubmit")?.addEventListener("click",async()=>{
    const username=$("#authUser").value.trim(),password=$("#authPass").value;
    const endpoint=signup?"/api/auth/signup":"/api/auth/signin";
    const r=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username,password})});
    const d=await r.json();
    if(!r.ok){$("#authError").textContent=d.error||"Something went wrong";return}
    localStorage.setItem(tokenKey,d.token);closeModal("#authModal");await refreshAccount();connectChat();
  });
}

function connectChat(){
  if(!token()||typeof io==="undefined") return;
  if(socket) socket.disconnect();
  socket=io();
  socket.on("connect",()=>socket.emit("auth",token()));
  socket.on("ready",d=>{$("#authNotice")&&($("#authNotice").textContent=`Signed in as ${d.username}`)});
  socket.on("chat:message",m=>addMessage(m.username,m.text));
  socket.on("chat:dm",m=>addMessage(m.self?"You":`${m.from} (DM)`,m.text));
}

function addMessage(user,text){
  const box=$("#messages");if(!box)return;
  box.insertAdjacentHTML("beforeend",`<div class="msg"><b>${esc(user)}</b><div>${esc(text)}</div></div>`);
  box.scrollTop=box.scrollHeight;
}

async function loadStickers(){
  const box=$("#stickers");if(!box)return;
  const files=await fetch("/api/stickers").then(r=>r.json());
  box.innerHTML=files.map(src=>`<button class="card" style="min-height:0;padding:8px"><img src="${src}" style="width:100%;max-height:80px;object-fit:contain"></button>`).join("");
  box.querySelectorAll("button").forEach((b,i)=>b.onclick=()=>{const src=files[i];$("#chatInput").value+=" [sticker:"+src+"]";$("#chatInput").focus()});
}

function setupChat(){
  const open=()=>{openModal("#chatModal");refreshAccount().then(u=>{if(!u)$("#authNotice")&&($("#authNotice").textContent="Sign in to chat.");connectChat()});loadStickers()};
  $("#openChat")?.addEventListener("click",open);$("#openChatCard")?.addEventListener("click",open);
  $("#closeChat")?.addEventListener("click",()=>closeModal("#chatModal"));
  $("#stickerToggle")?.addEventListener("click",()=>$("#stickers")?.classList.toggle("hidden"));
  $("#sendChat")?.addEventListener("click",send);
  $("#chatInput")?.addEventListener("keydown",e=>{if(e.key==="Enter")send()});
  function send(){const input=$("#chatInput"),text=input?.value.trim();if(!text)return;if(!token()){openModal("#authModal");return}socket?.emit("chat:global",text);input.value=""}
}

function setupProxy(){
  $("#proxySearch")?.addEventListener("submit",e=>{
    e.preventDefault();let q=$("#searchInput").value.trim();if(!q)return;
    let url=/^https?:\/\//i.test(q)?q:(q.includes(".")&&!q.includes(" ")?"https://"+q:"https://duckduckgo.com/?q="+encodeURIComponent(q));
    // Scramjet navigation always receives the original target and encodes it in the proxy page.
    localStorage.setItem("proxy","scramjet");localStorage.setItem("url",url);location.href="/search";
  });
}

refreshAccount().then(()=>{setupAuth();setupRequests();setupChat();setupProxy();if(token())connectChat()});
