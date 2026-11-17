# Help Desk — Azul Viagens Shopping Recife (módulo integrado)

Sistema de chamados em **Node.js + PostgreSQL** feito para ser **anexado ao sistema principal** da agência.
O help desk **não tem tela de login nem senhas**: quem diz quem está logado é o sistema principal.

Tudo o mais continua igual: chamados com localizador aéreo/pacote, prints, prazos (SLA), conversa entre agente e help desk, relatório por loja, categorias, perfis Agente / Help desk / Administrador (com visão lado a lado), admin fixo e e-mails automáticos.

---

## 1. Requisitos

- Sistema principal em **Node.js 18+** usando **Express 4 ou 5**.
- **PostgreSQL 12+** (pode ser o mesmo banco do sistema principal: as tabelas do help desk ficam no schema `helpdesk`, sem conflito com tabelas de mesmo nome como `usuarios`).

## 2. Instalação

1. Copie a pasta `helpdesk-azul` para dentro do projeto (ex.: `modulos/helpdesk-azul`).
2. Instale as dependências do módulo:
   ```bash
   cd modulos/helpdesk-azul
   npm install --omit=dev
   ```
3. Crie o arquivo `.env` a partir de `.env.example` (ou passe as configurações direto no código, seção 3).
4. Crie o schema e as tabelas:
   ```bash
   npm run db:criar
   ```
5. Importe os dados atuais (usuários, chamados, mensagens, prints, categorias e configurações):
   ```bash
   npm run importar
   ```
   Depois de conferir, **apague a pasta `dados-importacao`**.

## 3. Montar no sistema principal

No arquivo onde o Express do sistema principal é configurado, **depois** do middleware de login/sessão:

```js
const criarHelpdesk = require('./modulos/helpdesk-azul');

app.use('/helpdesk', criarHelpdesk({
  // OBRIGATÓRIO: devolve o usuário logado no sistema principal, ou null
  obterUsuario: req => req.user
    ? { id: req.user.id, nome: req.user.nome, email: req.user.email }
    : null,

  urlEntrar: '/login',     // tela de login do sistema principal
  urlSair: '/logout',      // botão "Sair" dentro do help desk
  urlVoltar: '/',          // botão "Voltar ao sistema"
  urlPublica: 'https://sistema.azulviagensrec.com.br/helpdesk', // links dos e-mails
}));
```

O help desk fica em `https://seu-sistema/helpdesk/`. Coloque um link para ele no menu do sistema principal.

### Exemplos de `obterUsuario` conforme o tipo de login

```js
// Passport
obterUsuario: req => req.user && { id: req.user.id, nome: req.user.name, email: req.user.email }

// express-session
obterUsuario: req => req.session.usuario && { id: req.session.usuario.id, nome: req.session.usuario.nome, email: req.session.usuario.email }

// JWT já validado por um middleware que grava em req.auth
obterUsuario: req => req.auth && { id: req.auth.sub, nome: req.auth.name, email: req.auth.email }

// Também pode ser assíncrona (ex.: buscar no banco do sistema principal)
obterUsuario: async req => { const u = await Usuarios.porId(req.session.uid); return u && { id: u.id, nome: u.nome, email: u.email }; }
```

Campos que `obterUsuario` pode devolver:

| Campo | Obrigatório | Uso |
|---|---|---|
| `id` | sim | Identificador do usuário no sistema principal |
| `nome` | recomendado | Nome exibido nos chamados |
| `email` | recomendado | Recebe e-mails automáticos e vincula contas importadas/pré-cadastradas |
| `loja` | não | Se informado, o sistema principal passa a definir a loja |
| `telefone` | não | Se informado, o sistema principal passa a definir o celular |
| `perfil` | não | `'agente'`, `'suporte'` ou `'admin'` (veja seção 4) |

### Todas as opções de `criarHelpdesk`

| Opção | Padrão | Descrição |
|---|---|---|
| `obterUsuario(req)` | — | **Obrigatória.** Quem está logado |
| `perfilPeloSistema` | `false` | `true` quando o perfil vem do sistema principal (a tela de Usuários deixa de permitir trocar perfil) |
| `urlEntrar`, `urlSair`, `urlVoltar` | vazio | Links para o sistema principal |
| `urlPublica` | `APP_URL` do `.env` | Endereço do help desk usado nos e-mails |
| `banco` | `.env` | `{ host, port, user, password, database, schema, ssl }` ou `{ connectionString }` |
| `pastaUploads` | `UPLOAD_DIR` do `.env` | Onde os prints são guardados (fora da pasta pública) |

## 4. Perfis

Há duas formas de definir quem é Agente, Help desk ou Administrador:

- **Pelo próprio help desk (padrão):** todo mundo entra como Agente no primeiro acesso. O administrador muda o perfil em **Usuários**. Também dá para **pré-cadastrar** alguém pelo e-mail, já com perfil e loja, antes do primeiro acesso.
- **Pelo sistema principal:** devolva `perfil` em `obterUsuario` e use `perfilPeloSistema: true`.

O **admin fixo** (Jean Lima) continua administrador em qualquer caso e não pode ser rebaixado, desativado ou excluído. Desativar alguém em **Usuários** bloqueia só o help desk, sem mexer no sistema principal.

Para tornar alguém administrador pelo terminal:
```bash
npm run promover-admin -- email@azulviagensrec.com.br "Nome Completo"
```

### Contas importadas
As contas que já existiam (Jean Lima, Alynne Maria, Manoel Marques) são **vinculadas automaticamente pelo e-mail** no primeiro acesso. Para isso, o e-mail delas no sistema principal precisa ser o mesmo: `adm@azulviagensrec.com.br`, `financeiro@azulviagensrec.com.br` e `helpdesk@sonhoazulviagens.com.br`. Até lá aparecem em Usuários como “aguardando 1º acesso”.

## 5. E-mails automáticos

Com o SMTP preenchido no `.env`, o sistema envia sozinho:

| Quando | Para quem |
|---|---|
| Novo chamado | E-mail do help desk (em *Configurações*) |
| Agente responde | E-mail do help desk |
| Help desk responde | Agente que abriu o chamado |
| Chamado resolvido ou “Aguardando agente” | Agente |
| Agente reabre | Help desk |

WhatsApp e SMS continuam como botões com a mensagem pronta.

## 6. Cuidados na integração

- **Ordem dos middlewares:** monte o help desk depois do middleware que preenche o usuário logado (sessão, Passport, JWT).
- **Content-Security-Policy:** se o sistema principal usa Helmet/CSP, libere `https://fonts.googleapis.com` (style), `https://fonts.gstatic.com` (font) e `data:` / `blob:` (img).
- **Proteção de envio (CSRF):** o módulo recusa POST/PATCH/DELETE vindos de outro domínio. Os cookies de sessão do sistema principal devem continuar `httpOnly` e `sameSite: 'lax'` (ou mais restrito).
- **Permissões checadas no servidor:** agente só vê os próprios chamados e prints; só administrador mexe em usuários, categorias e configurações.

## 7. Testar no computador

O arquivo `exemplo-servidor.js` simula um sistema principal com um login de mentira (escolhe o usuário numa lista):

```bash
npm install          # instala também o express-session usado só no exemplo
npm run db:criar
npm run importar     # opcional
npm run exemplo      # abre em http://localhost:3000
```

## 8. Backup

- Banco: `pg_dump -n helpdesk -U USUARIO -h localhost NOME_DO_BANCO > helpdesk.sql`
- A pasta de uploads (prints).

## 9. Referência da API (montada em `/helpdesk/api`)

| Método | Rota | Quem |
|---|---|---|
| GET | `/sessao` · `/config` | logado no sistema principal |
| GET | `/acesso` | qualquer um (link de login para a tela “sem acesso”) |
| PATCH | `/minha-conta` (celular) | logado |
| GET/POST | `/chamados` | logado (agente vê só os seus) |
| GET | `/chamados/versao` | logado (a tela consulta a cada 10 s) |
| POST | `/chamados/:id/mensagens` · `/chamados/:id/lido` | logado com acesso |
| PATCH | `/chamados/:id` (`status`, `prioridade`, `assumir`, `confirmar`, `reabrir`) | conforme perfil |
| GET | `/anexos/:id` | logado com acesso |
| PUT | `/config` · `/categorias` | admin |
| GET/POST/PATCH/DELETE | `/usuarios` | admin |
