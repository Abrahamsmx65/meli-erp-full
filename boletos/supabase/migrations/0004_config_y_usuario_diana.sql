-- Configuración no secreta de raíz (correo saliente, URL base) en la base,
-- para que en Vercel solo haga falta SUPABASE_SERVICE_ROLE_KEY. RLS sin
-- políticas: solo el servidor la lee.
create table if not exists ev_config (
  clave          text primary key,
  valor          text,
  actualizado_en timestamptz not null default now()
);
alter table ev_config enable row level security;

-- Usuario "Diana" (por dentro diana@boletos.local; el login completa el
-- dominio cuando se escribe solo el nombre).
insert into ev_administradores (correo, nombre)
values ('diana@boletos.local', 'Diana')
on conflict (correo) do nothing;
