-- ============================================================================
--  Miembros de la cuenta con acceso SOLO a TikTok.
--
--  Hasta hoy el ERP era de UNA persona: cada tabla se protege con
--  es_mi_cuenta(account_id) = «la cuenta es mía» (owner_id = auth.uid()).
--  El dueño pidió un usuario para el que empaca TikTok («david») que vea
--  todo lo de TikTok y NADA más del sistema (16-sep-2026).
--
--  Se resuelve en tres capas, cada una por sí sola ya cierra la puerta:
--   1. La base: `cuenta_miembros` dice quién es miembro de qué cuenta y con
--      qué rol; `es_miembro_tiktok()` es la llave, y SOLO las tablas
--      tiktok_* (más la lectura de la cuenta, del catálogo de SKUs y de la
--      vista de inventario, que las pantallas de TikTok necesitan) la
--      aceptan. Ventas de MELI, cortes, costos, Amazon, fundas: no.
--   2. El servidor: el rol viaja en el JWT (raw_app_meta_data.rol) y el
--      middleware manda a /tiktok/despacho cualquier otra ruta.
--   3. La pantalla: el menú solo enseña la sección de TikTok.
--  es_mi_cuenta() NO cambia: el dueño sigue siendo el dueño.
-- ============================================================================

create table if not exists public.cuenta_miembros (
  account_id uuid not null references public.meli_accounts (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  -- por ahora solo 'tiktok': todo lo de TikTok Shop y nada más
  rol        text not null check (rol in ('tiktok')),
  nota       text,
  creado_en  timestamptz not null default now(),
  primary key (account_id, user_id)
);

alter table public.cuenta_miembros enable row level security;
drop policy if exists cuenta_miembros_dueno on public.cuenta_miembros;
create policy cuenta_miembros_dueno on public.cuenta_miembros
  for all using (es_mi_cuenta(account_id)) with check (es_mi_cuenta(account_id));
drop policy if exists cuenta_miembros_propio on public.cuenta_miembros;
create policy cuenta_miembros_propio on public.cuenta_miembros
  for select to authenticated using (user_id = auth.uid());

create or replace function public.es_miembro_tiktok(a uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from cuenta_miembros
    where account_id = a and user_id = auth.uid() and rol = 'tiktok'
  );
$$;
revoke execute on function public.es_miembro_tiktok(uuid) from anon, public;
grant execute on function public.es_miembro_tiktok(uuid) to authenticated;

-- El miembro ve la cuenta (cuentaActiva la lee), pero no la toca.
drop policy if exists meli_accounts_miembros on public.meli_accounts;
create policy meli_accounts_miembros on public.meli_accounts
  for select to authenticated
  using (exists (select 1 from public.cuenta_miembros m where m.account_id = id and m.user_id = auth.uid()));

-- Las tablas de TikTok: el miembro lee y escribe (prepara, cuenta, corta).
do $$
declare t text;
begin
  foreach t in array array[
    'tiktok_alias_amazon', 'tiktok_cortes', 'tiktok_inventario', 'tiktok_mapeo_sku',
    'tiktok_movimientos', 'tiktok_orden_items', 'tiktok_ordenes', 'tiktok_pedidos_almacen',
    'tiktok_preparaciones', 'tiktok_salidas_3pl', 'tiktok_skus', 'tiktok_sync_estado',
    'tiktok_sync_log', 'tiktok_tienda', 'tiktok_ventas_diarias', 'tiktok_webhooks'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_miembros_tiktok', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (es_miembro_tiktok(account_id)) with check (es_miembro_tiktok(account_id))',
      t || '_miembros_tiktok', t
    );
  end loop;
end $$;

-- Solo lectura para el miembro: los desfases, la vista de inventario (el
-- pedido de almacén necesita la existencia por bodega) y el catálogo de
-- SKUs (Almacén TikTok amarra contra él). Costos y ventas de MELI, no.
drop policy if exists tiktok_desfases_miembros_tiktok on public.tiktok_desfases;
create policy tiktok_desfases_miembros_tiktok on public.tiktok_desfases
  for select to authenticated using (es_miembro_tiktok(account_id));
drop policy if exists inventario_cache_miembros_tiktok on public.inventario_cache;
create policy inventario_cache_miembros_tiktok on public.inventario_cache
  for select to authenticated using (es_miembro_tiktok(account_id));
drop policy if exists skus_miembros_tiktok on public.skus;
create policy skus_miembros_tiktok on public.skus
  for select to authenticated using (es_miembro_tiktok(account_id));
