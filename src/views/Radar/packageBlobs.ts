import type { GraphNode } from '../../stores/radarStore';

export interface PackageBlob {
  id: string;
  dirKey: string;
  depth: number;
  fileCount: number;
  centroid: { x: number; y: number };
  diameterPx: number;
  contentionScore: number;
  conflictCount: number;
  activeAgentCount: number;
  label: string;
  importance: number;
  memberFileIds: string[];
}

export interface PackageBlobInputs {
  nodes: GraphNode[];
  contentionScores?: Map<string, number>;
  activeConflictPaths?: Iterable<string>;
  activeAgentFiles?: Iterable<string>;
}

interface GroupAccumulator {
  dirKey: string;
  depth: number;
  memberFileIds: string[];
  xSum: number;
  ySum: number;
  contentionScore: number;
  conflictCount: number;
  activeAgentCount: number;
}

let cacheEpoch = '__sentinel__';
let cache: PackageBlob[] = [];

const WORKSPACE_MIN_DIAMETER = 24;
const WORKSPACE_MAX_DIAMETER = 96;
const PACKAGE_MIN_DIAMETER = 20;
const PACKAGE_MAX_DIAMETER = 72;

function clamp(min: number, value: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function blobDiameterPx(fileCount: number, level: 'workspace' | 'package' = 'workspace'): number {
  const min = level === 'workspace' ? WORKSPACE_MIN_DIAMETER : PACKAGE_MIN_DIAMETER;
  const max = level === 'workspace' ? WORKSPACE_MAX_DIAMETER : PACKAGE_MAX_DIAMETER;
  return clamp(min, Math.sqrt(fileCount) * 8, max);
}

function dirDepth(dirKey: string): number {
  if (dirKey === '') return 0;
  return dirKey.split('/').filter(Boolean).length;
}

function topLevelDir(node: GraphNode): string {
  if (node.dirKey === '') return node.id.split('/')[0] ?? node.id;
  return node.dirKey.split('/')[0] ?? node.dirKey;
}

function packageDir(node: GraphNode): string {
  if (node.dirKey === '') return topLevelDir(node);
  return node.dirKey;
}

function addToGroup(
  groups: Map<string, GroupAccumulator>,
  dirKey: string,
  node: GraphNode,
  contentionScores: Map<string, number>,
  activeConflictPaths: Set<string>,
  activeAgentFiles: Set<string>,
): void {
  if (node.x === undefined || node.y === undefined) return;
  const group = groups.get(dirKey) ?? {
    dirKey,
    depth: dirDepth(dirKey),
    memberFileIds: [],
    xSum: 0,
    ySum: 0,
    contentionScore: 0,
    conflictCount: 0,
    activeAgentCount: 0,
  };

  group.memberFileIds.push(node.id);
  group.xSum += node.x;
  group.ySum += node.y;
  group.contentionScore = Math.max(group.contentionScore, contentionScores.get(node.id) ?? 0);
  if (activeConflictPaths.has(node.id)) group.conflictCount += 1;
  if (activeAgentFiles.has(node.id)) group.activeAgentCount += 1;
  groups.set(dirKey, group);
}

function groupToBlob(group: GroupAccumulator, level: 'workspace' | 'package'): PackageBlob {
  const fileCount = group.memberFileIds.length;
  const conflictCount = group.conflictCount;
  const activeAgentCount = group.activeAgentCount;
  const contentionScore = group.contentionScore;
  return {
    id: `${level}:${group.dirKey || '(root)'}`,
    dirKey: group.dirKey,
    depth: group.depth,
    fileCount,
    centroid: {
      x: group.xSum / fileCount,
      y: group.ySum / fileCount,
    },
    diameterPx: blobDiameterPx(fileCount, level),
    contentionScore,
    conflictCount,
    activeAgentCount,
    label: (group.dirKey || '(root)').split('/').at(-1)!.toUpperCase(),
    importance: fileCount + (conflictCount * 50) + (activeAgentCount * 25) + (contentionScore * 20),
    memberFileIds: [...group.memberFileIds].sort(),
  };
}

function buildEpoch(inputs: PackageBlobInputs): string {
  const nodesKey = inputs.nodes
    .map((n) => `${n.id}:${n.kind ?? 'file'}:${n.dirKey}:${n.x ?? 'x'}:${n.y ?? 'y'}`)
    .join('|');
  const contentionKey = [...(inputs.contentionScores ?? new Map()).entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join('|');
  const conflictKey = [...(inputs.activeConflictPaths ?? [])].sort().join('|');
  const agentKey = [...(inputs.activeAgentFiles ?? [])].sort().join('|');
  return `${nodesKey}::${contentionKey}::${conflictKey}::${agentKey}`;
}

export function derivePackageBlobs(inputs: PackageBlobInputs): PackageBlob[] {
  const epoch = buildEpoch(inputs);
  if (epoch === cacheEpoch) return cache;

  const contentionScores = inputs.contentionScores ?? new Map<string, number>();
  const activeConflictPaths = new Set(inputs.activeConflictPaths ?? []);
  const activeAgentFiles = new Set(inputs.activeAgentFiles ?? []);
  const workspaceGroups = new Map<string, GroupAccumulator>();
  const packageGroups = new Map<string, GroupAccumulator>();

  for (const node of inputs.nodes) {
    if (node.kind === 'bridge') continue;
    if (node.x === undefined || node.y === undefined) continue;
    addToGroup(workspaceGroups, topLevelDir(node), node, contentionScores, activeConflictPaths, activeAgentFiles);
    addToGroup(packageGroups, packageDir(node), node, contentionScores, activeConflictPaths, activeAgentFiles);
  }

  cacheEpoch = epoch;
  cache = [
    ...[...workspaceGroups.values()].map((g) => groupToBlob(g, 'workspace')),
    ...[...packageGroups.values()].map((g) => groupToBlob(g, 'package')),
  ].sort((a, b) => b.importance - a.importance || a.dirKey.localeCompare(b.dirKey));
  return cache;
}

export function selectWorkspaceBlobs(blobs: PackageBlob[]): PackageBlob[] {
  return blobs
    .filter((blob) => blob.id.startsWith('workspace:'))
    .sort((a, b) => b.importance - a.importance || a.dirKey.localeCompare(b.dirKey));
}

export function selectPackageBlobs(blobs: PackageBlob[]): PackageBlob[] {
  return blobs
    .filter((blob) => blob.id.startsWith('package:'))
    .sort((a, b) => b.importance - a.importance || a.dirKey.localeCompare(b.dirKey));
}

export function _resetPackageBlobCacheForTest(): void {
  cacheEpoch = '__sentinel__';
  cache = [];
}
