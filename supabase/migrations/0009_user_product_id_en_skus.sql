-- Guarda a qué "user product" de MELI pertenece cada SKU.
--
-- En las publicaciones de Full el SKU ya no viene en la publicación: hay que
-- pedirlo con una llamada aparte por producto. Guardar el amarre convierte
-- ese trabajo en algo que se hace una vez y no en cada sincronización, que
-- es lo que hacía que la corrida se pasara del límite de tiempo.
alter table public.skus
  add column if not exists user_product_id text;

create index if not exists skus_user_product_id_idx
  on public.skus (account_id, user_product_id)
  where user_product_id is not null;
