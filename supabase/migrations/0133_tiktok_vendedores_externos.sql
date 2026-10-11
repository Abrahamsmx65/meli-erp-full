-- ============================================================================
--  Vendedores EXTERNOS en la tienda de TikTok (pedido del dueño, 11-oct-2026:
--  «david, que vende en Shein, quiere subir sus productos pero él los
--  despacha desde otra bodega»).
--
--  Una publicación de TikTok (product_id) se liga a un vendedor externo y con
--  ella todos sus SKUs: su stock lo captura él a mano (Industher no lo tiene),
--  sus pedidos —y los mixtos— van a SU corte, y su venta no entra a la
--  ganancia del dueño. Lo que no está ligado sigue siendo del dueño.
-- ============================================================================

create table if not exists public.tiktok_productos_externos (
  account_id  uuid not null references public.meli_accounts (id) on delete cascade,
  product_id  text not null,
  vendedor    text not null default 'david',
  titulo      text,
  ligado_en   timestamptz not null default now(),
  ligado_por  uuid references auth.users (id) on delete set null,
  primary key (account_id, product_id)
);
comment on table public.tiktok_productos_externos is
  'Publicaciones de TikTok que son de un vendedor externo (David): sus SKUs se surten desde otra bodega, van a su propio corte y no entran a la ganancia del dueño.';

alter table public.tiktok_productos_externos enable row level security;
drop policy if exists tiktok_productos_externos_mios on public.tiktok_productos_externos;
create policy tiktok_productos_externos_mios on public.tiktok_productos_externos
  for all using (account_id in (select mis_cuentas_meli())) with check (account_id in (select mis_cuentas_meli()));
drop policy if exists tiktok_productos_externos_miembros_tiktok on public.tiktok_productos_externos;
create policy tiktok_productos_externos_miembros_tiktok on public.tiktok_productos_externos
  for all to authenticated using (account_id in (select mis_cuentas_tiktok())) with check (account_id in (select mis_cuentas_tiktok()));

-- El corte sabe de quién es: null = el dueño (todo lo de antes), 'david' = el
-- vendedor externo. Un corte solo se une a otro de hoy del MISMO vendedor.
alter table public.tiktok_cortes add column if not exists vendedor text;
comment on column public.tiktok_cortes.vendedor is
  'Vendedor externo al que pertenece el corte (tiktok_productos_externos.vendedor); null = el dueño.';
