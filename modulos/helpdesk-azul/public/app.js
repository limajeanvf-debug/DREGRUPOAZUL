/* Help Desk — Azul Viagens Shopping Recife (frontend) */
(() => {
"use strict";

/* ---------- utilidades ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const STATUS = ["Aberto","Em andamento","Aguardando agente","Resolvido","Fechado"];
const DONE = s => s==="Resolvido"||s==="Fechado";
const SLABEL = s => s==="Aberto" ? "Novo" : s;
const sClass = s => ({"Aberto":"s-aberto","Em andamento":"s-andamento","Aguardando agente":"s-aguardando","Resolvido":"s-resolvido","Fechado":"s-fechado"}[s]||"");
const pClass = p => ({"Baixa":"p-baixa","Média":"p-media","Alta":"p-alta","Urgente":"p-urgente"}[p]||"");
const PRIS = ["Urgente","Alta","Média","Baixa"];
const ROLE_LABEL = {agente:"Agente", suporte:"Help desk", admin:"Administrador"};
const fmt = iso => { if (!iso) return ""; try { return new Date(iso).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}); } catch { return iso; } };
const dur = ms => { const m=Math.round(Math.abs(ms)/60000); if(m<60) return m+"min"; const h=Math.floor(m/60), r=m%60; if(h<48) return h+"h"+(r?String(r).padStart(2,"0"):""); return Math.round(h/24)+" dias"; };
function toast(t){ const d=document.createElement("div"); d.className="toast"; d.setAttribute("role","status"); d.textContent=t; document.body.appendChild(d); setTimeout(()=>d.remove(),3200); }

/* ---------- API ---------- */
function HD_Q(){ return window.HD_TOKEN ? "?t=" + encodeURIComponent(window.HD_TOKEN) : ""; }
async function api(method, url, body){
  const opt = { method, headers: window.HD_TOKEN ? { Authorization: "Bearer " + window.HD_TOKEN } : {}, credentials:"same-origin" };
  if (body instanceof FormData) opt.body = body;
  else if (body !== undefined) { opt.headers["Content-Type"]="application/json"; opt.body=JSON.stringify(body); }
  let res;
  try { res = await fetch(url, opt); }
  catch { throw new Error("Sem conexão com o servidor. Verifique a internet."); }
  let data = null;
  try { data = await res.json(); } catch {}
  if ((res.status===401 || (data && data.codigo==="inativo")) && me) { semAcesso(data && data.erro); }
  if (!res.ok) throw new Error((data && data.erro) || `Erro ${res.status}`);
  return data;
}

/* ---------- estado ---------- */
let me=null, cfg={sla:{},lojas:[],categorias:[],emissores:[],fornecedores:[]}, emailAuto=false, perfilPeloSistema=false, tickets=[], leituras={}, versao="", pollTimer=null;
let panes=[], adminView="ambos", activePane=null;
const isAdmin = () => me?.perfil==="admin";
const isStaff = () => me?.perfil==="suporte" || me?.perfil==="admin";
const slaHours = p => Number(cfg.sla?.[p]) || ({"Urgente":2,"Alta":4,"Média":8,"Baixa":24}[p]) || 8;
const lojaOf = t => t.autorLoja || "Sem loja";
const locText = t => [t.locAereo, t.locPacote].filter(Boolean).join(" ");
const readAdminView = () => { try { return localStorage.getItem("hd_adminview") || "ambos"; } catch { return "ambos"; } };

function slaInfo(t){
  const prazo = t.prazoEm;
  const total = new Date(prazo) - new Date(t.criadoEm);
  if (DONE(t.status) && t.resolvidoEm){
    const ok = new Date(t.resolvidoEm) <= new Date(prazo);
    return { cls: ok?"done":"bad", txt: ok?"No prazo":"Fora do prazo", ok, late:false, due:prazo };
  }
  if (DONE(t.status)) return { cls:"done", txt:"Encerrado", ok:null, late:false, due:prazo };
  const left = new Date(prazo) - Date.now();
  if (left < 0) return { cls:"bad", txt:"Atrasado "+dur(left), late:true, due:prazo };
  return { cls: left < total*0.25 ? "warn":"ok", txt:"Vence em "+dur(left), late:false, due:prazo };
}

/* ---------- leitura de mensagens ---------- */
const lidoEm = (mode,t) => leituras[mode+":"+t.id] || "";
const isUnread = (P,t) => !!(me && t.ultimaMsgEm && t.ultimaMsgPerfil && t.ultimaMsgPerfil!==P.mode && t.id!==P.selected && (!lidoEm(P.mode,t) || lidoEm(P.mode,t) < t.ultimaMsgEm));
function markSeen(t, mode){
  if (!t || !t.ultimaMsgEm) return;
  const k = mode+":"+t.id;
  if (leituras[k] && leituras[k] >= t.ultimaMsgEm) return;
  leituras[k] = t.ultimaMsgEm;
  api("POST", `api/chamados/${t.id}/lido`, { visao:mode, em:t.ultimaMsgEm }).catch(()=>{});
}

/* ---------- sem acesso (login é feito no sistema principal) ---------- */
async function semAcesso(msg){
  clearInterval(pollTimer); me=null; tickets=[]; leituras={}; panes=[]; versao="";
  $("#panes").innerHTML="";
  document.title="Azul Viagens Shopping Recife · Help Desk";
  document.querySelectorAll("dialog[open]").forEach(d=>d.close());
  $("#appView").classList.add("hidden"); $("#authView").classList.remove("hidden");
  $("#acessoBox h2").textContent = "Acesso ao Help Desk";
  $("#acessoMsg").className = "msg err";
  $("#acessoMsg").textContent = msg || "Entre no sistema principal para usar o help desk.";
  try {
    const a = await api("GET","api/acesso");
    if (a.entrar){ $("#acessoEntrar").href = a.entrar; $("#acessoEntrar").classList.remove("hidden"); }
  } catch {}
}

/* ---------- entrada no sistema ---------- */
async function iniciar(){
  const s = await api("GET","api/sessao");
  me = { ...s.usuario, id:String(s.usuario.id) };
  cfg = s.config; emailAuto = !!s.emailAutomatico; perfilPeloSistema = !!s.perfilPeloSistema;
  const links = s.links || {};
  if (links.voltar){ $("#voltarBtn").href=links.voltar; $("#voltarBtn").classList.remove("hidden"); }
  if (links.sair){ $("#logoutBtn").href=links.sair; $("#logoutBtn").classList.remove("hidden"); }
  $("#authView").classList.add("hidden"); $("#appView").classList.remove("hidden");
  $("#roleTag").textContent = ROLE_LABEL[me.perfil]||"Agente";
  $("#whoName").textContent=me.nome; $("#whoMail").textContent=me.email+(me.loja?" · "+me.loja:"");
  document.querySelectorAll(".staff-only").forEach(el=>el.classList.toggle("hidden",!isStaff()));
  document.querySelectorAll(".admin-only").forEach(el=>el.classList.toggle("hidden",!isAdmin()));
  adminView = readAdminView();
  panes=[]; buildPanes();
  await carregarChamados();
  abrirDoLink();
  clearInterval(pollTimer);
  pollTimer = setInterval(verificarNovidades, 10000);
}

async function carregarChamados(){
  const unreadAntes = me && tickets.length ? unreadIds().size : null;
  try { versao = (await api("GET","api/chamados/versao")).versao; } catch {}
  const d = await api("GET","api/chamados");
  tickets = d.chamados || []; leituras = d.leituras || {};
  renderAll();
  const after = unreadIds().size;
  document.title = (after?`(${after}) `:"") + "Azul Viagens Shopping Recife · Help Desk";
  if (unreadAntes!==null && after>unreadAntes) toast("Nova mensagem em um chamado");
}
const unreadIds = () => new Set(panes.flatMap(P=>visible(P).filter(t=>isUnread(P,t)).map(t=>t.id)));

async function verificarNovidades(){
  if (!me || document.hidden) return;
  try {
    const v = (await api("GET","api/chamados/versao")).versao;
    if (v!==versao){
      const cfgMudou = !versao || v.split("|")[2] !== versao.split("|")[2];
      if (cfgMudou){ cfg = await api("GET","api/config"); fillLojaSelects(); }
      await carregarChamados();
    }
  } catch {}
}
document.addEventListener("visibilitychange", ()=>{ if (!document.hidden) verificarNovidades(); });

function abrirDoLink(){
  const m = /^#chamado-(\d+)$/.exec(location.hash);
  if (!m) return;
  const t = tickets.find(x=>x.id===m[1]);
  if (!t) return;
  const P = panes.find(p=>p.mode==="suporte" && isStaff()) || panes.find(p=>p.mode==="agente" && t.autorId===me.id) || panes[0];
  if (P){ P.filterStatus = DONE(t.status) ? t.status : ""; select(P, t.id); }
  history.replaceState(null, "", location.pathname);
}

function fillLojaSelects(){
  const opts = (cfg.lojas||[]).map(l=>`<option>${esc(l)}</option>`).join("");
  const keep = (el, html) => { if (!el) return; const v=el.value; el.innerHTML=html; if ([...el.options].some(o=>o.value===v)) el.value=v; };
  keep($("#uLoja"), `<option value="">—</option>`+opts);
  panes.forEach(P=>keep(P.$("fLoja"), `<option value="">Todas as lojas</option>`+opts));
  const cats = cfg.categorias||[];
  keep($("#nCat"), cats.length ? cats.map(c=>`<option>${esc(c)}</option>`).join("") : `<option value="Geral">Geral</option>`);
  $("#catHint").classList.toggle("hidden", cats.length>0);
  const selOpts = arr => `<option value="">${arr.length?"Selecione…":"Nenhum cadastrado"}</option>`+arr.map(x=>`<option>${esc(x)}</option>`).join("");
  keep($("#nEmissor"), selOpts(cfg.emissores||[])); keep($("#nFornecedor"), selOpts(cfg.fornecedores||[]));
}

/* ---------- painéis (visão help desk / visão agente) ---------- */
function buildPanes(){
  const modes = isAdmin() ? (adminView==="ambos" ? ["suporte","agente"] : [adminView]) : [isStaff() ? "suporte" : "agente"];
  const old = Object.fromEntries(panes.map(p=>[p.mode,p]));
  const host=$("#panes"); host.innerHTML="";
  host.classList.toggle("split", modes.length>1);
  panes = modes.map(mode => {
    const P = old[mode] || { mode, key:"p"+mode, filterStatus:"", selected:null, lastDetailKey:"", replyFiles:[], replyPicker:null };
    P.lastDetailKey = "__rebuild";
    P.compact = modes.length>1;
    P.root = document.createElement("section");
    P.root.className = "pane "+(P.compact?"compact ":"")+"pane-"+mode;
    P.root.innerHTML = paneHTML(P);
    host.appendChild(P.root);
    P.$ = n => P.root.querySelector("#"+P.key+"-"+n);
    P.$("search").oninput=()=>render(P); P.$("fPri").onchange=()=>render(P); P.$("fLoja").onchange=()=>render(P);
    const nb=P.$("newBtn"); if (nb) nb.onclick=openNew;
    P.root.addEventListener("focusin",()=>activePane=P); P.root.addEventListener("pointerdown",()=>activePane=P);
    return P;
  });
  fillLojaSelects();
  $("#viewSwitch").querySelectorAll("button").forEach(b=>b.setAttribute("aria-pressed", b.dataset.v===adminView));
  renderAll();
}
function paneHTML(P){
  const sup = P.mode==="suporte", k=P.key;
  return `
    ${P.compact?`<div class="pane-band">${sup?"Visão Help Desk":"Visão Agente · meus chamados"}</div>`:""}
    <div class="stats" id="${k}-stats"></div>
    <div class="layout" id="${k}-layout">
      <section class="panel listPanel" id="${k}-listPanel">
        <div class="panel-h">
          <h2 id="${k}-listTitle"></h2>
          <div class="toolbar">
            <input id="${k}-search" type="search" placeholder="Buscar ou localizador" aria-label="Buscar chamados">
            <select id="${k}-fLoja" class="${sup?"":"hidden"}" aria-label="Filtrar loja"></select>
            <select id="${k}-fPri" aria-label="Filtrar prioridade">
              <option value="">Todas prioridades</option>
              <option>Urgente</option><option>Alta</option><option>Média</option><option>Baixa</option>
            </select>
            ${sup?"":`<button class="btn" id="${k}-newBtn">Novo chamado</button>`}
          </div>
        </div>
        <ul class="list" id="${k}-list"></ul>
      </section>
      <section class="panel detailPanel" id="${k}-detailPanel"><div id="${k}-detail"><div class="empty">Selecione um chamado para ver os detalhes.</div></div></section>
    </div>`;
}
$("#viewSwitch").querySelectorAll("button").forEach(b=>b.onclick=()=>{
  adminView=b.dataset.v; try { localStorage.setItem("hd_adminview", adminView); } catch {}
  buildPanes();
});
setInterval(()=>{ if (me) renderAll(true); }, 60000);

/* ---------- lista ---------- */
const matchesStatus = (P,t) => { const f=P.filterStatus; return f==="__unread" ? isUnread(P,t) : f==="__late" ? (!DONE(t.status) && slaInfo(t).late) : f ? t.status===f : !DONE(t.status); };
const visible = P => P.mode==="suporte" ? tickets : tickets.filter(t=>t.autorId===me.id);
const renderAll = timerOnly => panes.forEach(P=>render(P,timerOnly));

function render(P, timerOnly){
  if (!P.root || !P.root.isConnected) return;
  const sup = P.mode==="suporte";
  const base = visible(P);
  const counts = Object.fromEntries(STATUS.map(s=>[s,0]));
  base.forEach(t=>counts[t.status]=(counts[t.status]||0)+1);
  const open = base.filter(t=>!DONE(t.status));
  const late = open.filter(t=>slaInfo(t).late).length;
  const f=P.filterStatus;
  P.$("stats").innerHTML =
    `<button class="stat" data-st="" aria-pressed="${f===""}"><b>${open.length}</b>Todos ativos</button>` +
    `<button class="stat unread" data-st="__unread" aria-pressed="${f==="__unread"}"><b>${base.filter(t=>isUnread(P,t)).length}</b>Mensagens novas</button>` +
    `<button class="stat late" data-st="__late" aria-pressed="${f==="__late"}"><b>${late}</b>Atrasados</button>` +
    STATUS.map(s=>`<button class="stat" data-st="${s}" aria-pressed="${f===s}"><b>${counts[s]||0}</b>${SLABEL(s)}</button>`).join("");
  P.$("stats").querySelectorAll(".stat").forEach(b=>b.onclick=()=>{
    P.filterStatus=b.dataset.st; P.$("layout").classList.remove("showing-detail");
    const t=tickets.find(x=>x.id===P.selected);
    if (t && !matchesStatus(P,t)) P.selected=null;
    render(P); P.$("listPanel").scrollIntoView({behavior:"smooth",block:"start"});
  });
  P.$("listTitle").textContent = (sup?"Fila":"Meus chamados") + (f==="__late"?" · Atrasados": f==="__unread"?" · Mensagens novas": f?" · "+SLABEL(f):" · Ativos");

  const q=P.$("search").value.trim().toLowerCase(), pri=P.$("fPri").value, loja=sup?P.$("fLoja").value:"";
  let l = base.filter(t=>matchesStatus(P,t));
  if (pri) l=l.filter(t=>t.prioridade===pri);
  if (loja) l=l.filter(t=>lojaOf(t)===loja);
  if (q) l=l.filter(t=>[t.numero,t.titulo,t.descricao,t.autorNome,locText(t),t.categoria,lojaOf(t)].join(" ").toLowerCase().includes(q));
  l.sort((a,b)=> sup
    ? (DONE(a.status)-DONE(b.status)) || (new Date(slaInfo(a).due)-new Date(slaInfo(b).due))
    : (b.atualizadoEm>a.atualizadoEm?1:-1));

  const ul=P.$("list");
  if (!l.length){
    ul.innerHTML = `<li class="empty">${base.length ? "Nenhum chamado com esses filtros." :
      sup ? "A fila está vazia. Novos chamados dos agentes aparecem aqui." :
      `Você ainda não abriu chamados.<br><button class='btn' data-empty-new>Abrir o primeiro chamado</button>`}</li>`;
    const b=ul.querySelector("[data-empty-new]"); if (b) b.onclick=openNew;
  } else {
    ul.innerHTML = l.map(t=>{ const s=slaInfo(t); return `
      <li class="tk ${s.late?"overdue":""}" tabindex="0" data-id="${esc(t.id)}" aria-current="${P.selected===t.id}">
        <div class="stub"><span class="num">${esc(t.numero)}</span><span class="pri ${pClass(t.prioridade)}">${esc(t.prioridade)}</span></div>
        <div class="body">
          <div class="t">${esc(t.titulo)}</div>
          <div class="meta"><span class="pill ${sClass(t.status)}">${esc(SLABEL(t.status))}</span>
            ${isUnread(P,t)?`<span class="newdot">${t.mensagens&&t.mensagens.length>1?"Nova mensagem":"Novo"}</span>`:""}
            <span class="sla ${s.cls}">${esc(s.txt)}</span>
            ${sup?`<span>${esc(lojaOf(t))}</span>`:""}
            ${t.clienteNome?`<span>${esc(t.clienteNome)}</span>`:""}
            <span>${esc(t.locAereo||t.locPacote||"")}</span>
            ${(t.anexos||[]).length?`<span>📎 ${(t.anexos||[]).length}</span>`:""}
          </div>
        </div>
      </li>`; }).join("");
    ul.querySelectorAll(".tk").forEach(li=>{
      li.onclick=()=>select(P,li.dataset.id);
      li.onkeydown=e=>{ if(e.key==="Enter"||e.key===" "){e.preventDefault();select(P,li.dataset.id);} };
    });
  }
  const t = tickets.find(x=>x.id===P.selected);
  const key = t ? t.id+"|"+t.atualizadoEm : "";
  if (key !== P.lastDetailKey) { P.lastDetailKey=key; renderDetail(P); }
  else if (timerOnly && t) { const el=P.$("detailSla"); if (el){ const s=slaInfo(t); el.className="sla "+s.cls; el.textContent=s.txt; } }
}
function closeDetail(P,msg){
  P.selected=null; P.lastDetailKey="__closed"; P.$("layout").classList.remove("showing-detail"); renderAll(); if (msg) toast(msg);
}
function select(P,id){ P.selected=id; P.lastDetailKey=""; activePane=P; P.$("layout").classList.add("showing-detail"); render(P); }
function substituir(t){
  const i = tickets.findIndex(x=>x.id===t.id);
  if (i>=0) tickets[i]=t; else tickets.push(t);
  renderAll();
}

/* ---------- detalhe ---------- */
function renderDetail(P){
  const box=P.$("detail");
  const t=tickets.find(x=>x.id===P.selected);
  const sup = P.mode==="suporte", k=P.key;
  if (!t || (!sup && t.autorId!==me.id)){ box.innerHTML=`<div class="empty">Selecione um chamado para ver os detalhes.</div>`; return; }
  markSeen(t, P.mode);
  const s=slaInfo(t);
  const draft=P.$("replyTx")?.value||"";
  const anex=t.anexos||[];
  const ehImg = a => !a.mime || a.mime.startsWith("image/");
  const imgs=anex.filter(ehImg), docs=anex.filter(a=>!ehImg(a));
  box.innerHTML = `
    <div class="detail-head">
      <button class="btn ghost back sm" id="${k}-backBtn" style="margin-bottom:10px">Voltar à lista</button>
      <div class="num">${esc(t.numero)} · aberto em ${fmt(t.criadoEm)}</div>
      <h2>${esc(t.titulo)}</h2>
      <dl class="facts">
        <div><dt>Status</dt><dd><span class="pill ${sClass(t.status)}">${esc(SLABEL(t.status))}</span></dd></div>
        <div><dt>Prazo (SLA ${slaHours(t.prioridade)}h)</dt><dd><span id="${k}-detailSla" class="sla ${s.cls}">${esc(s.txt)}</span><br><small>${fmt(s.due)}</small></dd></div>
        <div><dt>Prioridade</dt><dd class="${pClass(t.prioridade)}">${esc(t.prioridade)}</dd></div>
        <div><dt>Categoria</dt><dd>${esc(t.categoria)}</dd></div>
        <div><dt>Solicitante</dt><dd>${esc(t.autorNome)}<br><small>${esc(lojaOf(t))}</small></dd></div>
        <div><dt>Responsável</dt><dd>${esc(t.responsavelNome||"Ainda não atribuído")}</dd></div>
        ${t.clienteNome?`<div><dt>Cliente</dt><dd>${esc(t.clienteNome)}</dd></div>`:""}
        ${t.emissor?`<div><dt>Emissor</dt><dd>${esc(t.emissor)}</dd></div>`:""}
        ${t.fornecedor?`<div><dt>Fornecedor</dt><dd>${esc(t.fornecedor)}</dd></div>`:""}
      </dl>
      <div class="locs">
        ${t.locAereo?`<span class="loc"><small>Aéreo</small>${esc(t.locAereo)}</span>`:""}
        ${t.locPacote?`<span class="loc"><small>Pacote</small>${esc(t.locPacote)}</span>`:""}
      </div>
    </div>
    <div class="desc">${esc(t.descricao)}</div>
    ${docs.length?`<div style="padding:12px 18px;border-bottom:1px solid var(--line)"><label>Arquivos (${docs.length})</label><div style="display:flex;gap:8px;flex-wrap:wrap">${docs.map(a=>`<a class="doc" href="api/anexos/${encodeURIComponent(a.id)}${HD_Q()}" target="_blank" rel="noopener" title="${esc(a.nome)} — ${esc(a.autor||"")}"><b>${esc(docTag(a.nome))}</b><span>${esc(a.nome)}</span><small>${esc(kb(a.tamanho))}</small></a>`).join("")}</div></div>`:""}
    ${imgs.length?`<div style="padding:12px 18px;border-bottom:1px solid var(--line)"><label>Prints (${imgs.length})</label><div class="thumbs">${imgs.map(a=>`<button type="button" class="thumb" data-aid="${esc(a.id)}" data-nome="${esc(a.nome)}" title="${esc(a.nome)} — ${esc(a.autor||"")}"><img src="api/anexos/${encodeURIComponent(a.id)}${HD_Q()}" alt="${esc(a.nome)}" loading="lazy"></button>`).join("")}</div></div>`:""}
    ${sup ? `<div class="actions">
        <select id="${k}-stSel" aria-label="Alterar status">${STATUS.map(x=>`<option value="${x}" ${x===t.status?"selected":""}>${SLABEL(x)}</option>`).join("")}</select>
        <select id="${k}-prSel" aria-label="Alterar prioridade">${PRIS.map(p=>`<option ${p===t.prioridade?"selected":""}>${p}</option>`).join("")}</select>
        ${t.responsavelId!==me.id?`<button class="btn dark sm" id="${k}-assignBtn">Assumir chamado</button>`:""}
        ${!DONE(t.status)?`<button class="btn sm" id="${k}-resolveBtn">Marcar como resolvido</button>`:""}
        ${t.status!=="Fechado"?`<button class="btn ghost sm" id="${k}-fecharBtn">Fechar chamado</button>`:""}
        <button class="btn ghost sm" id="${k}-mailAgentBtn">Avisar agente</button>
      </div>` : `<div class="actions">
        ${t.status==="Resolvido"?`<button class="btn dark sm" id="${k}-closeBtn">Confirmar solução e fechar</button><button class="btn ghost sm" id="${k}-reopenBtn">Ainda não resolveu</button>`:""}
        ${t.status!=="Fechado"?`<button class="btn ghost sm" id="${k}-mailHdBtn">Avisar help desk</button>`:""}
      </div>`}
    <div class="thread">${(t.mensagens||[]).map(m=> m.sistema
        ? `<div class="bubble sys">${esc(m.texto)} · ${fmt(m.em)}</div>`
        : `<div class="bubble ${m.perfil===P.mode && m.autorId===me.id?"mine":""}"><div class="by">${esc(m.autor)} ${m.perfil==="suporte"?"(help desk)":""} · ${fmt(m.em)}</div><div class="tx">${esc(m.texto)}</div>${m.anexos?`<div class="by" style="margin-top:4px">📎 ${m.anexos} arquivo(s) anexado(s)</div>`:""}</div>`).join("")
      || `<div class="bubble sys">Nenhuma mensagem ainda</div>`}</div>
    ${t.status!=="Fechado" ? `<div class="reply">
      <label for="${k}-replyTx">${sup?"Responder ao agente":"Adicionar informação para o help desk"}</label>
      <textarea id="${k}-replyTx" placeholder="${sup?"Explique o próximo passo ou peça mais detalhes.":"Ex.: o erro voltou, segue o print…"}">${esc(draft)}</textarea>
      <div class="thumbs" id="${k}-replyThumbs"></div>
      <div class="row">
        <span class="help" style="margin:0"><label for="${k}-replyFiles" style="display:inline;text-decoration:underline;cursor:pointer;font-size:12.5px">Anexar print, PDF ou planilha</label> ou cole com Ctrl+V <input type="file" id="${k}-replyFiles" accept="image/*,.pdf,.xlsx,.xls,.csv" multiple class="hidden"></span>
        <span style="display:flex;gap:8px;flex-wrap:wrap">
          <label style="display:flex;align-items:center;gap:6px;margin:0;font-weight:400"><input type="checkbox" id="${k}-replyMail" style="width:auto"> Avisar também por WhatsApp/SMS</label>
          <button class="btn" id="${k}-sendBtn">Enviar mensagem</button>
        </span>
      </div></div>`
      : `<div class="empty" style="padding:18px">Chamado fechado.${sup?"":" Se o problema voltar, abra um novo chamado."}</div>`}
  `;
  box.querySelectorAll("[data-aid]").forEach(el=>el.onclick=()=>{
    $("#imgBig").src=`api/anexos/${encodeURIComponent(el.dataset.aid)}${HD_Q()}`; $("#imgBig").alt=el.dataset.nome; $("#imgName").textContent=el.dataset.nome; $("#imgDlg").showModal();
  });
  P.$("backBtn").onclick=()=>P.$("layout").classList.remove("showing-detail");

  const acao = async (acao, valor) => {
    try { substituir(await api("PATCH", `api/chamados/${t.id}`, { acao, valor })); return true; }
    catch(err){ toast("Não foi possível salvar: "+err.message); return false; }
  };
  if (sup){
    const setStatus = async st => {
      if (st===t.status) return;
      if (!await acao("status", st)) { const s=P.$("stSel"); if (s) s.value=t.status; return; }
      if (DONE(st)) closeDetail(P, `Chamado ${t.numero} ${st==="Resolvido"?"marcado como resolvido":"fechado"}`);
      if (!emailAuto && (st==="Resolvido"||st==="Aguardando agente")) notifyAgent({...t,status:st}, st==="Resolvido"?"Seu chamado foi marcado como resolvido. Confirme a solução no sistema.":"Precisamos de mais informações para continuar.");
    };
    P.$("stSel").onchange=e=>setStatus(e.target.value);
    const rb=P.$("resolveBtn"); if (rb) rb.onclick=()=>setStatus("Resolvido");
    const fb=P.$("fecharBtn"); if (fb) fb.onclick=()=>setStatus("Fechado");
    P.$("prSel").onchange=e=>acao("prioridade", e.target.value);
    const a=P.$("assignBtn"); if(a) a.onclick=()=>acao("assumir");
    P.$("mailAgentBtn").onclick=()=>notifyAgent(t, "Há uma atualização no seu chamado.");
  } else {
    const c=P.$("closeBtn"); if(c) c.onclick=async()=>{ if (await acao("confirmar")) closeDetail(P, `Chamado ${t.numero} fechado`); };
    const r=P.$("reopenBtn"); if(r) r.onclick=async()=>{ if (await acao("reabrir") && !emailAuto) notifyHelpdesk({...t,status:"Aberto"}, `O chamado ${t.numero} foi reaberto: a solução não resolveu.`); };
    const mh=P.$("mailHdBtn"); if(mh) mh.onclick=()=>notifyHelpdesk(t, "Preciso de atenção neste chamado.");
  }
  const rt=P.$("replyThumbs");
  if (rt){
    if (P.replyPicker && P.replyPicker._for!==t.id) P.replyFiles.length=0;
    P.replyPicker = makePicker({listEl:rt, inputEl:P.$("replyFiles"), arr:P.replyFiles}); P.replyPicker._for=t.id;
    const sendBtn=P.$("sendBtn");
    sendBtn.onclick=async()=>{
      const tx=P.$("replyTx").value.trim();
      if (!tx && !P.replyFiles.length) return;
      sendBtn.disabled=true; sendBtn.textContent="Enviando…";
      try {
        const fd = new FormData();
        fd.append("texto", tx); fd.append("visao", P.mode);
        P.replyFiles.forEach(f=>fd.append("prints", f.blob, f.nome));
        const qtd = P.replyFiles.length;
        const wantMsg=P.$("replyMail").checked;
        const novo = await api("POST", `api/chamados/${t.id}/mensagens`, fd);
        P.replyFiles.length=0; const ta=P.$("replyTx"); if (ta) ta.value="";
        substituir(novo);
        if (wantMsg){ const m=`Nova mensagem de ${me.nome}:\n"${tx}"${qtd?`\n(${qtd} print(s) anexado(s) no chamado)`:""}`; sup?notifyAgent(t,m):notifyHelpdesk(t,m); }
      } catch(err){ toast("Não foi possível enviar: "+err.message); }
      const b=P.$("sendBtn"); if (b) { b.disabled=false; b.textContent="Enviar mensagem"; }
    };
  }
}

/* ---------- anexos: prints são compactados no navegador; PDF/planilhas vão como estão, com limite de tamanho ---------- */
const MAX_FILES = 6, MAX_BYTES = 400*1024, MAX_DOC = 5*1024*1024;
const DOC_EXT = /\.(pdf|xlsx|xls|csv)$/i;
const docTag = n => ((String(n).match(/\.([a-z0-9]+)$/i)||[])[1]||"ARQ").toUpperCase();
const kb = b => !b ? "" : b<1024*1024 ? Math.max(1,Math.round(b/1024))+" KB" : (b/1048576).toFixed(1).replace(".",",")+" MB";
function loadImage(file){ return new Promise((res,rej)=>{ const url=URL.createObjectURL(file); const img=new Image(); img.onload=()=>{URL.revokeObjectURL(url);res(img);}; img.onerror=()=>{URL.revokeObjectURL(url);rej(new Error("Imagem inválida"));}; img.src=url; }); }
const toBlob = (c,q) => new Promise(r=>c.toBlob(r,"image/jpeg",q));
async function compress(file){
  const img = await loadImage(file);
  let w=img.naturalWidth, h=img.naturalHeight, maxW=1920, q=0.85, blob=null;
  for (let i=0;i<8;i++){
    const s=Math.min(1, maxW/w); const c=document.createElement("canvas"); c.width=Math.round(w*s); c.height=Math.round(h*s);
    const ctx=c.getContext("2d"); ctx.fillStyle="#fff"; ctx.fillRect(0,0,c.width,c.height); ctx.drawImage(img,0,0,c.width,c.height);
    blob = await toBlob(c,q);
    if (blob && blob.size <= MAX_BYTES) break;
    if (q>0.55) q-=0.1; else maxW=Math.round(maxW*0.75);
  }
  return blob;
}
function makePicker({listEl, dropEl, inputEl, arr}){
  const draw = () => {
    listEl.innerHTML = arr.map((a,i)=> a.doc
      ? `<span class="doc" title="${esc(a.nome)}"><b>${esc(docTag(a.nome))}</b><span>${esc(a.nome)}</span><small>${esc(kb(a.blob.size))}</small><button type="button" class="x" data-i="${i}" aria-label="Remover ${esc(a.nome)}">×</button></span>`
      : `<div class="thumb" title="${esc(a.nome)}"><img src="${a.url}" alt="${esc(a.nome)}"><button type="button" class="x" data-i="${i}" aria-label="Remover ${esc(a.nome)}">×</button></div>`).join("");
    listEl.querySelectorAll(".x").forEach(b=>b.onclick=()=>{ const [r]=arr.splice(+b.dataset.i,1); if (r && r.url) URL.revokeObjectURL(r.url); draw(); });
  };
  const add = async files => {
    for (const f of files){
      if (arr.length>=MAX_FILES) { toast("Máximo de "+MAX_FILES+" arquivos"); break; }
      if (DOC_EXT.test(f.name||"")) {
        if (f.size > MAX_DOC) { toast(`"${f.name}" passa de 5 MB. Salve em PDF menor ou envie só a aba necessária da planilha.`); continue; }
        arr.push({ nome:f.name, blob:f, url:null, doc:true }); draw(); continue;
      }
      if (!f.type.startsWith("image/")) { toast("Aceitos: imagens, PDF, XLSX, XLS ou CSV"); continue; }
      try {
        const blob = await compress(f);
        const nome = (f.name||("print-"+(arr.length+1))).replace(/\.[^.]+$/,"")+".jpg";
        arr.push({ nome, blob, url:URL.createObjectURL(blob) }); draw();
      } catch(e){ toast(e.message); }
    }
  };
  if (inputEl) inputEl.onchange = () => { add([...inputEl.files]); inputEl.value=""; };
  if (dropEl){
    dropEl.ondragover = e => { e.preventDefault(); dropEl.classList.add("over"); };
    dropEl.ondragleave = () => dropEl.classList.remove("over");
    dropEl.ondrop = e => { e.preventDefault(); dropEl.classList.remove("over"); add([...e.dataTransfer.files]); };
  }
  draw();
  return { add, draw, clear(){ arr.forEach(a=>a.url&&URL.revokeObjectURL(a.url)); arr.length=0; draw(); } };
}
document.addEventListener("paste", e => {
  const files=[...(e.clipboardData?.files||[])].filter(f=>f.type.startsWith("image/"));
  if (!files.length || !me) return;
  if ($("#newDlg").open) { e.preventDefault(); newPicker.add(files); return; }
  if (document.querySelector("dialog[open]")) return;
  const P = (activePane && activePane.replyPicker && activePane.$("replyThumbs")) ? activePane : panes.find(p=>p.replyPicker && p.$("replyThumbs"));
  if (P) { e.preventDefault(); P.replyPicker.add(files); }
});

/* ---------- avisos manuais: WhatsApp, SMS, e-mail ---------- */
let mailText="";
const phoneDigits = tel => { let d=String(tel||"").replace(/\D/g,""); if (!d) return ""; if (d.length<=11) d="55"+d.replace(/^0+/,""); return d; };
function openNotify({email, tel, name}, subject, body, title){
  const short = `${subject}\n\n${body}`;
  mailText = short;
  $("#mailTitle").textContent = title || "Avisar";
  $("#mailTo").textContent = [name, email, tel].filter(Boolean).join(" · ") || "—";
  $("#mailBody").textContent = short;
  const d = phoneDigits(tel);
  const set = (el, href) => { if (href){ el.href=href; el.removeAttribute("aria-disabled"); } else { el.removeAttribute("href"); el.setAttribute("aria-disabled","true"); } };
  set($("#nfWhats"), d ? `https://wa.me/${d}?text=${encodeURIComponent(short)}` : "");
  set($("#nfSms"), d ? `sms:+${d}?body=${encodeURIComponent(short)}` : "");
  set($("#mailOpen"), email ? `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` : "");
  $("#nfHint").textContent = (d ? "Cada botão abre o aplicativo com a mensagem pronta; é só enviar." : "Sem celular cadastrado: WhatsApp e SMS ficam indisponíveis. Cadastre o número em “Minha conta”, “Usuários” ou “Configurações”.")
    + (emailAuto ? " Os e-mails principais já são enviados automaticamente pelo sistema." : "");
  $("#mailDlg").showModal();
}
["#nfWhats","#nfSms","#mailOpen"].forEach(s=>$(s).addEventListener("click",()=>setTimeout(()=>$("#mailDlg").close(),300)));
$("#mailCopy").onclick = async () => { try { await navigator.clipboard.writeText(mailText); toast("Mensagem copiada"); } catch { toast("Não foi possível copiar"); } };
function ticketSummary(t){
  return [
    `Chamado: ${t.numero} — ${t.titulo}`,
    `Loja: ${lojaOf(t)} · Solicitante: ${t.autorNome}`,
    `Categoria: ${t.categoria} · Prioridade: ${t.prioridade}`,
    t.clienteNome ? `Cliente: ${t.clienteNome}` : "",
    t.locAereo ? `Localizador aéreo: ${t.locAereo}` : "",
    t.locPacote ? `Pacote/reserva: ${t.locPacote}` : "",
    `Status: ${SLABEL(t.status)}`,
    `Prazo (SLA): ${fmt(t.prazoEm)}`
  ].filter(Boolean).join("\n");
}
const linkChamado = t => `${location.origin}${location.pathname}#chamado-${t.id}`;
function notifyHelpdesk(t, extra){
  openNotify({email:cfg.emailHelpdesk, tel:cfg.telHelpdesk, name:"Help Desk"}, `[${t.numero}] ${t.prioridade}: ${t.titulo}`,
    `${extra}\n\n${ticketSummary(t)}\n\n${linkChamado(t)}`, "Avisar o help desk");
}
function notifyAgent(t, extra){
  openNotify({email:t.autorEmail||"", tel:t.autorTel||"", name:t.autorNome}, `[${t.numero}] ${SLABEL(t.status)}: ${t.titulo}`,
    `Olá, ${String(t.autorNome).split(" ")[0]}.\n\n${extra}\n\n${ticketSummary(t)}\n\n${linkChamado(t)}\n— ${me.nome}, Help Desk`, "Avisar o agente");
}

/* ---------- novo chamado ---------- */
const newFiles=[];
const newPicker = makePicker({listEl:$("#newThumbs"), dropEl:$("#newDrop"), inputEl:$("#nFiles"), arr:newFiles});
const updSlaHint = () => $("#slaHint").textContent = `Prazo de atendimento: ${slaHours($("#nPri").value)}h`;
$("#nPri").onchange = updSlaHint;
$("#nLocAereo").oninput = e => { e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,""); e.target.removeAttribute("aria-invalid"); };
$("#nLocPacote").oninput = e => { e.target.value=e.target.value.toUpperCase(); e.target.removeAttribute("aria-invalid"); };
function openNew(){ $("#newForm").reset(); $("#nCliente").removeAttribute("aria-invalid"); $("#nPri").value="Média"; newPicker.clear(); $("#newMsg").textContent=""; fillLojaSelects(); updSlaHint(); $("#newDlg").showModal(); $("#nTitle").focus(); }
$("#newForm").onsubmit = async e => {
  e.preventDefault();
  const m=$("#newMsg"); m.textContent="";
  const titulo=$("#nTitle").value.trim(), desc=$("#nDesc").value.trim();
  const aer=$("#nLocAereo").value.trim(), pac=$("#nLocPacote").value.trim();
  const cliente=$("#nCliente").value.trim(), emissor=$("#nEmissor").value, fornecedor=$("#nFornecedor").value;
  if (!titulo){ m.textContent="Escreva um resumo do problema."; $("#nTitle").focus(); return; }
  if (!cliente){ m.textContent="Informe o nome do cliente."; $("#nCliente").setAttribute("aria-invalid","true"); $("#nCliente").focus(); return; }
  if ((cfg.emissores||[]).length && !emissor){ m.textContent="Escolha o emissor."; $("#nEmissor").focus(); return; }
  if ((cfg.fornecedores||[]).length && !fornecedor){ m.textContent="Escolha o fornecedor."; $("#nFornecedor").focus(); return; }
  if (!aer && !pac){ m.textContent="Informe o localizador aéreo ou o número do pacote/reserva."; $("#nLocAereo").setAttribute("aria-invalid","true"); $("#nLocPacote").setAttribute("aria-invalid","true"); $("#nLocAereo").focus(); return; }
  if (aer && !/^[A-Z0-9]{5,8}$/.test(aer)){ m.textContent="O localizador aéreo deve ter de 5 a 8 caracteres (letras e números)."; $("#nLocAereo").setAttribute("aria-invalid","true"); $("#nLocAereo").focus(); return; }
  if (!desc){ m.textContent="Descreva o que aconteceu."; $("#nDesc").focus(); return; }
  const btn=$("#nSubmit"); btn.disabled=true; btn.textContent="Enviando…";
  try {
    const fd = new FormData();
    fd.append("titulo", titulo); fd.append("categoria", $("#nCat").value); fd.append("prioridade", $("#nPri").value);
    fd.append("locAereo", aer); fd.append("locPacote", pac); fd.append("descricao", desc);
    fd.append("clienteNome", cliente); fd.append("emissor", emissor); fd.append("fornecedor", fornecedor);
    newFiles.forEach(f=>fd.append("prints", f.blob, f.nome));
    const t = await api("POST","api/chamados", fd);
    $("#newDlg").close(); newPicker.clear();
    substituir(t);
    const P = panes.find(p=>p.mode==="agente");
    if (P) { P.filterStatus=""; select(P, t.id); }
    toast(`Chamado ${t.numero} enviado`+(emailAuto?" — o help desk foi avisado por e-mail":""));
    if (t.prioridade==="Urgente" || !emailAuto) notifyHelpdesk(t, `${t.prioridade==="Urgente"?"URGENTE — ":""}Novo chamado aberto por ${me.nome} (${lojaOf(t)}).`);
  } catch(err){ m.textContent="Não foi possível enviar: "+err.message; }
  btn.disabled=false; btn.textContent="Enviar ao help desk";
};

/* ---------- minha conta ---------- */
$("#passBtn").onclick=()=>{ $("#mTel").value=me.tel||""; $("#passDlg").showModal(); };
$("#telForm").onsubmit = async e => { e.preventDefault();
  try { const r = await api("PATCH","api/minha-conta",{ tel:$("#mTel").value }); me.tel=r.tel; toast("Celular salvo"); }
  catch(err){ toast("Não foi possível salvar: "+err.message); } };

/* ---------- usuários (admin) ---------- */
async function loadUsers(){
  const users = await api("GET","api/usuarios");
  const lojaOpts = l => `<option value="">—</option>`+(cfg.lojas||[]).map(x=>`<option ${x===l?"selected":""}>${esc(x)}</option>`).join("");
  $("#usersBody").innerHTML = users.map(u=>`<tr>
    <td>${esc(u.nome)}${u.inativo?" <small>(inativo)</small>":""}${u.vinculado?"":" <small>(aguardando 1º acesso)</small>"}</td><td>${esc(u.email)}</td>
    <td><input data-tel="${esc(u.id)}" value="${esc(u.tel||"")}" placeholder="(81) 9…" style="padding:5px 8px;width:150px" aria-label="Celular de ${esc(u.nome)}"></td>
    <td><select data-loja="${esc(u.id)}" style="padding:5px 8px;width:auto" aria-label="Loja de ${esc(u.nome)}">${lojaOpts(u.loja)}</select></td>
    <td>${u.adminFixo?"Administrador (fixo)":(u.id===me.id||perfilPeloSistema)?esc(ROLE_LABEL[u.perfil])+(perfilPeloSistema&&u.id!==me.id?" <small>(definido pelo sistema principal)</small>":""):`<select data-role="${esc(u.id)}" style="padding:5px 8px;width:auto" aria-label="Perfil de ${esc(u.nome)}">${["agente","suporte","admin"].map(r=>`<option value="${r}" ${r===u.perfil?"selected":""}>${ROLE_LABEL[r]}</option>`).join("")}</select>`}</td>
    <td style="white-space:nowrap">${u.id!==me.id && !u.adminFixo?`<button class="btn ghost sm" data-toggle="${esc(u.id)}" data-inativo="${u.inativo?1:0}">${u.inativo?"Reativar":"Desativar"}</button> <button class="btn ghost sm" data-del="${esc(u.id)}" style="color:var(--bad)">Excluir</button>`:""}</td></tr>`).join("");
  const patch = async (id, body, ok) => { try { await api("PATCH", `api/usuarios/${id}`, body); toast(ok); } catch(e){ toast(e.message); } loadUsers(); };
  $("#usersBody").querySelectorAll("[data-tel]").forEach(i=>i.onchange=()=>patch(i.dataset.tel,{tel:i.value},"Celular atualizado"));
  $("#usersBody").querySelectorAll("[data-loja]").forEach(s=>s.onchange=()=>patch(s.dataset.loja,{loja:s.value},"Loja atualizada"));
  $("#usersBody").querySelectorAll("[data-role]").forEach(s=>s.onchange=()=>patch(s.dataset.role,{perfil:s.value},"Perfil atualizado"));
  $("#usersBody").querySelectorAll("[data-toggle]").forEach(b=>b.onclick=()=>patch(b.dataset.toggle,{inativo:b.dataset.inativo!=="1"},"Usuário atualizado"));
  $("#usersBody").querySelectorAll("[data-del]").forEach(b=>b.onclick=async()=>{
    const u=users.find(x=>x.id===b.dataset.del);
    if (!u || !confirm(`Excluir o usuário ${u.nome}? Os chamados abertos por essa pessoa continuam no sistema.`)) return;
    try { await api("DELETE", `api/usuarios/${u.id}`); toast("Usuário excluído"); } catch(e){ toast(e.message); }
    loadUsers();
  });
}
$("#usersBtn").onclick=async()=>{ $("#addUserMsg").textContent=""; fillLojaSelects(); $("#usersDlg").showModal(); try{ await loadUsers(); }catch(e){ toast(e.message); } };
$("#addUserForm").onsubmit = async e => {
  e.preventDefault(); const m=$("#addUserMsg");
  try {
    await api("POST","api/usuarios",{ nome:$("#uName").value, email:$("#uEmail").value, tel:$("#uTel").value, perfil:$("#uRole").value, loja:$("#uLoja").value });
    e.target.reset(); m.className="msg ok"; m.textContent="Pré-cadastro feito. A ficha é vinculada quando a pessoa entrar pelo sistema principal."; loadUsers();
  } catch(err){ m.className="msg err"; m.textContent=err.message; }
};

/* ---------- cadastros (admin): categorias, emissores, fornecedores ---------- */
const CADS = {
  categorias:   { um:"categoria",  ph:"Nova categoria, ex.: Emissão de bilhetes", help:"Opções que o agente escolhe ao abrir um chamado. Chamados antigos mantêm o que já tinham." },
  emissores:    { um:"emissor",    ph:"Novo emissor", help:"Aparece como seletor no novo chamado. Chamados antigos mantêm o emissor que já tinham." },
  fornecedores: { um:"fornecedor", ph:"Novo fornecedor, ex.: Azul Linhas Aéreas", help:"Aparece como seletor no novo chamado. Chamados antigos mantêm o fornecedor que já tinham." },
};
let catKind = "categorias";
function drawCats(){
  const D = CADS[catKind], cats = cfg[catKind]||[];
  $("#catTabs").querySelectorAll("button").forEach(b=>b.setAttribute("aria-pressed", String(b.dataset.k===catKind)));
  $("#catHelp").textContent = D.help; $("#catNew").placeholder = D.ph;
  $("#catList").innerHTML = cats.length ? cats.map((c,i)=>`<li><span>${esc(c)}</span><button type="button" data-up="${i}" aria-label="Subir ${esc(c)}" ${i===0?"disabled":""}>↑</button><button type="button" data-del="${i}" aria-label="Remover ${esc(c)}">Remover</button></li>`).join("")
    : `<li style="justify-content:center;color:var(--muted)">Nenhum(a) ${D.um} cadastrado(a). Adicione abaixo.</li>`;
  $("#catList").querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>{ const l=[...cats]; l.splice(+b.dataset.del,1); saveCats(l); });
  $("#catList").querySelectorAll("[data-up]").forEach(b=>b.onclick=()=>{ const i=+b.dataset.up; if(!i) return; const l=[...cats]; [l[i-1],l[i]]=[l[i],l[i-1]]; saveCats(l); });
}
async function saveCats(list){
  const m=$("#catMsg"); m.textContent="";
  try { cfg = await api("PUT",`api/listas/${catKind}`,{itens:list}); fillLojaSelects(); drawCats(); }
  catch(err){ m.className="msg err"; m.textContent="Não foi possível salvar: "+err.message; }
}
$("#catBtn").onclick=()=>{ $("#catMsg").textContent=""; drawCats(); $("#catDlg").showModal(); $("#catNew").focus(); };
$("#catTabs").querySelectorAll("button").forEach(b=>b.onclick=()=>{ catKind=b.dataset.k; $("#catMsg").textContent=""; $("#catNew").value=""; drawCats(); $("#catNew").focus(); });
$("#catForm").onsubmit = e => { e.preventDefault();
  const v=$("#catNew").value.trim(); if (!v) return;
  const cats=cfg[catKind]||[];
  if (cats.some(c=>c.toLowerCase()===v.toLowerCase())){ $("#catMsg").className="msg err"; $("#catMsg").textContent="Esse item já está cadastrado."; return; }
  $("#catNew").value=""; saveCats([...cats, v]);
};

/* ---------- configurações (admin) ---------- */
$("#cfgBtn").onclick=()=>{
  $("#cEmail").value=cfg.emailHelpdesk||""; $("#cTel").value=cfg.telHelpdesk||"";
  $("#cUrg").value=slaHours("Urgente"); $("#cAlt").value=slaHours("Alta"); $("#cMed").value=slaHours("Média"); $("#cBai").value=slaHours("Baixa");
  $("#cLojas").value=(cfg.lojas||[]).join("\n"); $("#cfgMsg").textContent=""; $("#cfgDlg").showModal();
};
$("#cfgForm").onsubmit = async e => {
  e.preventDefault(); const m=$("#cfgMsg");
  try {
    cfg = await api("PUT","api/config",{
      emailHelpdesk:$("#cEmail").value, telHelpdesk:$("#cTel").value,
      sla:{"Urgente":+$("#cUrg").value,"Alta":+$("#cAlt").value,"Média":+$("#cMed").value,"Baixa":+$("#cBai").value},
      lojas:$("#cLojas").value.split("\n").map(s=>s.trim()).filter(Boolean)
    });
    fillLojaSelects(); $("#cfgDlg").close(); toast("Configurações salvas. O novo SLA vale para chamados abertos a partir de agora."); renderAll(true);
  } catch(err){ m.className="msg err"; m.textContent=err.message; }
};

/* ---------- relatório ---------- */
let repRows=[];
function buildReport(){
  const days=+$("#repPeriod").value, since = days? Date.now()-days*86400000 : 0;
  const list=tickets.filter(t=>new Date(t.criadoEm).getTime()>=since);
  const lojas=[...new Set([...(cfg.lojas||[]), ...list.map(lojaOf)])];
  const calc = arr => {
    const done=arr.filter(t=>DONE(t.status)&&t.resolvidoEm);
    const inSla=done.filter(t=>slaInfo(t).ok).length;
    const open=arr.filter(t=>!DONE(t.status));
    const late=open.filter(t=>slaInfo(t).late).length;
    const avg = done.length ? done.reduce((s,t)=>s+(new Date(t.resolvidoEm)-new Date(t.criadoEm)),0)/done.length : null;
    const cats={}; arr.forEach(t=>cats[t.categoria]=(cats[t.categoria]||0)+1);
    const top=Object.entries(cats).sort((a,b)=>b[1]-a[1])[0];
    return { total:arr.length, abertos:open.length, atrasados:late, resolvidos:done.length,
      slaPct: done.length? Math.round(inSla/done.length*100) : null, tempoMedio: avg, topCat: top?`${top[0]} (${top[1]})`:"—" };
  };
  repRows = lojas.map(l=>({loja:l, ...calc(list.filter(t=>lojaOf(t)===l))})).filter(r=>r.total || (cfg.lojas||[]).includes(r.loja)).sort((a,b)=>b.total-a.total);
  const tot = calc(list);
  $("#repKpis").innerHTML = `
    <div class="kpi"><b>${tot.total}</b><span>Chamados no período</span></div>
    <div class="kpi"><b>${tot.abertos}</b><span>Ainda em aberto</span></div>
    <div class="kpi"><b style="color:${tot.atrasados?"var(--bad)":"inherit"}">${tot.atrasados}</b><span>Atrasados agora</span></div>
    <div class="kpi"><b>${tot.slaPct==null?"—":tot.slaPct+"%"}</b><span>Resolvidos no prazo</span></div>
    <div class="kpi"><b>${tot.tempoMedio==null?"—":dur(tot.tempoMedio)}</b><span>Tempo médio de solução</span></div>`;
  $("#repTable").innerHTML = `<thead><tr><th>Loja</th><th class="n">Total</th><th class="n">Em aberto</th><th class="n">Atrasados</th><th class="n">Resolvidos</th><th>No prazo</th><th class="n">Tempo médio</th><th>Categoria mais comum</th></tr></thead>
    <tbody>${repRows.map(r=>`<tr><td>${esc(r.loja)}</td><td class="n">${r.total}</td><td class="n">${r.abertos}</td><td class="n" style="${r.atrasados?"color:var(--bad);font-weight:600":""}">${r.atrasados}</td><td class="n">${r.resolvidos}</td>
      <td>${r.slaPct==null?"—":`${r.slaPct}%<span class="bar" style="width:${Math.max(2,r.slaPct*.6)}px;background:${r.slaPct>=90?"var(--ok)":r.slaPct>=70?"var(--warn)":"var(--bad)"}"></span>`}</td>
      <td class="n">${r.tempoMedio==null?"—":dur(r.tempoMedio)}</td><td>${esc(r.topCat)}</td></tr>`).join("") || `<tr><td colspan="8" class="empty">Sem chamados no período.</td></tr>`}</tbody>
    <tfoot><tr><td>Total</td><td class="n">${tot.total}</td><td class="n">${tot.abertos}</td><td class="n">${tot.atrasados}</td><td class="n">${tot.resolvidos}</td><td>${tot.slaPct==null?"—":tot.slaPct+"%"}</td><td class="n">${tot.tempoMedio==null?"—":dur(tot.tempoMedio)}</td><td>${esc(tot.topCat)}</td></tr></tfoot>`;
}
const repCsv = () => {
  const q = v => `"${String(v??"").replace(/"/g,'""')}"`;
  const head=["Loja","Total","Em aberto","Atrasados","Resolvidos","% no prazo","Tempo médio (h)","Categoria mais comum"];
  return [head.map(q).join(";"), ...repRows.map(r=>[r.loja,r.total,r.abertos,r.atrasados,r.resolvidos,r.slaPct??"",r.tempoMedio==null?"":(r.tempoMedio/3600000).toFixed(1).replace(".",","),r.topCat].map(q).join(";"))].join("\r\n");
};
$("#reportBtn").onclick=()=>{ buildReport(); $("#repDlg").showModal(); };
$("#repPeriod").onchange=buildReport;
$("#repCsv").onclick=()=>{
  const blob = new Blob(["\ufeff"+repCsv()], {type:"text/csv;charset=utf-8"});
  const a = document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=`chamados-por-loja-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 1000);
};
$("#repCopy").onclick=async()=>{ try { await navigator.clipboard.writeText(repCsv().replace(/;/g,"\t").replace(/"/g,"")); toast("Tabela copiada — cole no Excel ou Planilhas"); } catch { toast("Não foi possível copiar"); } };

document.querySelectorAll("dialog [data-close]").forEach(b=>b.onclick=()=>b.closest("dialog").close());

/* ---------- início ---------- */
(async () => {
  try { await iniciar(); }
  catch(err) { me=null; semAcesso(err && err.message); }
})();
})();
