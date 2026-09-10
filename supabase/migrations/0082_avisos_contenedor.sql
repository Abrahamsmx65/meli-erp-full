-- 0082 — Recordatorios por correo del contenedor (decisión del dueño)
--
-- Una semana antes de la llegada estimada: las fotos que faltan de los
-- productos nuevos que trae. El día que llega: aviso de que ya está en USA.
-- Cada uno se manda UNA vez; la constancia vive aquí para que el cron diario
-- no lo repita.
alter table contenedores
  add column if not exists aviso_previo_en   timestamptz,
  add column if not exists aviso_llegada_en  timestamptz;

comment on column contenedores.aviso_previo_en is 'Cuándo se mandó el recordatorio de fotos, una semana antes de la llegada estimada.';
comment on column contenedores.aviso_llegada_en is 'Cuándo se mandó el aviso de que el contenedor llegó a USA.';
