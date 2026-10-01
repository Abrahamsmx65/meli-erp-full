// La tienda no usa Tailwind: su CSS es propio (src/app/globals.css). Este
// archivo existe para que Next NO suba a buscar el postcss.config.mjs del
// ERP en la raíz del repositorio, que pide @tailwindcss/postcss y aquí no
// está instalado (así tronó el primer despliegue en Vercel).
export default { plugins: {} };
