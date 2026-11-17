/* Modo demonstração do Help Desk: só liga com ?demo=1 na URL (pré-visualização antes do deploy).
   Responde às chamadas "api/..." no navegador, com dados de exemplo guardados na sessão. */
(() => {
  const q = new URLSearchParams(location.search);
  if (!q.has("demo")) return;
  const PERFIL = ["agente", "suporte", "admin"].includes(q.get("perfil")) ? q.get("perfil") : "admin";
  const KEY = "hd_demo_v1";
  const agora = () => new Date().toISOString();
  const h = n => new Date(Date.now() - n * 3600e3).toISOString();
  const SLA = { Urgente: 24, Alta: 48, "Média": 36, Baixa: 72 };
  const prazo = (criado, pri) => new Date(new Date(criado).getTime() + (SLA[pri] || 36) * 3600e3).toISOString();
  const eu = { id: "1", nome: "Usuário de teste", email: "teste@azulviagensrec.com.br", tel: "", loja: "Shopping Recife", perfil: PERFIL, adminFixo: false };
  const agt = { id: "2", nome: "JEAN LIMA", email: "adm@azulviagensrec.com.br", loja: "Matriz" };
  const sup = { id: "3", nome: "Equipe Help Desk", email: "helpdesk@sonhoazulviagens.com.br" };
  const tk = (id, num, titulo, cat, pri, status, criadoH, autor, extra = {}) => {
    const criadoEm = h(criadoH);
    return Object.assign({ id, numero: num, titulo, categoria: cat, prioridade: pri, status, locAereo: "", locPacote: "", descricao: "",
      autorId: autor.id, autorNome: autor.nome, autorEmail: autor.email, autorTel: "", autorLoja: autor.loja || "",
      responsavelId: "", responsavelNome: "", criadoEm, atualizadoEm: criadoEm, prazoEm: prazo(criadoEm, pri), resolvidoEm: "",
      ultimaMsgPerfil: "", ultimaMsgEm: "", anexos: [], mensagens: [{ sistema: true, texto: "Chamado enviado ao help desk", em: criadoEm }] }, extra);
  };
  const inicial = () => {
    const t1 = tk("101", "HD-084852", "REACOMODAÇÃO DE CLIENTE", "REACOMODAÇÃO", "Alta", "Em andamento", 20, agt,
      { locAereo: "ASZCDS", locPacote: "AADD221", descricao: "Cliente com voo cancelado, precisa ser reacomodado no próximo voo disponível.", responsavelId: sup.id, responsavelNome: sup.nome });
    t1.mensagens.push({ sistema: true, texto: "Equipe Help Desk assumiu o chamado", em: h(19) },
      { autor: sup.nome, autorId: sup.id, perfil: "suporte", texto: "Cliente contactado, aguardando retorno.", anexos: 0, em: h(18) });
    t1.ultimaMsgPerfil = "suporte"; t1.ultimaMsgEm = h(18); t1.atualizadoEm = h(18);
    const t2 = tk("102", "HD-091230", "Nominar grupo de 12 passageiros", "NOMINAR GRUPO", "Média", "Aberto", 3, eu,
      { locPacote: "PKG4410", descricao: "Grupo da excursão de dezembro, lista de nomes em anexo no e-mail." });
    const t3 = tk("103", "HD-077415", "Cancelamento com crédito — família Souza", "CANCELAMENTO COM CRÉDITO", "Baixa", "Resolvido", 60, eu,
      { locAereo: "QWE8RT", descricao: "Cliente pediu cancelamento e crédito para uso futuro.", responsavelId: sup.id, responsavelNome: sup.nome, resolvidoEm: h(30) });
    t3.mensagens.push({ sistema: true, texto: "Equipe Help Desk alterou o status para \"Resolvido\"", em: h(30) });
    return { seq: 104, chamados: [t1, t2, t3], leituras: {},
      config: { emissores: ["Equipe Recife", "Equipe Matriz"], fornecedores: ["Azul Linhas Aéreas", "Azul Viagens", "Flytour", "Salinas"], categorias: ["REACOMODAÇÃO", "NOMINAR GRUPO", "ALTERAÇÃO DE POUSADA/HOTEL", "CANCELAMENTO COM CRÉDITO", "CANCELAMENTO COM REEBOLSO"],
        emailHelpdesk: sup.email, lojas: ["Shopping Recife", "Matriz"], sla: SLA, telHelpdesk: "81996917074" },
      usuarios: [Object.assign({}, eu, { inativo: false, vinculado: true }), Object.assign({ tel: "", perfil: "agente", adminFixo: false, inativo: false, vinculado: true }, agt),
        Object.assign({ tel: "", loja: "", perfil: "suporte", adminFixo: false, inativo: false, vinculado: true }, sup)] };
  };
  let db; try { db = JSON.parse(sessionStorage.getItem(KEY)) || inicial(); } catch { db = inicial(); }
  const salvar = () => { try { sessionStorage.setItem(KEY, JSON.stringify(db)); } catch {} };
  const visiveis = () => (PERFIL === "agente" ? db.chamados.filter(c => c.autorId === eu.id) : db.chamados);
  const json = (d, st = 200) => new Response(JSON.stringify(d), { status: st, headers: { "Content-Type": "application/json" } });
  const corpo = b => (b instanceof FormData ? Object.fromEntries([...b.entries()].filter(([, v]) => typeof v === "string")) : b ? JSON.parse(b) : {});
  const anexosDe = b => (b instanceof FormData ? b.getAll("prints").filter(f => f && f.name).map((f, i) => ({ id: "a" + Date.now() + i, nome: f.name, mime: f.type || "", tamanho: f.size || 0, autor: eu.nome, em: agora() })) : []);
  const visao = () => (PERFIL === "agente" ? "agente" : "suporte");
  const sys = (c, texto) => { c.mensagens.push({ sistema: true, texto, em: agora() }); c.atualizadoEm = agora(); };

  async function rota(method, path, body) {
    const m = (re) => path.match(re);
    if (path === "sessao") return { usuario: eu, config: db.config, emailAutomatico: false, perfilPeloSistema: true, links: {} };
    if (path === "acesso") return { entrar: "" };
    if (path === "config" && method === "GET") return db.config;
    if (path === "config" && method === "PUT") { const b = corpo(body); Object.assign(db.config, b); salvar(); return db.config; }
    if (path.startsWith("listas/")) { const k = path.slice(7); db.config[k] = corpo(body).itens || []; salvar(); return db.config; }
    if (path === "categorias") { db.config.categorias = corpo(body).categorias || []; salvar(); return db.config; }
    if (path === "chamados/versao") return { versao: db.chamados.length + "|" + db.chamados.map(c => c.atualizadoEm).sort().pop() + "|" + JSON.stringify(db.config).length };
    if (path === "chamados" && method === "GET") return { chamados: visiveis(), leituras: db.leituras };
    if (path === "chamados" && method === "POST") {
      const b = corpo(body), id = String(db.seq++);
      const c = tk(id, "HD-" + String(Date.now()).slice(-6), b.titulo || "Sem título", b.categoria || "", b.prioridade || "Média", "Aberto", 0, eu,
        { locAereo: b.locAereo || "", locPacote: b.locPacote || "", descricao: b.descricao || "", clienteNome: b.clienteNome || "", emissor: b.emissor || "", fornecedor: b.fornecedor || "", anexos: anexosDe(body) });
      db.chamados.unshift(c); salvar(); return c;
    }
    let r;
    if ((r = m(/^chamados\/([^/]+)\/mensagens$/))) {
      const c = db.chamados.find(x => x.id === r[1]); const b = corpo(body); const an = anexosDe(body);
      c.mensagens.push({ autor: eu.nome, autorId: eu.id, perfil: visao(), texto: b.texto || "", anexos: an.length, em: agora() });
      c.anexos.push(...an); c.ultimaMsgPerfil = visao(); c.ultimaMsgEm = agora(); c.atualizadoEm = agora(); salvar(); return c;
    }
    if ((r = m(/^chamados\/([^/]+)\/lido$/))) { const b = corpo(body); db.leituras[b.visao + ":" + r[1]] = b.em; salvar(); return { ok: true }; }
    if ((r = m(/^chamados\/([^/]+)$/)) && method === "PATCH") {
      const c = db.chamados.find(x => x.id === r[1]); const { acao, valor } = corpo(body);
      const done = s => s === "Resolvido" || s === "Fechado";
      if (acao === "status" && valor !== c.status) { c.status = valor; c.resolvidoEm = done(valor) ? (c.resolvidoEm || agora()) : ""; sys(c, `${eu.nome} alterou o status para "${valor === "Aberto" ? "Novo" : valor}"`); }
      if (acao === "prioridade" && valor !== c.prioridade) { c.prioridade = valor; c.prazoEm = prazo(c.criadoEm, valor); sys(c, `Prioridade alterada para ${valor}`); }
      if (acao === "assumir") { c.responsavelId = eu.id; c.responsavelNome = eu.nome; if (c.status === "Aberto") c.status = "Em andamento"; sys(c, `${eu.nome} assumiu o chamado`); }
      if (acao === "confirmar") { c.status = "Fechado"; sys(c, `${eu.nome} confirmou a solução`); }
      if (acao === "reabrir") { c.status = "Aberto"; c.resolvidoEm = ""; sys(c, `${eu.nome} reabriu o chamado`); }
      salvar(); return c;
    }
    if (path === "minha-conta") { eu.tel = corpo(body).tel || ""; return { ok: true, tel: eu.tel }; }
    if (path === "usuarios" && method === "GET") return db.usuarios;
    if (path === "usuarios" && method === "POST") { const b = corpo(body); db.usuarios.push({ id: "u" + Date.now(), nome: b.nome, email: b.email, tel: b.tel || "", loja: b.loja || "", perfil: b.perfil || "agente", adminFixo: false, inativo: false, vinculado: false }); salvar(); return { ok: true }; }
    if ((r = m(/^usuarios\/([^/]+)$/))) {
      if (method === "DELETE") db.usuarios = db.usuarios.filter(u => u.id !== r[1]);
      else Object.assign(db.usuarios.find(u => u.id === r[1]) || {}, corpo(body));
      salvar(); return { ok: true };
    }
    return null;
  }

  const fetchOrig = window.fetch.bind(window);
  window.fetch = async (url, opt = {}) => {
    const u = String(url);
    if (!u.startsWith("api/")) return fetchOrig(url, opt);
    const path = u.slice(4).split("?")[0];
    try {
      const d = await rota((opt.method || "GET").toUpperCase(), path, opt.body);
      return d === null ? json({ erro: "Rota não disponível no modo demonstração." }, 404) : json(d);
    } catch (e) { return json({ erro: "Demonstração: " + e.message }, 400); }
  };
  window.HD_DEMO = true;
  document.addEventListener("DOMContentLoaded", () => {
    const b = document.createElement("div");
    b.textContent = "Modo demonstração — dados de exemplo, nada é salvo no servidor";
    b.style.cssText = "position:fixed;left:50%;bottom:12px;transform:translateX(-50%);z-index:9999;background:#B45309;color:#fff;font:600 12.5px system-ui,sans-serif;padding:6px 14px;border-radius:999px;box-shadow:0 4px 12px rgba(0,0,0,.18);pointer-events:none";
    document.body.appendChild(b);
  });
})();
