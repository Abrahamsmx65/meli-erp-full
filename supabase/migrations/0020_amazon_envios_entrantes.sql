-- Envíos entrantes a FBA (inbound shipments), leídos del SP-API.
--
-- El reporte de inventario solo trae TOTALES por SKU (afn-inbound-*), sin
-- fechas: un envío que se quedó atorado hace meses sigue sumando "en camino"
-- para siempre, el plan cree que el stock ya viene y deja de sugerir cajas.
-- Aquí vive el detalle por envío y por SKU, con la marca de si el envío
-- sigue vivo (tuvo movimiento en los últimos 20 días) o ya se da por perdido.
create table if not exists public.amazon_envios_entrantes (
  account_id uuid not null references public.amazon_accounts(id) on delete cascade,
  shipment_id text not null,
  seller_sku text not null,
  nombre text,
  estado text not null,
  enviado integer not null default 0,
  recibido integer not null default 0,
  -- true = con movimiento reciente: lo que le falta por recibir cuenta como
  -- "en camino". false = lleva demasiado sin moverse: se ignora en el plan.
  vigente boolean not null default true,
  sincronizado_en timestamptz not null default now(),
  primary key (account_id, shipment_id, seller_sku)
);

alter table public.amazon_envios_entrantes enable row level security;

drop policy if exists amazon_envios_entrantes_mias on public.amazon_envios_entrantes;
create policy amazon_envios_entrantes_mias on public.amazon_envios_entrantes
  for all
  using (es_mi_cuenta_amazon(account_id))
  with check (es_mi_cuenta_amazon(account_id));
