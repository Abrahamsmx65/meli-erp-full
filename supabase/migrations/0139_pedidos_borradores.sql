-- Pedidos a China ARMADOS POR EL ERP desde la lista del dueño (11-oct-2026:
-- «quiero mandarte una lista así y que se haga solo todo; que me salga
-- borrador, confirmo y se manda a mi correo, al de mi papá y al de Joanne»).
--
-- Un borrador por MODELO (cada modelo se pide en su propio Excel) con su
-- número IN consecutivo. Mientras es borrador NO cuenta como en camino; al
-- confirmarlo se da de alta en `pedidos` / `pedido_lineas` igual que una
-- proforma (origen = 'sistema') y se manda el Excel por correo.
create table if not exists public.pedidos_borradores (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references public.meli_accounts (id) on delete cascade,
  pedido         text not null,
  modelo         text not null,
  -- clave del perfil de fábrica (`pedidos-china/fabricas.ts`): chaozhou, jinjiang… u "otra:NOMBRE"
  fabrica        text,
  proveedor      text,
  moneda         text check (moneda in ('USD', 'RMB')),
  descripcion    text,
  lineas         jsonb not null default '[]'::jsonb,
  texto          text,
  avisos         jsonb not null default '[]'::jsonb,
  estado         text not null default 'borrador' check (estado in ('borrador', 'confirmado', 'descartado')),
  pedido_id      uuid references public.pedidos (id) on delete set null,
  correo         jsonb,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  confirmado_en  timestamptz
);

create unique index if not exists pedidos_borradores_in_vivo
  on public.pedidos_borradores (account_id, pedido) where estado <> 'descartado';
create index if not exists pedidos_borradores_cuenta on public.pedidos_borradores (account_id, estado);

alter table public.pedidos_borradores enable row level security;
create policy pedidos_borradores_mios on public.pedidos_borradores
  for all using (account_id in (select mis_cuentas_meli()))
  with check (account_id in (select mis_cuentas_meli()));

-- A quién se manda el pedido confirmado y desde qué número sigue el IN.
create table if not exists public.pedidos_ajustes (
  account_id     uuid primary key references public.meli_accounts (id) on delete cascade,
  destinatarios  text[] not null default '{}',
  -- el último IN que se usó fuera del ERP (el dueño: «el último ha sido IN10183»)
  ultimo_in      integer,
  actualizado_en timestamptz not null default now()
);

alter table public.pedidos_ajustes enable row level security;
create policy pedidos_ajustes_mios on public.pedidos_ajustes
  for all using (account_id in (select mis_cuentas_meli()))
  with check (account_id in (select mis_cuentas_meli()));

-- De dónde salió el pedido, y lo que hace falta para el dinero y el CBM.
alter table public.pedidos
  add column if not exists origen text not null default 'proforma' check (origen in ('proforma', 'sistema'));
alter table public.pedidos alter column moneda set default null;

alter table public.pedido_lineas
  add column if not exists precios_talla jsonb,
  add column if not exists cbm_caja numeric;

-- La MONEDA de cada fábrica, verificada en sus proformas reales (fixtures):
-- hasta hoy todo se guardaba como RMB. Las demás quedan sin moneda hasta
-- que se vuelva a subir su proforma (el lector ya la lee) o se capture.
update public.pedidos set moneda = 'USD'
  where proveedor ~* '(CHAOZHOU\s+YINGYUAN|JIAXING\s+INNOVATIVE|FUZHOU\s+KC|TENGCHUANG|WENZHOU\s+BAIKE)';
update public.pedidos set moneda = 'RMB'
  where proveedor ~* '(JINJIANG\s+HANDSOME|MINGTAI)';
update public.pedidos set moneda = null
  where not (proveedor ~* '(CHAOZHOU\s+YINGYUAN|JIAXING\s+INNOVATIVE|FUZHOU\s+KC|TENGCHUANG|WENZHOU\s+BAIKE|JINJIANG\s+HANDSOME|MINGTAI)')
    or proveedor is null;

-- Precio que la fábrica escribió solo en el primer color del modelo (FUZHOU,
-- celda combinada): los demás colores del MISMO pedido y modelo lo heredan
-- cuando ese pedido y modelo tienen un solo precio. Con eso se rehace el
-- importe de esos pedidos (IN10163 decía $1,483 y la proforma $11,618) y de
-- los que no tenían importe. Los demás NO se tocan: JINJIANG y MINGTAI
-- cobran distinto por talla y su importe guardado es el de la proforma.
create temporary table pedidos_con_precio_heredado on commit drop as
  select distinct l.pedido_id
    from public.pedido_lineas l
    join (
      select pedido_id, modelo
        from public.pedido_lineas
       where precio_unitario is not null
       group by pedido_id, modelo
      having count(distinct precio_unitario) = 1
    ) x on x.pedido_id = l.pedido_id and x.modelo = l.modelo
   where l.precio_unitario is null;

update public.pedido_lineas l
   set precio_unitario = x.precio
  from (
    select pedido_id, modelo, min(precio_unitario) as precio
      from public.pedido_lineas
     where precio_unitario is not null
     group by pedido_id, modelo
    having count(distinct precio_unitario) = 1
  ) x
 where l.pedido_id = x.pedido_id and l.modelo = x.modelo and l.precio_unitario is null;

update public.pedidos p
   set importe = s.total
  from (
    select pedido_id, round(sum(precio_unitario * pares)::numeric, 2) as total
      from public.pedido_lineas
     group by pedido_id
    having bool_and(precio_unitario is not null)
  ) s
 where p.id = s.pedido_id
   and (p.importe is null or p.id in (select pedido_id from pedidos_con_precio_heredado));
