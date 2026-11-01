-- DRE Grupo Azul — atualização do banco (rodar no DBeaver, pode repetir sem risco)

-- Permissões por aba
ALTER TABLE dre.usuarios ADD COLUMN IF NOT EXISTS permissoes JSONB;

-- Credores manuais / categorias
ALTER TABLE dre.credores_manuais ADD COLUMN IF NOT EXISTS grupo TEXT NOT NULL DEFAULT 'passivo';
INSERT INTO dre.categorias (tipo_categoria, codigo, nome, aplica_tipo, ordem)
SELECT 'ocupacao','ocu_internet','Internet',NULL,58 WHERE NOT EXISTS (SELECT 1 FROM dre.categorias WHERE codigo='ocu_internet');
INSERT INTO dre.categorias (tipo_categoria, codigo, nome, aplica_tipo, ordem)
SELECT 'outras_despesas','out_publicidade','Publicidade','arranjos',150 WHERE NOT EXISTS (SELECT 1 FROM dre.categorias WHERE codigo='out_publicidade');
INSERT INTO dre.categorias (tipo_categoria, codigo, nome, aplica_tipo, ordem)
SELECT 'outras_despesas','out_royalties','Royalties','arranjos',151 WHERE NOT EXISTS (SELECT 1 FROM dre.categorias WHERE codigo='out_royalties');

-- Faturas
CREATE TABLE IF NOT EXISTS dre.fatura_tipos (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE,
  ativo BOOLEAN NOT NULL DEFAULT true,
  ordem INT NOT NULL DEFAULT 100
);
CREATE TABLE IF NOT EXISTS dre.faturas (
  id SERIAL PRIMARY KEY,
  descricao TEXT NOT NULL,
  tipo_nome TEXT NOT NULL DEFAULT '',
  competencia DATE NOT NULL,
  vencimento DATE,
  valor NUMERIC(14,2) NOT NULL DEFAULT 0,
  movimento TEXT NOT NULL DEFAULT 'pagar' CHECK (movimento IN ('pagar','receber')),
  conferida BOOLEAN NOT NULL DEFAULT false,
  conferida_por INT REFERENCES dre.usuarios(id),
  conferida_email TEXT,
  conferida_em TIMESTAMPTZ,
  criado_por INT REFERENCES dre.usuarios(id),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE dre.faturas ADD COLUMN IF NOT EXISTS responsavel TEXT;
ALTER TABLE dre.faturas ADD COLUMN IF NOT EXISTS recebido BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE dre.faturas ADD COLUMN IF NOT EXISTS recebido_email TEXT;
ALTER TABLE dre.faturas ADD COLUMN IF NOT EXISTS recebido_em TIMESTAMPTZ;
ALTER TABLE dre.faturas ADD COLUMN IF NOT EXISTS recebido_banco TEXT;
CREATE TABLE IF NOT EXISTS dre.bancos (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE,
  ativo BOOLEAN NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS idx_faturas_comp ON dre.faturas (competencia, tipo_nome, movimento);
INSERT INTO dre.fatura_tipos (nome, ordem) VALUES
  ('Cartão',10),('Azul',20),('Azul Viagens',30),('Gol',40),('Latam',50),('Consolidadora',60)
ON CONFLICT (nome) DO NOTHING;

-- Responsáveis e cartões
CREATE TABLE IF NOT EXISTS dre.responsaveis (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE,
  ativo BOOLEAN NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS dre.cartoes (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  dia_venc INT NOT NULL CHECK (dia_venc BETWEEN 1 AND 31),
  valor_previsto NUMERIC(14,2) NOT NULL DEFAULT 0,
  inicio DATE NOT NULL,
  fim DATE,
  criado_por INT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dre.cartao_checks (
  id SERIAL PRIMARY KEY,
  cartao_id INT NOT NULL REFERENCES dre.cartoes(id) ON DELETE CASCADE,
  competencia DATE NOT NULL,
  vencimento DATE,
  valor NUMERIC(14,2) NOT NULL DEFAULT 0,
  conferido BOOLEAN NOT NULL DEFAULT false,
  conferido_email TEXT,
  conferido_em TIMESTAMPTZ,
  removido BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (cartao_id, competencia)
);

-- Faturas administrativas
CREATE TABLE IF NOT EXISTS dre.faturas_adm_tipos (
  nome TEXT PRIMARY KEY,
  ativo BOOLEAN NOT NULL DEFAULT true,
  ordem INT NOT NULL DEFAULT 100
);
INSERT INTO dre.faturas_adm_tipos (nome, ordem) VALUES
  ('Aluguel',10),('Energia',20),('Água',30),('Internet',40),('Telefone',50),
  ('Contabilidade',60),('Impostos',70),('Manutenção',80),('Outros',90)
ON CONFLICT (nome) DO NOTHING;
CREATE TABLE IF NOT EXISTS dre.faturas_adm (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT '',
  loja TEXT NOT NULL DEFAULT '',
  vencimento DATE,
  valor NUMERIC(14,2) NOT NULL DEFAULT 0,
  pago BOOLEAN NOT NULL DEFAULT false,
  pago_email TEXT,
  pago_em TIMESTAMPTZ,
  criado_por INT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Help desk
CREATE TABLE IF NOT EXISTS dre.hd_chamados (
  id SERIAL PRIMARY KEY, titulo TEXT NOT NULL, categoria TEXT NOT NULL DEFAULT 'Outros',
  prioridade TEXT NOT NULL DEFAULT 'Média', loja TEXT NOT NULL DEFAULT '', descricao TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Novo', solicitante_id INT, solicitante_email TEXT NOT NULL,
  responsavel_email TEXT, criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(), resolvido_em TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS dre.hd_mensagens (
  id SERIAL PRIMARY KEY, chamado_id INT NOT NULL REFERENCES dre.hd_chamados(id) ON DELETE CASCADE,
  autor_email TEXT NOT NULL, texto TEXT NOT NULL, interno BOOLEAN NOT NULL DEFAULT false,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RH
CREATE TABLE IF NOT EXISTS dre.rh_colaboradores (
  id SERIAL PRIMARY KEY, nome TEXT NOT NULL, cargo TEXT NOT NULL DEFAULT '', loja TEXT NOT NULL DEFAULT '',
  admissao DATE, salario NUMERIC(14,2) NOT NULL DEFAULT 0, telefone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
  ativo BOOLEAN NOT NULL DEFAULT true, desligamento DATE, criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dre.rh_ausencias (
  id SERIAL PRIMARY KEY, colaborador_id INT NOT NULL REFERENCES dre.rh_colaboradores(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL, inicio DATE NOT NULL, fim DATE NOT NULL, obs TEXT NOT NULL DEFAULT '',
  criado_por TEXT, criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Conferência
SELECT column_name FROM information_schema.columns
WHERE table_schema='dre' AND table_name='usuarios' AND column_name='permissoes';
SELECT table_name FROM information_schema.tables WHERE table_schema='dre' AND table_name IN ('hd_chamados','hd_mensagens','rh_colaboradores','rh_ausencias');
