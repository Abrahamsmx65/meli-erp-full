-- El costo de envío se cobra por TRAMO DE PRECIO ($299–$498 con descuento,
-- desde $499 completo). La revisión de costos le preguntaba al simulador con
-- el precio de LISTA de la publicación, y MELI enseña (y cobra) el costo al
-- precio real de venta: una publicación de $499 en promoción a $341 se ve
-- con un envío distinto en MELI y en el ERP, y el dueño leía que MELI "ya
-- había corregido" cuando la medida seguía igual (GT229-TABACO BROWN-24,
-- 25-sep-2026). Aquí se guarda el precio de venta (`/items/{id}/sale_price`)
-- y cuándo se leyó, para refrescarlo por tandas como las medidas.
alter table medidas_envio
  add column if not exists precio_venta numeric,
  add column if not exists precio_en timestamptz;
