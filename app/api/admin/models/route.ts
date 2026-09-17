import { NextRequest, NextResponse } from "next/server";
import { isAdminEmail } from "@/lib/admin";
import { authCookie, sessionFromToken, validRequestOrigin } from "@/lib/auth";
import { adminModelCatalog, deleteModelOverride, upsertModelOverride } from "@/lib/model-catalog";

export const runtime = "nodejs";

async function adminUser(request: NextRequest) {
  const user = await sessionFromToken(request.cookies.get(authCookie)?.value);
  return user && isAdminEmail(user.email) ? user : null;
}

export async function GET(request: NextRequest) {
  try {
    if (!(await adminUser(request))) return NextResponse.json({ error: "ADMIN_REQUIRED" }, { status: 403 });
    return NextResponse.json(await adminModelCatalog());
  } catch {
    return NextResponse.json({ error: "MODEL_CATALOG_UNAVAILABLE" }, { status: 503 });
  }
}

export async function PATCH(request: NextRequest) {
  if (!validRequestOrigin(request)) return NextResponse.json({ error: "CSRF_INVALID" }, { status: 403 });
  try {
    const user = await adminUser(request);
    if (!user) return NextResponse.json({ error: "ADMIN_REQUIRED" }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    const result = await upsertModelOverride({ ...body, actorEmail: user.email });
    return NextResponse.json({ ok: true, ...result, snapshot: await adminModelCatalog() });
  } catch (error) {
    const code = error instanceof Error ? error.message : "MODEL_UPDATE_FAILED";
    const status = /INVALID|NOT_FOUND/.test(code) ? 400 : 503;
    return NextResponse.json({ error: code }, { status });
  }
}

export async function DELETE(request: NextRequest) {
  if (!validRequestOrigin(request)) return NextResponse.json({ error: "CSRF_INVALID" }, { status: 403 });
  try {
    if (!(await adminUser(request))) return NextResponse.json({ error: "ADMIN_REQUIRED" }, { status: 403 });
    const modelId = request.nextUrl.searchParams.get("modelId");
    const result = await deleteModelOverride(modelId);
    return NextResponse.json({ ok: true, ...result, snapshot: await adminModelCatalog() });
  } catch (error) {
    const code = error instanceof Error ? error.message : "MODEL_DELETE_FAILED";
    const status = /INVALID|NOT_FOUND/.test(code) ? 400 : 503;
    return NextResponse.json({ error: code }, { status });
  }
}
