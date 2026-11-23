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
function fcVazio(){ return {despesas:{}, saldos:{}, aportes:{}, controles:{}, movs:{}, planilhas:{}, config:{geral:{empresas:FC_EMPRESAS_PADRAO.slice(), taxa:FC_TAXA_PADRAO}}}; }
function fcDeItens(itens){
  const d = fcVazio();
  (itens||[]).forEach(i=>{ if(d[i.colecao]) d[i.colecao][i.id] = i.dados; });
  if(!d.config.geral) d.config.geral = {empresas:FC_EMPRESAS_PADRAO.slice(), taxa:FC_TAXA_PADRAO};
  return d;
}
function fcLerLocal(){ try{ const v = JSON.parse(localStorage.getItem(LS_FLUXO) || "null"); return v && v.despesas ? Object.assign(fcVazio(), v) : null; }catch(e){ return null; } }
function fcSalvarLocal(d){ try{ localStorage.setItem(LS_FLUXO, JSON.stringify(d)); }catch(e){} }

// ===== Planilhas do Fluxo de Caixa (formato de planilha, com copiar e colar do Excel) =====
// Cada planilha: {titulo, modelo, colunas:[{nome, tipo}], linhas:[[...]], saldo, taxa, ref, ordem}.
// tipo da coluna: texto | valor | data | dias (digitável só nas linhas quitadas) | calc (calculada, não se digita).
FC_COLECOES.push("planilhas");
const FC_MODELOS = {
  despesas: {label:"Despesas", desc:"Histórico, valor, vencimento e empresa. Embaixo: Faturas (soma), Saldo (digite) e Final.",
    colunas:[["Histórico","texto"],["Valor R$","valor"],["Data venc.","data"],["Empresa","texto"]]},
  aportes: {label:"Aportes com correção", desc:"Correção de 0,1% ao dia (ajustável) até a data de referência. Total = valor + correção − abatimento.",
    colunas:[["Número","texto"],["Histórico","texto"],["Valor aporte","valor"],["Abatimento","valor"],["Data","data"],["Nº dias","dias"],["Correção","calc"],["Total","calc"]]},
  controle: {label:"Valor, abatimento e saldo", desc:"Empréstimos e cartões: saldo de cada linha = valor − abatimento.",
    colunas:[["Histórico","texto"],["Data","texto"],["Valor","valor"],["Abatimento","valor"],["Saldo","calc"]]},
  livre: {label:"Tabela livre", desc:"Colunas à sua escolha. As colunas de valor são somadas no fim.",
    colunas:[["Histórico","texto"],["Valor R$","valor"],["Data","data"]]},
};
function fcNovaPlanilha(modelo, titulo, ordem){
  const m = FC_MODELOS[modelo] || FC_MODELOS.livre;
  return {titulo: titulo || m.label.toUpperCase(), modelo, colunas: m.colunas.map(([nome,tipo])=>({nome, tipo})), linhas: [],
    saldo: null, taxa: FC_TAXA_PADRAO, ref: "", ordem: ordem || Date.now(), criadoEm: new Date().toISOString()};
}
// "R$ 1.234,56", "-R$ 1.281,97", "(1.281,97)", "1281.97", "19285,22" → número; vazio ou texto → null
function fcValorDe(txt){
  if(typeof txt==="number") return isFinite(txt) ? txt : null;
  let t = String(txt==null ? "" : txt).trim(); if(!t || t==="-" || t==="–") return null;
  let neg = /^\(.*\)$/.test(t) || /^-|^−|-\s*R\$|−\s*R\$/.test(t);
  t = t.replace(/[()R$\s−-]/g, "");
  if(!/^[\d.,]+$/.test(t)) return null;
  if(t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if((t.match(/\./g)||[]).length>1 || /\.\d{3}$/.test(t)) t = t.replace(/\./g, "");
  const n = parseFloat(t); return isFinite(n) ? (neg ? -n : n) : null;
}
// "20/09/2021", "20/09/21", "2021-09-20" ou número de série do Excel → "2021-09-20"; senão null
function fcDataDe(txt){
  const t = String(txt==null ? "" : txt).trim(); let m;
  if((m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/))){ const y = m[3].length===2 ? "20"+m[3] : m[3]; return y+"-"+m[2].padStart(2,"0")+"-"+m[1].padStart(2,"0"); }
  if((m = t.match(/^(\d{4})-(\d{2})-(\d{2})/))) return m[1]+"-"+m[2]+"-"+m[3];
  if(/^\d{5}$/.test(t)){ const d = new Date(Date.UTC(1899,11,30) + (+t)*864e5); return d.toISOString().slice(0,10); }
  return null;
}
function fcFmtValor(n){ return n==null ? "" : n.toLocaleString("pt-BR",{minimumFractionDigits:2, maximumFractionDigits:2}); }
function fcFmtData(iso){ return /^\d{4}-\d{2}-\d{2}$/.test(iso||"") ? iso.slice(8,10)+"/"+iso.slice(5,7)+"/"+iso.slice(0,4) : (iso||""); }
// Valor guardado de uma célula a partir do texto digitado/colado.
function fcCelula(tipo, txt){
  const t = String(txt==null ? "" : txt).trim();
  if(tipo==="valor"){ if(!t) return null; const v = fcValorDe(t); return v==null ? t : v; }
  if(tipo==="dias"){ if(!t) return null; const v = parseInt(t.replace(/\D/g,""),10); return isFinite(v) ? v : null; }
  if(tipo==="data"){ if(!t) return ""; return fcDataDe(t) || t; }
  return t;
}
function fcTextoCelula(tipo, v){
  if(v==null || v==="") return "";
  if(tipo==="valor") return typeof v==="number" ? fcFmtValor(v) : String(v);
  if(tipo==="data") return fcFmtData(v);
  return String(v);
}
// Texto colado do Excel (tabulações e quebras de linha) → matriz. Aceita células entre aspas com quebra de linha.
function fcLerColado(texto){
  const out = []; let row = [], cel = "", aspas = false;
  const t = String(texto||"").replace(/\r\n?/g, "\n");
  for(let i=0;i<t.length;i++){
    const ch = t[i];
    if(aspas){ if(ch==='"'){ if(t[i+1]==='"'){ cel += '"'; i++; } else aspas = false; } else cel += ch; continue; }
    if(ch==='"' && cel===""){ aspas = true; continue; }
    if(ch==="\t"){ row.push(cel); cel = ""; continue; }
    if(ch==="\n"){ row.push(cel); out.push(row); row = []; cel = ""; continue; }
    cel += ch;
  }
  if(cel!=="" || row.length){ row.push(cel); out.push(row); }
  return out;
}
function fcLinhaVazia(l){ return !l || l.every(v=>v==null || v===""); }
// Cola a matriz a partir da linha r0, coluna c0. Colunas calculadas são puladas (o valor colado nelas é ignorado).
function fcColar(p, r0, c0, matriz){
  const linhas = p.linhas.map(l=>l.slice());
  matriz.forEach((vals, i)=>{
    const r = r0 + i; while(linhas.length<=r) linhas.push(p.colunas.map(()=>null));
    vals.forEach((txt, j)=>{ const c = c0 + j; const col = p.colunas[c]; if(!col || col.tipo==="calc") return; linhas[r][c] = fcCelula(col.tipo, txt); });
  });
  return linhas.filter(l=>!fcLinhaVazia(l));
}
function fcIdx(p, nome){ return p.colunas.findIndex(c=>c.nome===nome); }
// Calcula as colunas "calc"/"dias" e o rodapé. Volta {calc:[[...por coluna]], rodape:[{rotulo, valores:{col:numero}}], final}.
function fcCalcPlanilha(p, hojeISO){
  const num = v=>typeof v==="number" ? v : 0;
  const calc = p.linhas.map(l=>p.colunas.map(()=>null));
  const somaCol = c=>p.linhas.reduce((a,l)=>a+num(l[c]),0);
  const r2 = n=>Math.round(n*100)/100;
  const out = {calc, rodape:[], final:null};
  if(p.modelo==="aportes"){
    const iV = 2, iA = 3, iD = 4, iN = 5, iC = 6, iT = 7, ref = p.ref || hojeISO, taxa = p.taxa==null ? FC_TAXA_PADRAO : +p.taxa;
    let sc = 0, st = 0;
    p.linhas.forEach((l,r)=>{
      const v = num(l[iV]), ab = Math.abs(num(l[iA])), dataOk = /^\d{4}-\d{2}-\d{2}$/.test(l[iD]||"");
      if(!v && !ab) return;
      const dias = ab>0 && typeof l[iN]==="number" ? l[iN] : (dataOk ? fcDias(l[iD], ref) : 0);
      const corr = r2(v * taxa/100 * dias), tot = r2(v + corr - ab) || 0;
      calc[r][iN] = dias; calc[r][iC] = corr; calc[r][iT] = tot; sc += corr; st += tot;
    });
    out.rodape.push({rotulo:"TOTAL", valores:{[iV]:somaCol(iV), [iA]:-p.linhas.reduce((a,l)=>a+Math.abs(num(l[iA])),0), [iC]:r2(sc), [iT]:r2(st)}, texto:{[iD]:fcFmtData(ref)}});
  } else if(p.modelo==="controle"){
    let ss = 0;
    p.linhas.forEach((l,r)=>{ const v = num(l[2]), ab = Math.abs(num(l[3])); if(!v && !ab) return; calc[r][4] = r2(v - ab) || 0; ss += v - ab; });
    out.rodape.push({rotulo:"TOTAL", valores:{2:somaCol(2), 3:-p.linhas.reduce((a,l)=>a+Math.abs(num(l[3])),0), 4:r2(ss)}});
  } else if(p.modelo==="despesas"){
    const fat = r2(somaCol(1)), saldo = typeof p.saldo==="number" ? p.saldo : null;
    out.rodape.push({rotulo:"FATURAS", valores:{1:fat}});
    out.rodape.push({rotulo:"SALDO", valores:{1:saldo}, editavel:"saldo"});
    out.final = r2((saldo||0) - fat);
    out.rodape.push({rotulo:"FINAL", valores:{1:out.final}, destaque:true});
  } else {
    const vals = {}; p.colunas.forEach((c,i)=>{ if(c.tipo==="valor") vals[i] = r2(somaCol(i)); });
    out.rodape.push({rotulo:"TOTAL", valores:vals});
  }
  return out;
}
// Planilha inteira em texto com tabulações, para colar no Excel ou no WhatsApp.
function fcPlanilhaTSV(p, hojeISO){
  const k = fcCalcPlanilha(p, hojeISO), linhas = [p.colunas.map(c=>c.nome).join("\t")];
  p.linhas.forEach((l,r)=>linhas.push(p.colunas.map((c,i)=>{ const v = (c.tipo==="calc" || c.tipo==="dias") && k.calc[r][i]!=null ? k.calc[r][i] : l[i];
    return c.tipo==="calc" || c.tipo==="valor" ? (typeof v==="number" ? fcFmtValor(v) : (v||"")) : fcTextoCelula(c.tipo, v); }).join("\t")));
  k.rodape.forEach(f=>linhas.push(p.colunas.map((c,i)=>i===0 ? f.rotulo : (f.valores[i]!=null ? fcFmtValor(f.valores[i]) : (f.texto && f.texto[i]) || "")).join("\t")));
  return linhas.join("\n");
}
// Primeira abertura do formato planilha: leva despesas, aportes e controles antigos para planilhas.
function fcMigrarParaPlanilhas(fc){
  const out = []; let ordem = 1;
  const desp = Object.values(fc.despesas||{});
  const pd = fcNovaPlanilha("despesas", "DESPESAS", ordem++);
  pd.linhas = desp.sort((a,b)=>(a.venc||"").localeCompare(b.venc||"")).map(d=>[d.historico||"", fcNum(d.valor), d.venc||"", d.empresa||""]);
  const sal = Object.values(fc.saldos||{}).sort((a,b)=>String(b.data||"").localeCompare(String(a.data||"")))[0];
  if(sal && sal.valor!=null) pd.saldo = fcNum(sal.valor);
  out.push(pd);
  const pa = fcNovaPlanilha("aportes", "APORTES", ordem++);
  const taxa = fc.config && fc.config.geral && fc.config.geral.taxa; if(taxa!=null) pa.taxa = taxa;
  pa.linhas = Object.values(fc.aportes||{}).sort((a,b)=>String(a.numero).localeCompare(String(b.numero), undefined, {numeric:true})).map(a=>{
    const ab = fcNum(a.abatimento); return [a.numero||"", a.historico||"", fcNum(a.valor)||null, ab ? -ab : null, a.data||"", ab && a.quitadoEm ? fcDias(a.data, a.quitadoEm) : null, null, null]; });
  out.push(pa);
  Object.entries(fc.controles||{}).forEach(([cid,c])=>{
    const pc = fcNovaPlanilha("controle", c.nome, ordem++);
    pc.linhas = Object.values(fc.movs||{}).filter(m=>m.controleId===cid).sort((a,b)=>(a.data||"").localeCompare(b.data||""))
      .map(m=>[m.historico||c.nome, fcFmtData(m.data), fcNum(m.valor)||null, fcNum(m.abatimento) ? -fcNum(m.abatimento) : null, null]);
    out.push(pc);
  });
  return out;
}

// ===== Importar a planilha do Excel do fluxo de caixa =====
// Procura, em todas as abas, cada tabela que tem uma coluna "HISTÓRICO" no cabeçalho (tabelas lado a lado ou uma
// embaixo da outra). O tipo vem do cabeçalho: ABATIMENTO + dias/correção/data → Aportes; EMPRESA → Despesas;
// ABATIMENTO + SALDO → Valor, abatimento e saldo; o resto vira Tabela livre com as mesmas colunas.
// Linhas FATURAS/TOTAL/FINAL são recalculadas pelo sistema; o valor da linha SALDO vira o saldo da planilha.
function fcNormCab(v){ return v instanceof Date ? "#data" : String(v==null?"":v).normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z0-9#º]+/g," ").trim(); }
function fcIsoDeExcel(v){ if(v instanceof Date && !isNaN(v)){ const d = new Date(v.getTime() + 6*3600e3); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); } return null; }
function fcCelulaExcel(tipo, v){
  const iso = fcIsoDeExcel(v);
  if(iso) return tipo==="data" ? iso : tipo==="texto" ? fcFmtData(iso) : null;
  if(tipo==="dias") return typeof v==="number" ? Math.round(v) : fcCelula(tipo, v);
  if(tipo==="data" && typeof v==="number") return fcFmtValor(v); // número numa coluna de data: guarda como texto
  return fcCelula(tipo, typeof v==="number" && tipo==="texto" ? String(v) : v);
}
function fcTabelasDoExcel(wb){
  const blocos = [];
  wb.SheetNames.forEach(sn=>{
    const ws = wb.Sheets[sn]; if(!ws || !ws["!ref"]) return;
    const aoa = XLSX.utils.sheet_to_json(ws, {header:1, raw:true, defval:""});
    const dentroDeMescla = {};
    (ws["!merges"]||[]).forEach(m=>{ for(let r=m.s.r; r<=m.e.r; r++) for(let c=m.s.c; c<=m.e.c; c++) if(c>m.s.c) dentroDeMescla[r+":"+c] = true; });
    const vazia = v=>v==null || (typeof v==="string" && !v.trim());
    aoa.forEach((row, r)=>{
      row.forEach((cel, c)=>{
        if(fcNormCab(cel)!=="historico") return;
        const livre = cc=>vazia(row[cc]) && !dentroDeMescla[r+":"+cc];
        let c0 = c; while(c0>0 && !livre(c0-1)) c0--;
        // Uma coluna sem título no meio do cabeçalho (ex.: HISTÓRICO mesclado, coluna vazia, DATA VENC) não corta a
        // tabela quando está vazia embaixo e o pedaço seguinte não é outra tabela (não tem HISTÓRICO).
        const colVaziaAbaixo = cc=>{ for(let rr=r+1; rr<Math.min(aoa.length, r+60); rr++){ const l = aoa[rr]||[];
          if(l.slice(c0, cc+1).some(v=>fcNormCab(v)==="historico")) break; if(!vazia(l[cc])) return false; } return true; };
        const temHistAte = cc=>{ for(let k=cc; k<row.length && !livre(k); k++) if(fcNormCab(row[k])==="historico") return true; return false; };
        let c1 = c;
        for(;;){
          if(c1+1<row.length && !livre(c1+1)){ c1++; continue; }
          if(c1+2<row.length && livre(c1+1) && !livre(c1+2) && colVaziaAbaixo(c1+1) && !temHistAte(c1+2)){ c1 += 2; continue; }
          break;
        }
        const cols = []; for(let cc=c0; cc<=c1; cc++) if(!dentroDeMescla[r+":"+cc] && !vazia(row[cc])) cols.push(cc);
        const cab = cols.map(cc=>row[cc]), nc = cab.map(fcNormCab);
        const linhas = []; let saldo = null, brancas = 0;
        for(let rr=r+1; rr<aoa.length; rr++){
          const vals = cols.map(cc=>(aoa[rr]||[])[cc]);
          if(vals.some(v=>fcNormCab(v)==="historico")) break;
          if(vals.every(vazia)){ if(++brancas>=3) break; continue; }
          brancas = 0;
          const primeiroTxt = fcNormCab(vals.find(v=>typeof v==="string" && v.trim()) || "");
          if(/^saldo\b/.test(primeiroTxt) && vals.filter(v=>typeof v==="string" && v.trim()).length===1){ const n = vals.find(v=>typeof v==="number" || fcValorDe(v)!=null); saldo = n==null ? null : fcValorDe(n); continue; }
          if(/^(faturas|final|totais?)\b|aporte total|\btotal$/.test(primeiroTxt)) continue;
          linhas.push(vals);
        }
        blocos.push({aba:sn, ordemAba:wb.SheetNames.indexOf(sn), r, c0, cab, nc, linhas, saldo});
      });
    });
  });
  // Ordem de leitura: aba, depois as tabelas da esquerda (de cima para baixo), depois as da direita.
  blocos.sort((a,b)=>a.ordemAba-b.ordemAba || a.c0-b.c0 || a.r-b.r);
  return blocos.map(fcPlanilhaDoBloco).filter(Boolean);
}
function fcPlanilhaDoBloco(b){
  const nc = b.nc, acha = rx=>nc.findIndex(h=>rx.test(h));
  const temAbat = acha(/abatimento/)>=0, temData = nc.includes("#data");
  let modelo = "livre";
  if(temAbat && (acha(/dias|correcao/)>=0 || temData)) modelo = "aportes";
  else if(acha(/empresa/)>=0) modelo = "despesas";
  else if(temAbat && acha(/saldo/)>=0) modelo = "controle";
  const p = fcNovaPlanilha(modelo);
  let mapa;
  if(modelo==="aportes"){
    const iData = temData ? nc.indexOf("#data") : acha(/^data/);
    mapa = [acha(/^numero|^n(º|o)?$/), acha(/^historico/), acha(/^valor/), acha(/abatimento/), iData, acha(/dias/), -1, -1];
    if(temData){ const iso = fcIsoDeExcel(b.cab[iData]); if(iso) p.ref = iso; }
  } else if(modelo==="despesas") mapa = [acha(/^historico/), acha(/^valor/), acha(/venc|^data/), acha(/empresa/)];
  else if(modelo==="controle") mapa = [acha(/^historico/), acha(/^data/), acha(/^valor/), acha(/abatimento/), -1];
  else {
    p.colunas = b.cab.map((h,i)=>{
      const vs = b.linhas.map(l=>l[i]).filter(v=>!(v==null || v===""));
      const nNum = vs.filter(v=>typeof v==="number" || (typeof v==="string" && /R\$|^-?[\d.]+,\d{2}$/.test(v.trim()))).length;
      const nData = vs.filter(v=>v instanceof Date || (typeof v==="string" && /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(v.trim()))).length;
      const nome = h instanceof Date ? fcFmtData(fcIsoDeExcel(h)) : String(h).trim();
      const tipo = /^historico/.test(b.nc[i]) ? "texto" : nData && nData>=vs.length/2 ? "data" : nNum && nNum>=vs.length/2 ? "valor" : "texto";
      return {nome: (nome.charAt(0) + nome.slice(1).toLowerCase()).replace(/r\$/g, "R$"), tipo};
    });
    mapa = b.cab.map((_,i)=>i);
  }
  p.linhas = b.linhas.map(vals=>p.colunas.map((col,j)=>{ const i = mapa[j]; if(i==null || i<0 || col.tipo==="calc") return null; return fcCelulaExcel(col.tipo, vals[i]); }))
    .filter(l=>!fcLinhaVazia(l));
  if(modelo==="aportes") p.linhas.forEach(l=>{ if(!(Math.abs(typeof l[3]==="number" ? l[3] : 0)>0)) l[5] = null; });
  if(modelo==="despesas") p.saldo = b.saldo;
  const hist = p.linhas.map(l=>l[p.colunas.findIndex(c=>/hist/i.test(c.nome))]).find(v=>typeof v==="string" && v.trim());
  p.titulo = modelo==="despesas" ? "DESPESAS" : modelo==="aportes" ? "APORTES" : String(hist || FC_MODELOS[modelo].label).toUpperCase().slice(0,48);
  return p.linhas.length || p.saldo!=null ? p : null;
}
