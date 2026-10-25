import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { AppError, AuthenticationError, logServerError, toUserMessage } from "@/lib/errors";
import type { Permission } from "@/lib/permissions";
import { requireActor } from "@/server/auth/session";
import type { SessionUser } from "@/server/services/auth.service";

/**
 * JSON route-handler wrapper: authenticates via the session cookie,
 * enforces the permission, rejects cross-origin mutations, and converts
 * errors to safe JSON responses (no stack traces or driver messages).
 */
export function apiRoute<Ctx = unknown>(
  permission: Permission,
  handler: (request: NextRequest, actor: SessionUser, ctx: Ctx) => Promise<unknown>,
) {
  return async (request: NextRequest, ctx: Ctx) => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        const origin = request.headers.get("origin");
        if (origin && origin !== request.nextUrl.origin) {
          return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
        }
      }
      const actor = await requireActor(permission);
      const data = await handler(request, actor, ctx);
      return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (error instanceof AppError) {
        return NextResponse.json({ error: error.message, fieldErrors: error.fieldErrors }, { status: error instanceof AuthenticationError ? 401 : error.status });
      }
      const message = toUserMessage(error, "");
      if (message) return NextResponse.json({ error: message }, { status: 422 });
      logServerError(`API ${request.method} ${request.nextUrl.pathname}`, error);
      return NextResponse.json({ error: "Internal error. No changes were saved." }, { status: 500 });
    }
  };
}

export async function jsonBody(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export function searchParam(request: NextRequest, name: string): string | undefined {
  return request.nextUrl.searchParams.get(name) ?? undefined;
}

export function intSearchParam(request: NextRequest, name: string): number | undefined {
  const v = request.nextUrl.searchParams.get(name);
  return v && /^\d{1,9}$/.test(v) ? Number(v) : undefined;
}
