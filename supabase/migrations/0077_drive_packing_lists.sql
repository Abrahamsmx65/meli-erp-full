-- Packing lists que llegan solos desde la carpeta de Drive de la fábrica
-- (una vez al día, como BORRADOR que el dueño revisa y confirma) y el aviso
-- por correo de las fotos que faltan cuando se carga un contenedor nuevo.

create table if not exists public.drive_packing_lists (
  account_id     uuid not null references public.meli_accounts(id) on delete cascade,
  drive_file_id  text not null,
  nombre         text not null,
  md5            text,
  modificado_en  timestamptz,
  procesado_en   timestamptz not null default now(),
  -- importado | omitido | error
  estado         text not null,
  motivo         text,
  contenedor_id  uuid references public.contenedores(id) on delete set null,
  resultado      jsonb,
  primary key (account_id, drive_file_id)
);

alter table public.drive_packing_lists enable row level security;

drop policy if exists drive_packing_lists_mias on public.drive_packing_lists;
create policy drive_packing_lists_mias on public.drive_packing_lists
  for select using (es_mi_cuenta(account_id));

-- Cuándo se mandó el correo con las fotos que faltan para ese contenedor.
alter table public.contenedores add column if not exists fotos_aviso_en timestamptz;
