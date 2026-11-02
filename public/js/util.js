// Utilitários de texto, números e datas no formato brasileiro.
// Carregado como script comum antes do componente (ver <head> do Sistema Grupo Azul.dc.html).
function lerJSON(k, padrao){ try{ const v = JSON.parse(localStorage.getItem(k)||"null"); return v==null ? padrao : v; }catch(e){ return padrao; } }
function normTxt(v){ return String(v==null?"":v).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim(); }
// Valor no formato brasileiro (1.234,56 · (1.234,56) · -1234,5 · R$ 10) ou número do Excel.
function numBR(v){
  if(typeof v==="number") return v;
  let t = String(v==null?"":v).trim(); if(!t) return NaN;
  const neg = /^\(.*\)$/.test(t) || /^-/.test(t) || /-$/.test(t) || /\bD$/i.test(t);
  t = t.replace(/[^\d,.]/g,"");
  if(t.indexOf(",")>=0) t = t.replace(/\./g,"").replace(",",".");
  else if((t.match(/\./g)||[]).length>1 || /^\d{1,3}\.\d{3}$/.test(t)) t = t.replace(/\./g,"");
  const n = parseFloat(t); return isNaN(n) ? NaN : (neg ? -n : n);
}
// Data em ISO a partir de Date, número de série do Excel, dd/mm/aaaa ou aaaa-mm-dd.
function dataISOde(v){
  const iso = d=>d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
  if(v instanceof Date && !isNaN(v)) return iso(new Date(v.getTime()+12*3600000));
  if(typeof v==="number" && v>20000 && v<80000){ const d=new Date(Math.round((v-25569)*86400000)); return d.getUTCFullYear()+"-"+String(d.getUTCMonth()+1).padStart(2,"0")+"-"+String(d.getUTCDate()).padStart(2,"0"); }
  const t = String(v==null?"":v).trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if(m) return m[1]+"-"+m[2].padStart(2,"0")+"-"+m[3].padStart(2,"0");
  m = t.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  if(m){ const a = m[3].length===2 ? "20"+m[3] : m[3]; if(+m[2]>=1 && +m[2]<=12 && +m[1]>=1 && +m[1]<=31) return a+"-"+m[2].padStart(2,"0")+"-"+m[1].padStart(2,"0"); }
  return "";
}
