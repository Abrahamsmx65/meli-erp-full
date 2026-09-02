-- ============================================================================
--  Evidencia para la solicitud de revisión de medidas a MELI.
--
--  Cuando una publicación de Full quedó mal medida, MELI pide un Excel con
--  Item ID, Site y las medidas correctas, y un LINK a una imagen de evidencia.
--  La ficha de evidencia se dibuja en el ERP con lo que MELI mismo midió en
--  las hermanas del modelo (`evidencia-envio-imagen.tsx`) y se sube a un
--  bucket público para que el link se pueda pegar en la solicitud.
--
--  Esta tabla guarda, por modelo, el link de la ficha ya subida y la huella
--  de los datos con los que se dibujó: si nada cambió, no se vuelve a subir.
-- ============================================================================
create table if not exists evidencia_envio (
  account_id      uuid not null references meli_accounts (id) on delete cascade,
  modelo          text not null,
  url             text not null,          -- link público de la ficha (PNG)
  huella          text not null,          -- hash de lo dibujado
  imagen_producto text,                   -- la foto de la publicación, de MELI
  generado_en     timestamptz not null default now(),
  primary key (account_id, modelo)
);

alter table evidencia_envio enable row level security;

create policy evidencia_envio_mia on evidencia_envio for all
  using (es_mi_cuenta(account_id)) with check (es_mi_cuenta(account_id));

-- Bucket público, como el de videos: la URL se le manda a MELI y la tiene que
-- poder abrir cualquiera sin sesión. Solo escribe el service-role.
insert into storage.buckets (id, name, public)
values ('evidencia-envio', 'evidencia-envio', true)
on conflict (id) do nothing;
