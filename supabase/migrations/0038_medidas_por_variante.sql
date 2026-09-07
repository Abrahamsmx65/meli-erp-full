-- Las medidas no siempre viven en la publicación.
--
-- En las publicaciones de Full con variantes dentro (una sola MLM con 100
-- tallas), los atributos PACKAGE_* NO vienen ni en el item ni en la variante:
-- viven en el "user product" de cada variante, que es el producto real de la
-- bodega. Son 1,086 de los ~1,400 SKUs de Full del catálogo, así que no es un
-- caso raro: es la mayoría.
--
-- Esa consulta va de una en una (MELI limita /user-products a ~1/s), así que
-- hay que saber cuándo se leyó cada una para irlas refrescando por tandas y
-- no volver a preguntar por todas en cada revisión.
alter table medidas_envio
  add column if not exists user_product_id text,
  add column if not exists medidas_en timestamptz;

create index if not exists medidas_envio_refresco_idx
  on medidas_envio (account_id, medidas_en nulls first);
