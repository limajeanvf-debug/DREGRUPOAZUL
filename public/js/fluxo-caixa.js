// Fluxo de Caixa (Financeiro › Fluxo de Caixa) — exclusivo para administradores.
// Carregado como script comum antes do componente (ver <head> do Sistema Grupo Azul.dc.html).
// Três controles, no formato da planilha usada hoje:
//   1. Despesas: histórico, valor, vencimento, empresa e pago; Final = Saldo informado − Total das despesas.
//   2. Aportes: correção simples por dia (taxa % ao dia × dias × valor). Os dias contam da data do aporte até a
//      data de quitação (quando quitado) ou até a data de referência. Total = valor + correção − abatimento.
//   3. Empréstimos e cartões: listas livres com valor e abatimento; saldo = soma dos valores − soma dos abatimentos.
// Os dados ficam no servidor (/api/fluxo, só admin) e numa cópia neste navegador para quando o servidor não responde.
const LS_FLUXO = "grupoAzul_fluxo_caixa_v1";
const FC_EMPRESAS_PADRAO = ["AZUL", "SONHO", "ARRANJOS"];
const FC_TAXA_PADRAO = 0.1; // % ao dia
const FC_COLECOES = ["despesas", "saldos", "aportes", "controles", "movs", "config"];

function fcHojeISO(){ const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0"); }
function fcId(){ return "fc" + Date.now().toString(36) + Math.random().toString(36).slice(2,6); }
function fcData(iso){ return iso ? new Date(iso + "T00:00:00").toLocaleDateString("pt-BR") : "—"; }
// Dias corridos entre duas datas ISO (aaaa-mm-dd); nunca negativo.
function fcDias(de, ate){
  if(!de || !ate) return 0;
  const a = Date.UTC(+de.slice(0,4), +de.slice(5,7)-1, +de.slice(8,10)), b = Date.UTC(+ate.slice(0,4), +ate.slice(5,7)-1, +ate.slice(8,10));
  return Math.max(0, Math.round((b - a) / 864e5));
}
function fcNum(v){ const n = typeof v === "number" ? v : parseFloat(v); return isFinite(n) ? n : 0; }
// Um aporte com a correção do dia de referência.
function fcCalcAporte(a, refISO, taxa){
  const valor = fcNum(a.valor), abat = fcNum(a.abatimento);
  const dias = fcDias(a.data, a.quitadoEm || refISO);
  const correcao = Math.round(valor * (fcNum(taxa) / 100) * dias * 100) / 100;
  return {dias, correcao, total: Math.round((valor + correcao - abat) * 100) / 100};
}
// Movimentos de um controle (empréstimo/cartão) com saldo acumulado, em ordem de data.
function fcCalcControle(movs){
  const ord = movs.slice().sort((x,y)=>(x.data||"").localeCompare(y.data||"") || (x.criadoEm||"").localeCompare(y.criadoEm||""));
  let saldo = 0, tv = 0, ta = 0;
  const linhas = ord.map(m=>{ tv += fcNum(m.valor); ta += fcNum(m.abatimento); saldo = tv - ta; return {...m, saldo}; });
  return {linhas, totalValor: tv, totalAbat: ta, saldo};
}
// Coleções em objeto {id: dados} → estado vazio padrão
function fcVazio(){ return {despesas:{}, saldos:{}, aportes:{}, controles:{}, movs:{}, config:{geral:{empresas:FC_EMPRESAS_PADRAO.slice(), taxa:FC_TAXA_PADRAO}}}; }
function fcDeItens(itens){
  const d = fcVazio();
  (itens||[]).forEach(i=>{ if(d[i.colecao]) d[i.colecao][i.id] = i.dados; });
  if(!d.config.geral) d.config.geral = {empresas:FC_EMPRESAS_PADRAO.slice(), taxa:FC_TAXA_PADRAO};
  return d;
}
function fcLerLocal(){ try{ const v = JSON.parse(localStorage.getItem(LS_FLUXO) || "null"); return v && v.despesas ? Object.assign(fcVazio(), v) : null; }catch(e){ return null; } }
function fcSalvarLocal(d){ try{ localStorage.setItem(LS_FLUXO, JSON.stringify(d)); }catch(e){} }
