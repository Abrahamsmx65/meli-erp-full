-- Precios para TikTok: elegir por modelo si el objetivo descuenta la
-- retención de MELI (2-oct-2026). Muchos precios de MELI se pusieron
-- contando con que MELI retendría el 10.5 % (IVA 8 % + ISR 2.5 % sobre la
-- base sin IVA); en REVENTA MELI ya no lo retiene y el neto real quedó más
-- alto de lo planeado. Con `quitar_retencion` el objetivo de ese modelo es
-- el neto del relámpago COMO SI MELI sí lo retuviera, y el precio de TikTok
-- sale más bajo. Dueño: «quisiera tener la opción de elegir en cada SKU si
-- quiero que se calcule así como está ahora o como si sí me quitarían el
-- 10.5 % de MELI».
--
-- El renglón puede existir solo por la casilla: `precio` pasa a ser
-- opcional (null = el calculado).

alter table public.tiktok_precios_objetivo
  alter column precio drop not null,
  add column if not exists quitar_retencion boolean not null default false;

alter table public.tiktok_precios_objetivo
  drop constraint if exists tiktok_precios_objetivo_precio_check;
alter table public.tiktok_precios_objetivo
  add constraint tiktok_precios_objetivo_precio_check check (precio is null or precio > 0);
