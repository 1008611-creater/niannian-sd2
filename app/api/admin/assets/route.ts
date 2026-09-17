import { NextRequest, NextResponse } from "next/server";
import { isAdminEmail } from "@/lib/admin";
import { authCookie, sessionFromToken, validRequestOrigin } from "@/lib/auth";
import { adminAssetList, setAssetModeration, validAssetVisibility } from "@/lib/asset-library";

export const runtime = "nodejs";

async function adminUser(request: NextRequest) {
  const user = await sessionFromToken(request.cookies.get(authCookie)?.value);
  return user && isAdminEmail(user.email) ? user : null;
}

export async function GET(request: NextRequest) {
  try {
    if (!(await adminUser(request))) return NextResponse.json({ error: "ADMIN_REQUIRED" }, { status: 403 });
    const params = request.nextUrl.searchParams;
    return NextResponse.json(await adminAssetList({
      query: params.get("query") ?? undefined,
      visibility: params.get("visibility") ?? undefined,
      limit: Number(params.get("limit") ?? 60),
    }));
  } catch {
    return NextResponse.json({ error: "ASSET_ADMIN_UNAVAILABLE" }, { status: 503 });
  }
}

export async function PATCH(request: NextRequest) {
  if (!validRequestOrigin(request)) return NextResponse.json({ error: "CSRF_INVALID" }, { status: 403 });
  try {
    const user = await adminUser(request);
    if (!user) return NextResponse.json({ error: "ADMIN_REQUIRED" }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    const visibility = validAssetVisibility(body.visibility);
    if (!visibility) return NextResponse.json({ error: "ASSET_VISIBILITY_INVALID" }, { status: 400 });
    const result = await setAssetModeration({
      assetId: String(body.assetId ?? ""),
      visibility,
      reason: typeof body.reason === "string" ? body.reason : null,
      actorEmail: user.email,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const code = error instanceof Error ? error.message : "ASSET_UPDATE_FAILED";
    const status = /INVALID|NOT_FOUND|REQUIRED/.test(code) ? 400 : 503;
    return NextResponse.json({ error: code }, { status });
  }
}
