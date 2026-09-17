import { NextRequest, NextResponse } from "next/server";
import { adminAnalytics } from "@/lib/analytics";
import { isAdminEmail } from "@/lib/admin";
import { authCookie, sessionFromToken } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const user = await sessionFromToken(request.cookies.get(authCookie)?.value);
    if (!user || !isAdminEmail(user.email)) return NextResponse.json({ error: "ADMIN_REQUIRED" }, { status: 403 });
    return NextResponse.json(await adminAnalytics());
  } catch {
    return NextResponse.json({ error: "ANALYTICS_UNAVAILABLE" }, { status: 503 });
  }
}
