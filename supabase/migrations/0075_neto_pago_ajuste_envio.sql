-- El envío del vendedor sale de /shipments/{id}/costs, no del cargo del pago.
--
-- Hallazgo al conciliar agosto contra el reporte de Ventas de MELI: el pago
-- de Mercado Pago trae un cargo `shp_fulfillment` con el costo de lista del
-- envío (95, 145) y el neto depositado ya lo descuenta (0.68 de 125.99),
-- pero lo que el vendedor paga de verdad por ese envío según MELI es lo
-- que dice /shipments/{id}/costs (38): la diferencia es la bonificación de
-- envío gratis de Full, que MELI acredita por su cuenta de envíos, aparte
-- del pago. El reporte de Ventas (Costos de envío −38, Total 57.68) lo
-- confirma orden por orden.
--
--   neto_pago    = lo que Mercado Pago depositó por el pago (crudo)
--   ajuste_envio = cargo de envío del pago − costo real del envío
--                  (positivo: bonificación a favor; negativo: cargo que MELI
--                  aún no adjunta al pago)
--   neto         = neto_pago + ajuste_envio (lo que MELI dice que te deja)
--   envio_leido_en = cuándo se consultó /costs (para no reintentar sin fin)
alter table public.ordenes_neto
  add column if not exists neto_pago      numeric,
  add column if not exists ajuste_envio   numeric,
  add column if not exists envio_leido_en timestamptz;

alter table public.yz_ordenes_neto
  add column if not exists neto_pago      numeric,
  add column if not exists ajuste_envio   numeric,
  add column if not exists envio_leido_en timestamptz;

-- La reparación del envío recorre lo ya leído con pago real y sin /costs.
create index if not exists ordenes_neto_envio_pendiente_idx
  on public.ordenes_neto (account_id, fecha desc, order_id desc)
  where cargos_fuente is not null and envio_leido_en is null;
create index if not exists yz_ordenes_neto_envio_pendiente_idx
  on public.yz_ordenes_neto (account_id, fecha desc, order_id desc)
  where cargos_fuente is not null and envio_leido_en is null;
