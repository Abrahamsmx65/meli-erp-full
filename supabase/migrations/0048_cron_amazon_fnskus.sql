-- ============================================================================
--  pg_cron: FNSKU de las publicaciones de Amazon cada 10 minutos.
--
--  El latido solo corre con la app abierta (o cada hora por el webhook), y
--  la primera carga son miles de publicaciones a 600 por paso. Este job
--  llama a /api/cron/amazon?tarea=fnskus igual que los de ventas, inventario
--  y recarga: el secreto se lee de app_secretos en el momento, nunca vive
--  aquí. La ruta registra la corrida como `cron_fnskus`, el mismo nombre que
--  usa el latido, así que los dos no se pisan.
-- ============================================================================

select cron.unschedule(jobid) from cron.job where jobname = 'amazon_fnskus';

select cron.schedule(
  'amazon_fnskus',
  '*/10 * * * *',
  $$
  select net.http_get(
    url := 'https://meli-erp-full.vercel.app/api/cron/amazon?tarea=fnskus',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select valor from public.app_secretos where clave = 'cron_amazon')
    ),
    timeout_milliseconds := 55000
  );
  $$
);
