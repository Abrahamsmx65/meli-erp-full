-- ============================================================================
--  Costos de envío por publicación: cazar las variantes mal medidas.
--
--  En Full, MELI MIDE la caja al recibirla y guarda el resultado en los
--  atributos PACKAGE_* de la publicación (PACKAGE_DATA_SOURCE = MEASUREMENT).
--  Con esas medidas calcula un peso facturable y de ahí el costo de envío que
--  nos cobra por cada venta.
--
--  Cuando esa medición sale mal —una talla del GT229 quedó guardada como
--  12 × 30 × 37 cm cuando sus hermanas miden 27 × 24 × 10— el costo salta de
--  $88.50 a $139.50 o $190 en esa variante, y se paga de más en cada venta.
--
--  Estas dos tablas guardan la foto para poder compararla y armar el caso:
--    · medidas_envio: qué medidas tiene HOY cada publicación y qué costo sale.
--    · tarifas_envio: caché del simulador de MELI, que es una llamada por
--      combinación de medidas y precio; sin caché una revisión completa serían
--      miles de llamadas cada vez.
-- ============================================================================
create table if not exists medidas_envio (
  account_id       uuid not null references meli_accounts (id) on delete cascade,
  sku              text not null,
  item_id          text,
  inventory_id     text,          -- el "código Full"
  modelo           text not null default '',
  color            text,
  talla            text,
  -- Las medidas que MELI USA para cobrar (atributos PACKAGE_*), en cm y g.
  largo            numeric,
  ancho            numeric,
  alto             numeric,
  peso             numeric,
  fuente           text,          -- MEASUREMENT (midió MELI) | SELLER (las declaré yo)
  -- Las que declaró el vendedor (SELLER_PACKAGE_*), para ver si MELI las pisó.
  largo_vendedor   numeric,
  ancho_vendedor   numeric,
  alto_vendedor    numeric,
  peso_vendedor    numeric,
  precio           numeric,
  tipo_publicacion text,          -- gold_special | gold_pro…: cambia la tarifa
  envio_gratis     boolean not null default true,
  estado           text,
  -- Resultado de la comparación contra las hermanas del mismo modelo.
  costo            numeric,       -- lo que cuesta el envío CON SUS medidas
  costo_normal     numeric,       -- lo que costaría con las medidas de consenso
  peso_facturable  numeric,
  actualizado_en   timestamptz not null default now(),
  primary key (account_id, sku)
);

create index if not exists medidas_envio_modelo_idx on medidas_envio (account_id, modelo);

alter table medidas_envio enable row level security;

create policy medidas_envio_mias on medidas_envio for all
  using (es_mi_cuenta(account_id)) with check (es_mi_cuenta(account_id));

-- ---------------------------------------------------------------------------
-- Caché del simulador de costos de MELI.
-- La tarifa depende de la cuenta (nivel del vendedor y sus descuentos), de las
-- medidas y del precio de la publicación: la clave las junta todas.
-- ---------------------------------------------------------------------------
create table if not exists tarifas_envio (
  account_id      uuid not null references meli_accounts (id) on delete cascade,
  clave           text not null,   -- "26x26x10,440|499|gold_special"
  costo           numeric,
  peso_facturable numeric,
  actualizado_en  timestamptz not null default now(),
  primary key (account_id, clave)
);

alter table tarifas_envio enable row level security;

create policy tarifas_envio_mias on tarifas_envio for all
  using (es_mi_cuenta(account_id)) with check (es_mi_cuenta(account_id));
