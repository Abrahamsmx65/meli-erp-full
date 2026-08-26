-- Personajes consistentes y clips en formato de Mercado Libre.
--
-- `personajes_video`: los "influencers" fijos (una mujer, un hombre…) que se
-- repiten en los videos. Higgsfield los entrena a partir de fotos de
-- referencia (custom references / Soul ID) y aquí se guarda el folio.
--
-- En `videos_producto` se agrega el modo clip en dos etapas: primero Soul
-- genera la foto vertical 9:16 del personaje usando el producto, y luego
-- Kling la anima 10 segundos — el mínimo que piden los Clips de MELI.

create table if not exists personajes_video (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references meli_accounts (id) on delete cascade,
  nombre text not null,
  genero text,                       -- 'mujer' | 'hombre' | 'nino' | null
  soul_id text,                      -- folio del custom reference en Higgsfield
  -- creando -> listo | fallido
  estado text not null default 'creando',
  fotos jsonb not null default '[]', -- URLs de referencia en el CDN de Higgsfield
  error text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

alter table personajes_video enable row level security;

create policy personajes_video_mios on personajes_video for all
  using (es_mi_cuenta(account_id)) with check (es_mi_cuenta(account_id));

alter table videos_producto
  add column if not exists personaje_id uuid references personajes_video (id) on delete set null,
  -- 'clip' (Soul 9:16 + Kling 10 s, listo para MELI) | 'dop' (prueba rápida ~5 s)
  add column if not exists formato text not null default 'dop',
  -- en modo clip: 'imagen' mientras Soul trabaja, 'video' cuando anima Kling
  add column if not exists etapa text not null default 'video',
  add column if not exists prompt_imagen text,
  add column if not exists request_id_imagen text,
  add column if not exists imagen_generada text,
  add column if not exists duracion int;
