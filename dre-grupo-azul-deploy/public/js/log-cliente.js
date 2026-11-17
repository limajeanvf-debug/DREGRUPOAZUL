// Envia ao servidor os erros que acontecem no navegador (aparecem nos logs do Render como "erro no navegador").
// Limite de 10 envios por página e sem repetir a mesma mensagem.
(function(){
  var enviados = 0, vistos = {};
  function usuario(){ try { var s = JSON.parse(localStorage.getItem("dreAzul_session_v1")||"null"); return (s && (s.email||s.user&&s.user.email)) || ""; } catch(e){ return ""; } }
  window.logCliente = function(tipo, mensagem, extra){
    try {
      var chave = tipo + "|" + mensagem;
      if (enviados >= 10 || vistos[chave] || typeof API_BASE_URL === "undefined") return;
      vistos[chave] = 1; enviados++;
      var corpo = Object.assign({ tipo: tipo, mensagem: String(mensagem).slice(0,300), tela: location.pathname + location.hash, usuario: usuario() }, extra||{});
      fetch(API_BASE_URL + "/api/logs/cliente", { method: "POST", keepalive: true, headers: { "Content-Type": "text/plain" }, body: JSON.stringify(corpo) }).catch(function(){});
    } catch(e){}
  };
  window.addEventListener("error", function(e){
    if (!e.message) return; // recurso (imagem/fonte) que não carregou
    window.logCliente("erro", e.message, { origem: e.filename, linha: e.lineno, stack: e.error && e.error.stack && String(e.error.stack).slice(0,2000) });
  });
  window.addEventListener("unhandledrejection", function(e){
    var r = e.reason || {}; var m = r.message || String(r);
    if (/^api_401$/.test(m)) return; // sessão expirada já é tratada na tela
    window.logCliente("promise", m, { stack: r.stack && String(r.stack).slice(0,2000), apiRef: r.ref });
  });
})();
