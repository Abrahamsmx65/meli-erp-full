-- ============================================================================
--  Devoluciones de TikTok Shop.
--
--  TikTok lleva las devoluciones en su propio API, aparte de los pedidos: el
--  renglón del pedido no cambia de estado cuando el cliente devuelve, así que
--  el ERP no sabía de ninguna. El cron las baja aquí masticadas; la pantalla
--  las busca por la guía de regreso o el pedido, y al confirmar el paquete
--  recibido el ERP le avisa a TikTok (reembolsa al cliente) y decide por par
--  si vuelve al stock o se tira. Pedido del dueño, 9-oct-2026.
-- ============================================================================

create table if not exists public.tiktok_devoluciones (
  id                     bigserial primary key,
  account_id             uuid not null references public.meli_accounts (id) on delete cascade,
  return_id              text not null,
  order_id               text not null,
  -- lo que dice TikTok (se pisa en cada lectura)
  estado                 text not null,
  tipo                   text,
  siguiente_accion       text,
  plazo                  timestamptz,
  guia                   text,
  paqueteria             text,
  motivo                 text,
  motivo_texto           text,
  reembolso              numeric,
  moneda                 text,
  renglones              jsonb not null default '[]'::jsonb,
  creada_tiktok_en       timestamptz,
  actualizada_tiktok_en  timestamptz,
  crudo                  jsonb,
  leida_en               timestamptz not null default now(),
  -- lo que decidió quien recibió el paquete (lo escribe solo el ERP)
  decisiones             jsonb not null default '[]'::jsonb,
  confirmada_en          timestamptz,
  confirmada_por         uuid references auth.users (id) on delete set null,
  respuesta_tiktok       jsonb,
  error                  text,
  unique (account_id, return_id)
);

create index if not exists tiktok_devoluciones_estado_idx on public.tiktok_devoluciones (account_id, estado);
create index if not exists tiktok_devoluciones_pedido_idx on public.tiktok_devoluciones (account_id, order_id);
create index if not exists tiktok_devoluciones_guia_idx on public.tiktok_devoluciones (account_id, guia);

alter table public.tiktok_devoluciones enable row level security;
drop policy if exists tiktok_devoluciones_mios on public.tiktok_devoluciones;
create policy tiktok_devoluciones_mios on public.tiktok_devoluciones
  for all using (es_mi_cuenta(account_id)) with check (es_mi_cuenta(account_id));
drop policy if exists tiktok_devoluciones_miembros_tiktok on public.tiktok_devoluciones;
create policy tiktok_devoluciones_miembros_tiktok on public.tiktok_devoluciones
  for all to authenticated using (es_miembro_tiktok(account_id)) with check (es_miembro_tiktok(account_id));
