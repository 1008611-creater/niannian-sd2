export function cosClientOptions(env = process.env) {
  for (const name of ["TENCENT_COS_SECRET_ID", "TENCENT_COS_SECRET_KEY", "TENCENT_COS_BUCKET", "TENCENT_COS_REGION"]) {
    if (!env[name]) throw new Error("COS_NOT_CONFIGURED");
  }
  return {
    SecretId: env.TENCENT_COS_SECRET_ID,
    SecretKey: env.TENCENT_COS_SECRET_KEY,
    ...(env.TENCENT_COS_SECURITY_TOKEN ? { SecurityToken: env.TENCENT_COS_SECURITY_TOKEN } : {}),
  };
}
