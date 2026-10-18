-- Números: lo cambiado en el ERP le gana al sheet (dueño, 18-oct-2026).
-- editados_erp: campos que el dueño cambió en el ERP; valores_sheet: lo que
-- dijo el sheet la última vez. Si el sheet cambia un campo, vuelve a mandar.
alter table public.numeros_modelos
  add column if not exists editados_erp text[] not null default '{}',
  add column if not exists valores_sheet jsonb;
