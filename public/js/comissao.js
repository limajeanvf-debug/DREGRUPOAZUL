// Comissão dos consultores (Comercial › Comissão). Regras da planilha simulacao_comissao_consultores.xlsx.
// Carregado como script comum antes do componente (ver <head> do Sistema Grupo Azul.dc.html).
// Percentuais dos parâmetros ficam em pontos (60 = 60%); o cálculo divide por 100.
const LS_COMISSAO = "grupoAzul_comissao_v1";
const COMISSAO_PARAMS = [
  {grupo:"Metas do mês", itens:[
    {k:"metaLoja", label:"Meta de receita da loja", tipo:"R$", dica:"Informada pela franquia todo mês"},
    {k:"metaAzulInd", label:"Meta Azul Viagens individual", tipo:"R$", dica:"Tarifa no fornecedor Azul Viagens, por consultor"},
    {k:"metaAzulOnline", label:"Meta Azul Viagens do Online", tipo:"R$", dica:"Equipe Online somada"},
    {k:"bonus", label:"Bônus coletivo da loja", tipo:"R$", dica:"Dividido entre quem bateu a meta Azul individual"},
  ]},
  {grupo:"Faixas pela receita individual", itens:[
    {k:"minPct", label:"Mínimo para ter comissão", tipo:"% da meta"},
    {k:"f1", label:"Comissão da faixa 1", tipo:"%"},
    {k:"f2Ini", label:"Início da faixa 2", tipo:"% da meta"},
    {k:"f2", label:"Comissão da faixa 2", tipo:"%"},
    {k:"f3Ini", label:"Início da faixa 3", tipo:"% da meta"},
    {k:"f3", label:"Comissão da faixa 3", tipo:"%"},
  ]},
  {grupo:"Ajuste pela meta Azul individual", itens:[
    {k:"azLim", label:"Limite inferior", tipo:"% da meta Azul", dica:"Abaixo disso aplica o downgrade"},
    {k:"azDown", label:"Ajuste abaixo do limite", tipo:"pontos"},
    {k:"azMeio", label:"Ajuste entre o limite e a meta", tipo:"pontos"},
    {k:"azMeta", label:"Meta Azul atingida a partir de", tipo:"% da meta Azul"},
    {k:"azUp", label:"Ajuste com a meta Azul atingida", tipo:"pontos"},
  ]},
  {grupo:"Plus coletivo", itens:[
    {k:"plus", label:"Plus coletivo", tipo:"pontos", dica:"Exige meta de receita da loja e meta Azul total batidas"},
    {k:"gatilho", label:"Gatilho individual (Azul mínima)", tipo:"% da meta Azul", dica:"0 desliga o gatilho"},
  ]},
];
const COMISSAO_PADRAO = {metaLoja:120000, metaAzulInd:100000, metaAzulOnline:122929.79, bonus:1000,
  minPct:60, f1:7, f2Ini:100, f2:10, f3Ini:120, f3:12, azLim:60, azDown:-2, azMeio:0.5, azMeta:100, azUp:1, plus:1, gatilho:85};
// Valores reais de outubro/2026 (aba Simulação da planilha), usados se a competência ainda não foi salva.
const COMISSAO_EXEMPLO = {"2026-10": {params:COMISSAO_PADRAO, receitaLoja:138502.37, azulOnline:295732.70, consultores:[
  {nome:"Ana", receita:43483.13, azul:55877}, {nome:"Alessandra", receita:42837.78, azul:98919.94},
  {nome:"Driely", receita:31380.76, azul:109811.49}, {nome:"Isabela", receita:16950.49, azul:83771.09}]}};

function numComissao(v){ const n = numBR(v); return isFinite(n) ? n : 0; }

// d = {params, receitaLoja, azulOnline, consultores:[{nome, receita, azul}]} (valores podem vir como texto).
function calcComissao(d){
  const P = {}; Object.keys(COMISSAO_PADRAO).forEach(k=>P[k] = numComissao(d.params && d.params[k]!=null ? d.params[k] : COMISSAO_PADRAO[k]));
  const p = k=>P[k]/100;
  const cons = (d.consultores||[]).map(c=>({nome:c.nome||"", receita:numComissao(c.receita), azul:numComissao(c.azul)}));
  const n = cons.length;
  const metaInd = n ? P.metaLoja/n : 0;
  const metaAzulTotal = P.metaAzulInd*n + P.metaAzulOnline;
  const receitaLoja = numComissao(d.receitaLoja), azulOnline = numComissao(d.azulOnline);
  const azulCons = cons.reduce((a,c)=>a+c.azul,0);
  const azulTotal = azulCons + azulOnline;
  const div = (a,b)=>b ? a/b : 0;
  const lojaOk = receitaLoja >= P.metaLoja, azulOk = azulTotal >= metaAzulTotal;
  const linhas = cons.map(c=>{
    const pctRec = div(c.receita, metaInd), pctAzul = div(c.azul, P.metaAzulInd);
    const base = pctRec < p("minPct") ? 0 : pctRec >= p("f3Ini") ? p("f3") : pctRec >= p("f2Ini") ? p("f2") : p("f1");
    const ajuste = base===0 ? 0 : pctAzul < p("azLim") ? p("azDown") : pctAzul < p("azMeta") ? p("azMeio") : p("azUp");
    const plus = base>0 && lojaOk && azulOk && pctAzul >= p("gatilho") ? p("plus") : 0;
    const final = base===0 ? 0 : Math.max(0, base+ajuste+plus);
    const nova = c.receita*final, atual = c.receita*base;
    const elegivel = lojaOk && azulOk && pctAzul >= p("azMeta");
    return {...c, pctRec, base, pctAzul, ajuste, plus, final, nova, atual, dif:nova-atual, elegivel};
  });
  const azulElegiveis = linhas.filter(l=>l.elegivel).reduce((a,l)=>a+l.azul,0);
  linhas.forEach(l=>{ l.bonus = l.elegivel ? div(P.bonus*l.azul, azulElegiveis) : 0; l.total = l.nova + l.bonus; });
  const soma = k=>linhas.reduce((a,l)=>a+l[k],0);
  return {P, n, metaInd, metaAzulTotal, receitaLoja, azulOnline, azulCons, azulTotal,
    pctLoja:div(receitaLoja,P.metaLoja), pctOnline:div(azulOnline,P.metaAzulOnline), pctAzulTotal:div(azulTotal,metaAzulTotal),
    lojaOk, azulOk, bonusLiberado:lojaOk && azulOk, linhas,
    tot:{receita:soma("receita"), azul:azulCons, nova:soma("nova"), atual:soma("atual"), dif:soma("dif"), bonus:soma("bonus"), total:soma("total")}};
}
