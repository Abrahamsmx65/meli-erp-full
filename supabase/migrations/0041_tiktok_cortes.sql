-- ============================================================================
--  Cortes de despacho de TikTok.
--
--  Un corte es "todo lo que había por enviar cuando llegué en la mañana":
--  se confirman esos envíos en TikTok de un jalón, y el corte se queda
--  guardado con sus pedidos para reimprimir etiquetas y lista de empaque
--  cuantas veces haga falta. Un pedido pertenece a UN corte; el siguiente
--  corte solo toma lo que no tiene corte todavía.
-- ============================================================================

create table if not exists public.tiktok_cortes (
  id          bigserial primary key,
  account_id  uuid not null references public.meli_accounts (id) on delete cascade,
  -- número consecutivo por cuenta, el que se imprime en la etiqueta
  numero      integer not null,
  creado_en   timestamptz not null default now(),
  creado_por  uuid references auth.users (id) on delete set null,
  -- PICKUP (pasa el repartidor) o DROP_OFF (se lleva a la paquetería)
  handover    text not null default 'PICKUP',
  pedidos     integer not null default 0,
  pares       integer not null default 0,
  -- errores por pedido, si TikTok rechazó alguno: [{ orderId, error }]
  errores     jsonb not null default '[]'::jsonb,
  unique (account_id, numero)
);

alter table public.tiktok_ordenes
  add column if not exists corte_id bigint references public.tiktok_cortes (id) on delete set null;
create index if not exists tiktok_ordenes_corte_idx on public.tiktok_ordenes (account_id, corte_id);

alter table public.tiktok_cortes enable row level security;
drop policy if exists tiktok_cortes_mias on public.tiktok_cortes;
create policy tiktok_cortes_mias on public.tiktok_cortes
  for all using (es_mi_cuenta(account_id)) with check (es_mi_cuenta(account_id));
