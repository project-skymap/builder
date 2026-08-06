import type { ConstellationConfig } from "@project-skymap/library";
import { ARRANGEMENT_RADIUS } from "./shared";

export type Vec2 = {
  x: number;
  y: number;
};

export type Vec3 = {
  x: number;
  y: number;
  z: number;
};

export type ConstellationItem = ConstellationConfig["constellations"][number];

export function bookKeyFromConstellation(item: ConstellationItem): string {
  return item.anchors[0]?.split(":")[1] ?? item.id;
}

export function mapPointToDomeCenter(point: Vec2): [number, number, number] {
  const radius2d = Math.hypot(point.x, point.y);
  const scale = radius2d > 0.98 ? 0.98 / radius2d : 1;
  const x = point.x * scale;
  const y = point.y * scale;
  const domeY = Math.sqrt(Math.max(0, 1 - x * x - y * y));
  return [-x * ARRANGEMENT_RADIUS, domeY * ARRANGEMENT_RADIUS, y * ARRANGEMENT_RADIUS];
}

export function mapPointToDomeVec(point: Vec2): Vec3 {
  const center = mapPointToDomeCenter(point);
  return { x: center[0], y: center[1], z: center[2] };
}

export function domeVecToMapPoint(vec: Vec3): Vec2 {
  return {
    x: -vec.x / ARRANGEMENT_RADIUS,
    y: vec.z / ARRANGEMENT_RADIUS,
  };
}

export function constellationCenterVec(item: ConstellationItem | null, fallbackCenter: Vec2 | null): Vec3 {
  if (item?.center) {
    return {
      x: item.center[0],
      y: item.center[1],
      z: item.center[2] ?? 0,
    };
  }
  return mapPointToDomeVec(fallbackCenter ?? { x: 0, y: 0 });
}

function vecLength(vec: Vec3): number {
  return Math.hypot(vec.x, vec.y, vec.z);
}

function normalizeVec(vec: Vec3): Vec3 {
  const length = vecLength(vec);
  if (length <= 1e-9) return { x: 0, y: 1, z: 0 };
  return { x: vec.x / length, y: vec.y / length, z: vec.z / length };
}

export function normalizeVec2(vec: Vec2): Vec2 {
  const length = Math.hypot(vec.x, vec.y);
  if (length <= 1e-9) return { x: 1, y: 0 };
  return { x: vec.x / length, y: vec.y / length };
}

function dotVec(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function crossVec(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function rotateVecAroundAxis(vec: Vec3, axis: Vec3, angleRad: number): Vec3 {
  const unitAxis = normalizeVec(axis);
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const cross = crossVec(unitAxis, vec);
  const dot = dotVec(unitAxis, vec);
  return {
    x: vec.x * cos + cross.x * sin + unitAxis.x * dot * (1 - cos),
    y: vec.y * cos + cross.y * sin + unitAxis.y * dot * (1 - cos),
    z: vec.z * cos + cross.z * sin + unitAxis.z * dot * (1 - cos),
  };
}

function defaultTangentFrame(centerNorm: Vec3): { rightDir: Vec3; upDir: Vec3 } {
  const worldUp = { x: 0, y: 1, z: 0 };
  const rightBasis = Math.abs(dotVec(centerNorm, worldUp)) > 0.99 ? { x: 1, y: 0, z: 0 } : worldUp;
  let rightDir = normalizeVec(crossVec(rightBasis, centerNorm));
  let upDir = normalizeVec(crossVec(centerNorm, rightDir));
  rightDir = normalizeVec(crossVec(upDir, centerNorm));
  return { rightDir, upDir };
}

export function artworkTangentFrame(item: ConstellationItem | null, fallbackCenter: Vec2 | null): { center: Vec3; rightDir: Vec3; upDir: Vec3 } {
  const center = constellationCenterVec(item, fallbackCenter);
  const centerNorm = normalizeVec(center);
  let { rightDir, upDir } = defaultTangentFrame(centerNorm);
  const rotationRad = ((item?.rotationDeg ?? 0) * Math.PI) / 180;
  if (Math.abs(rotationRad) > 1e-9) {
    rightDir = rotateVecAroundAxis(rightDir, centerNorm, rotationRad);
    upDir = rotateVecAroundAxis(upDir, centerNorm, rotationRad);
  }
  return { center, rightDir, upDir };
}

export function centerToMapPoint(item: ConstellationItem | null, fallbackCenter: Vec2 | null): Vec2 {
  if (item?.center) return domeVecToMapPoint(constellationCenterVec(item, fallbackCenter));
  return fallbackCenter ?? { x: 0, y: 0 };
}
