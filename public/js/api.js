// Comunicação com o backend.
// Carregado como script comum antes do componente (ver <head> do Sistema Grupo Azul.dc.html).
const API_BASE_URL = "https://dregrupoazul.onrender.com"; // schema aplicado
async function apiFetch(path, opts){
  const token = localStorage.getItem(LS_TOKEN);
  const headers = {"Content-Type":"application/json", ...((opts&&opts.headers)||{})};
  if(token) headers.Authorization = "Bearer "+token;
  const res = await fetch(API_BASE_URL+path, {...opts, headers});
  if(res.status===401){
    // Sessão expirada/inválida. Antes o 401 era engolido em silêncio: a tela
    // seguia mostrando o localStorage, nada subia nem descia, e o usuário
    // achava que estava sincronizado.
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem(LS_SESSION);
    window.dispatchEvent(new Event("dre-sessao-expirada"));
    throw new Error("api_401");
  }
  if(!res.ok){ const e = new Error("api_"+res.status); e.ref = res.headers.get("X-Request-Id") || ""; if(res.status>=500) window.logCliente && window.logCliente("api", e.message+" "+path, {apiRef:e.ref}); throw e; }
  const ct = res.headers.get("content-type")||"";
  return ct.includes("application/json") ? res.json() : null;
}
