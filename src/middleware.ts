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

  const ruta = request.nextUrl.pathname;
  const publica =
    ruta.startsWith("/login") ||
    ruta.startsWith("/api/cron") ||
    ruta.startsWith("/api/meli/callback") ||
    ruta.startsWith("/api/meli/webhook") ||
    ruta.startsWith("/api/meli/skus-pendientes") ||
    ruta.startsWith("/auth");

  if (!user && !publica) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("destino", ruta);
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
