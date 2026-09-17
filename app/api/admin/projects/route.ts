import { NextRequest, NextResponse } from "next/server";
import { isAdminEmail } from "@/lib/admin";
import { authCookie, sessionFromToken, validRequestOrigin } from "@/lib/auth";
import { adminProjectList, setProjectStatus } from "@/lib/project-admin";

export const runtime = "nodejs";

async function adminUser(request: NextRequest) {
  const user = await sessionFromToken(request.cookies.get(authCookie)?.value);
  return user && isAdminEmail(user.email) ? user : null;
}

export async function GET(request: NextRequest) {
  try {
    if (!(await adminUser(request))) return NextResponse.json({ error: "ADMIN_REQUIRED" }, { status: 403 });
    const params = request.nextUrl.searchParams;
    return NextResponse.json(await adminProjectList({
      query: params.get("query") ?? undefined,
      limit: Number(params.get("limit") ?? 60),
    }));
  } catch {
    return NextResponse.json({ error: "PROJECT_ADMIN_UNAVAILABLE" }, { status: 503 });
  }
}

export async function PATCH(request: NextRequest) {
  if (!validRequestOrigin(request)) return NextResponse.json({ error: "CSRF_INVALID" }, { status: 403 });
  try {
    const user = await adminUser(request);
    if (!user) return NextResponse.json({ error: "ADMIN_REQUIRED" }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    const result = await setProjectStatus({
      projectId: String(body.projectId ?? ""),
      status: String(body.status ?? ""),
      actorEmail: user.email,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const code = error instanceof Error ? error.message : "PROJECT_UPDATE_FAILED";
    const status = /INVALID|NOT_FOUND/.test(code) ? 400 : 503;
    return NextResponse.json({ error: code }, { status });
  }
}
