// Importação de relatórios: campos do Comercial e sugestão de linha do DRE.
// Carregado como script comum antes do componente (ver <head> do Sistema Grupo Azul.dc.html).
const COM_CAMPOS = [
  {k:"data", label:"Data da venda", obrig:true, pistas:["data venda","data emissao","data","emissao","dt"]},
  {k:"vendedor", label:"Vendedor", obrig:true, pistas:["vendedor","consultor","agente","emissor","atendente","usuario"]},
  {k:"valor", label:"Valor da venda (faturamento bruto)", obrig:true, pistas:["total cliente","valor total","valor venda","total venda","valor","total","vlr"]},
  {k:"liquido", label:"Faturamento líquido", pistas:["liq agencia","liquido agencia","faturamento liquido","receita liquida","liquido"]},
  {k:"tarifa", label:"Tarifa", pistas:["total tarifa","tarifa"]},
  {k:"produto", label:"Produto", pistas:["produto","servico","tipo de venda"]},
  {k:"fornecedor", label:"Fornecedor", pistas:["fornecedor","operadora","consolidadora","companhia","cia","prestador"]},
  {k:"destino", label:"Destino", pistas:["destino","cidade","roteiro","trecho"]},
  {k:"cliente", label:"Cliente", pistas:["cliente","passageiro","pagante","nome"]},
  {k:"loja", label:"Loja", pistas:["loja","filial","unidade","ponto de venda","agencia"]},
  {k:"documento", label:"Nº da venda / localizador", pistas:["localizador","reserva","pedido","numero","codigo","n venda","venda"]},
];
const IMP_TIPOS = [
  {id:"receitas", label:"Faturamento e receitas", desc:"Relatório de vendas ou faturamento do mês.", cats:["faturamento","receita","deducao"], assinado:true},
  {id:"despesas", label:"Despesas pagas", desc:"Contas pagas, extrato ou razão de despesas.", cats:["ocupacao","marketing","outras_despesas","custos_extras","deducao"]},
  {id:"folha", label:"Folha de pagamento", desc:"Resumo da folha, encargos, benefícios e pró-labore.", cats:["pessoal","pro_labore"]},
  {id:"passivo", label:"Passivo", desc:"Saldos de empréstimos, financiamentos e cartões.", cats:["passivo"]},
];
const IMP_STOP = new Set(["com","de","da","do","das","dos","para","sobre","the","and"]);
function sugerirLinha(desc, cand){
  const t = normTxt(desc); const tok = t.split(" ").filter(w=>w.length>2 && !IMP_STOP.has(w));
  let melhor = "", nota = 0;
  for(const d of cand){
    const dl = normTxt(d.label); if(dl===t) return d.id;
    const dt = dl.split(" ").filter(w=>w.length>2 && !IMP_STOP.has(w)); if(!dt.length) continue;
    const hit = dt.filter(w=>tok.some(x=>x===w || (x.length>4 && w.length>4 && x.slice(0,5)===w.slice(0,5)))).length;
    const sc = hit/dt.length; if(sc>nota){ nota=sc; melhor=d.id; }
  }
  return nota>=0.6 ? melhor : "";
}

// Relatório "Faturamento Líquido" do sistema de vendas (PDF): colunas pela posição na página.
// Valores quebrados em duas linhas (ex.: "16.301,8" + "2") são juntados. Retorna null se não for esse relatório.
const FAT_LIQ_CAB = ["Data Venda","Fornecedor","Cod. Cliente","Cia","Venda Nº","Produto","Emissor","Promotor","Total Tarifa","Total Taxas","Total Outras Taxas","Total DU/RAV","Comissão Agência","Total Cliente","Over Agência","% Lucrat.","Liq. Agência","Tx. DU/RAV Cartão","Markup","Filial"];
async function pdfFaturamentoLiquido(file){
  const pdfjs = await carregarPdfjs();
  const doc = await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
  const TXT = [30,63,178,210,243,275,307,339];                         // início (x) das colunas de texto 0..7
  const NUM = [402,436,467,499,531,564,596,628,660,692,724,9999];      // fim (x) das colunas numéricas 8..19
  const ehData = t=>/^\d{2}\/\d{2}\/\d{2,4}$/.test(t);
  const linhas = []; let achou = false;
  for(let p=1; p<=doc.numPages; p++){
    const pg = await doc.getPage(p), esc = pg.view[2]/842.25;
    const it = (await pg.getTextContent()).items.filter(i=>i.str && i.str.trim()).map(i=>({s:i.str.trim(), x:i.transform[4]/esc, y:i.transform[5], r:(i.transform[4]+i.width)/esc}));
    if(p===1){ achou = it.some(i=>/FATURAMENTO LIQUIDO/i.test(normTxt(i.s).toUpperCase())); if(!achou) return null; }
    const tot = it.find(i=>/^Totais/.test(i.s)), corte = tot ? tot.y+8 : -1;
    const rows = it.filter(i=>i.x<45 && ehData(i.s)).map(i=>({y:i.y, cel:{}})).sort((a,b)=>a.y-b.y);
    it.forEach(i=>{
      if(i.y<=corte) return;
      const row = rows.find(r=>r.y>=i.y-0.5); if(!row || i.y<row.y-9) return;
      let c;
      if(i.x<360){ c = 0; TXT.forEach((x,j)=>{ if(i.x>=x-3) c = j; }); }
      else { if(!/^-?[\d.,]+$/.test(i.s)) return; c = 8 + NUM.findIndex(x=>i.r<=x); }
      (row.cel[c] = row.cel[c] || []).push(i);
    });
    rows.forEach(r=>{
      const out = FAT_LIQ_CAB.map((_,c)=>{
        const a = (r.cel[c]||[]).sort((u,v)=>v.y-u.y || u.x-v.x).map(z=>z.s);
        if(!a.length) return c>=8 ? 0 : "";
        if(c===4) return a[0];
        const t = a.join(c===1 ? " " : "");
        return c>=8 ? numBR(t) : t;
      });
      linhas.push(out);
    });
  }
  return {nome:file.name, cab:FAT_LIQ_CAB.slice(), linhas};
}
function lerRelatorioVendas(file){
  if(!/\.pdf$/i.test(file.name)) return lerPlanilha(file);
  return pdfFaturamentoLiquido(file).catch(()=>null).then(r=>r || lerPlanilha(file));
}

// Relatório "Faturamento Bruto" do sistema de vendas (PDF) para o DRE.
// Lê venda a venda pela posição das colunas e resume por fornecedor:
//   Faturamento = Total Cliente · Receita = DU/RAV + Comissão + Over · Mark-up separado.
// Retorna null se o PDF não for esse relatório.
const FAT_BRUTO_CAB = ["Data Venda","Fornecedor","Cod. Cliente","Venda Nº","Produto","Emissor","Promotor","Total Tarifa","Total Taxas","Total Outras Taxas","Total DU/RAV","Comissão Agência","Total Cliente","Over Agência","% Lucrat.","Markup"];
const FAT_BRUTO_CONSOLID = ["sky team","flytour","latam","salinas","gol","rextur","esferatur","confianca","bwt"];
async function pdfFaturamentoBruto(file){
  const pdfjs = await carregarPdfjs();
  const doc = await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
  const TXT = [30,63,215,247,279,312,344], NUM = [407,439,471,504,536,568,600,632,9999];
  const vendas = []; let periodo = "";
  for(let p=1; p<=doc.numPages; p++){
    const pg = await doc.getPage(p), esc = pg.view[2]/842.25;
    const it = (await pg.getTextContent()).items.filter(i=>i.str && i.str.trim()).map(i=>({s:i.str.trim(), x:i.transform[4]/esc, y:i.transform[5], r:(i.transform[4]+i.width)/esc}));
    if(p===1){
      if(!it.some(i=>/FATURAMENTO BRUTO/i.test(normTxt(i.s).toUpperCase()))) return null;
      const per = it.find(i=>/^Per[ií]odo/i.test(i.s)); periodo = per ? per.s : "";
    }
    const tot = it.find(i=>/^Totais/.test(i.s)), corte = tot ? tot.y+8 : -1;
    const rows = it.filter(i=>i.x<45 && /^\d{2}\/\d{2}\/\d{2,4}$/.test(i.s) && i.y>corte).map(i=>({y:i.y, cel:{}})).sort((a,b)=>a.y-b.y);
    it.forEach(i=>{
      if(i.y<=corte) return;
      const row = rows.find(r=>r.y>=i.y-0.5); if(!row || i.y<row.y-9) return;
      let c;
      if(i.x<374){ c = 0; TXT.forEach((x,k)=>{ if(i.x>=x-3) c = k; }); }
      else { if(!/^-?[\d.,]+$/.test(i.s)) return; c = 7 + NUM.findIndex(x=>i.r<=x); }
      (row.cel[c] = row.cel[c] || []).push(i);
    });
    rows.forEach(r=>vendas.push(FAT_BRUTO_CAB.map((_,c)=>{
      const a = (r.cel[c]||[]).sort((u,v)=>v.y-u.y || u.x-v.x).map(z=>z.s);
      if(!a.length) return c>=7 ? 0 : "";
      if(c===3) return a[0];
      const t = a.join(c===1 ? " " : "");
      return c>=7 ? numBR(t) : t;
    })));
  }
  if(!vendas.length) return null;
  const por = new Map(); let markup = 0;
  vendas.forEach(v=>{
    const f = v[1] || "(sem fornecedor)", g = por.get(f) || {fat:0, rec:0, n:0};
    g.fat += v[12]; g.rec += v[10] + v[11] + v[13]; g.n++; por.set(f, g); markup += v[15];
  });
  const linhaDe = f=>{ const n = normTxt(f);
    if(/^azul viagens/.test(n)) return ["fat_pacote","rec_pacote"];
    if(/^azul linhas/.test(n)) return ["fat_aereo","rec_aereo"];
    if(FAT_BRUTO_CONSOLID.some(c=>n.startsWith(c))) return ["fat_consolidadoras","rec_ancil"];
    return ["fat_outros","rec_outros"]; };
  const linhas = [], sugestao = {}, r2 = x=>Math.round(x*100)/100;
  Array.from(por.entries()).sort((a,b)=>b[1].fat-a[1].fat).forEach(([f,g])=>{
    const [lf, lr] = linhaDe(f), q = " ("+g.n+(g.n>1?" vendas)":" venda)");
    if(g.fat){ const d = "Faturamento · "+f+q; linhas.push([d, r2(g.fat)]); sugestao[normTxt(d)] = lf; }
    if(g.rec){ const d = "Receita (DU/RAV + comissão + over) · "+f; linhas.push([d, r2(g.rec)]); sugestao[normTxt(d)] = lr; }
  });
  if(markup){ const d = "Mark-up · todas as vendas"; linhas.push([d, r2(markup)]); sugestao[normTxt(d)] = "rec_markup"; }
  return {nome:file.name, cab:["Descrição","Valor"], linhas, sugestao, info:vendas.length+" vendas lidas"+(periodo?" · "+periodo:"")};
}
function lerRelatorioDre(file){
  if(!/\.pdf$/i.test(file.name)) return lerPlanilha(file);
  return pdfFaturamentoBruto(file).catch(()=>null).then(r=>r || lerPlanilha(file));
}
