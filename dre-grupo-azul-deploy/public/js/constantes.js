// Constantes do sistema: meses, lojas, categorias do DRE, chaves de armazenamento local e perfis de permissão.
// Carregado como script comum antes do componente (ver <head> do Sistema Grupo Azul.dc.html).
const MESES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const YEARS = [2025,2026,2027];
const UNIT_DEFS = [
{name:"Loja Azul Viagens Shopping Recife",tipo:"turismo",cor:"#1d4ed8"},
{name:"Loja Azul Viagens João Roma",tipo:"turismo",cor:"#2563eb"},
{name:"Sonho Azul",tipo:"turismo",cor:"#0ea5e9"},
{name:"Loja Arranjos Express Shopping Recife",tipo:"arranjos",cor:"#ec4899"},
{name:"Loja Arranjos Express Conselheiro Aguiar",tipo:"arranjos",cor:"#f43f5e"},
];
const CATEGORIES = [
{key:"faturamento",label:"Faturamento"},
{key:"receita",label:"Receita"},
{key:"deducao",label:"Deduções da Receita"},
{key:"ocupacao",label:"Ocupação"},
{key:"pessoal",label:"Pessoal"},
{key:"marketing",label:"Marketing"},
{key:"outras_despesas",label:"Outras Despesas"},
{key:"custos_extras",label:"Custos Extras"},
{key:"passivo",label:"Passivo"},
{key:"pro_labore",label:"Pró-labore"},
];
const DETAIL_ROWS = [
{id:"fat_pacote",label:"Faturamento Venda de Pacote Azul Viagens",cat:"faturamento",tipo:"turismo"},
{id:"fat_aereo",label:"Faturamento Venda de Aéreo Azul Linhas",cat:"faturamento",tipo:"turismo"},
{id:"fat_consolidadoras",label:"Faturamento Consolidação",cat:"faturamento",tipo:"turismo"},
{id:"fat_arranjos",label:"Faturamento Venda de Arranjos",cat:"faturamento",tipo:"arranjos"},
{id:"fat_outros",label:"Faturamento Outros Serviços",cat:"faturamento",tipo:"turismo"},

{id:"rec_pacote",label:"Receita Venda de Pacote",cat:"receita",tipo:"turismo"},
{id:"rec_aereo",label:"Receita Venda de Aéreo Azul Linhas",cat:"receita",tipo:"turismo"},
{id:"rec_inc_av",label:"Incentivo Azul Viagens",cat:"receita",tipo:"turismo"},
{id:"rec_inc_al",label:"Incentivo Azul Linhas",cat:"receita",tipo:"turismo"},
{id:"rec_ancil",label:"Receita de Consolidação",cat:"receita",tipo:"turismo"},
{id:"rec_inc_ac",label:"Incentivo Ação Comercial",cat:"receita",tipo:"turismo"},
{id:"rec_outros",label:"Receita Outros",cat:"receita",tipo:"turismo"},
{id:"rec_markup",label:"Mark-up",cat:"receita",tipo:"turismo"},
{id:"rec_arranjos",label:"Receita Venda de Arranjos",cat:"receita",tipo:"arranjos"},

{id:"ded_imp",label:"Imposto sobre as Vendas",cat:"deducao"},
{id:"ocu_aluguel",label:"Aluguel",cat:"ocupacao"},
{id:"ocu_cond",label:"Condomínio",cat:"ocupacao"},
{id:"ocu_fundo",label:"Fundo de Propaganda",cat:"ocupacao"},
{id:"ocu_iptu",label:"IPTU",cat:"ocupacao"},
{id:"ocu_ar",label:"Ar Condicionado",cat:"ocupacao"},
{id:"ocu_taxa",label:"Taxa de Administração",cat:"ocupacao"},
{id:"ocu_manut",label:"Manutenção / Limpeza",cat:"ocupacao"},
{id:"ocu_energia",label:"Energia Elétrica",cat:"ocupacao"},
{id:"ocu_agua",label:"Água",cat:"ocupacao"},
{id:"ocu_telefone",label:"Telefone",cat:"ocupacao"},
{id:"ocu_seguro",label:"Seguro",cat:"ocupacao"},
{id:"ocu_internet",label:"Internet",cat:"ocupacao"},
{id:"ocu_outras",label:"Outras Despesas de Ocupação",cat:"ocupacao"},
{id:"pes_sal",label:"Salários Funcionários",cat:"pessoal"},
{id:"pes_comis",label:"Comissão Funcionários",cat:"pessoal"},
{id:"pes_dsr",label:"DSR",cat:"pessoal"},
{id:"pes_enc",label:"Encargos",cat:"pessoal"},
{id:"pes_ferias",label:"Provisão Férias",cat:"pessoal"},
{id:"pes_13",label:"Provisão 13º Salário",cat:"pessoal"},
{id:"pes_exames",label:"Exames",cat:"pessoal"},
{id:"pes_bonus",label:"Bônus e Premiação",cat:"pessoal"},
{id:"pes_vr",label:"Benefícios - Vale Refeição",cat:"pessoal"},
{id:"pes_vt",label:"Benefícios - Vale Transporte",cat:"pessoal"},
{id:"pes_saude",label:"Benefícios - Plano de Saúde",cat:"pessoal"},
{id:"pes_outros",label:"Benefícios - Outros",cat:"pessoal"},
{id:"pes_estag",label:"Estagiários",cat:"pessoal"},
{id:"pes_diarias",label:"Diárias",cat:"pessoal",tipo:"arranjos"},
{id:"mkt_anuncios",label:"Custos com Anúncios",cat:"marketing"},
{id:"mkt_influenciadores",label:"Custos com Influenciadores",cat:"marketing"},
{id:"mkt_brindes",label:"Custos com Brindes",cat:"marketing"},
{id:"out_tarifa",label:"Tarifa",cat:"outras_despesas"},
{id:"out_consorcios",label:"Consórcios",cat:"outras_despesas"},
{id:"out_seguros",label:"Seguros",cat:"outras_despesas"},
{id:"out_sistema",label:"Sistema (Google / CRM)",cat:"outras_despesas"},
{id:"out_wintour",label:"Sistema Wintour",cat:"outras_despesas"},
{id:"out_wts",label:"Sistema WTS",cat:"outras_despesas"},
{id:"out_uniforme",label:"Uniforme",cat:"outras_despesas"},
{id:"out_viagens",label:"Viagens (Reuniões / Famtours)",cat:"outras_despesas"},
{id:"out_ti",label:"Terceirizados - TI",cat:"outras_despesas"},
{id:"out_contador",label:"Terceirizados - Contador",cat:"outras_despesas"},
{id:"out_limpeza",label:"Terceirizados - Limpeza",cat:"outras_despesas"},
{id:"out_portador",label:"Terceirizados - Portador",cat:"outras_despesas"},
{id:"out_juridico",label:"Terceirizados - Assessoria Jurídica",cat:"outras_despesas"},
{id:"out_outros",label:"Terceirizados - Outros",cat:"outras_despesas"},
{id:"out_publicidade",label:"Publicidade",cat:"outras_despesas",tipo:"arranjos"},
{id:"out_royalties",label:"Royalties",cat:"outras_despesas",tipo:"arranjos"},
{id:"cex_rescisao",label:"Rescisão de Funcionário",cat:"custos_extras"},
{id:"cex_outros",label:"Outros Extras",cat:"custos_extras"},
{id:"cex_indeniz",label:"Ações Indenizatórias",cat:"custos_extras"},
{id:"pas_emprestimos",label:"Empréstimos",cat:"passivo"},
{id:"pas_financiamentos",label:"Financiamentos",cat:"passivo"},
{id:"pas_cartoes",label:"Cartões",cat:"passivo"},
{id:"prl_joao",label:"João Almeida",cat:"pro_labore"},
{id:"prl_carlos",label:"Carlos Henrique",cat:"pro_labore"},
];
const SUMMARY_ROWS = [
{key:"faturamento",label:"Faturamento",kind:"plain"},
{key:"receitaBruta",label:"Receita bruta",kind:"plain"},
{key:"deducoes",label:"(-) Deduções",kind:"plain"},
{key:"receita",label:"(=) Receita",kind:"sub"},
{key:"ocupacao",label:"(-) Ocupação",kind:"expense"},
{key:"pessoal",label:"(-) Pessoal",kind:"expense"},
{key:"marketing",label:"(-) Marketing",kind:"expense"},
{key:"outras",label:"(-) Outras despesas",kind:"expense"},
{key:"custosExtras",label:"(-) Custos extras",kind:"expense"},
{key:"despesas",label:"(=) Despesas",kind:"subExpense"},
{key:"lucroOperacional",label:"(=) Lucro operacional",kind:"final"},
{key:"passivo",label:"(-) Passivo",kind:"expense"},
{key:"proLabore",label:"(-) Pró-labore",kind:"expense"},
{key:"lucroFinal",label:"(=) Lucro final",kind:"final"},
{key:"margem",label:"Margem (%)",kind:"pct"},
];
const LS_USERS = "dreAzul_users_v1", LS_SESSION = "dreAzul_session_v1", LS_DATA = "dreAzul_data_v1", LS_DEBTS = "dreAzul_debts_v1", LS_AUDIT = "dreAzul_audit_v1", LS_LOCKS = "dreAzul_locks_v1", LS_TOKEN = "dreAzul_token_v1";
const LS_FATURAS = "dreAzul_faturas_v1";
const LS_CARTOES = "dreAzul_cartoes_v1", LS_RESP = "dreAzul_responsaveis_v1";
const LS_ADM = "dreAzul_faturas_adm_v1";
const ABAS_PERM = [{id:"operacao",label:"Por operação"},{id:"consolidacao",label:"Consolidação"},{id:"balanco",label:"Balanço"},{id:"passivo",label:"Passivo"},{id:"faturas",label:"Faturas"},{id:"contasadm",label:"Contas Administrativas"},{id:"importacao",label:"Importar relatórios"},{id:"conferencia",label:"Conferência de fatura"},{id:"fatdiario",label:"Faturamento diário"}];
const MODS_PERM = [{id:"comercial",label:"Comercial"},{id:"helpdesk",label:"Help desk"}];
const PERM_PADRAO_MOD = {helpdesk:"ver", rh:"nenhum", comercial:"nenhum"};
function permsPadrao(role){ const n = role==="leitor" ? "ver" : "editar"; const o={}; ABAS_PERM.forEach(a=>o[a.id]=n); Object.assign(o, PERM_PADRAO_MOD); return o; }
function mkPerfil(dre, hd, rh, com){ const o={}; ABAS_PERM.forEach(a=>o[a.id]=dre); o.helpdesk=hd; o.rh=rh; o.comercial=com||"nenhum"; return o; }
const PERFIS_PRONTOS = {
  "Financeiro": mkPerfil("editar","ver","nenhum"),
  "Financeiro (somente leitura)": mkPerfil("ver","ver","nenhum"),
  "Suporte / Help desk": mkPerfil("nenhum","editar","nenhum"),
  "RH": mkPerfil("nenhum","ver","editar"),
  "Comercial": mkPerfil("nenhum","ver","nenhum","editar"),
  "Gestor": mkPerfil("ver","ver","ver","ver"),
  "Colaborador": mkPerfil("nenhum","ver","nenhum"),
};
function perfilDe(pp){ const ids=ABAS_PERM.concat(MODS_PERM).map(a=>a.id); const n=Object.keys(PERFIS_PRONTOS).find(k=>ids.every(i=>PERFIS_PRONTOS[k][i]===pp[i])); return n || "Personalizado"; }
const LS_HD = "grupoAzul_helpdesk_v1", LS_RH = "grupoAzul_rh_v1";
const LS_COM = "grupoAzul_comercial_v1", LS_IMP_MAP = "dreAzul_import_map_v1";
