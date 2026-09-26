import type { InspectionConclusion, Inspection } from './inspection';

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
   * 保存时刻按当时规则判定的可通行快照（历史记录，落库后不再改写）。
   * 当前是否可通行须以最新核验动态复判结果为准。
   */
  wheelchairPassable: boolean;
  /** 在整条路线中的顺序，从 1 开始 */
  order: number;
  createdAt: string;
}

export type RouteSegmentDraft = Omit<RouteSegment, 'id' | 'createdAt' | 'wheelchairPassable'>;

/** 点位闸门状态：取该点位最新一次核验结论，无记录为未核验 */
export type PointGateStatus = InspectionConclusion | '未核验';

/** 路线上单个点位的最新核验闸门结果 */
export interface PointGate {
  pointId: string;
  pointName: string;
  status: PointGateStatus;
  /** 仅最新核验结论为「合格」时放行 */
  passable: boolean;
  /** 判定原因（未通过时为阻断原因，合格时为最新核验说明） */
  reasons: string[];
  /** 所依据的最新核验日期 YYYY-MM-DD，未核验为空串 */
  latestDate: string;
}

/** 全线判定结果 */
export interface RouteVerdict {
  routeName: string;
  passable: boolean;
  totalLength: number;
  totalObstacles: number;
  totalSteps: number;
  maxCurbHeight: number;
  /** 汇总后的阻断原因（路段物理条件 + 点位核验闸门） */
  reasons: string[];
  /** 按路线顺序去重后的各点位核验闸门结果 */
  pointGates: PointGate[];
  /** 未通过核验闸门的点位（未核验 / 限期整改 / 不合格） */
  blockedPoints: PointGate[];
}

/** 路线判定所需的点位核验上下文（由调用方从核验数据中提供，保证判定始终基于最新记录） */
export interface RouteJudgeContext {
  /** 按 pointId 取点位名称（找不到时回退为 pointId） */
  nameOf: (pointId: string) => string;
  /** 取点位最新一次核验记录，从未核验返回 undefined */
  latestInspectionOf: (pointId: string) => Inspection | undefined;
}
