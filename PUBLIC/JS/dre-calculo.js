// Cálculo do DRE, passivo e formatação de valores.
// Carregado como script comum antes do componente (ver <head> do Sistema Grupo Azul.dc.html).
function getPeriodCredores(unit, year, month){
  const byPeriod = unit.customRows && unit.customRows.passivoByPeriod;
  return (byPeriod && byPeriod[`${year}-${month}`]) || [];
}
// Itens manuais criados na categoria Outras Despesas, por competência.
function getPeriodOutras(unit, year, month){
  const byPeriod = unit.customRows && unit.customRows.outrasByPeriod;
  return (byPeriod && byPeriod[`${year}-${month}`]) || [];
}
function getVal(unit, rowId, year, month){
  const y = unit.values[rowId];
  return y ? (y[`${year}-${month}`] ?? 0) : 0;
}
function computeDebtAccumulated(debt, year, month){
  let months = (year-debt.anoInicial)*12 + (month-debt.mesInicial);
  if(months<0) months=0;
  return debt.valorInicial * (1 + (debt.jurosMensal/100)*months);
}
function debtMonthlyInterest(debt, year, month){
  let months = (year-debt.anoInicial)*12 + (month-debt.mesInicial);
  if(months<0) return 0;
  return debt.valorInicial * (debt.jurosMensal/100);
}
function totalDebts(debts, year, month){
  return debts.reduce((s,d)=>s+computeDebtAccumulated(d,year,month), 0);
}
function catSum(cat, unit, year, month){
  let s = 0;
  for(const r of DETAIL_ROWS) if(r.cat===cat && (!r.tipo || r.tipo===unit.tipo)) s += getVal(unit,r.id,year,month);
  if(cat==="passivo") for(const cr of getPeriodCredores(unit,year,month)) s += getVal(unit,cr.id,year,month);
  if(cat==="outras_despesas") for(const it of getPeriodOutras(unit,year,month)) s += getVal(unit,it.id,year,month);
  return s;
}
function computeUnitMonth(unit, year, month){
  const faturamento = catSum("faturamento",unit,year,month);
  const receitaBruta = catSum("receita",unit,year,month);
  const deducoes = catSum("deducao",unit,year,month);
  const receita = receitaBruta - deducoes;
  const ocupacao = catSum("ocupacao",unit,year,month);
  const pessoal = catSum("pessoal",unit,year,month);
  const marketing = catSum("marketing",unit,year,month);
  const outras = catSum("outras_despesas",unit,year,month);
  const custosExtras = catSum("custos_extras",unit,year,month);
  const despesas = ocupacao+pessoal+marketing+outras+custosExtras;
  const lucroOperacional = receita-despesas;
  const passivo = catSum("passivo",unit,year,month);
  const proLabore = catSum("pro_labore",unit,year,month);
  const lucroFinal = lucroOperacional-passivo-proLabore;
  const margem = faturamento ? lucroFinal/faturamento : 0;
  return {faturamento,receitaBruta,deducoes,receita,ocupacao,pessoal,marketing,outras,custosExtras,despesas,lucroOperacional,passivo,proLabore,lucroFinal,margem};
}
function sumResults(list){
  const keys = ["faturamento","receitaBruta","deducoes","receita","ocupacao","pessoal","marketing","outras","custosExtras","despesas","lucroOperacional","passivo","proLabore","lucroFinal"];
  const g = {};
  for(const k of keys) g[k] = list.reduce((s,r)=>s+r[k],0);
  g.margem = g.faturamento ? g.lucroFinal/g.faturamento : 0;
  return g;
}
function formatBRL(v){
  const r = Math.round(v);
  if(r===0) return "R$ 0,00";
  const abs = Math.abs(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
  return r<0 ? `-R$ ${abs}` : `R$ ${abs}`;
}
function formatPct(v){ return (v*100).toLocaleString("pt-BR",{minimumFractionDigits:1,maximumFractionDigits:1})+"%"; }
function formatBRLOrDash(v){ return Math.round(v)===0 ? "—" : formatBRL(v); }
function formatMoeda(v){
  const abs = Math.abs(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
  return v<0 ? `(R$ ${abs})` : `R$ ${abs}`;
}
function parseMoedaInput(str){
  const digits = str.replace(/\D/g,"");
  return digits ? parseInt(digits,10)/100 : 0;
}
function cumulativeLucro(unit, year, month){
  let total = 0;
  for(const y of YEARS){
    if(y>year) continue;
    const maxM = y===year ? month : 11;
    for(let m=0; m<=maxM; m++) total += computeUnitMonth(unit,y,m).lucroFinal;
  }
  return total;
}
