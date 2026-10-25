import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { mongoDb } from "@/lib/mongo";

/** Public liveness check: reports reachability only, never configuration. */
export async function GET() {
  const check = async (fn: () => Promise<unknown>) => {
    const started = Date.now();
    try {
      await fn();
      return { ok: true, ms: Date.now() - started };
    } catch {
      return { ok: false, ms: Date.now() - started };
    }
  };
  const [mysql, mongodb] = await Promise.all([check(() => prisma.$queryRaw`SELECT 1`), check(async () => (await mongoDb()).command({ ping: 1 }))]);
  const ok = mysql.ok && mongodb.ok;
  return NextResponse.json({ status: ok ? "ok" : "degraded", mysql, mongodb }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
