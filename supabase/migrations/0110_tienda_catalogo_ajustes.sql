-- Back del catálogo completo para creadores (pedido del dueño, 5-oct-2026:
-- «un back para poder gestionar cuáles quiero que sean visibles y cuáles
-- no»). Un renglón por modelo que el dueño tocó; sin renglón = visible.
-- La categoría NO vive aquí: se cambia en productos_config (la fuente única
-- de categoría y costo de todo el ERP).
create table if not exists public.tienda_catalogo_ajustes (
  account_id     uuid not null references public.meli_accounts (id) on delete cascade,
  modelo         text not null,
  oculto         boolean not null default false,
  actualizado_en timestamptz not null default now(),
  primary key (account_id, modelo)
);

alter table public.tienda_catalogo_ajustes enable row level security;
drop policy if exists tienda_catalogo_ajustes_mios on public.tienda_catalogo_ajustes;
create policy tienda_catalogo_ajustes_mios on public.tienda_catalogo_ajustes
  for all using (es_mi_cuenta(account_id)) with check (es_mi_cuenta(account_id));
drop policy if exists tienda_catalogo_ajustes_miembros_tiktok on public.tienda_catalogo_ajustes;
create policy tienda_catalogo_ajustes_miembros_tiktok on public.tienda_catalogo_ajustes
  for all to authenticated using (es_miembro_tiktok(account_id)) with check (es_miembro_tiktok(account_id));
