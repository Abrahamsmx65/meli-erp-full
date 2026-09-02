-- Segunda vuelta de la sección de contenido en Amazon:
--   1. el ASIN PADRE de cada publicación, para agrupar por producto y que el
--      link abra la página padre completa en vez de una talla suelta;
--   2. el token del acceso sin contraseña a /amazon/contenido.

-- ---------------------------------------------------------------------------
-- 1. Mapa hijo -> padre
--
--    Amazon solo nos da ASINs HIJOS (uno por talla y color); el padre se
--    resuelve con Catalog Items (`relationships`). Con UN hijo por color
--    basta, así que esta tabla guarda solo los representativos: resolver los
--    cuarenta hijos de un modelo sería tirar cuota a la basura.
--
--    `titulo` es el del PADRE (el del hijo trae el color y la talla pegados).
-- ---------------------------------------------------------------------------
create table if not exists public.amazon_padres (
  account_id  uuid not null references public.amazon_accounts(id) on delete cascade,
  asin        text not null,
  parent_asin text,
  titulo      text,
  -- Se marca aunque Amazon no devuelva padre: sin esto se volvería a
  -- preguntar por el mismo ASIN en cada corrida, para siempre.
  resuelto_en timestamptz not null default now(),
  primary key (account_id, asin)
);

create index if not exists amazon_padres_parent_idx
  on public.amazon_padres (account_id, parent_asin);

alter table public.amazon_padres enable row level security;

drop policy if exists amazon_padres_mias on public.amazon_padres;
create policy amazon_padres_mias on public.amazon_padres for all
  using (es_mi_cuenta_amazon(account_id)) with check (es_mi_cuenta_amazon(account_id));

-- ---------------------------------------------------------------------------
-- 2. Acceso sin contraseña a la sección de contenido
--
--    Quien trabaja el contenido de la marca no tiene cuenta en el ERP: entra
--    con un link secreto que abre ESA sección y nada más. El token es lo único
--    que separa a un extraño de esa pantalla —del otro lado se lee y escribe
--    con service_role, sin RLS que valga—, así que:
--
--      · RLS activo y CERO políticas, igual que meli_tokens y tiktok_tokens:
--        solo la service_role puede leerlo, nunca el navegador.
--      · 64 hexadecimales (dos uuid pegados): no se adivina.
--      · Se regenera desde la pantalla cuando haga falta revocarlo; el link
--        anterior muere en ese instante.
-- ---------------------------------------------------------------------------
create table if not exists public.contenido_acceso (
  account_id uuid primary key references public.amazon_accounts(id) on delete cascade,
  token      text not null unique,
  creado_en  timestamptz not null default now()
);

alter table public.contenido_acceso enable row level security;

-- Un token por cuenta de Amazon, sin pisar el que ya exista.
insert into public.contenido_acceso (account_id, token)
select a.id,
       replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
  from public.amazon_accounts a
 where not exists (select 1 from public.contenido_acceso c where c.account_id = a.id);
