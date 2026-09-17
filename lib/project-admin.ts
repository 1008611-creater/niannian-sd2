import { dbAll, dbOne, dbRun, recordAdminAction, timestamp } from "@/lib/auth";

/**
 * 后台项目管理（只读列表 + 状态强制修正）。
 *
 * 刻意**不做删除**：删项目会连带删掉 canvas / 任务关联 / 素材关联，不可逆。
 * 真要清理，等老大明确指定项目 ID 再单独处理。
 */

export type AdminProjectRow = {
  id: string;
  title: string;
  type: string;
  status: string;
  progress: number;
  episodes: number;
  ownerEmail: string;
  ownerId: string;
  assetCount: number;
  taskCount: number;
  createdAt: string;
  updatedAt: string;
};

const PROJECT_STATUSES = ["准备中", "进行中", "已暂停", "已完成", "已冻结"] as const;

export function validProjectStatus(value: unknown): string | null {
  return typeof value === "string" && PROJECT_STATUSES.includes(value as (typeof PROJECT_STATUSES)[number])
    ? value
    : null;
}

function asInteger(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isInteger(parsed) ? parsed : 0;
}

export async function adminProjectList(input: { query?: string; limit?: number } = {}) {
  const limit = Math.max(1, Math.min(200, Math.trunc(Number(input.limit ?? 60)) || 60));
  const term = input.query?.trim().toLowerCase() ?? "";
  const values: unknown[] = [];
  let where = "";
  if (term) {
    where = ` WHERE (LOWER(projects.title) LIKE ? OR LOWER(users.email) LIKE ? OR LOWER(projects.id) LIKE ?)`;
    values.push(`%${term}%`, `%${term}%`, `%${term}%`);
  }
  const rows = await dbAll<{
    id: string; title: string; type: string; status: string; progress: number | string;
    episodes: number | string; user_id: string; owner_email: string;
    asset_count: number | string; task_count: number | string;
    created_at: string; updated_at: string;
  }>(
    `SELECT projects.*, users.email AS owner_email,
            (SELECT COUNT(*) FROM project_assets WHERE project_assets.project_id = projects.id) AS asset_count,
            (SELECT COUNT(*) FROM project_task_links WHERE project_task_links.project_id = projects.id) AS task_count
       FROM projects JOIN users ON users.id = projects.user_id${where}
      ORDER BY projects.updated_at DESC LIMIT ?`,
    [...values, limit] as never[],
  );
  return {
    projects: rows.map<AdminProjectRow>((row) => ({
      id: row.id,
      title: row.title,
      type: row.type,
      status: row.status,
      progress: asInteger(row.progress),
      episodes: asInteger(row.episodes),
      ownerEmail: row.owner_email,
      ownerId: row.user_id,
      assetCount: asInteger(row.asset_count),
      taskCount: asInteger(row.task_count),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    statuses: [...PROJECT_STATUSES],
    summary: {
      returned: rows.length,
      limit,
      frozen: rows.filter((row) => row.status === "已冻结").length,
    },
  };
}

export async function setProjectStatus(input: { projectId: string; status: string; actorEmail: string }) {
  const projectId = typeof input.projectId === "string" ? input.projectId.trim() : "";
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(projectId)) throw new Error("PROJECT_ID_INVALID");
  const status = validProjectStatus(input.status);
  if (!status) throw new Error("PROJECT_STATUS_INVALID");
  const project = await dbOne<{ id: string; status: string }>("SELECT id, status FROM projects WHERE id = ? LIMIT 1", [projectId]);
  if (!project) throw new Error("PROJECT_NOT_FOUND");
  const now = timestamp();
  await dbRun("UPDATE projects SET status = ?, updated_at = ? WHERE id = ?", [status, now, projectId]);
  await recordAdminAction({
    actorEmail: input.actorEmail,
    targetType: "project",
    targetId: projectId,
    action: `status:${status}`,
    detail: `原状态：${project.status}`,
  });
  return { projectId, status, previousStatus: project.status };
}
