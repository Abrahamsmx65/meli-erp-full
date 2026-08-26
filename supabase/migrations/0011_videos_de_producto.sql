-- Videos de producto generados con Higgsfield.
--
-- Cada fila es una generación: de qué publicación salió, con qué foto y qué
-- prompt se pidió, y en qué quedó. El video que devuelve Higgsfield vive en
-- su CDN solo unos días, así que al completarse se copia a Supabase Storage
-- (bucket `videos-producto`) y esa es la URL que se usa de ahí en adelante.

create table if not exists videos_producto (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references meli_accounts (id) on delete cascade,
  item_id text,
  sku text,
  titulo text,
  imagen_url text not null,
  prompt text not null,
  preset text,
  modelo text not null default 'dop-turbo',
  request_id text,
  -- creado -> enviado -> en_progreso -> completado | fallido | rechazado
  estado text not null default 'creado',
  video_url text,       -- URL temporal en el CDN de Higgsfield (~7 días)
  video_guardado text,  -- URL permanente en Supabase Storage
  error text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create index if not exists videos_producto_cuenta_estado
  on videos_producto (account_id, estado);

alter table videos_producto enable row level security;

create policy videos_producto_mios on videos_producto for all
  using (es_mi_cuenta(account_id)) with check (es_mi_cuenta(account_id));

-- Bucket público para los MP4 ya guardados. Público porque las URLs se pegan
-- en publicaciones y se comparten; lo que protege la tabla es RLS, y al
-- bucket solo escribe el service-role.
insert into storage.buckets (id, name, public)
values ('videos-producto', 'videos-producto', true)
on conflict (id) do nothing;
