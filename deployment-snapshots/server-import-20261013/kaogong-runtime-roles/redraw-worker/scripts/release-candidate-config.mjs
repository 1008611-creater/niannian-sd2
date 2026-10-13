export const releaseCandidate = Object.freeze({
  releaseId: "niannian-video-reference-contract-1.4.12-rc4",
  releaseVersion: "2026.07.21-rc4",
  referenceContractVersion: 2,
  databaseMigration: "20260713_asset_reference_metadata_v1",
  macWorkerVersion: "1.4.12",
  skillBundleVersion: "1.2.8",
  authorizationPackage: "RELEASE_AUTHORIZATION_PACKAGE_20260721_RC4.md",
  runbook: "deploy/RELEASE_RUNBOOK_1.4.12_RC4.md",
});

export const excludedReleaseDirectories = Object.freeze([
  ".next",
  ".playwright-cli",
  ".postgres-data",
  "data",
  "node_modules",
  "output",
  "release-candidates",
]);

export function isExcludedReleaseDirectory(name) {
  return excludedReleaseDirectories.includes(name) || name.startsWith(".next-preview-");
}
