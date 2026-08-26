-- Modo UGC en los videos de producto: una persona (generada con Soul a
-- partir de la foto real) presenta el calzado hablando a cámara.
--
-- La voz puede ser del vendedor (graba o sube un audio; se convierte a WAV
-- en el navegador y se guarda en el CDN de Higgsfield) y entonces Speak v2
-- anima a la persona con lip sync 10-15 s; sin audio, Veo 3.1 genera la voz
-- en español (8 s). El audio_url guarda la URL del WAV en el CDN para que
-- el vigilante lo mande a Speak cuando la imagen de la persona esté lista.

alter table videos_producto
  add column if not exists audio_url text;
