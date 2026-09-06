-- ============================================================================
--  Modelos nuevos y costos de producto.
--
--  Dos secciones nuevas del ERP de calzado, las dos por MODELO (el nivel al
--  que el negocio decide precio, categoría y contenido: todos los colores y
--  tallas de un modelo comparten las tres cosas).
--
--  1. costos_producto: la hoja "Numeros" del dueño, renglón por modelo. Se
--     captura el costo en dólares, el tipo de cambio, el CBM por par y los
--     envíos; el sistema calcula la aduana (pesos por m³ × CBM), el costo
--     total aterrizado y cuánto se gana con cada precio en MELI, Amazon y
--     TikTok. El costo total calculado se copia a productos_config.costo_mxn,
--     que es lo que ya usa la sección de Ventas para la ganancia real: UNA
--     sola verdad del costo.
--  2. costos_parametros: las constantes de esa hoja (tipo de cambio de
--     omisión, pesos por m³ de aduana, IVA, retención, comisiones, factores)
--     como JSON por cuenta, editables desde la pantalla.
--  3. modelos_nuevos: el seguimiento de cada listado nuevo hasta que queda
--     completo: llegada estimada, imágenes de China (recibidas / mandadas a
--     cargar), clip y video, A+ y lo que la revisión automática encontró en
--     MELI y Amazon (fotos, video, A+), guardado como JSON con su fecha.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Costos por modelo
-- ---------------------------------------------------------------------------
create table if not exists public.costos_producto (
  account_id        uuid not null references public.meli_accounts(id) on delete cascade,
  modelo            text not null,
  -- Costo de fábrica por par, en dólares.
  costo_usd         numeric,
  -- Tipo de cambio con el que se pagó ese modelo; nulo = el de omisión.
  tdc               numeric,
  -- Metros cúbicos que ocupa UN PAR (caja completa ÷ pares por caja).
  cbm_par           numeric,
  -- Costo de envío de MELI por par vendido, en pesos.
  envio_meli        numeric,
  precio_relampago  numeric,
  precio_normal     numeric,
  -- Tarifa de logística de Amazon (FBA) por par, en pesos.
  envio_amazon      numeric,
  -- Precio REAL publicado en Amazon, para ver la ganancia con ese precio.
  precio_amazon     numeric,
  -- Comisión de afiliados de TikTok para este modelo (0.08 = 8 %); nulo = la
  -- de omisión.
  afiliado_tiktok   numeric,
  -- Precio REAL publicado en TikTok.
  precio_tiktok     numeric,
  notas             text not null default '',
  actualizado_en    timestamptz not null default now(),
  primary key (account_id, modelo)
);

alter table public.costos_producto enable row level security;
drop policy if exists costos_producto_mias on public.costos_producto;
create policy costos_producto_mias on public.costos_producto for all
  using (es_mi_cuenta(account_id)) with check (es_mi_cuenta(account_id));

-- ---------------------------------------------------------------------------
-- 2. Constantes de la hoja de costos, por cuenta
-- ---------------------------------------------------------------------------
create table if not exists public.costos_parametros (
  account_id     uuid primary key references public.meli_accounts(id) on delete cascade,
  datos          jsonb not null default '{}'::jsonb,
  actualizado_en timestamptz not null default now()
);

alter table public.costos_parametros enable row level security;
drop policy if exists costos_parametros_mias on public.costos_parametros;
create policy costos_parametros_mias on public.costos_parametros for all
  using (es_mi_cuenta(account_id)) with check (es_mi_cuenta(account_id));

-- ---------------------------------------------------------------------------
-- 3. Seguimiento de modelos nuevos
-- ---------------------------------------------------------------------------
create table if not exists public.modelos_nuevos (
  account_id         uuid not null references public.meli_accounts(id) on delete cascade,
  modelo             text not null,
  -- Llegada capturada a mano; si está vacía se usa la ETA del contenedor
  -- que trae el modelo (pedido_lineas -> contenedor_lineas -> contenedores).
  llegada_estimada   date,
  -- Las fotos que manda la fábrica: ya llegaron / ya se mandaron a cargar.
  imagenes_recibidas boolean not null default false,
  imagenes_enviadas  boolean not null default false,
  -- Lo que el API no puede ver y se palomea a mano.
  meli_clip          boolean not null default false,
  amazon_video       boolean not null default false,
  aplus_cargado      boolean not null default false,
  notas              text not null default '',
  -- Ya no le falta nada: sale de la lista de pendientes (se conserva).
  listo              boolean not null default false,
  -- Última revisión automática en MELI y Amazon (fotos, video, A+), tal
  -- como la armó modelos-nuevos-revisar.ts.
  revision           jsonb,
  revisado_en        timestamptz,
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),
  primary key (account_id, modelo)
);

create index if not exists modelos_nuevos_pendientes_idx
  on public.modelos_nuevos (account_id) where not listo;

alter table public.modelos_nuevos enable row level security;
drop policy if exists modelos_nuevos_mias on public.modelos_nuevos;
create policy modelos_nuevos_mias on public.modelos_nuevos for all
  using (es_mi_cuenta(account_id)) with check (es_mi_cuenta(account_id));
