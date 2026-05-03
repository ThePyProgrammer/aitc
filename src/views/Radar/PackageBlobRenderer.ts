import type { Viewport } from '../../stores/radarStore';
import {
  type GraphTheme,
  DEFAULT_THEME_ID,
  THEMES,
} from './themes';
import type { PackageBlob } from './packageBlobs';

const FALLBACK_THEME: GraphTheme = THEMES[DEFAULT_THEME_ID];

export interface PackageBlobDrawOptions {
  zoom: number;
  viewport: Viewport;
  canvasWidth: number;
  canvasHeight: number;
  hoveredBlobId?: string | null;
  selectedBlobId?: string | null;
  maxLabels?: number;
  theme?: GraphTheme;
}

const CONFLICT_COLOR = '#ff7351';
const ACTIVITY_COLOR = '#ffd16f';
const ACTIVE_COLOR = '#8eff71';

function screenDiameterToWorld(diameterPx: number, zoom: number): number {
  return diameterPx / Math.max(zoom, 0.1);
}

function shouldDrawLabel(blob: PackageBlob, rank: number, maxLabels: number): boolean {
  return blob.conflictCount > 0 || rank < maxLabels;
}

export function drawPackageBlobs(
  ctx: CanvasRenderingContext2D,
  blobs: PackageBlob[],
  options: PackageBlobDrawOptions,
): void {
  const zoom = Math.max(options.zoom, 0.1);
  const theme = options.theme ?? FALLBACK_THEME;
  const maxLabels = options.maxLabels ?? 12;

  blobs.forEach((blob, rank) => {
    const radius = screenDiameterToWorld(blob.diameterPx, zoom) / 2;
    const isConflict = blob.conflictCount > 0;
    const isHovered = options.hoveredBlobId === blob.id;
    const isSelected = options.selectedBlobId === blob.id;

    ctx.save();
    if (isConflict) {
      ctx.shadowColor = CONFLICT_COLOR;
      ctx.shadowBlur = 18;
      ctx.fillStyle = 'rgba(255, 115, 81, 0.16)';
      ctx.strokeStyle = CONFLICT_COLOR;
    } else if (blob.activeAgentCount > 0) {
      ctx.shadowColor = ACTIVITY_COLOR;
      ctx.shadowBlur = 12;
      ctx.fillStyle = theme.hullFill;
      ctx.strokeStyle = ACTIVITY_COLOR;
    } else if (blob.contentionScore > 0) {
      ctx.shadowColor = ACTIVITY_COLOR;
      ctx.shadowBlur = 10 * Math.max(0.25, blob.contentionScore);
      ctx.fillStyle = theme.hullFill;
      ctx.strokeStyle = theme.hullStroke;
    } else {
      ctx.fillStyle = theme.hullFill;
      ctx.strokeStyle = theme.hullStroke;
    }

    ctx.globalAlpha = isSelected || isHovered ? 0.95 : 0.72;
    ctx.lineWidth = (isConflict ? 2 : 1) / zoom;
    ctx.beginPath();
    ctx.arc(blob.centroid.x, blob.centroid.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (isHovered || isSelected) {
      ctx.shadowColor = ACTIVE_COLOR;
      ctx.shadowBlur = 40;
      ctx.strokeStyle = ACTIVE_COLOR;
      ctx.lineWidth = 1 / zoom;
      ctx.beginPath();
      ctx.arc(blob.centroid.x, blob.centroid.y, radius + 4 / zoom, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    if (isConflict) {
      ctx.save();
      const badgeR = 8 / zoom;
      const badgeX = blob.centroid.x + radius * 0.7;
      const badgeY = blob.centroid.y - radius * 0.7;
      ctx.fillStyle = CONFLICT_COLOR;
      ctx.strokeStyle = theme.canvasBackground;
      ctx.lineWidth = 1 / zoom;
      ctx.beginPath();
      ctx.arc(badgeX, badgeY, badgeR, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = theme.canvasBackground;
      ctx.font = `${10 / zoom}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(blob.conflictCount), badgeX, badgeY);
      ctx.restore();
    }

    if (shouldDrawLabel(blob, rank, maxLabels)) {
      ctx.save();
      ctx.fillStyle = isConflict ? CONFLICT_COLOR : theme.folderLabelColor;
      ctx.globalAlpha = isConflict ? 1 : 0.82;
      ctx.font = `${blob.depth <= 1 ? 14 : 10 / zoom}px "Space Grotesk", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(blob.label, blob.centroid.x, blob.centroid.y);
      ctx.restore();
    }
  });
}

export function findPackageBlobAtWorld(
  blobs: PackageBlob[],
  worldX: number,
  worldY: number,
  zoom: number,
): PackageBlob | null {
  const safeZoom = Math.max(zoom, 0.1);
  for (let i = blobs.length - 1; i >= 0; i--) {
    const blob = blobs[i];
    const hitRadius = Math.max(blob.diameterPx / 2, 22) / safeZoom;
    if (Math.hypot(blob.centroid.x - worldX, blob.centroid.y - worldY) <= hitRadius) {
      return blob;
    }
  }
  return null;
}
