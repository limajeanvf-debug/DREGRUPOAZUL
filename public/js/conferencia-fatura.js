// Conferência de fatura: leitura de PDF/planilha e os layouts de cada fornecedor (Azul Linhas, Azul Viagens, Skyteam, Salinas).
// Carregado como script comum antes do componente (ver <head> do Sistema Grupo Azul.dc.html).
const CONF_TIPOS = [
  {id:"azul_linhas", label:"Faturas Azul Linhas", pronto:true, desc:"Envie a fatura da Azul Linhas Aéreas (arquivo 1, PDF ou planilha) e o relatório de vendas do sistema (arquivo 2). Cada bilhete da fatura é ligado à venda pelo localizador (RLOC) e recebe o número da venda e a filial. Quando a venda não é encontrada, os campos ficam em branco. Digite a NC e exporte para o Excel."},
  {id:"azul_viagens", label:"Faturas Azul Viagens", pronto:true, desc:"Envie a fatura RAV da Azul Viagens (arquivo 1, PDF ou planilha) e o relatório de vendas do sistema (arquivo 2). Cada booking da fatura é ligado à venda pelo localizador e recebe o número da venda e a filial. Quando a venda não é encontrada, os campos ficam em branco. Digite a NC e exporte para o Excel."},
  {id:"skyteam", label:"Faturas Skyteam", pronto:false},
  {id:"salinas", label:"Faturas Salinas", pronto:true, desc:"Envie a fatura da Salinas Tour (arquivo 1, PDF ou planilha) e o relatório de vendas do sistema (arquivo 2). Cada item da fatura é ligado à venda pelo localizador (ou pelo bilhete, se for a coluna com valores em comum) e recebe o número da venda e a filial. Quando a venda não é encontrada, os campos ficam em branco. Digite a NC e exporte para o Excel."},
  {id:"flytour", label:"Faturas Flytour", pronto:false},
];
function confNorm(s){ return String(s==null?"":s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[º°.]/g," ").replace(/\s+/g," ").trim(); }
function confChave(v){
  if(v==null) return "";
  if(v instanceof Date) return isNaN(v) ? "" : v.toISOString().slice(0,10);
  let s = String(v).trim().toUpperCase().replace(/\s+/g,"");
  if(/^\d+([.,]0+)?$/.test(s)) s = s.replace(/[.,]0+$/,"").replace(/^0+(?=\d)/,"");
  return s;
}
function confCelula(v){
  if(v==null) return "";
  if(v instanceof Date) return isNaN(v) ? "" : v.toLocaleDateString("pt-BR", {timeZone:"UTC"});
  if(typeof v==="number") return Number.isInteger(v) ? String(v) : v.toLocaleString("pt-BR", {minimumFractionDigits:2, maximumFractionDigits:2});
  return String(v);
}
let _pdfjs = null;
async function carregarPdfjs(){
  if(!_pdfjs){
    _pdfjs = await import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs");
    _pdfjs.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
  }
  return _pdfjs;
}
// Lê o texto do PDF e agrupa em linhas pela posição vertical (cada linha = itens ordenados da esquerda p/ direita).
async function pdfLinhas(bytes){
  const pdfjs = await carregarPdfjs();
  const doc = await pdfjs.getDocument({data:bytes}).promise;
  const out = [];
  for(let p=1;p<=doc.numPages;p++){
    const tc = await (await doc.getPage(p)).getTextContent();
    const its = tc.items.filter(i=>i.str && i.str.trim()).map(i=>({s:i.str.trim(), x:i.transform[4], y:i.transform[5]}));
    const ls = [];
    its.forEach(i=>{ const l = ls.find(l=>Math.abs(l.y-i.y)<=0.3); if(l) l.t.push(i); else ls.push({y:i.y, t:[i]}); });
    ls.sort((a,b)=>b.y-a.y).forEach(l=>{ l.t.sort((a,b)=>a.x-b.x); out.push(l.t); });
  }
  return out;
}
function pdfNum(s){ const t = String(s).replace(/\s/g,""); if(/^-?\d{1,3}(\.\d{3})*,\d+$/.test(t)) return parseFloat(t.replace(/\./g,"").replace(",", ".")); if(/^-?\d+(\.\d+)?$/.test(t)) return parseFloat(t); return null; }
// Fatura da Azul (Factura Nº / RLOC): uma linha por bilhete, com o RLOC do grupo.
function pdfFaturaAzul(L){
  const cab = ["Tipo","RLOC","Passageiro","Nº TKT","Data","Tarifa à vista","Tarifa crédito","Taxas à vista","Taxas crédito","DU à vista","DU crédito","CC DU","Comissão","Incentivo","Valor líquido","Observações"];
  const linhas = []; let tipo = "", rloc = "", ativo = false;
  L.forEach(t=>{
    const txt = t.map(i=>i.s).join(" ");
    if(/^Vendas:/i.test(txt)){ tipo = "Venda"; ativo = true; return; }
    if(/^Reembolso/i.test(txt)){ tipo = "Reembolso"; ativo = true; return; }
    if(/^(Subtotal|TOTAL GERAL)/i.test(txt)){ ativo = false; return; }
    if(!ativo) return;
    const k = t.findIndex(i=>/^\d{10,13}$/.test(i.s));
    if(k>0 && t[k+1] && /^\d{2}\/\d{2}\/\d{4}$/.test(t[k+1].s)){
      const nums = [], obs = [];
      t.slice(k+2).forEach(i=>{ const n = pdfNum(i.s); if(n!==null && nums.length<10 && !obs.length) nums.push(n); else obs.push(i.s); });
      while(nums.length<10) nums.push("");
      linhas.push([tipo, rloc, t.slice(0,k).map(i=>i.s).join(" "), t[k].s, t[k+1].s, ...nums, obs.join(" ")]);
    } else if(t.length===1 && /^[A-Z0-9]{5,8}$/.test(t[0].s)) rloc = t[0].s;
  });
  return {cab, linhas};
}
// Fatura RAV da Azul Viagens (Booking / RAV): uma linha por booking. O localizador pode quebrar em duas linhas no PDF.
function pdfFaturaAzulViagens(L){
  const its = [].concat(...L);
  const achar = re=>{ const l = L.find(t=>t.some(i=>re.test(i.s))); if(!l) return ""; const k = l.findIndex(i=>re.test(i.s)); return l.slice(k+1).map(i=>i.s).join(" "); };
  const fatura = achar(/^N[º°o] ?Fatura:?$/i), lote = achar(/^Lote:?$/i);
  const hdr = L.find(t=>t.some(i=>i.s==="Booking"));
  const xBook = hdr ? hdr.find(i=>i.s==="Booking").x : 42, xPax = xBook + 26;
  const yHdr = hdr ? hdr[0].y : 1e9;
  const cab = ["Booking","Passageiro","Dt venda","Dt pagto.","Forma de pagamento","Valor pagto.","RAV","RAV adicional","Valor pagar/receber","Nº fatura","Lote"];
  const linhas = [];
  L.forEach(t=>{
    if(t[0].y>=yHdr) return;
    const datas = t.filter(i=>/^\d{2}\/\d{2}\/\d{4}$/.test(i.s));
    if(datas.length<2) return;
    const y = datas[0].y;
    const book = its.filter(i=>i.x < xPax && Math.abs(i.y-y)<=9 && /^[A-Z0-9]{1,8}$/.test(i.s)).sort((a,b)=>b.y-a.y).map(i=>i.s).join("");
    const pax = t.filter(i=>i.x>=xPax && i.x<datas[0].x-2).map(i=>i.s).join(" ");
    const dx = datas[1].x;
    const resto = t.filter(i=>i.x>dx+8);
    const nums = resto.filter(i=>pdfNum(i.s)!==null), forma = resto.filter(i=>pdfNum(i.s)===null).map(i=>i.s).join(" ");
    const v = nums.slice(-4).map(i=>pdfNum(i.s));
    while(v.length<4) v.unshift("");
    linhas.push([book, pax, datas[0].s, datas[1].s, forma, ...v, fatura, lote]);
  });
  return {cab, linhas};
}
// Fatura da SkyTeam (Skyplus): números no formato 1,234.56; cada bilhete ocupa 2 linhas (dados + passageiro/trecho).
function pdfNumUS(s){ const t = String(s).replace(/\s/g,""); return /^-?\d{1,3}(,\d{3})*(\.\d+)?$|^-?\d+(\.\d+)?$/.test(t) ? parseFloat(t.replace(/,/g,"")) : null; }
function pdfFaturaSkyteam(L){
  const txt = L.map(t=>t.map(i=>i.s).join(" ")).join("\n");
  const mF = txt.match(/Fatura\s+(\d+)/), fatura = mF ? mF[1] : "";
  const cab = ["Seção","CIA","Venda SkyTeam","Bilhete","Passageiro","Trecho / descrição","Emissão","Tarifa","Taxa","Incentivo","Comissão","Repasse","Tx Adm","Multa","Desc/Ent","F. pagto","Valor F. pagto","TEB SkyTeam","TEB agência","ISS","Valor líquido","Nº fatura"];
  const linhas = []; let secao = "", ult = null;
  L.forEach(t=>{
    const linha = t.map(i=>i.s).join(" ");
    if(t.length===1 && /^(Vendas|Reembolso|Cancelamento|Remarca|Emiss|Ajuste)/i.test(t[0].s)){ secao = t[0].s; ult = null; return; }
    if(/^TOTAL/i.test(linha)){ ult = null; return; }
    const k = t.findIndex(i=>/^\d{2}\/\d{2}\/\d{4}$/.test(i.s));
    if(t.length>=6 && /^[A-Z0-9]{2}$/.test(t[0].s) && /^\d{4,}$/.test(t[1].s) && k>=2){
      const resto = t.slice(k+1), v = [], pos = [];
      let fp = "", fpVal = "";
      resto.forEach(i=>{
        const m = i.s.match(/^([A-Z]{2,3})\s+(-?[\d.,]+)$/);
        if(m && !fp){ fp = m[1]; fpVal = pdfNumUS(m[2]); return; }
        const n = pdfNumUS(i.s);
        if(n===null) return;
        (fp ? pos : v).push(n);
      });
      while(v.length<8) v.push("");
      while(pos.length<4) pos.unshift("");
      ult = [secao, t[0].s, t[1].s, t.slice(2,k).map(i=>i.s).join(" "), "", "", t[k].s, ...v.slice(0,8), fp, fpVal, ...pos.slice(-4), fatura];
      linhas.push(ult);
    } else if(ult && !ult[4] && t.length<=3){
      ult[4] = t[0].s; ult[5] = t.slice(1).map(i=>i.s).join(" ");
    }
  });
  return {cab, linhas};
}
// Fatura da Salinas Tour: cada item tem uma linha de valores e um bloco abaixo com Loc, Pax, Fornecedor e Produto.
function pdfFaturaSalinas(L){
  const txt = L.map(t=>t.map(i=>i.s).join(" ")).join("\n");
  const mF = txt.match(/FATURA\s+(\d+\/\d+)/), fatura = mF ? mF[1] : "";
  const cab = ["Seq","Título","Emissão","Localizador","Passageiro","Fornecedor","Bilhete","Trecho","Ida","Volta","Forma recebimento","Tarifa","Taxa BR","Outras taxas","RAV","Repasse","Desc.","Total","Nº fatura"];
  const linhas = []; let it = null;
  const fechar = ()=>{
    if(!it) return;
    const b = it.bloco.join(" ").replace(/\s+/g," ");
    const g = re=>{ const m = b.match(re); return m ? m[1].trim() : ""; };
    const loc = g(/Loc:\s*([A-Z0-9]+)/);
    linhas.push([it.seq, it.titulo, it.emissao, loc || it.titulo, g(/Pax:\s*(.+?)\s+Fornecedor:/), g(/Fornecedor:\s*(.+?)\s+CNPJ:/),
      g(/Bilhete:\s*(\d+)/), g(/Trecho emitido:\s*([A-Z\/]+)/), g(/Ida:\s*(\d{2}\/\d{2}\/\d{4})/), g(/Volta:\s*(\d{2}\/\d{2}\/\d{4})/),
      g(/Forma\s+Recebimento:\s*([^\s]+)/), ...it.v, fatura]);
    it = null;
  };
  let ativo = false;
  L.forEach(t=>{
    const linha = t.map(i=>i.s).join(" ");
    if(/^Seq\b/.test(linha) && /Tarifa/.test(linha)){ ativo = true; return; }
    if(!ativo) return;
    if(/^Total|Centro de Custo/i.test(linha) || (t.length>=5 && t.every(i=>pdfNum(i.s)!==null))){ fechar(); ativo = false; return; }
    if(t.length>=6 && /^\d+$/.test(t[0].s) && /^\d{2}\/\d{2}\/\d{4}$/.test(t[2].s)){
      fechar();
      const nums = t.slice(3).map(i=>pdfNum(i.s)).filter(n=>n!==null);
      while(nums.length<7) nums.unshift("");
      it = {seq:t[0].s, titulo:t[1].s, emissao:t[2].s, v:nums.slice(-7), bloco:[t.slice(3).filter(i=>pdfNum(i.s)===null).map(i=>i.s).join(" ")]};
      return;
    }
    if(it) it.bloco.push(linha);
  });
  fechar();
  return {cab, linhas};
}
// Relatório em tabela (ex.: conferência do sistema): colunas pela posição do cabeçalho.
function pdfTabela(L){
  const h = L.findIndex(t=>t.length>=3 && t.filter(i=>/[A-Za-zÀ-ú]{2}/.test(i.s) && pdfNum(i.s)===null).length>=3);
  if(h<0) return null;
  const xs = L[h].map(i=>i.x), cab = L[h].map(i=>i.s);
  const col = x=>{ let c = 0; xs.forEach((v,j)=>{ if(x>=v-4) c = j; }); return c; };
  let i = h+1;
  while(i<L.length && L[i].every(t=>pdfNum(t.s)===null) && L[i].length<cab.length){ L[i].forEach(t=>{ cab[col(t.x)] += " " + t.s; }); i++; }
  const linhas = [];
  for(; i<L.length; i++){
    const cel = cab.map(()=>[]);
    L[i].forEach(t=>{ const c = col(t.x); if(cel[c][cel[c].length-1]!==t.s) cel[c].push(t.s); });
    if(cel[0].length) linhas.push(cel);
    else if(linhas.length){ const ult = linhas[linhas.length-1]; cel.forEach((v,c)=>{ if(v.length) ult[c].push(...v); }); }
  }
  const rows = linhas.filter(r=>r.filter(c=>c.length).length>=2).map(r=>r.map(c=>{ const s = c.join(" "); const n = pdfNum(s); return n!==null && !/^0\d/.test(s) ? n : s; }));
  return {cab, linhas:rows};
}
async function lerPdf(file){
  let L;
  try{ L = await pdfLinhas(new Uint8Array(await file.arrayBuffer())); }
  catch(e){ throw new Error("Não foi possível abrir o PDF. Verifique a conexão com a internet e tente de novo."); }
  if(!L.length) throw new Error("Este PDF não tem texto (parece escaneado). Use a versão em Excel/CSV ou um PDF gerado pelo sistema.");
  const txt = L.map(t=>t.map(i=>i.s).join(" ")).join("\n");
  const r = (/SALINAS TOUR/i.test(txt) && /\bSeq\b/.test(txt)) ? pdfFaturaSalinas(L)
    : (/Bilhete - Passageiro/.test(txt) && /SKYPLUS|SkyTeam/i.test(txt)) ? pdfFaturaSkyteam(L)
    : (/Booking/.test(txt) && /\bRAV\b/.test(txt)) ? pdfFaturaAzulViagens(L)
    : (/Factura N|Fatura N/i.test(txt) && /RLOC/.test(txt)) ? pdfFaturaAzul(L) : pdfTabela(L);
  if(!r || !r.linhas.length) throw new Error("Não encontrei uma tabela neste PDF. Use a versão em Excel ou CSV.");
  return {nome:file.name, cab:r.cab, linhas:r.linhas};
}
function lerPlanilha(file){
  if(/\.pdf$/i.test(file.name)) return lerPdf(file);
  return new Promise((ok, falha)=>{
    if(!window.XLSX){ falha(new Error("O leitor de planilhas ainda está carregando. Tente de novo em instantes.")); return; }
    const r = new FileReader();
    r.onerror = ()=>falha(new Error("Não foi possível ler o arquivo."));
    r.onload = ()=>{
      try{
        const bytes = new Uint8Array(r.result);
        let wb;
        if(/\.(csv|txt)$/i.test(file.name)){
          // CSV: decodifica (UTF-8 ou Windows-1252 do Excel) e mantém as células como texto,
          // para numBR/dataISOde lerem 1.250,00 e 01/10/2026 no padrão brasileiro.
          let texto;
          try{ texto = new TextDecoder("utf-8", {fatal:true}).decode(bytes); }
          catch(e){ texto = new TextDecoder("windows-1252").decode(bytes); }
          texto = texto.replace(/^\uFEFF/, "");
          const l1 = texto.split(/\r?\n/)[0] || "";
          const sep = (l1.match(/;/g)||[]).length >= (l1.match(/,/g)||[]).length ? ";" : (l1.indexOf("\t")>=0 ? "\t" : ",");
          wb = XLSX.read(texto, {type:"string", raw:true, FS:sep});
        } else {
          wb = XLSX.read(bytes, {type:"array", cellDates:true});
        }
        const ws = wb.Sheets[wb.SheetNames[0]];
        const aoa = XLSX.utils.sheet_to_json(ws, {header:1, raw:true, defval:""});
        let h = aoa.findIndex(row=>row.filter(c=>typeof c==="string" && c.trim() && !/^[\d.,\s()R$-]+$/.test(c)).length>=2);
        if(h<0) h = 0;
        const largura = Math.max(0, ...aoa.slice(h, h+50).map(x=>x.length));
        const cab = Array.from({length:largura}, (_,i)=>String((aoa[h]||[])[i]==null?"":(aoa[h]||[])[i]).trim() || ("Coluna "+(i+1)));
        const linhas = aoa.slice(h+1).filter(row=>row.some(c=>String(c).trim()!==""));
        if(!linhas.length){ falha(new Error("A planilha não tem linhas de dados.")); return; }
        ok({nome:file.name, cab, linhas});
      }catch(e){ falha(new Error("Arquivo não reconhecido. Use .xlsx, .xls ou .csv.")); }
    };
    r.readAsArrayBuffer(file);
  });
}
function acharColuna(cab, pistas, usadas){
  const n = cab.map(normTxt);
  for(const p of pistas){ const i = n.findIndex((h,ix)=>!(usadas&&usadas.has(ix)) && (" "+h+" ").includes(" "+p)); if(i>=0) return i; }
  return -1;
}
