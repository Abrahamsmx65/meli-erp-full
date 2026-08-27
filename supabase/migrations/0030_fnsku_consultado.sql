-- Recuperación del FNSKU de los SKUs que el reporte de inventario no alcanza.
--
-- El FNSKU solo llegaba de `GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA`, que por
-- definición trae únicamente los listings FBA vivos. Un SKU con el listing
-- Inactive o Incomplete (agotado en FBA, pausado) no sale en ese reporte, así
-- que su FNSKU no existía en ninguna tabla y su etiqueta de Amazon no se podía
-- armar: 6 mil y pico de SKUs del catálogo. Ese dato sí lo contesta el API de
-- inventario FBA (getInventorySummaries), SKU por SKU.
--
-- Esta columna anota CUÁNDO se le preguntó a Amazon por un SKU, para no
-- volver a preguntar en cada corrida por los que de verdad no tienen FNSKU
-- (los que nunca se dieron de alta en FBA). Nula = nunca se ha preguntado.
alter table public.amazon_skus
  add column if not exists fnsku_consultado_en timestamptz;

-- Los pendientes se piden ordenados y filtrados por esta condición en cada
-- corrida del latido; sin índice es un recorrido completo de la tabla.
create index if not exists amazon_skus_fnsku_pendiente_idx
  on public.amazon_skus (account_id, fnsku_consultado_en)
  where fnsku is null;
