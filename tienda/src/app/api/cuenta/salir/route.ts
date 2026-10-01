import { NextResponse } from "next/server";
import { salir } from "@/lib/sesion";

export async function POST() {
  await salir();
  return NextResponse.json({ ok: true });
}
