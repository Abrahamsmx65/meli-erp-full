-- La categoría de MELI de cada publicación, para que la sección fiscal
-- sugiera por CATEGORÍA (dato real de MELI) en vez de adivinar por el
-- nombre del modelo. Se llena en cada sincronización completa del catálogo.
alter table public.skus add column if not exists categoria_id text;

-- Nombres de las categorías ("Fundas y Carcasas", "Botas y Botines"…):
-- se consultan a MELI una sola vez y se quedan guardadas. No llevan
-- account_id porque el catálogo de categorías de MELI es el mismo para
-- todos; solo el service role escribe.
create table if not exists public.categorias_meli (
  id text primary key,
  nombre text not null
);

alter table public.categorias_meli enable row level security;

drop policy if exists categorias_meli_lectura on public.categorias_meli;
create policy categorias_meli_lectura on public.categorias_meli
  for select to authenticated using (true);
