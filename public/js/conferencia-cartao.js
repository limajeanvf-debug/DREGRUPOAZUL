// Conferência de faturas de cartão de crédito (Nubank e Itaú) contra o relatório "Conferência" do sistema de vendas.
// Adaptado do módulo conferencia-cartao (src/core.js, src/leitor-pdf.js, src/index.js) para script comum:
// o projeto não usa bundler nem ES modules, então o código fica dentro de uma função e expõe window.ConfCartao.
// As regras de conferência são as do módulo original, sem alteração.
// Carregado como script comum antes do componente (ver <head> do Sistema Grupo Azul.dc.html).
(function(){
'use strict';
/* ===== src/core.js ===== */
/* ===== NÚCLEO: leitura de PDFs e conferência ===== */
const MESES = 'JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ';
const DEFAULT_KW = 'AZUL, AZULVIA, AZULVIAGEN, AZULVIAGENS, LATAM, TAM, TAP, GOL, AVIANCA, COPA, IBERIA, UNITED, AMERICAN, AIR, TKT, AEREO, AEREA, LINHAS, OPERADORA, HOTEL, HOTELARI, POUSADA, RESORT, CVC, MOVIDA, LOCALIZA, UNIDAS, EUROPLUS, FLY PACK, DECOLAR, TURISMO, CRUZEIRO, MSC, ASSIST, SKYTEAM, VIAGENS';

function toLines(items, tol) {
  tol = tol || 3;
  const its = items.filter(i => i.str.trim() !== '').slice().sort((a, b) => (b.y - a.y) || (a.x - b.x));
  const lines = [];
  for (const it of its) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - it.y) <= tol) last.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }
  return lines.map(l => {
    const a = l.items.sort((x, y) => x.x - y.x);
    let out = '';
    a.forEach((it, i) => {
      const prev = a[i - 1];
      const gap = prev ? it.x - (prev.x + (prev.w || 0)) : 99;
      out += (prev && gap < 1.2 ? '' : ' ') + it.str.trim();
    });
    return out.replace(/\s+/g, ' ').trim();
  });
}

function brNum(s) { return parseFloat(s.replace(/\./g, '').replace(',', '.')); }

function detectBank(pages) {
  const txt = pages.slice(0, 8).map(p => p.items.map(i => i.str).join(' ')).join(' ');
  // Frases do próprio emissor (cabeçalho, SAC, boleto), não nomes soltos: uma compra "MERCADOPAGO*LOJA"
  // ou um boleto do Itaú numa fatura de outro banco não podem trocar a detecção.
  if (/nu pagamentos/i.test(txt)) return 'Nubank';
  for (const [nome, L] of Object.entries(LAYOUTS)) if (L.detecta.test(txt)) return nome;
  if (/nubank/i.test(txt)) return 'Nubank';
  if (/ita[uú]/i.test(txt)) return 'Itaú';
  return 'Outro';
}

/* ---------- Layouts adicionais (C6, Digio, Sicoob, Brasilcard, Riachuelo/Midway, Bradescard, PicPay, Mercado Pago) ----------
   Leitura por linha-âncora: cada lançamento começa por uma data à esquerda e termina no valor à direita.
   O que estiver logo acima/abaixo (até ~6 pt) e entre a data e o valor é continuação do descritivo
   (no Sicoob o descritivo quebra em duas linhas, uma acima e outra abaixo da data).
   split: fração da largura onde a página se divide em duas colunas (null = coluna única).
   sinal: 'normal' (menos = crédito) | 'invertido' (Brasilcard: menos = débito, mais = crédito).
   Créditos sem sinal (C6, Mercado Pago) são reconhecidos pelo texto (pagamento, estorno, reembolso…). */
const LAYOUTS = {
  // total / anterior: onde ler o total da fatura e o saldo da fatura anterior, para conferir se a leitura está completa
  // (anterior + soma dos lançamentos = total). O C6 lista também os pagamentos da fatura anterior, então não confere assim.
  'C6':           { detecta: /BANCO C6 S|C6 Carbon|Cart[aã]o C6/i, split: null, sinal: 'normal', total: /Total a pagar\s*R\$\s*(-?\d{1,3}(?:\.\d{3})*,\d{2})/, anterior: null },
  'Digio':        { detecta: /app do Digio|Cart[aã]o Digio|digio\.com\.br/i, split: null, sinal: 'normal', total: /Valor da fatura:\s*R\$\s*(-?\d{1,3}(?:\.\d{3})*,\d{2})/ },
  'Sicoob':       { detecta: /SICOOB (VISA|MASTERCARD|PERNAMBUCO|CART)|BANCO COOPERATIVO SICOOB/i, split: 0.5, sinal: 'normal', cidade: true, parcelaSolta: true, total: /no valor total de R\$\s*(-?\d{1,3}(?:\.\d{3})*,\d{2})/ },
  'Brasilcard':   { detecta: /BRASILCARD INSTITUI/i, split: null, sinal: 'invertido', limpar: d => d.replace(/^\.\s*/, ''), total: /Fatura de [A-Za-zç]+:\s*R\$\s*(-?\d{1,3}(?:\.\d{3})*,\d{2})/ },
  'Riachuelo':    { detecta: /MIDWAY S|Cart[aã]o Riachuelo|ANUIDADE RIACHUELO/i, split: null, sinal: 'normal', parcelaSolta: true, limpar: d => d.replace(/^\d{3}\s+/, ''), total: /Saldo desta Fatura\s*(-?\d{1,3}(?:\.\d{3})*,\d{2})/ },
  'Bradesco':     { detecta: /BANCO BRADESCARD|Bradesco Cart[oõ]es/i, split: 0.5, sinal: 'normal', limpar: d => d.replace(/\s+BRA$/, ''), total: /Total da fatura\s*R\$\s*(-?\d{1,3}(?:\.\d{3})*,\d{2})/ },
  'PicPay':       { detecta: /aplicativo PicPay|app PicPay|PicPay Bank|Cart[aã]o PicPay/i, split: 0.5, sinal: 'normal', total: /Total da fatura\s*R\$\s*(-?\d{1,3}(?:\.\d{3})*,\d{2})/ },
  'Mercado Pago': { detecta: /app (do )?Mercado Pago|Cr[eé]dito Mercado Pago/i, split: null, sinal: 'normal', total: /Total a pagar\s*R\$\s*(-?\d{1,3}(?:\.\d{3})*,\d{2})/, anterior: /Total da fatura de [A-Za-zç]+\s*R\$\s*(-?\d{1,3}(?:\.\d{3})*,\d{2})/ },
};
const L_MESES = 'jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez';
const L_DATA = new RegExp('^(\\d{2}\\/\\d{2}(?:\\/\\d{2,4})?|\\d{2}\\s+(?:' + L_MESES + '))(?=\\s|$)', 'i');
const L_VALOR = /^([+\-−–]?)\s*(?:R\$\s*)?([+\-−–]?)\s*(\d{1,3}(?:\.\d{3})*,\d{2})\s*([+\-−–]?)$/;
const L_SINAL = /^[+\-−–]$/;
const L_CREDITO = /^(inclus[aã]o\s+(de\s+)?(pagamento|pgto)|pagamento|pagto|reembolso|estorno|cr[eé]dito|devolu)|[-–]\s*estorno$|pag(amento)?\s+(da\s+)?fatura/i;

function parseLayout(pages, cfg) {
  const rows = [];
  for (const p of pages) {
    const all = p.items.filter(i => i.str.trim() !== '');
    const cols = cfg.split ? [all.filter(i => i.x < p.width * cfg.split), all.filter(i => i.x >= p.width * cfg.split)] : [all];
    for (const col of cols) {
      // coluna "Cidade" (Sicoob): o que estiver nela não entra no descritivo
      const hCid = cfg.cidade ? col.find(i => /^CIDADE$/i.test(i.str.trim())) : null;
      const anchors = [];
      for (const it of col) {
        const m = it.str.trim().match(L_DATA);
        if (!m) continue;
        const mesmaLinha = col.filter(o => Math.abs(o.y - it.y) <= 2.5);
        if (mesmaLinha.some(o => o !== it && o.x < it.x - 1 && /[A-Za-z0-9]/.test(o.str))) continue; // data não é o 1º item da linha
        const vals = mesmaLinha.filter(o => o.x > it.x && L_VALOR.test(o.str.trim()));
        if (!vals.length) continue;
        const v = vals.sort((a, b) => a.x - b.x)[vals.length - 1];
        anchors.push({ it, data: m[1], resto: it.str.trim().slice(m[0].length).trim(), v, linha: mesmaLinha });
      }
      anchors.sort((a, b) => b.it.y - a.it.y);
      const banda = new Map(anchors.map(a => [a, []]));
      for (const o of col) {
        if (anchors.some(a => a.linha.includes(o))) continue;
        let best = null, bd = 6.5;
        for (const a of anchors) { const d = Math.abs(o.y - a.it.y); if (d < bd && o.x > a.it.x - 1 && o.x < a.v.x) { bd = d; best = a; } }
        if (best) banda.get(best).push(o);
      }
      for (const a of anchors) {
        const vEnd = a.v.x;
        const cidX = hCid ? hCid.x - 3 : Infinity;
        let neg = false, pos = false;
        const vm = a.v.str.trim().match(L_VALOR);
        const sinais = [vm[1], vm[2], vm[4]].join('');
        if (/[-−–]/.test(sinais)) neg = true; if (/\+/.test(sinais)) pos = true;
        const partes = [];
        for (const o of a.linha) {
          if (o === a.it || o === a.v) continue;
          const s = o.str.trim();
          if (L_SINAL.test(s) && Math.abs(o.x - vEnd) < 30) { if (s === '+') pos = true; else neg = true; continue; }
          if (o.x > vEnd || o.x >= cidX) continue;
          partes.push(o);
        }
        // valores intermediários na linha (ex.: Riachuelo traz o valor total da compra antes da parcela)
        const meio = partes.filter(o => L_VALOR.test(o.str.trim()));
        const descIts = partes.filter(o => !meio.includes(o)).concat(banda.get(a).filter(o => o.x < cidX));
        descIts.sort((x, y) => (Math.abs(x.y - y.y) > 2.5 ? y.y - x.y : x.x - y.x));
        let desc = [a.resto].concat(descIts.map(o => o.str.trim())).join(' ').replace(/\s+/g, ' ').trim();
        let parcela = null, m;
        if ((m = desc.match(/\s*-?\s*Parcela\s+(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})\b/i)) ||
            (m = desc.match(/\s*Parc\.?\s*(\d{1,2})\s*\/\s*(\d{1,2})\b/i)) ||
            (cfg.parcelaSolta && (m = desc.match(/(?:^|\s)(\d{2})\/(\d{2})(?=\s|$)/)) && +m[1] >= 1 && +m[1] <= +m[2])) {
          parcela = (+m[1]) + '/' + (+m[2]);
          desc = (desc.slice(0, m.index) + ' ' + desc.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
        }
        if (cfg.limpar) desc = cfg.limpar(desc).trim();
        if (!/[A-Za-zÀ-ú]{2}/.test(desc)) continue;
        let valor = brNum(vm[3]);
        if (cfg.sinal === 'invertido') valor = pos ? -valor : valor;
        else if (neg) valor = -valor;
        if (L_CREDITO.test(desc)) valor = -Math.abs(valor);
        const r = { data: a.data.replace(/\s+/g, ' '), desc, parcela, valor };
        if (meio.length) r.totalCompra = brNum(meio[meio.length - 1].str.trim().match(L_VALOR)[3]);
        rows.push(r);
      }
    }
  }
  return rows;
}

/* ---------- Nubank ---------- */
function parseNubank(pages) {
  const NU = new RegExp('^(\\d{2})\\s+(' + MESES + ')\\s+(?:[•·.*]{2,}\\s*\\d{4}\\s+)?(.+?)\\s+([−–-])?\\s*R\\$\\s*([\\d.]+,\\d{2})$', 'i');
  const rows = []; let section = 'cur';
  for (const p of pages) {
    for (const line of toLines(p.items)) {
      // "Pagamentos e Financiamentos" também entra: pagamentos (negativos), saldo restante e financiamentos (ex.: iFood
      // parcelado pelo NuPay), senão a fatura anterior + lançamentos não fecha com o total.
      if (/Pagamentos e Financiamentos/i.test(line)) { section = 'cur'; continue; }
      if (/^TRANSA[ÇC][ÕO]ES/i.test(line)) { section = 'cur'; continue; }
      if (section !== 'cur') continue;
      const m = line.match(NU);
      if (!m) continue;
      let desc = m[3].trim(), parcela = null;
      const pm = desc.match(/\s*-\s*Parcela\s*(\d+\/\d+)\s*$/i);
      if (pm) { parcela = pm[1]; desc = desc.replace(pm[0], '').trim(); }
      rows.push({ data: m[1] + ' ' + m[2].toUpperCase(), desc, parcela, valor: (m[4] ? -1 : 1) * brNum(m[5]) });
    }
  }
  return rows;
}

/* ---------- Itaú (duas colunas) ---------- */
function parseItau(pages) {
  const RX = /(?<![\d\/])(\d{2}\/\d{2})\s+(.+?)\s+(?:(\d{2}\/\d{2})\s+)?(-?\d{1,3}(?:\.\d{3})*,\d{2})(?![\d,])/g;
  const rows = []; let section = 'other';
  for (const p of pages) {
    const split = p.width * 0.575;
    const cols = [p.items.filter(i => i.x < split), p.items.filter(i => i.x >= split)];
    for (const col of cols) {
      for (const line of toLines(col)) {
        if (/Lançamentos:\s*(compras e saques|produtos e serviços)/i.test(line)) { section = 'cur'; continue; }
        if (/Compras parceladas/i.test(line) && /pr[oó]ximas faturas/i.test(line)) { section = 'fut'; continue; }
        if (/^Pagamentos efetuados/i.test(line)) { section = 'pay'; continue; }
        if (/Encargos cobrados/i.test(line)) { section = 'enc'; continue; }
        if (/Limites de crédito|Total para próximas faturas|^Próxima fatura|^continua|Novo teto de juros/i.test(line)) { section = 'other'; continue; }
        // Encargos do quadro "Encargos cobrados nesta fatura" (juros do rotativo, mora, multa, IOF de financiamento):
        // não têm data; entram com valor para a leitura fechar e para comparar juros entre os cartões.
        if (section === 'enc') {
          const e = line.match(/^(Juros do rotativo|Juros de mora|Multa por atraso|IOF de financiamento)\b.*?(\d{1,3}(?:\.\d{3})*,\d{2})$/i);
          if (e && brNum(e[2]) > 0) rows.push({ data: '', desc: e[1], parcela: null, valor: brNum(e[2]) });
          continue;
        }
        if (section !== 'cur' && section !== 'pay') continue;
        let m; RX.lastIndex = 0;
        while ((m = RX.exec(line))) {
          rows.push({ data: m[1], desc: m[2].trim(), parcela: m[3] ? m[3].replace(/^0/, '').replace('/0', '/') : null, valor: brNum(m[4]) });
        }
      }
    }
  }
  return rows;
}

/* ---------- Relatório de vendas (sistema) ---------- */
function parseSistema(pages) {
  const toks = [];
  let stop = false;
  for (const p of pages) {
    let started = false;
    for (const it of p.items) {
      const s = it.str;
      if (/N[uú]mero de registros/i.test(s)) { stop = true; break; }
      if (!started) { if (/Confirma[cç][aã]o/i.test(s)) started = true; continue; }
      s.trim().split(/\s+/).filter(Boolean).forEach(t => toks.push(t));
    }
    if (stop) break;
  }
  const map = new Map(), pidx = new Map();
  const add = (T, v) => {
    if (!map.has(T)) {
      map.set(T, []);
      if (!T.includes('-')) for (const L of [4, 5, 6]) if (T.length > L) {
        const k = L + ':' + T.slice(0, L);
        if (!pidx.has(k)) pidx.set(k, []);
        pidx.get(k).push(T);
      }
    }
    const a = map.get(T); if (!a.includes(v)) a.push(v);
  };
  let last = 0, venda = null, vendas = 0;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (/^\d{1,4}$/.test(t)) {
      const n = +t;
      if (n > last && n <= last + 25 && /^[123]$/.test(toks[i + 1] || '')) { last = n; venda = n; vendas++; i++; continue; }
    }
    const T = t.toUpperCase().replace(/[^A-Z0-9-]/g, '');
    if (T.length >= 4 && venda) add(T, venda);
  }
  return { map, pidx, vendas, tokens: map.size };
}

/* ---------- Conferência ---------- */
function extractCode(descRaw) {
  const U = descRaw.toUpperCase().replace(/\s+/g, ' ');
  let m;
  if (/AZUL\s*VIAGENS?\b|AZULVIAGEN/.test(U)) return null;             // "MP *AZULVIAGEN": compra na Azul Viagens sem localizador
  if ((m = U.match(/AZULVIA\W*([A-Z0-9]{3,})/))) return m[1];
  if ((m = U.match(/AZUL\s*LINHAS\s*([A-Z0-9]{2,})/))) return m[1];
  if ((m = U.match(/\bAZUL([A-Z0-9]{4,})\b/)) && !/^VIA/.test(m[1])) return m[1];
  if ((m = U.match(/LATAM\s*DCP\s*ND\W*([A-Z0-9]+)/))) return m[1];
  if ((m = U.match(/(LA\d{7}[A-Z0-9]{2,5})/))) return m[1];
  if ((m = U.match(/TKT\s*AEREO\s*G3([A-Z0-9]{4,})/))) return m[1];
  if ((m = U.match(/GOL\s*LINHAS\s*A?\s*\*\s*([A-Z]{6})/))) return m[1];       // C6: "GOL LINHAS A*COTUXN011"

  return null;
}

function lookup(code, S) {
  if (S.map.has(code)) return { level: 'exact', token: code, vendas: S.map.get(code) };
  if (code.length > 6) {
    const f6 = code.slice(0, 6);
    if (S.map.has(f6)) return { level: 'exact', token: f6, vendas: S.map.get(f6) };
    const c = S.pidx.get('6:' + f6);
    if (c && c.length === 1) return { level: 'prov', token: c[0], vendas: S.map.get(c[0]) };
  }
  if (code.length >= 5) {
    const f5 = code.slice(0, 5);
    if (S.map.has(f5)) return { level: 'prov', token: f5, vendas: S.map.get(f5) };
  }
  if (code.length === 4 || code.length === 5) {
    const c = S.pidx.get(code.length + ':' + code);
    if (c && c.length === 1) return { level: 'prov', token: c[0], vendas: S.map.get(c[0]) };
    if (c && c.length > 1) return { level: 'amb', token: c.join(', '), vendas: [] };
  }
  return { level: 'none', vendas: [] };
}

function buildKwRegex(text) {
  const parts = text.split(/[,\n]/).map(s => s.trim()).filter(Boolean).map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return parts.length ? new RegExp('(^|[^A-Z0-9])(' + parts.join('|') + ')([^A-Z0-9]|$)', 'i') : null;
}

const IGN_RX = /pagamento|saldo restante|estorno|^IOF\b|anuidade|redu[cç][aã]o mensalidade|financiam/i;

function conferir(row, S, kwRx) {
  const r = Object.assign({}, row);
  r.code = extractCode(row.desc);
  if (row.valor <= 0) { r.status = 'ign'; r.nota = 'Estorno ou crédito' + (r.code ? ' (' + r.code + ')' : ''); r.refund = true; return r; }
  if (IGN_RX.test(row.desc)) { r.status = 'ign'; r.nota = 'Pagamento, taxa ou parcelamento da fatura'; return r; }
  if (r.code && r.code.length >= 4) {
    const m = lookup(r.code, S);
    r.vendas = m.vendas;
    if (m.level === 'exact') { r.status = 'ok'; r.nota = 'Localizador ' + m.token; return r; }
    if (m.level === 'prov') { r.status = 'prov'; r.nota = 'Código parcial ' + r.code + ' ≈ ' + m.token; return r; }
    if (m.level === 'amb') { r.status = 'prov'; r.nota = 'Código ' + r.code + ' pode ser: ' + m.token; return r; }
    r.status = 'nf'; r.nota = 'Localizador ' + r.code + ' não consta no relatório'; return r;
  }
  if (r.code) { r.status = 'semcod'; r.nota = 'Código truncado no descritivo (' + r.code + ')'; return r; }
  if (kwRx && kwRx.test(row.desc)) { r.status = 'semcod'; r.nota = 'Fornecedor de viagem sem localizador no descritivo'; return r; }
  r.status = 'ign'; r.nota = 'Não parece despesa de viagem';
  return r;
}
/* ===== Relatório de vendas (com Total; v3 também com Data e Fornecedor), leitura por colunas ===== */
function parseSistema2(pages) {
  const sales = []; let stop = false;
  const v3 = pages.slice(0, 2).some(p => p.items.some(i => /Forneced/i.test(i.str)));
  // limites das colunas (x): data | filial | cia | localizador | total | fornecedor
  const B = v3 ? { dat: 50, fil: 90, cia: 125, loc: 157, tot: 219, forn: 252 } : { dat: 0, fil: 50, cia: 90, loc: 125, tot: 186, forn: 9999 };
  for (const p of pages) {
    if (stop) break;
    const its = p.items.filter(i => i.str.trim() !== '');
    if (its.some(i => /N[uú]mero de registros/i.test(i.str))) stop = true;
    const rows = [];
    its.filter(i => i.x < 50 && /^\d{1,5}$/.test(i.str.trim())).forEach(i => {
      if (!rows.some(r => Math.abs(r.y - i.y) < 0.25)) rows.push({ n: +i.str.trim(), y: i.y, d: [], f: [], c: [], l: [], t: [], s: [] });
    });
    rows.sort((a, b) => b.y - a.y);
    for (const it of its) {
      if (it.x < 50) continue;
      if (it.y > (rows[0] ? rows[0].y + 1 : 0)) continue;
      if (/Totais:|N[uú]mero de registros/i.test(it.str)) continue;
      let r = rows.find(r => Math.abs(r.y - it.y) < 0.25), over = false;
      if (!r) { r = rows.find(r => r.y - it.y > 6.5 && r.y - it.y < 10.5); over = true; }
      if (!r) continue;
      const col = it.x < B.dat ? null : it.x < B.fil ? (v3 ? 'd' : 'f') : it.x < B.cia ? 'f' : it.x < B.loc ? 'c' : it.x < B.tot ? 'l' : it.x < B.forn ? 't' : 's';
      if (!col) continue;
      r[col].push({ s: it.str.trim(), x: it.x, over });
    }
    for (const r of rows) {
      const j = (arr, sep) => arr.sort((a, b) => (a.over - b.over) || a.x - b.x).map(a => a.s).join(sep);
      const tArr = r.t.sort((a, b) => (a.over - b.over) || a.x - b.x).map(a => a.s);
      let tot = tArr.join('');
      if (!/^\d{1,3}(\.\d{3})*,\d{2}$/.test(tot) && tArr.length === 2 && /^\d{1,3}$/.test(tArr[0]) && /^\d{3},\d{2}$/.test(tArr[1])) tot = tArr[0] + '.' + tArr[1];
      const dm = j(r.d, '').match(/(\d{2})\/(\d{2})\/(\d{2,4})/);
      sales.push({
        venda: r.n, data: dm ? dm[1] + '/' + dm[2] + '/' + (dm[3].length === 2 ? '20' + dm[3] : dm[3]) : '',
        filial: j(r.f, ''), cia: j(r.c, ' '), loc: j(r.l, ''), forn: j(r.s, ' '),
        totalTxt: tot, total: /^\d{1,3}(\.\d{3})*,\d{2}$/.test(tot) ? brNum(tot) : NaN
      });
    }
  }
  return { sales, v3 };
}

/* ===== Índice a partir do relatório com Total ===== */
function buildIndex(sales) {
  const map = new Map(), pidx = new Map(), byVenda = new Map();
  const add = (T, v) => {
    if (!map.has(T)) {
      map.set(T, []);
      if (!T.includes('-')) for (const L of [4, 5, 6]) if (T.length > L) {
        const k = L + ':' + T.slice(0, L);
        if (!pidx.has(k)) pidx.set(k, []);
        pidx.get(k).push(T);
      }
    }
    const a = map.get(T); if (!a.includes(v)) a.push(v);
  };
  sales.forEach(s => {
    byVenda.set(s.venda, s);
    const T = s.loc.toUpperCase().replace(/[^A-Z0-9-]/g, '');
    if (T.length >= 4) add(T, s.venda);
  });
  return { map, pidx, byVenda, sales, vendas: sales.length, hasTotals: sales.some(s => s.total > 0) };
}

const TOL = 0.10;
const nParc = r => { const m = r.parcela && r.parcela.match(/\/(\d+)/); return m ? +m[1] : 1; };
const keyOf = r => r.arquivo + '|' + (r.code ? r.code.slice(0, 6) : '');

/* ===== Consolida por localizador: soma parcelas, estornos e compara com o Total da venda ===== */
function consolidar(rows, S) {
  const groups = new Map();
  rows.forEach(r => {
    if (!r.code || !(r.status === 'ok' || r.status === 'prov' || r.status === 'nf' || r.refund)) return;
    const k = keyOf(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  });
  groups.forEach(g => {
    const pos = g.filter(r => r.valor > 0), neg = g.filter(r => r.valor <= 0);
    if (!pos.length) return;
    const sumPos = pos.reduce((a, r) => a + r.valor, 0), sumNeg = -neg.reduce((a, r) => a + r.valor, 0);
    if (sumNeg > 0 && Math.abs(sumPos - sumNeg) < 1) {
      g.forEach(r => { r.status = 'estorn'; r.nota = 'Cobrado R$ ' + fmtBR(sumPos) + ' e estornado R$ ' + fmtBR(sumNeg) + ' (saldo ≈ zero)'; });
      return;
    }
    const first = pos[0];
    const est = Math.max(sumPos - sumNeg, ...pos.map(r => r.valor * nParc(r)));
    first.cardTotal = est; first.first = true;
    const ref = pos.find(r => r.vendas && r.vendas.length);
    if (!ref || !S.byVenda) return;
    const sys = ref.vendas.reduce((a, v) => a + ((S.byVenda.get(v) || {}).total || 0), 0);
    if (!(sys > 0)) return;
    first.sysTotal = sys; first.diff = est - sys;
    const nv = ref.vendas.length > 1 ? ' (soma de ' + ref.vendas.length + ' vendas com esse localizador)' : '';
    if (Math.abs(first.diff) <= TOL) first.nota += ' · Valor confere' + nv;
    else if (first.diff < 0) first.nota += ' · Cartão menor que a venda em R$ ' + fmtBR(-first.diff) + ' (resto por outra forma de pagamento?)' + nv;
    else if (first.status === 'ok') { first.status = 'div'; first.nota += ' · Cartão MAIOR que a venda em R$ ' + fmtBR(first.diff) + nv; }
    else first.nota += ' · Cartão maior que a venda em R$ ' + fmtBR(first.diff) + nv;
  });
}
function fmtBR(n) { return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

/* ===== Datas ===== */
const MON = { JAN: 0, FEV: 1, MAR: 2, ABR: 3, MAI: 4, JUN: 5, JUL: 6, AGO: 7, SET: 8, OUT: 9, NOV: 10, DEZ: 11 };
const DAY = 864e5;
function saleDate(s) { const m = (s.data || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null; }
/* Data provável da compra: Itaú mostra a data original; Nubank mostra a data da parcela (volta n−1 meses). */
function cardDate(r, ref) {
  let d, m, x;
  if ((x = r.data.match(/^(\d{2})\/(\d{2})\/(\d{2,4})$/))) { const a = +x[3] < 100 ? 2000 + +x[3] : +x[3]; return new Date(a, +x[2] - 1, +x[1]); }
  if ((x = r.data.match(/^(\d{2})\/(\d{2})$/))) { d = +x[1]; m = +x[2] - 1; }
  else if ((x = r.data.match(/^(\d{2}) (\w{3})/))) { d = +x[1]; m = MON[x[2].toUpperCase()]; }
  else return null;
  let dt = new Date(ref.getFullYear(), m, d);
  if (dt > new Date(ref.getTime() + 2 * DAY)) dt = new Date(ref.getFullYear() - 1, m, d);
  if (r.cartao === 'Nubank' && r.parcela) { const n = +r.parcela.split('/')[0]; dt = new Date(dt.getFullYear(), dt.getMonth() - (n - 1), dt.getDate()); }
  return dt;
}
const normK = t => (t || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const famOf = r => r.desc.toUpperCase().replace(r.code || '\u0000', '').replace(/[^A-Z]/g, '');

/* ===== Sem localizador: liga por fornecedor + data + valor (parcelas × valor) ===== */
const ALIAS = [[/\bTAP\b/i, ['TP']], [/\bLATAM\b/i, ['LA', 'JJ', 'TAM']], [/^TAM\b/i, ['TAM', 'JJ', 'LA']], [/\bGOL\b|TKT\s*AEREO/i, ['G3']], [/\bAZUL\b/i, ['AD', 'AZULVI AGEN']]];

function subsetExato(c, alvo, maxK) {
  const t = Math.round(alvo * 100), v = c.map(s => Math.round(s.total * 100)), out = [];
  (function rec(i, k, sum, pick) {
    if (out.length) return;
    if (sum === t || (k > 0 && Math.abs(sum - t) <= 10)) { if (k >= 2) out.push(pick.slice()); return; }
    if (sum > t + 10 || k >= maxK) return;
    for (let j = i; j < c.length; j++) { pick.push(c[j]); rec(j + 1, k + 1, sum + v[j], pick); pick.pop(); }
  })(0, 0, 0, []);
  return out[0] || null;
}

function sugerir(rows, S, ref) {
  if (!S.byVenda) return;
  ref = ref || new Date();
  const linked = new Set();
  const learned = new Map();                      // família do descritivo -> fornecedor (aprendido nas ligações por localizador)
  rows.forEach(r => {
    if ((r.status === 'ok' || r.status === 'prov' || r.status === 'div') && r.vendas && r.vendas.length && r.code) {
      r.vendas.forEach(v => linked.add(v));
      const f = (S.byVenda.get(r.vendas[0]) || {}).forn; if (!f) return;
      const k = famOf(r); if (!learned.has(k)) learned.set(k, new Map());
      learned.get(k).set(f, (learned.get(k).get(f) || 0) + 1);
    }
  });
  rows.forEach(r => {
    if (r.status !== 'semcod' || !(r.valor > 0)) return;
    const est = r.valor * nParc(r); r.estTotal = est;
    const cd = cardDate(r, ref);
    const N = r.desc.toUpperCase().replace(/[^A-Z]/g, '');
    const alias = []; ALIAS.forEach(([rx, a]) => { if (rx.test(r.desc)) alias.push(...a); });
    const fam = learned.get(famOf(r)); const fornApr = fam ? [...fam.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]) : [];
    const compat = s => {
      const F = normK(s.forn);
      if (fornApr.includes(s.forn)) return 'aprendido';
      if (F.length >= 5 && N.length >= 5 && (N.startsWith(F) || F.startsWith(N.slice(0, 5)))) return 'nome';
      if (alias.includes(s.cia)) return 'alias';
      return null;
    };
    const base = S.sales.filter(s => s.total > 0).map(s => ({ s, dt: saleDate(s), c: compat(s) }));
    const inWin = (x, a, b) => !cd || !x.dt || (x.dt - cd >= -a * DAY && x.dt - cd <= b * DAY);
    const sup = base.filter(x => x.c);
    const fmtC = x => 'venda ' + x.s.venda + ' (' + x.s.data.slice(0, 5) + ', ' + x.s.forn + ') R$ ' + fmtBR(x.s.total);
    const ligar = (vs, motivo) => {
      r.status = 'prov'; r.vendas = vs.map(x => x.s.venda); r.sysTotal = vs.reduce((a, x) => a + x.s.total, 0);
      r.cardTotal = est; r.diff = est - r.sysTotal; r.first = true;
      r.nota = motivo + ' · estimado R$ ' + fmtBR(est) + (nParc(r) > 1 ? ' (' + fmtBR(r.valor) + ' × ' + nParc(r) + ')' : '');
    };
    // 1) fornecedor compatível + data próxima + valor exato
    let ex = sup.filter(x => inWin(x, 4, 4) && Math.abs(x.s.total - est) <= TOL).sort((a, b) => Math.abs(a.s.total - est) - Math.abs(b.s.total - est));
    if (ex.length === 1) { ligar(ex, 'Sem localizador: ' + fmtC(ex[0]) + ' tem o mesmo valor e data, e o fornecedor combina'); return; }
    // 2) soma de 2 a 4 vendas do fornecedor em janela de datas
    const win = sup.filter(x => inWin(x, 10, 3));
    if (win.length >= 2 && win.length <= 60) {
      const ss = subsetExato(win.map(x => Object.assign({}, x.s)), est, 4);
      if (ss) { ligar(ss.map(s => ({ s })), 'Sem localizador: soma das vendas ' + ss.map(s => s.venda).join(' + ') + ' (' + ss[0].forn + ') = valor estimado'); return; }
    }
    // 3) sem fornecedor identificado: valor exato + data próxima, único
    if (!sup.length) {
      ex = base.filter(x => x.dt && cd && inWin(x, 4, 4) && Math.abs(x.s.total - est) <= TOL);
      if (ex.length === 1) { ligar(ex, 'Sem localizador: ' + fmtC(ex[0]) + ' tem o mesmo valor e data (fornecedor não identificado)'); return; }
    }
    // 4) sugestões
    const pool = (sup.length ? sup : base).filter(x => x.dt && cd ? inWin(x, 7, 4) : true)
      .map(x => ({ x, dif: x.s.total - est })).filter(o => Math.abs(o.dif) / est <= (sup.length ? 0.25 : 0.05))
      .sort((a, b) => Math.abs(a.dif) - Math.abs(b.dif)).slice(0, 3);
    r.cands = pool;
    if (pool.length) {
      r.nota = (sup.length ? 'Sugestões do fornecedor ' + pool[0].x.s.forn : 'Sugestões por data e valor (fornecedor desconhecido)') + ' (estimado R$ ' + fmtBR(est) + '): ' +
        pool.map(o => 'venda ' + o.x.s.venda + ' ' + o.x.s.data.slice(0, 5) + ' R$ ' + fmtBR(o.x.s.total) + ' (dif. ' + (o.dif >= 0 ? '+' : '−') + fmtBR(Math.abs(o.dif)) + ')').join('; ');
      r.vendas = pool.map(o => o.x.s.venda);
    } else r.nota += ' · Nenhuma venda compatível em fornecedor, data e valor (estimado R$ ' + fmtBR(est) + ')';
  });
}

/* ===== Alternativa: localizador bate, mas outra venda tem valor e data exatos (ex.: bagagem lançada à parte) ===== */
function alternativas(rows, S, ref) {
  if (!S.byVenda) return;
  ref = ref || new Date();
  rows.forEach(r => {
    if (!r.first || r.diff == null || Math.abs(r.diff) <= TOL || !r.vendas || !r.code) return;
    const cd = cardDate(r, ref); if (!cd) return;
    const est = r.cardTotal;
    const alt = S.sales.filter(s => s.total > 0 && !r.vendas.includes(s.venda) && Math.abs(s.total - est) <= TOL && saleDate(s) && Math.abs(saleDate(s) - cd) <= 4 * DAY);
    if (alt.length === 1) { r.alt = alt[0]; r.nota += ' · Outra venda tem valor e data exatos: ' + alt[0].venda + ' (' + alt[0].cia + ' ' + alt[0].loc + ', ' + alt[0].data.slice(0, 5) + ', R$ ' + fmtBR(alt[0].total) + ')'; }
  });
}


/* ===== src/leitor-pdf.js ===== */
/**
 * Lê um PDF (com ou sem senha) e devolve as páginas no formato que o núcleo espera:
 *   [{ width, items: [{ str, x, y, w }] }]
 *
 * Recebe o pdfjs já carregado, para funcionar em qualquer projeto (navegador ou Node):
 *   navegador: import * as pdfjs from 'pdfjs-dist'   (versão testada: 3.11.174)
 *   Node:      import pdfjs from 'pdfjs-dist/legacy/build/pdf.js'
 */
function criarLeitor(pdfjs) {
  async function abrir(dados, senha) {
    const data = new Uint8Array(dados); // cópia: o pdf.js não aceita Buffer do Node e transfere o buffer original
    try {
      const doc = await pdfjs.getDocument({ data, password: senha || undefined }).promise;
      const pages = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const p = await doc.getPage(i);
        const vp = p.getViewport({ scale: 1 });
        const tc = await p.getTextContent();
        pages.push({ width: vp.width, items: tc.items.map(t => ({ str: t.str, x: t.transform[4], y: t.transform[5], w: t.width })) });
      }
      return { ok: true, pages, numPages: doc.numPages };
    } catch (e) {
      // PasswordException: code 1 = precisa de senha, code 2 = senha incorreta
      if (e && e.name === 'PasswordException') return { ok: false, motivo: e.code === 2 ? 'senha_incorreta' : 'precisa_senha' };
      return { ok: false, motivo: 'erro', mensagem: (e && e.message) || String(e) };
    }
  }
  return { abrir };
}

/* ===== src/index.js ===== */


const SITUACOES = {
  ok: 'Conferido', div: 'Cartão maior que a venda', prov: 'Provável', nf: 'Não encontrado',
  semcod: 'Sem localizador', estorn: 'Estornado', ign: 'Não é viagem'
};

/**
 * Processa a conferência.
 * @param {{ faturas: {nome:string, pages:any[]}[], vendasPages:any[], palavrasViagem?:string, hoje?:Date }} o
 * @returns {{ linhas: object[], indice: object }}
 *   cada linha: { cartao, arquivo, data, desc, parcela, valor, status, code, vendas[], nota,
 *                 first, cardTotal, sysTotal, diff }
 */
function processarConferencia({ faturas, vendasPages, palavrasViagem = DEFAULT_KW, hoje = new Date() }) {
  const vendas = parseSistema2(vendasPages).sales;
  const S = vendas.length > 10 ? buildIndex(vendas) : Object.assign(parseSistema(vendasPages), { hasTotals: false });
  const kwRx = buildKwRegex(palavrasViagem);
  const linhas = [], infos = [];
  for (const f of faturas) {
    const banco = detectBank(f.pages);
    let itens;
    if (banco === 'Nubank') itens = parseNubank(f.pages);
    else if (banco === 'Itaú') itens = parseItau(f.pages);
    else if (LAYOUTS[banco]) itens = parseLayout(f.pages, LAYOUTS[banco]);
    else { const a = parseNubank(f.pages), b = parseItau(f.pages); itens = a.length >= b.length ? a : b; }
    for (const r of itens) { const c = conferir(r, S, kwRx); c.cartao = banco; c.arquivo = f.nome; linhas.push(c); }
    infos.push(Object.assign({ nome: f.nome, cartao: banco }, totaisDoPdf(f.pages, banco)));
  }
  consolidar(linhas, S); sugerir(linhas, S, hoje); alternativas(linhas, S, hoje);
  linhas.forEach(r => { r.categoria = categorizar(r); });
  return { linhas, indice: S, faturas: resumoFaturas(linhas, infos) };
}

/* ===== Fatura na íntegra: categoria de cada lançamento e resumo por fatura ===== */
const CATEGORIAS = {
  viagem: 'Compra de viagem', outras: 'Outras compras', juros: 'Juros e encargos', multa: 'Multas',
  iof: 'IOF', tarifa: 'Anuidade, tarifas e seguros', parcfat: 'Parcelamento de fatura',
  pagamento: 'Pagamentos', credito: 'Estornos e créditos'
};
const CAT_ORDEM = ['viagem', 'outras', 'juros', 'multa', 'iof', 'tarifa', 'parcfat', 'pagamento', 'credito'];
function categorizar(r) {
  const d = r.desc;
  if (r.valor < 0) return /pag(amento|to)?\b|inclus[aã]o/i.test(d) ? 'pagamento' : 'credito';
  if (r.status === 'estorn') return 'viagem';
  if (/\bIOF\b/i.test(d)) return 'iof';
  if (/multa/i.test(d)) return 'multa';
  if (/juros|encargo|rotativo|refinanciamento|mora\b/i.test(d)) return 'juros';
  if (r.status !== 'ign') return 'viagem';
  if (/parcelamento de fatura|fatura parcelada|financiam\w*\s+fat/i.test(d)) return 'parcfat';
  if (/anuidade|tarifa|seguro|prote[cç][aã]o|\bSMS\b|\bUCC\b|avalia[cç][aã]o emerg|ressarcimento de (despesa|cobran)/i.test(d)) return 'tarifa';
  return 'outras';
}
const TOTAIS_EXTRA = {
  'Nubank': { total: /fatura de \S+,? no valor de\s*R\$\s*(-?\d{1,3}(?:\.\d{3})*,\d{2})/i },
  'Itaú':   { total: /Total desta fatura\s*(-?\d{1,3}(?:\.\d{3})*,\d{2})/i, anterior: /Total da fatura anterior\s*(-?\d{1,3}(?:\.\d{3})*,\d{2})/i }
};
function totaisDoPdf(pages, banco) {
  const L = LAYOUTS[banco] || TOTAIS_EXTRA[banco] || {};
  const t = pages.map(p => p.items.map(i => i.str).join(' ')).join(' ').replace(/\s+/g, ' ');
  const V = '(-?\\d{1,3}(?:\\.\\d{3})*,\\d{2})';
  const tot = L.total || new RegExp('(?:Total a pagar|Total da (?:sua )?fatura|Valor da fatura)\\s*:?\\s*(?:R\\$\\s*)?' + V, 'i');
  const ant = L.anterior === null ? null : (L.anterior || new RegExp('(?:Saldo anterior|Fatura anterior|Saldo da fatura anterior)\\s*:?\\s*(?:R\\$\\s*)?' + V, 'i'));
  const mt = t.match(tot), ma = ant ? t.match(ant) : null;
  return { totalPdf: mt ? brNum(mt[1]) : null, anteriorPdf: ma ? brNum(ma[1]) : null };
}
/* ===== Projeção de parcelas futuras (só compras da agência) =====
   Cada fatura importada guarda as compras parceladas que ainda têm parcelas a vencer. A projeção usa só a fatura mais
   recente de cada cartão: ela já lista todas as parcelas em andamento, então nada é contado duas vezes.
   Compra da agência = categoria "Compra de viagem" (localizador ou fornecedor de viagem) ou marcada como Agência.
   A marcação vale pelo estabelecimento (chaveEstab) e é reaproveitada nas próximas faturas. */
const MES_N = { JAN: 1, FEV: 2, MAR: 3, ABR: 4, MAI: 5, JUN: 6, JUL: 7, AGO: 8, SET: 9, OUT: 10, NOV: 11, DEZ: 12 };
const p2 = n => String(n).padStart(2, '0');
/** Vencimento (aaaa-mm-dd), final do cartão e primeiro nome do titular (só quando não há final), lidos do PDF. */
function metaFatura(pages, banco, hoje) {
  hoje = hoje || new Date();
  const t = pages.slice(0, 4).map(p => p.items.map(i => i.str).join(' ')).join(' ').replace(/\s+/g, ' ');
  let venc = null, m;
  if ((m = t.match(/(?:Vencimento|Vence em|Data de vencimento)\s*:?\s*(\d{2})\/(\d{2})\/(\d{4})/i))) venc = m[3] + '-' + m[2] + '-' + m[1];
  else if ((m = t.match(new RegExp('vencimento\\s*:?\\s*(\\d{1,2})\\s+(?:de\\s+)?(' + MESES + ')[a-zç]*\\.?\\s+(?:de\\s+)?(\\d{4})', 'i'))))
    venc = m[3] + '-' + p2(MES_N[m[2].toUpperCase()]) + '-' + p2(m[1]);
  else if ((m = t.match(new RegExp('vencimento\\s*:?\\s*(\\d{1,2})\\s+(?:de\\s+)?(' + MESES + ')', 'i')))) {
    // Sem ano (ex.: "Vencimento: 25 SET"): o ano mais próximo de hoje.
    const mes = MES_N[m[2].toUpperCase()], hm = hoje.getMonth() + 1; let y = hoje.getFullYear();
    if (mes - hm > 6) y--; else if (hm - mes > 6) y++;
    venc = y + '-' + p2(mes) + '-' + p2(m[1]);
  }
  let final = null, titular = null;
  if ((m = t.match(/final\s+(\d{4})\b/i)) || (m = t.match(/(?:[X*]{4}[.\s]?)+\]?\s*(\d{4})\b/))) final = m[1];
  if (!final && (m = t.match(/Ol[áa],?\s+([A-ZÀ-Ý][A-Za-zÀ-ÿ]+)/))) titular = m[1].charAt(0) + m[1].slice(1).toLowerCase();
  const apelido = banco + (final ? ' final ' + final : titular ? ' ' + titular : '');
  return { vencimento: venc, final, titular, apelido };
}
/** Chave do estabelecimento: duas primeiras palavras sem números (tira parcela, localizador e códigos). */
function chaveEstab(desc) {
  const u = String(desc || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    .replace(/\s*-?\s*PARCELA\s+\d+\s*(?:\/|DE)\s*\d+.*$/, '').replace(/\b\d{1,2}\/\d{1,2}\b/g, ' ');
  const ws = u.split(/[^A-Z0-9]+/).filter(w => w.length >= 2 && !/\d/.test(w));
  return ws.slice(0, 2).join(' ') || u.replace(/[^A-Z0-9]+/g, ' ').trim().slice(0, 24) || '?';
}
const CAT_FORA_PROJ = ['juros', 'multa', 'iof', 'tarifa', 'parcfat', 'pagamento', 'credito'];
/** Compras parceladas de uma fatura que ainda têm parcelas a vencer.
 *  Quando a mesma compra aparece com várias parcelas na mesma fatura (antecipação), vale a maior. */
function parcelasDaFatura(linhas) {
  const grupos = new Map();
  linhas.forEach(r => {
    const m = r.parcela && String(r.parcela).match(/(\d+)\s*\/\s*(\d+)/);
    if (!m || !(r.valor > 0) || CAT_FORA_PROJ.includes(r.categoria)) return;
    const n = +m[1], N = +m[2]; if (!(N > 1 && n >= 1 && n <= N)) return;
    const k = [r.desc, r.valor.toFixed(2), N, r.data].join('|'), g = grupos.get(k);
    if (!g || n > g.n) grupos.set(k, { desc: r.desc, data: r.data || '', n, N, valor: Math.round(r.valor * 100) / 100,
      viagem: r.categoria === 'viagem', chave: chaveEstab(r.desc), code: r.code || '' });
  });
  return [...grupos.values()].filter(g => g.n < g.N);
}
/** Soma das compras da agência (viagem ou marcada como Agência) na própria fatura, para a coluna "Fatura atual". */
function agenciaNaFatura(linhas, regras) {
  regras = regras || {};
  return Math.round(linhas.reduce((a, r) => {
    if (CAT_FORA_PROJ.includes(r.categoria) && r.categoria !== 'credito') return a;
    const reg = regras[chaveEstab(r.desc)];
    const ag = reg ? reg === 'agencia' : r.categoria === 'viagem' || (r.categoria === 'credito' && r.status === 'estorn');
    return ag ? a + r.valor : a;
  }, 0) * 100) / 100;
}
function somaMes(iso, k) { const y = +iso.slice(0, 4), m = +iso.slice(5, 7) - 1 + k; return (y + Math.floor(m / 12)) + '-' + p2(m % 12 + 1); }
/**
 * Projeção: registros = [{id, apelido, vencimento:'aaaa-mm-dd', itens:[parcelasDaFatura], agenciaAtual}], regras = {chave:'agencia'|'pessoal'}.
 * Volta {meses:['aaaa-mm'], cartoes:[{apelido, vencimento, porMes, total, agenciaAtual}], porMes, total, itens, pendentes, pessoais}.
 */
function projetar(registros, regras) {
  regras = regras || {};
  const ultimo = new Map();
  (registros || []).forEach(r => { if (!r || !r.vencimento) return; const u = ultimo.get(r.apelido); if (!u || r.vencimento > u.vencimento) ultimo.set(r.apelido, r); });
  const meses = new Set(), cartoes = [], itens = [], pendentes = [], pessoais = [];
  [...ultimo.values()].sort((a, b) => a.apelido.localeCompare(b.apelido)).forEach(r => {
    const c = { apelido: r.apelido, vencimento: r.vencimento, porMes: {}, total: 0, agenciaAtual: r.agenciaAtual || 0, registro: r.id };
    (r.itens || []).forEach(it => {
      const reg = regras[it.chave];
      const rest = it.N - it.n, base = Object.assign({}, it, { cartao: r.apelido, restantes: rest, totalRestante: Math.round(rest * it.valor * 100) / 100,
        ultimaEm: somaMes(r.vencimento, rest), regra: reg || '' });
      const ag = reg ? reg === 'agencia' : it.viagem ? true : null;
      if (ag === null) { pendentes.push(base); return; }
      if (!ag) { pessoais.push(base); return; }
      itens.push(base);
      for (let k = 1; k <= rest; k++) { const mes = somaMes(r.vencimento, k); meses.add(mes); c.porMes[mes] = Math.round(((c.porMes[mes] || 0) + it.valor) * 100) / 100; c.total += it.valor; }
    });
    c.total = Math.round(c.total * 100) / 100;
    cartoes.push(c);
  });
  const ms = [...meses].sort(), porMes = {};
  ms.forEach(m => { porMes[m] = Math.round(cartoes.reduce((a, c) => a + (c.porMes[m] || 0), 0) * 100) / 100; });
  itens.sort((a, b) => a.ultimaEm.localeCompare(b.ultimaEm) || b.totalRestante - a.totalRestante);
  return { meses: ms, cartoes, porMes, total: Math.round(cartoes.reduce((a, c) => a + c.total, 0) * 100) / 100, itens, pendentes, pessoais };
}
function resumoFaturas(linhas, infos) {
  return infos.map(f => {
    const ls = linhas.filter(r => r.arquivo === f.nome);
    const cat = {}; CAT_ORDEM.forEach(k => { cat[k] = 0; });
    ls.forEach(r => { cat[r.categoria] += r.valor; });
    const soma = ls.reduce((a, r) => a + r.valor, 0);
    // anterior + lançamentos = total da fatura → todos os lançamentos foram lidos
    const dif = f.totalPdf != null && f.anteriorPdf != null ? Math.round((f.anteriorPdf + soma - f.totalPdf) * 100) / 100 : null;
    return Object.assign({}, f, { lancamentos: ls.length, soma, cat, difLeitura: dif,
      leitura: dif == null ? 'Não verificada' : Math.abs(dif) < 0.05 ? 'Completa' : 'Diferença de R$ ' + fmtBR(dif) });
  });
}

/** Filial(is) e rótulo das vendas ligadas a uma linha. */
function infoVenda(linha, indice) {
  const vs = linha.vendas || [];
  const filiais = [...new Set(vs.map(v => indice.byVenda && indice.byVenda.get(v)).filter(Boolean).map(s => s.filial))];
  return { vendas: vs, filial: filiais.join(', ') };
}

/** Matriz pronta para planilha (Excel/CSV), com todas as linhas da fatura. ncPorArquivo: { 'nome.pdf': '101' } */
function linhasParaPlanilha(linhas, indice, ncPorArquivo = {}, situacoes = ['ok', 'div', 'prov', 'nf', 'semcod', 'estorn', 'ign']) {
  const cab = ['NC', 'Cartão', 'Arquivo', 'Data', 'Descrição', 'Parcela', 'Valor', 'Categoria', 'Total no cartão (est.)', 'Total da venda', 'Diferença', 'Situação', 'Venda nº', 'Filial', 'Observação'];
  const out = [cab];
  for (const r of linhas.filter(x => situacoes.includes(x.status))) {
    out.push([ncPorArquivo[r.arquivo] || '', r.cartao, r.arquivo, r.data, r.desc, r.parcela || '', r.valor, CATEGORIAS[r.categoria] || '',
      r.first ? (r.cardTotal || r.estTotal || null) : null, r.first && r.sysTotal ? r.sysTotal : null, r.diff == null ? null : r.diff,
      SITUACOES[r.status], (r.vendas || []).join(' / '), infoVenda(r, indice).filial, r.nota]);
  }
  return out;
}

/** Matriz do resumo por fatura (aba "Resumo por cartão" do Excel). */
function resumoParaPlanilha(faturas, ncPorArquivo = {}) {
  const cab = ['NC', 'Cartão', 'Arquivo', 'Total da fatura (PDF)', 'Fatura anterior (PDF)'].concat(CAT_ORDEM.map(k => CATEGORIAS[k]), ['Juros + multas + IOF', 'Leitura']);
  const out = [cab];
  const tot = CAT_ORDEM.map(() => 0); let jm = 0, tf = 0;
  for (const f of faturas) {
    const enc = f.cat.juros + f.cat.multa + f.cat.iof; jm += enc; tf += f.totalPdf || 0;
    CAT_ORDEM.forEach((k, i) => { tot[i] += f.cat[k]; });
    out.push([ncPorArquivo[f.nome] || '', f.cartao, f.nome, f.totalPdf, f.anteriorPdf].concat(CAT_ORDEM.map(k => f.cat[k]), [enc, f.leitura]));
  }
  if (faturas.length > 1) out.push(['', 'Total', '', tf, null].concat(tot, [jm, '']));
  return out;
}

window.ConfCartao = { metaFatura, chaveEstab, parcelasDaFatura, agenciaNaFatura, projetar, somaMes, criarLeitor, detectBank, processarConferencia, linhasParaPlanilha, resumoParaPlanilha, infoVenda, SITUACOES, CATEGORIAS, CAT_ORDEM, DEFAULT_KW, fmtBR };
})();
