// Faturamento diário (Financeiro): leitura das planilhas de cada empresa e cálculos do mês.
const LS_FD = "grupoAzul_fatdiario_v1";
const FD_EMPRESAS = [
  {id:"azul", label:"Azul Viagens", temDU:true, setores:["AZUL VIAGENS - RECIFE","AZUL VIAGENS - ONLINE","AZUL VIAGENS- PATTEO"],
    dica:"Importe a planilha de faturamento (aba PLANILHA GERAL). O sistema soma Total tarifa (Total produtos) e Liq. Agência (DU) por setor e dia."},
  {id:"sonho", label:"Sonho Azul", temDU:true, setores:["The Blue- Prime e Grupos","The Blue- Corporativo Brasil Eduardo","The Blue- Corporativo (Carlos Maris)","The Blue- Corporativo","Parceiros Partner"],
    dica:"Importe a planilha de faturamento (aba PLANILHA GERAL). O sistema soma Total tarifa (Total produtos) e Liq. Agência (DU) por setor e dia."},
  {id:"arranjos", label:"Arranjos Express", temDU:false, royalties:0.06, marketing:0.02, setores:["RECIFE","CONSELHEIRO"], excluir:["17 DE AGOSTO"],
    dica:"Importe a planilha mensal das lojas (colunas LOJA · FATURAMENTO R$) ou digite o faturamento de cada dia direto na tabela. Royalties 6% e marketing 2% sobre o projetado."},
];
const FD_SEMANA = ["dom","seg","ter","qua","qui","sex","sáb"];
function fdNorm(v){ return String(v==null?"":v).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9%]+/g," ").trim(); }
function fdNum(v){
  if(typeof v==="number") return isFinite(v) ? v : 0;
  let t = String(v==null?"":v).replace(/R\$|\s/g,"").trim();
  if(!t || t==="-") return 0;
  if(t.includes(",")) t = t.replace(/\./g,"").replace(",",".");
  const n = parseFloat(t); return isFinite(n) ? n : 0;
}
function fdData(v){
  const p2 = n=>String(n).padStart(2,"0");
  if(v instanceof Date && !isNaN(v)){ const d = new Date(v.getTime()+6*3600e3); return d.getFullYear()+"-"+p2(d.getMonth()+1)+"-"+p2(d.getDate()); }
  if(typeof v==="number" && v>20000 && v<80000 && typeof XLSX!=="undefined"){ const c = XLSX.SSF.parse_date_code(v); return c ? c.y+"-"+p2(c.m)+"-"+p2(c.d) : null; }
  const m = String(v||"").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if(m){ const y = m[3].length===2 ? "20"+m[3] : m[3]; return y+"-"+p2(m[2])+"-"+p2(m[1]); }
  const iso = String(v||"").match(/^(\d{4})-(\d{2})-(\d{2})/); return iso ? iso[0] : null;
}
function fdLoja(nome){
  let n = String(nome||"").toUpperCase().replace(/\s+/g," ").trim().replace(/^LOJA\s+/,"").replace(/^TOTAL\s+/,"");
  n = n.replace(/DEAGOSTO/,"DE AGOSTO");
  return n;
}
function fdSomar(out, comp, dia, setor, t, du){
  if(!dia || dia.slice(0,7)!==comp && comp) return;
  const c = dia.slice(0,7); out[c] = out[c] || {}; const d = (out[c][dia] = out[c][dia] || {});
  const x = (d[setor] = d[setor] || {t:0, du:0}); x.t = Math.round((x.t+t)*100)/100; x.du = Math.round((x.du+du)*100)/100;
}
// Devolve {porComp: {"AAAA-MM": {"AAAA-MM-DD": {setor:{t,du}}}}, setores:[...]}
function fdLerWorkbook(wb, emp){
  const porComp = {}, setores = [];
  const addSetor = s=>{ if(s && !setores.includes(s)) setores.push(s); };
  if(emp.temDU){
    for(const sn of wb.SheetNames){
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], {header:1, raw:true, defval:""});
      const hi = rows.slice(0,8).findIndex(r=>r.some(c=>fdNorm(c)==="setor") && r.some(c=>fdNorm(c).startsWith("data venda")));
      if(hi<0) continue;
      const cab = rows[hi].map(fdNorm), col = (...ks)=>cab.findIndex(c=>ks.some(k=>c===k||c.startsWith(k)));
      const cS = col("setor"), cD = col("data venda"), cT = col("total tarifa"), cL = col("liq agencia","liquido agencia");
      if(cD<0 || cT<0) continue;
      rows.slice(hi+1).forEach(r=>{ const setor = String(r[cS]||"").trim(), dia = fdData(r[cD]); if(!setor || !dia) return;
        addSetor(setor); fdSomar(porComp, "", dia, setor, fdNum(r[cT]), cL>=0 ? fdNum(r[cL]) : 0); });
      if(setores.length) break;
    }
  } else {
    for(const sn of wb.SheetNames){
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], {header:1, raw:true, defval:""});
      const hi = rows.slice(0,10).findIndex(r=>r.some(c=>fdNorm(c).startsWith("faturamento r")));
      if(hi<0) continue;
      const blocos = [];
      rows[hi].forEach((c,j)=>{ if(!fdNorm(c).startsWith("faturamento r")) return;
        let k = j-1; while(k>=0 && !String(rows[hi][k]||"").trim()) k--;
        if(k<0) return; const nome = fdLoja(rows[hi][k]); if(!nome || /CONSOLIDADO/.test(nome) || (emp.excluir||[]).includes(nome)) return;
        blocos.push({nome, cD:k, cV:j}); });
      for(let i=hi+1;i<rows.length;i++){
        const r = rows[i]; if(blocos.some(b=>/^total/i.test(String(r[b.cD]||"").trim()))) break;
        const dRow = blocos.map(b=>fdData(r[b.cD])).find(Boolean); if(!dRow) continue;
        blocos.forEach(b=>{ const dia = fdData(r[b.cD]) || dRow; const v = fdNum(r[b.cV]); addSetor(b.nome);
          const c = dia.slice(0,7); const ja = porComp[c] && porComp[c][dia] && porComp[c][dia][b.nome];
          if(ja && ja.t) return; if(ja) ja.t = v; else fdSomar(porComp, "", dia, b.nome, v, 0); });
      }
    }
  }
  return {porComp, setores};
}
function fdLerArquivo(file, emp){
  return file.arrayBuffer().then(buf=>{
    const wb = XLSX.read(buf, {type:"array", cellDates:true});
    const r = fdLerWorkbook(wb, emp);
    if(!Object.keys(r.porComp).length) throw new Error(emp.temDU ? "Não encontrei a aba com Setor, Data venda e Total tarifa (PLANILHA GERAL)." : "Não encontrei as colunas LOJA · FATURAMENTO (R$) na planilha.");
    return r;
  });
}
function fdDiasApurados(comp, corte){
  const [y,m] = comp.split("-").map(Number), nd = new Date(y, m, 0).getDate();
  if(corte!=null && corte!=="") return Math.max(0, Math.min(nd, parseInt(corte,10)||0));
  const hoje = new Date(), hc = hoje.getFullYear()+"-"+String(hoje.getMonth()+1).padStart(2,"0");
  if(comp<hc) return nd; if(comp>hc) return 0;
  return Math.max(1, hoje.getDate()-1);
}

const FD_MESES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
// Imagem do relatório (para enviar à diretoria): só até o último dia preenchido. m = {emp, comp, setores, dias, apur, nd}
function fdDesenharImagem(m){
  const emp = m.emp, [y, mo] = m.comp.split("-").map(Number);
  const preench = Object.keys(m.dias).filter(d=>d.slice(0,7)===m.comp && m.setores.some(n=>{ const x = m.dias[d][n]; return x && (x.t||x.du); })).sort();
  if(!preench.length) return null;
  const ultimo = +preench[preench.length-1].slice(8,10);
  const num = v=>v ? v.toLocaleString("pt-BR",{minimumFractionDigits:2, maximumFractionDigits:2}) : "–";
  const moeda = v=>"R$ "+(v||0).toLocaleString("pt-BR",{minimumFractionDigits:2, maximumFractionDigits:2});
  const pct = (a,b)=>b ? (a/b*100).toLocaleString("pt-BR",{minimumFractionDigits:2, maximumFractionDigits:2})+"%" : "–";
  const grupos = m.setores.concat(["Consolidado"]);
  const sub = emp.temDU ? [["Total produtos",112],["DU",96],["Rent.",68]] : [["Faturamento (R$)",140]];
  const diaW = 124, P = 24, W = Math.max(760, P*2 + diaW + grupos.length*sub.reduce((a,c)=>a+c[1],0));
  const k = (W - P*2 - diaW) / (grupos.length*sub.reduce((a,c)=>a+c[1],0)); sub.forEach(c=>c[1] = Math.floor(c[1]*k));
  const gW = sub.reduce((a,c)=>a+c[1],0), tW0 = diaW + grupos.length*gW;
  const linhas = [], tot = grupos.map(()=>({t:0, du:0}));
  for(let i=1;i<=ultimo;i++){
    const iso = m.comp+"-"+String(i).padStart(2,"0"), dd = m.dias[iso] || {}, c = {t:0, du:0};
    const vals = m.setores.map((n,gi)=>{ const x = dd[n] || {t:0, du:0}; c.t += x.t||0; c.du += x.du||0; tot[gi].t += x.t||0; tot[gi].du += x.du||0; return x; });
    tot[grupos.length-1].t += c.t; tot[grupos.length-1].du += c.du;
    linhas.push({dia:String(i).padStart(2,"0")+"/"+String(mo).padStart(2,"0"), wd:new Date(y, mo-1, i).getDay(), vals:vals.concat([c])});
  }
  const fator = m.apur ? m.nd/m.apur : 0, totC = tot[tot.length-1];
  const rod = [["Total", x=>[num(x.t), num(x.du), pct(x.du,x.t)], false], ["Projeção do mês", x=>[num(x.t*fator), num(x.du*fator), pct(x.du,x.t)], true]];
  if(!emp.temDU){ rod.push(["Royalties ("+(emp.royalties*100)+"%)", x=>[num(x.t*fator*emp.royalties)], false]); rod.push(["Marketing ("+(emp.marketing*100)+"%)", x=>[num(x.t*fator*emp.marketing)], false]); }
  const kpis = emp.temDU ? [["Total produtos", moeda(totC.t)], ["DU", moeda(totC.du)], ["Rentabilidade", pct(totC.du, totC.t)], ["Projeção do mês", moeda(totC.t*fator)]]
    : [["Faturamento", moeda(totC.t)], ["Projeção do mês", moeda(totC.t*fator)], ["Royalties ("+(emp.royalties*100)+"%)", moeda(totC.t*fator*emp.royalties)], ["Marketing ("+(emp.marketing*100)+"%)", moeda(totC.t*fator*emp.marketing)]];
  const HH = 74, KH = 70, G1 = 30, G2 = 24, RH = 24, FH = 28;
  const TH = G1+G2+linhas.length*RH+rod.length*FH;
  const H = HH + 16 + KH + 16 + TH + 38;
  const esc = 2, cv = document.createElement("canvas"); cv.width = W*esc; cv.height = H*esc;
  const g = cv.getContext("2d"); g.scale(esc, esc);
  const F = (peso, tam)=>peso+" "+tam+"px Manrope, system-ui, sans-serif";
  const txt = (s, x, yy, cor, fonte, al, max)=>{ g.fillStyle = cor; g.font = fonte; g.textAlign = al || "left"; g.textBaseline = "middle";
    let t = String(s); if(max && g.measureText(t).width>max){ while(t.length>2 && g.measureText(t+"…").width>max) t = t.slice(0,-1); t += "…"; } g.fillText(t, x, yy); };
  g.fillStyle = "#F5F7FB"; g.fillRect(0,0,W,H);
  g.fillStyle = "#1D4ED8"; g.fillRect(0,0,W,HH);
  txt("Faturamento diário · "+emp.label, P, 28, "#fff", F(800,19));
  txt(FD_MESES[mo-1].replace(/^./,c=>c.toUpperCase())+" de "+y+" · até "+String(ultimo).padStart(2,"0")+"/"+String(mo).padStart(2,"0")+" · "+m.apur+" de "+m.nd+" dias apurados", P, 52, "#DBE6FF", F(600,12.5));
  txt("Gerado em "+new Date().toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}), W-P, 28, "#DBE6FF", F(600,11.5), "right");
  const kw = (W - P*2 - 12*3)/4; let yy = HH + 16;
  kpis.forEach((k,i)=>{ const x = P + i*(kw+12); g.fillStyle = "#fff"; g.strokeStyle = "#E3E8F3"; g.lineWidth = 1;
    g.beginPath(); if(g.roundRect) g.roundRect(x+.5, yy+.5, kw-1, KH-1, 10); else g.rect(x+.5, yy+.5, kw-1, KH-1); g.fill(); g.stroke();
    txt(k[0], x+14, yy+22, "#6B7280", F(600,11.5)); txt(k[1], x+14, yy+46, "#111827", F(800,17), "left", kw-24); });
  yy += KH + 16;
  const x0 = P, tW = tW0;
  g.fillStyle = "#fff"; g.fillRect(x0, yy, tW, TH);
  g.fillStyle = "#F3F6FB"; g.fillRect(x0, yy, tW, G1+G2);
  txt("DIA", x0+12, yy+(G1+G2)/2, "#475569", F(800,10.5));
  grupos.forEach((n,gi)=>{ const gx = x0 + diaW + gi*gW, cons = gi===grupos.length-1;
    if(cons){ g.fillStyle = "#EEF3FF"; g.fillRect(gx, yy, gW, TH); }
    txt(n, gx+gW/2, yy+G1/2+3, cons ? "#1D4ED8" : "#334155", F(800,11.5), "center", gW-12);
    let sx = gx; sub.forEach(c=>{ txt(c[0].toUpperCase(), sx+c[1]-10, yy+G1+G2/2, "#6B7280", F(700,9.5), "right"); sx += c[1]; }); });
  g.fillStyle = "#E3E8F3"; g.fillRect(x0, yy+G1+G2-1, tW, 1);
  let ry = yy + G1 + G2;
  linhas.forEach(l=>{ const fds = l.wd===0 || l.wd===6;
    if(fds){ g.fillStyle = "#F5F8FD"; g.fillRect(x0, ry, diaW + (grupos.length-1)*gW, RH); }
    txt(l.dia, x0+12, ry+RH/2, "#334155", F(700,11.5)); txt(FD_SEMANA[l.wd], x0+54, ry+RH/2, fds ? "#B42318" : "#94A3B8", F(600,10));
    l.vals.forEach((x,gi)=>{ const gx = x0 + diaW + gi*gW, peso = gi===grupos.length-1 ? 700 : 500;
      const cel = emp.temDU ? [num(x.t), num(x.du), pct(x.du, x.t)] : [num(x.t)]; let sx = gx;
      cel.forEach((v,ci)=>{ txt(v, sx+sub[ci][1]-10, ry+RH/2, v==="–" ? "#CBD5E1" : ci===2 ? "#64748B" : "#111827", F(peso,11.5), "right"); sx += sub[ci][1]; }); });
    g.fillStyle = "#F0F2F7"; g.fillRect(x0, ry+RH-1, tW, 1); ry += RH; });
  rod.forEach(r=>{ g.fillStyle = r[2] ? "#E4ECFF" : "#F8FAFC"; g.fillRect(x0, ry, tW, FH); g.fillStyle = "#E3E8F3"; g.fillRect(x0, ry, tW, 1);
    const cor = r[2] ? "#1D4ED8" : "#111827"; txt(r[0], x0+12, ry+FH/2, cor, F(800,11.5), "left", diaW-16);
    tot.forEach((x,gi)=>{ let sx = x0 + diaW + gi*gW; r[1](x).slice(0, sub.length).forEach((v,ci)=>{ txt(v, sx+sub[ci][1]-10, ry+FH/2, cor, F(800,11.5), "right"); sx += sub[ci][1]; }); });
    ry += FH; });
  grupos.forEach((n,gi)=>{ const gx = x0 + diaW + gi*gW, cons = gi===grupos.length-1; g.fillStyle = cons ? "#A5B8F5" : "#D8DFEE"; g.fillRect(gx, yy, cons?2:1, TH); });
  g.strokeStyle = "#D8DFEE"; g.lineWidth = 1; g.strokeRect(x0+.5, yy+.5, tW-1, TH-1);
  txt("Grupo Azul · Sistema integrado", P, H-18, "#94A3B8", F(600,10.5));
  return {canvas:cv, ultimo};
}
