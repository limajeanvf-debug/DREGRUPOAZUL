// Competência (mês/ano) usada em Faturas e Contas Administrativas.
// Carregado como script comum antes do componente (ver <head> do Sistema Grupo Azul.dc.html).
const ADM_TIPOS_PADRAO = ["Aluguel","Energia","Água","Internet","Telefone","Contabilidade","Impostos","Manutenção","Outros"];
const MESES_CURTOS = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
function compShift(comp, n){ const p = comp.split("-").map(Number); const d = new Date(p[0], p[1]-1+n, 1); return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0"); }
function vencNoMes(comp, dia){ const p = comp.split("-").map(Number); const ult = new Date(p[0], p[1], 0).getDate(); return comp + "-" + String(Math.min(dia, ult)).padStart(2,"0"); }
const FATURA_TIPOS_PADRAO = ["Cartão","Azul","Azul Viagens","Gol","Latam","Consolidadora"];
function compAtualISO(){ const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0"); }
function compLabelISO(c){ return c ? MESES[parseInt(c.slice(5,7),10)-1] + "/" + c.slice(0,4) : "Sem competência"; }
function diasParaISO(iso){ const h = new Date(); h.setHours(0,0,0,0); return Math.round((new Date(iso+"T00:00:00") - h)/86400000); }
function dataBRISO(iso){ return iso ? new Date(iso+"T00:00:00").toLocaleDateString("pt-BR") : "—"; }
// Aponte para o backend publicado para sair do modo offline (localStorage) e falar com a API real.
