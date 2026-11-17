// Help desk e RH: listas fixas, formulários vazios e SLA.
// Carregado como script comum antes do componente (ver <head> do Sistema Grupo Azul.dc.html).
const HD_CATS = ["Equipamentos","Sistemas e acessos","Internet e rede","Manutenção predial","Outros"];
const HD_PRIOS = ["Baixa","Média","Alta","Urgente"];
const HD_STATUS = ["Novo","Em atendimento","Aguardando solicitante","Aguardando fornecedor","Resolvido"];
const HD_PRAZO_H = {Urgente:4, Alta:8, "Média":24, Baixa:72};
const RH_TIPOS_AUS = ["Férias","Atestado médico","Folga","Licença","Falta"];
const LOJAS = UNIT_DEFS.map(u=>u.name).concat(["Escritório / Administração"]);
function hdNovoVazio(){ return {titulo:"", categoria:HD_CATS[0], prioridade:"Média", loja:LOJAS[0], descricao:""}; }
function rhFormVazio(){ return {id:null, nome:"", cargo:"", loja:LOJAS[0], admissao:"", salario:"", telefone:"", email:""}; }
function ausFormVazio(){ return {colaboradorId:"", tipo:RH_TIPOS_AUS[0], inicio:"", fim:"", obs:""}; }
function localISO(addDias){ const d=new Date(); d.setDate(d.getDate()+(addDias||0)); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
function hdSla(c){
  if(c.status==="Resolvido") return {txt:"Resolvido", cor:"#047857"};
  const prazo = new Date(c.criadoEm).getTime() + (HD_PRAZO_H[c.prioridade]||24)*3600000;
  const diff = prazo - Date.now(), abs = Math.abs(diff);
  const f = abs<3600000 ? Math.max(1,Math.round(abs/60000))+" min" : abs<172800000 ? Math.round(abs/3600000)+"h" : Math.round(abs/86400000)+" dias";
  if(diff<0) return {txt:"Atrasado "+f, cor:"#DC2626"};
  return {txt:"Vence em "+f, cor: diff<7200000 ? "#B45309" : "#64748B"};
}
