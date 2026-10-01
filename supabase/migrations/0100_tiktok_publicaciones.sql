-- ============================================================================
--  Publicar en TikTok Shop los productos de calzado que ya están en Amazon
--  (sección «Productos nuevos» de TikTok; pedido del dueño, 30-sep-2026).
--
--  Cada renglón es UN producto de TikTok por publicar: un modelo con los
--  colores que faltan en la tienda y el precio que el dueño le puso. La
--  publicación corre por atrás (ruta + eslabones): la pantalla encola, el
--  fondo sube las fotos de Amazon, crea el producto y deja aquí el
--  product_id o el error de TikTok, para que nada se repita ni se pierda.
-- ============================================================================

create table if not exists public.tiktok_publicaciones (
  id             bigserial primary key,
  account_id     uuid not null references public.meli_accounts (id) on delete cascade,
  modelo         text not null,
  -- colores de Amazon que lleva este producto
  colores        jsonb not null default '[]'::jsonb,
  titulo         text not null,
  precio         numeric not null,
  borrador       boolean not null default false,
  -- pendiente | publicando | publicado | error
  estado         text not null default 'pendiente',
  product_id     text,
  -- lo que contestó TikTok (skus creados, avisos) o lo que faltó
  resultado      jsonb,
  error          text,
  intentos       integer not null default 0,
  creado_en      timestamptz not null default now(),
  creado_por     uuid references auth.users (id) on delete set null,
  actualizado_en timestamptz not null default now(),
  publicado_en   timestamptz
);

create index if not exists tiktok_publicaciones_estado_idx
  on public.tiktok_publicaciones (account_id, estado, creado_en);
create index if not exists tiktok_publicaciones_modelo_idx
  on public.tiktok_publicaciones (account_id, modelo);

alter table public.tiktok_publicaciones enable row level security;
drop policy if exists tiktok_publicaciones_mios on public.tiktok_publicaciones;
create policy tiktok_publicaciones_mios on public.tiktok_publicaciones
  for all using (es_mi_cuenta(account_id)) with check (es_mi_cuenta(account_id));
-- El miembro de TikTok puede VER qué se publicó; publicar es del dueño.
drop policy if exists tiktok_publicaciones_miembros_tiktok on public.tiktok_publicaciones;
create policy tiktok_publicaciones_miembros_tiktok on public.tiktok_publicaciones
  for select to authenticated using (es_miembro_tiktok(account_id));
