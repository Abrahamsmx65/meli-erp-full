-- Conexión OAuth con el MCP oficial de Higgsfield (mcp.higgsfield.ai).
--
-- El usuario conecta su CUENTA de Higgsfield (la de la suscripción, no la
-- llave de API) con un login en el navegador; aquí viven los tokens. Con
-- offline_access el refresh token mantiene la conexión sin volver a entrar.
-- Por ahí el ERP usa el Marketing Studio: productos anclados a fotos
-- reales, avatares y video UGC con Seedance — lo que la llave de API no da.
--
-- Como meli_tokens: RLS encendida con CERO políticas a propósito — solo el
-- service-role la toca. No agregar políticas.

create table if not exists higgsfield_mcp (
  account_id uuid primary key references meli_accounts (id) on delete cascade,
  client_id text not null,
  access_token text not null,
  refresh_token text,
  expira_en timestamptz,
  actualizado_en timestamptz not null default now()
);

alter table higgsfield_mcp enable row level security;
