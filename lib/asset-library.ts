import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { dbAll, dbOne, dbRun, recordAdminAction, timestamp } from "@/lib/auth";

/**
 * 素材库治理：可见性与违规下架。
 *
 * 为什么单独一张 `asset_moderation` 而不是给 `uploaded_assets` 加字段：
 *   1. 现有生产库是 Postgres，加列要写 ALTER 迁移；新建表随应用启动自动建好，零迁移；
 *   2. 素材本体和字节是**历史任务的证据**，下架只能影响"展示"，不能污染原始记录。
 *
 * 三档可见性：
 *   owner（默认）  只有上传者自己可见 —— 与改造前行为一致
 *   public         全站可见，别人也能拿去做参考素材
 *   taken_down     违规下架，任何人（含上传者）都看不到，但字节保留、可一键恢复
 */

export const assetVisibilities = ["owner", "public", "taken_down"] as const;
export type AssetVisibility = (typeof assetVisibilities)[number];

const REUSABLE_ROLES = "'character','product','scene','reference_video','reference_audio'";

type AssetRow = {
  id: string;
  user_id: string;
  role: string;
  original_name: string;
  mime_type: string;
  byte_size: number | string;
  sha256: string;
  local_path: string;
  created_at: string;
};

type ModerationRow = {
  asset_id: string;
  visibility: string;
  reason: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export function validAssetVisibility(value: unknown): AssetVisibility | null {
  return typeof value === "string" && assetVisibilities.includes(value as AssetVisibility) ? (value as AssetVisibility) : null;
}

export const assetVisibilityNames: Record<AssetVisibility, string> = {
  owner: "仅本人",
  public: "公共素材",
  taken_down: "已下架",
};

async function moderationFor(assetId: string) {
  const row = await dbOne<ModerationRow>("SELECT * FROM asset_moderation WHERE asset_id = ? LIMIT 1", [assetId]);
  return row
    ? { visibility: (validAssetVisibility(row.visibility) ?? "owner") as AssetVisibility, reason: row.reason, updatedBy: row.updated_by, updatedAt: row.updated_at }
    : { visibility: "owner" as AssetVisibility, reason: null, updatedBy: null, updatedAt: null };
}

export async function setAssetModeration(input: {
  assetId: string;
  visibility: AssetVisibility;
  reason?: string | null;
  actorEmail: string;
}) {
  const assetId = typeof input.assetId === "string" ? input.assetId.trim() : "";
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(assetId)) throw new Error("ASSET_ID_INVALID");
  const visibility = validAssetVisibility(input.visibility);
  if (!visibility) throw new Error("ASSET_VISIBILITY_INVALID");
  // 下架必须写理由：这是给用户的交代，也是以后复盘的依据。
  const reason = typeof input.reason === "string" && input.reason.trim() ? input.reason.trim().slice(0, 280) : null;
  if (visibility === "taken_down" && !reason) throw new Error("ASSET_TAKEDOWN_REASON_REQUIRED");

  const asset = await dbOne<{ id: string }>("SELECT id FROM uploaded_assets WHERE id = ? LIMIT 1", [assetId]);
  if (!asset) throw new Error("ASSET_NOT_FOUND");

  const now = timestamp();
  await dbRun(
    `INSERT INTO asset_moderation (asset_id, visibility, reason, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(asset_id) DO UPDATE SET visibility = excluded.visibility, reason = excluded.reason,
       updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    [assetId, visibility, reason, input.actorEmail, now, now],
  );
  await recordAdminAction({
    actorEmail: input.actorEmail,
    targetType: "asset",
    targetId: assetId,
    action: `visibility:${visibility}`,
    detail: reason,
  });
  return { assetId, visibility, reason };
}

export type AdminAssetRow = {
  id: string;
  ownerEmail: string;
  ownerId: string;
  role: string;
  name: string;
  mimeType: string;
  byteSize: number;
  visibility: AssetVisibility;
  reason: string | null;
  moderatedBy: string | null;
  moderatedAt: string | null;
  hiddenByOwner: boolean;
  createdAt: string;
  previewUrl: string;
};

export async function adminAssetList(input: { query?: string; visibility?: string; limit?: number } = {}) {
  const limit = Math.max(1, Math.min(200, Math.trunc(Number(input.limit ?? 60)) || 60));
  const term = input.query?.trim().toLowerCase() ?? "";
  const visibility = validAssetVisibility(input.visibility);
  const values: unknown[] = [];
  let where = "";
  if (visibility) {
    where += ` AND COALESCE(asset_moderation.visibility, 'owner') = ?`;
    values.push(visibility);
  }
  if (term) {
    where += ` AND (LOWER(uploaded_assets.original_name) LIKE ? OR LOWER(users.email) LIKE ? OR LOWER(uploaded_assets.id) LIKE ?)`;
    values.push(`%${term}%`, `%${term}%`, `%${term}%`);
  }
  const rows = await dbAll<AssetRow & {
    owner_email: string;
    visibility: string;
    reason: string | null;
    updated_by: string | null;
    moderated_at: string | null;
    hidden: number | string | null;
  }>(
    `SELECT uploaded_assets.*, users.email AS owner_email,
            COALESCE(asset_moderation.visibility, 'owner') AS visibility,
            asset_moderation.reason, asset_moderation.updated_by,
            asset_moderation.updated_at AS moderated_at,
            COALESCE(asset_library_visibility.hidden, 0) AS hidden
       FROM uploaded_assets
       JOIN users ON users.id = uploaded_assets.user_id
       LEFT JOIN asset_moderation ON asset_moderation.asset_id = uploaded_assets.id
       LEFT JOIN asset_library_visibility ON asset_library_visibility.asset_id = uploaded_assets.id
      WHERE 1 = 1${where}
      ORDER BY uploaded_assets.created_at DESC
      LIMIT ?`,
    [...values, limit] as never[],
  );
  return {
    assets: rows.map<AdminAssetRow>((row) => ({
      id: row.id,
      ownerEmail: row.owner_email,
      ownerId: row.user_id,
      role: row.role,
      name: row.original_name,
      mimeType: row.mime_type,
      byteSize: Number(row.byte_size ?? 0),
      visibility: (validAssetVisibility(row.visibility) ?? "owner") as AssetVisibility,
      reason: row.reason,
      moderatedBy: row.updated_by,
      moderatedAt: row.moderated_at,
      hiddenByOwner: Number(row.hidden ?? 0) === 1,
      createdAt: row.created_at,
      previewUrl: `/media/assets/${encodeURIComponent(row.id)}`,
    })),
    summary: {
      returned: rows.length,
      limit,
    },
  };
}

/** 源站：别人设为「公共」的素材，当前用户也能看到。 */
export async function listPublicAssets(viewerId: string) {
  const rows = await dbAll<AssetRow>(
    `SELECT uploaded_assets.* FROM uploaded_assets
       JOIN asset_moderation ON asset_moderation.asset_id = uploaded_assets.id
      WHERE asset_moderation.visibility = 'public'
        AND uploaded_assets.user_id <> ?
        AND uploaded_assets.role IN (${REUSABLE_ROLES})
        AND uploaded_assets.mime_type LIKE '%/%' AND uploaded_assets.byte_size > 0
      ORDER BY uploaded_assets.created_at DESC LIMIT 60`,
    [viewerId],
  );
  return rows.map((asset) => ({
    id: asset.id,
    role: asset.role,
    name: asset.original_name,
    mimeType: asset.mime_type,
    byteSize: Number(asset.byte_size ?? 0),
    hidden: false,
    isPublic: true,
    previewUrl: `/media/assets/${encodeURIComponent(asset.id)}`,
    createdAt: asset.created_at,
  }));
}

/** 下单时：别人的素材只有在「公共且未下架」时才允许被引用。 */
export async function publicAssetUsable(assetId: string) {
  const row = await dbOne<{ asset_id: string }>(
    "SELECT asset_id FROM asset_moderation WHERE asset_id = ? AND visibility = 'public' LIMIT 1",
    [assetId],
  );
  return Boolean(row);
}

async function readVerifiedAsset(asset: AssetRow) {
  const root = path.resolve(process.cwd(), "data", "video-assets", asset.user_id);
  const localPath = path.resolve(asset.local_path);
  if (!localPath.startsWith(`${root}${path.sep}`)) throw new Error("ASSET_PATH_INVALID");
  const file = await readFile(localPath);
  const byteSize = Number(asset.byte_size ?? 0);
  if (file.length !== byteSize || createHash("sha256").update(file).digest("hex") !== asset.sha256) throw new Error("ASSET_HASH_MISMATCH");
  return { file, mimeType: asset.mime_type, name: asset.original_name };
}

/**
 * 看素材的人可能是三种身份：上传者本人、拿到公共素材的其他用户、管理员。
 * 管理员能看已下架的（否则没法复核自己下了什么），普通用户不行。
 */
export async function previewForViewer(input: { viewerId: string; isAdmin: boolean; assetId: string }) {
  const asset = await dbOne<AssetRow>("SELECT * FROM uploaded_assets WHERE id = ? LIMIT 1", [input.assetId]);
  if (!asset) throw new Error("ASSET_NOT_FOUND");
  const moderation = await moderationFor(asset.id);
  const isOwner = asset.user_id === input.viewerId;
  if (!input.isAdmin) {
    if (moderation.visibility === "taken_down") throw new Error("ASSET_NOT_FOUND");
    if (!isOwner && moderation.visibility !== "public") throw new Error("ASSET_NOT_FOUND");
  }
  return readVerifiedAsset(asset);
}
