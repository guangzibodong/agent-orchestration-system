export type ArtifactPreviewRequest = {
  workflowId: string;
  artifactPath: string;
  maxBytes?: number;
};

export type ArtifactPreviewResponse = {
  workflowId: string;
  path: string;
  content: string;
  contentType: string;
  sizeBytes: number;
  maxBytes: number;
  truncated: boolean;
};

export type ArtifactPreviewDisplay = {
  title: string;
  meta: string;
  content: string;
  truncated: boolean;
};

export function buildArtifactPreviewPath(
  request: ArtifactPreviewRequest
): string {
  const maxBytes = request.maxBytes ?? 65536;

  return `/workflows/${request.workflowId}/artifact?maxBytes=${maxBytes}&path=${encodeURIComponent(
    request.artifactPath
  )}`;
}

export function buildArtifactPreviewDisplay(
  preview: ArtifactPreviewResponse
): ArtifactPreviewDisplay {
  const title = preview.path.split(/[\\/]/).at(-1) ?? preview.path;

  return {
    title,
    meta: `${formatBytes(Math.min(preview.sizeBytes, preview.maxBytes))} of ${formatBytes(
      preview.sizeBytes
    )} bytes loaded`,
    content: preview.content,
    truncated: preview.truncated
  };
}

function formatBytes(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}
