import type { Inspection } from './inspection';

/** 通行路线段 */
export interface RouteSegment {
  id: string;
  /** 路线名称，同一条路线的多段共用一个名称 */
  routeName: string;
  fromPointId: string;
  toPointId: string;
  /** 长度 m */
  length: number;
  /** 沿途障碍数 */
  obstacleCount: number;
  /** 台阶数 */
  stepCount: number;
  /** 路缘高差 cm */
  curbHeight: number;
  /**
   * 保存当时是否可轮椅通行的历史快照（由当时逐段物理指标与端点最新核验共同判定）。
   * 落库后不再改写；当前是否可通行一律以实时重算的全线判定为准。
   */
  wheelchairPassable: boolean;
  /** 在整条路线中的顺序，从 1 开始 */
  order: number;
  createdAt: string;
}

export type RouteSegmentDraft = Omit<RouteSegment, 'id' | 'createdAt' | 'wheelchairPassable'>;

/** 点位的最新核验状态：无核验记录即为未核验 */
export type PointCheckStatus = '合格' | '限期整改' | '不合格' | '未核验';

/** 单个点位的通行核验判定 */
export interface PointVerdict {
  pointId: string;
  status: PointCheckStatus;
  /** 判定所依据的最新核验记录，未核验时为 null */
  latest: Inspection | null;
  passable: boolean;
  /** 判定原因（不含点位名称前缀，供表格逐行展示） */
  reasons: string[];
}

/** 全线判定结果 */
export interface RouteVerdict {
  routeName: string;
  passable: boolean;
  totalLength: number;
  totalObstacles: number;
  totalSteps: number;
  maxCurbHeight: number;
  /** 阻断原因：物理路段问题 + 点位核验问题，已带「第 N 段」「点位名称」前缀 */
  reasons: string[];
  /** 全线涉及点位（含起点与终点，按路线顺序去重）的最新核验判定 */
  pointVerdicts: PointVerdict[];
  /** 其中最新核验合格的点位数 */
  qualifiedPoints: number;
}
