import { NextRequest, NextResponse } from "next/server";
import { isAdminEmail } from "@/lib/admin";
import { authCookie, sessionFromToken, validRequestOrigin } from "@/lib/auth";
import { adminPricingSnapshot, deletePricingRule, restoreDefaultPricing, upsertPricingRule } from "@/lib/pricing";

export const runtime = "nodejs";

async function adminUser(request: NextRequest) {
  const user = await sessionFromToken(request.cookies.get(authCookie)?.value);
  return user && isAdminEmail(user.email) ? user : null;
}

export async function GET(request: NextRequest) {
  try {
    if (!(await adminUser(request))) return NextResponse.json({ error: "ADMIN_REQUIRED" }, { status: 403 });
    return NextResponse.json(await adminPricingSnapshot());
  } catch {
    return NextResponse.json({ error: "PRICING_UNAVAILABLE" }, { status: 503 });
  }
}

export async function PATCH(request: NextRequest) {
  if (!validRequestOrigin(request)) return NextResponse.json({ error: "CSRF_INVALID" }, { status: 403 });
  try {
    const user = await adminUser(request);
    if (!user) return NextResponse.json({ error: "ADMIN_REQUIRED" }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    if (body.action === "restore_default") {
      return NextResponse.json({ ok: true, ...(await restoreDefaultPricing(user.email)) });
    }
    const result = await upsertPricingRule({ ...body, actorEmail: user.email });
    return NextResponse.json({ ok: true, ...result, snapshot: await adminPricingSnapshot() });
  } catch (error) {
    const code = error instanceof Error ? error.message : "PRICING_UPDATE_FAILED";
    const status = /INVALID|NOT_FOUND|REQUIRED/.test(code) ? 400 : 503;
    return NextResponse.json({ error: code }, { status });
  }
}

export async function DELETE(request: NextRequest) {
  if (!validRequestOrigin(request)) return NextResponse.json({ error: "CSRF_INVALID" }, { status: 403 });
  try {
    if (!(await adminUser(request))) return NextResponse.json({ error: "ADMIN_REQUIRED" }, { status: 403 });
    const id = request.nextUrl.searchParams.get("id");
    const result = await deletePricingRule(id);
    return NextResponse.json({ ok: true, ...result, snapshot: await adminPricingSnapshot() });
  } catch (error) {
    const code = error instanceof Error ? error.message : "PRICING_DELETE_FAILED";
    const status = /INVALID|NOT_FOUND/.test(code) ? 400 : 503;
    return NextResponse.json({ error: code }, { status });
  }
}
