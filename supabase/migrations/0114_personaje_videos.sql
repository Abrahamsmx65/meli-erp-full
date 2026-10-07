-- El PERSONAJE usado en cada video del Studio, para saber cuál fue y volver
-- a usarlo si gustó (pedido del dueño, 7-oct-2026). Los videos anteriores a
-- esta columna no lo guardaron y se quedan en blanco.
alter table videos_producto
  add column if not exists personaje text;
