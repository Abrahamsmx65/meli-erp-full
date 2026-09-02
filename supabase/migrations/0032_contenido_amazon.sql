-- Contenido de la marca en Amazon: catálogo, categorías de la store y avance
-- por modelo.
--
-- Tres tablas nuevas y NINGUNA columna nueva en `amazon_skus`, a propósito:
-- esa tabla la llena el reporte de ÓRDENES (solo entra el SKU que YA vendió) y
-- `amazon_resumen_skus` la usa como universo de claves del plan de FBA. Meterle
-- ahí el catálogo completo agregaría cientos de "tallas" con venta 0 a los
-- grupos modelo|color, y la regla de la corrida despareja (`fba.ts`, la de
-- `sanas.length > agotadas.length`) las leería como hermanas al día: media
-- corrida dejaría de viajar. Por eso la foto del catálogo vive aparte y no la
-- lee nadie más que esta sección.
--
-- Los modelos tampoco se guardan: la lista se arma en cada visita (los GT054 a
-- GT300 más MY2307 y G650). Aquí solo vive lo que se le anota encima; por eso
-- `eliminado` oculta un modelo de la pantalla sin tocar el catálogo, y se
-- puede restaurar.

-- ---------------------------------------------------------------------------
-- 1. Foto del catálogo tal como Amazon lo publica
--    (reporte GET_MERCHANT_LISTINGS_ALL_DATA)
-- ---------------------------------------------------------------------------
create table if not exists public.amazon_listings (
  account_id     uuid not null references public.amazon_accounts(id) on delete cascade,
  seller_sku     text not null,
  asin           text,
  titulo         text,
  precio         numeric,
  cantidad       integer,
  -- Columna `status` del reporte: Active | Inactive | Incomplete.
  estado         text,
  -- `fulfillment-channel`: DEFAULT (envío propio) | AMAZON_NA (FBA). OJO: no
  -- es el mismo vocabulario que amazon_skus.canal ("Amazon"), que sale del
  -- reporte de órdenes. No se mezclan.
  canal          text,
  -- `image-url`: la imagen PRINCIPAL. Es el respaldo del ZIP de imágenes
  -- cuando el catálogo de Amazon no contesta.
  imagen_url     text,
  actualizado_en timestamptz not null default now(),
  primary key (account_id, seller_sku)
);

-- ---------------------------------------------------------------------------
-- 2. Categorías de la STORE, capturadas a mano
--
--    Lista propia: NO son las de productos_config (esas agrupan por material
--    para costear). Estas son las páginas que existen —o van a existir— en la
--    tienda de marca de Amazon.
-- ---------------------------------------------------------------------------
create table if not exists public.amazon_categorias_store (
  account_id     uuid not null references public.amazon_accounts(id) on delete cascade,
  nombre         text not null,
  creada         boolean not null default false,
  imagenes       boolean not null default false,
  pagina_store   boolean not null default false,
  notas          text not null default '',
  orden          integer not null default 0,
  actualizado_en timestamptz not null default now(),
  primary key (account_id, nombre)
);

-- ---------------------------------------------------------------------------
-- 3. Palomeos y prioridad POR MODELO
-- ---------------------------------------------------------------------------
create table if not exists public.amazon_contenido (
  account_id     uuid not null references public.amazon_accounts(id) on delete cascade,
  modelo         text not null,
  categoria      text,
  -- 0 = sin prioridad, 5 = lo más urgente. La pantalla ordena por aquí.
  prioridad      smallint not null default 0 check (prioridad between 0 and 5),
  imagenes       boolean not null default false,
  aplus          boolean not null default false,
  notas          text not null default '',
  eliminado      boolean not null default false,
  actualizado_en timestamptz not null default now(),
  primary key (account_id, modelo),
  -- Renombrar una categoría arrastra a sus modelos; borrarla los deja sin
  -- categoría en vez de dejar un nombre que ya no existe. El SET NULL va
  -- acotado a la columna `categoria` para no tocar `account_id`.
  foreign key (account_id, categoria)
    references public.amazon_categorias_store (account_id, nombre)
    on update cascade on delete set null (categoria)
);

create index if not exists amazon_contenido_vivos_idx
  on public.amazon_contenido (account_id) where not eliminado;

create index if not exists amazon_contenido_categoria_idx
  on public.amazon_contenido (account_id, categoria);

-- ---------------------------------------------------------------------------
-- RLS: las tres cuelgan de la cuenta de Amazon.
-- ---------------------------------------------------------------------------
alter table public.amazon_listings         enable row level security;
alter table public.amazon_categorias_store enable row level security;
alter table public.amazon_contenido        enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'amazon_listings', 'amazon_categorias_store', 'amazon_contenido'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_mias', t);
    execute format(
      'create policy %I on public.%I for all
         using (es_mi_cuenta_amazon(account_id))
         with check (es_mi_cuenta_amazon(account_id))', t || '_mias', t);
  end loop;
end $$;
