import { NextRequest, NextResponse } from "next/server";
import { authCookie, sessionFromToken } from "@/lib/auth";
import { providerDescriptors } from "@/lib/provider-contract";
import { listPublicModels } from "@/lib/model-catalog";
import { type ZiyuModel, ZiyuApiError, ziyuConfigured, ziyuModelSyncStatus } from "@/lib/ziyu-api";

export async function GET(request: NextRequest) {
  const user = await sessionFromToken(request.cookies.get(authCookie)?.value).catch(() => null);
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const configured = ziyuConfigured();
  // 源站只应该看到后台上架的模型，所以用合并了 model_overrides 的目录，而不是裸渠道列表。
  let models: ZiyuModel[] = [];
  let state: "ready" | "not_configured" | "unavailable" = configured ? "ready" : "not_configured";
  let error: string | undefined;
  if (configured) {
    try {
      models = await listPublicModels();
    } catch (cause) {
      state = "unavailable";
      error = cause instanceof ZiyuApiError ? cause.message : "紫域模型目录暂时不可用";
    }
  }
  const clientModels = models;
  const sync = ziyuModelSyncStatus();
  return NextResponse.json({
    providers: providerDescriptors.map((provider) => provider.id === "ziyu" ? { ...provider, label: "智能视频渠道", purpose: "实时可用的视频与图片生成渠道", configured, state, models: clientModels } : provider),
    ziyu: {
      configured,
      state: sync.stale && state === "ready" ? "degraded" : state,
      models: clientModels,
      modelSync: sync,
      ...(error ? { error } : {}),
    },
  });
}
