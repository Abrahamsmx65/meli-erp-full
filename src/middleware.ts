import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/config";

/**
 * Refresca la sesión de Supabase en cada petición y manda al login a quien
 * no haya entrado. Los cron de Vercel se autentican con CRON_SECRET, no con
 * sesión, así que /api/cron queda fuera.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // La sesión se lee de la cookie SIN viaje a Supabase: validar contra el
  // servidor en cada clic costaba 100-300 ms fijos por navegación. Solo se
  // valida (y refresca) por red cuando el token está por vencer; los datos
  // siguen protegidos por RLS aunque alguien fabricara una cookie.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  let user = session?.user ?? null;
  const expiraMs = (session?.expires_at ?? 0) * 1000;
  if (!session || expiraMs < Date.now() + 60_000) {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  }

  // Diagonales repetidas ("//preparar/…", cuando la URL base trae diagonal
  // final) se aplastan: la ruta pública es la misma.
  const ruta = request.nextUrl.pathname.replace(/\/{2,}/g, "/");
  const publica =
    ruta.startsWith("/login") ||
    ruta.startsWith("/api/cron") ||
    ruta.startsWith("/api/meli/callback") ||
    // El de TikTok también: el rebote al login tira el ?code= de la URL y
    // el usuario aterriza en el callback sin nada que canjear.
    ruta.startsWith("/api/tiktok/callback") ||
    // Los avisos de TikTok llegan sin sesión; la ruta verifica su firma.
    ruta.startsWith("/api/tiktok/webhook") ||
    ruta.startsWith("/api/meli/webhook") ||
    ruta.startsWith("/api/meli/skus-pendientes") ||
    // Las mismas dos puertas para la cuenta de YAPANIZCEL: el callback de
    // MELI y el resolutor de SKUs que se relanza solo con CRON_SECRET.
    ruta.startsWith("/api/yapanizcel/meli/callback") ||
    ruta.startsWith("/api/yapanizcel/skus-pendientes") ||
    // El trabajo de fondo de netos de fundas (cron cada 10 min con
    // CRON_SECRET; la ruta valida el bearer o la sesión). Sin esta línea el
    // middleware lo mandaba al login con 307 y el cron nunca corrió: por eso
    // fundas llevaba días sin netos reales ni desglose de cargos.
    ruta.startsWith("/api/yapanizcel/netos") ||
    ruta.startsWith("/api/videos/procesar") ||
    ruta.startsWith("/api/videos/diagnostico") ||
    // El acceso sin contraseña a la sección de contenido: la puerta es el
    // token del link, que valida `acceso-contenido.ts`. Sin esto el link
    // rebotaría al login, que es justo lo que no debe pedir.
    ruta.startsWith("/contenido/") ||
    // La estación de preparar pedidos de TikTok, para los empleados: la
    // puerta es el token de la URL (acceso-preparar.ts), no la sesión.
    ruta.startsWith("/preparar/") ||
    ruta.startsWith("/api/preparar-publico/") ||
    ruta.startsWith("/api/contenido-publico/") ||
    ruta.startsWith("/auth");

  if (!user && !publica) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("destino", ruta);
    return NextResponse.redirect(url);
  }

  return response;
}

/**
 * Las rutas que reciben tráfico de MÁQUINAS (los avisos de MELI y TikTok,
 * los cron de Vercel) no pasan por aquí: no traen sesión que refrescar y
 * ya se autentican solas (firma, CRON_SECRET, vendedor conocido). Son
 * millones de peticiones al día; correr el middleware en cada una era
 * puro costo.
 */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/meli/webhook|api/tiktok/webhook|api/yapanizcel/meli/callback|api/cron/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
