import { NextRequest, NextResponse } from "next/server";
import { isAdminEmail } from "@/lib/admin";
import { authCookie, sessionFromToken } from "@/lib/auth";
import { previewForViewer } from "@/lib/asset-library";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await sessionFromToken(request.cookies.get(authCookie)?.value);
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    const { id } = await context.params;
    if (!/^[A-Za-z0-9_-]{12,120}$/.test(id)) return NextResponse.json({ error: "ASSET_INVALID" }, { status: 400 });
    // 管理员能看已下架素材（要复核自己下了什么）；普通用户只能看自己的或公共素材。
    const preview = await previewForViewer({ viewerId: user.id, isAdmin: isAdminEmail(user.email), assetId: id });
    return new NextResponse(preview.file, {
      headers: {
        "content-type": preview.mimeType,
        "cache-control": "private, max-age=300",
        "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(preview.name)}`,
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "ASSET_PREVIEW_FAILED";
    return NextResponse.json({ error: code }, { status: code === "ASSET_NOT_FOUND" ? 404 : /INVALID|MISMATCH/.test(code) ? 400 : 503 });
  }
}
