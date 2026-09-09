-- El frente "reclamos" de la recarga (órdenes con reembolso ya leídas pero
-- sin sus reclamos) corría cada latido sin índice: recorría ~78 mil
-- órdenes (150 MB) para sacar 100. Índice parcial con la condición exacta.
create index if not exists ordenes_neto_reclamo_pendiente_idx
  on public.ordenes_neto (account_id, fecha desc, order_id desc)
  where cargos_fuente is not null and reclamo_leido_en is null
    and (reembolsado > 0 or estado_pago in ('refunded','charged_back') or estado = 'partially_refunded');

-- Netos pendientes de fundas (cron cada 10 min, cuenta exacta sobre ~365 mil
-- órdenes): antes recorría la tabla completa (520 MB); con el índice parcial
-- la cuenta y el lote salen del índice.
create index if not exists yz_ordenes_neto_netos_pendientes_idx
  on public.yz_ordenes_neto (account_id, fecha desc)
  where (neto_en is null or cargos_leidos_en is null or cargos_fuente is null or envio_leido_en is null) and total > 0;

create index if not exists yz_ordenes_neto_reclamo_pendiente_idx
  on public.yz_ordenes_neto (account_id, fecha desc, order_id desc)
  where cargos_fuente is not null and reclamo_leido_en is null
    and (reembolsado > 0 or estado_pago in ('refunded','charged_back') or estado = 'partially_refunded');
