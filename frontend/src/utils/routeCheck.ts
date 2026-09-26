import type { Inspection, InspectionConclusion, OccupiedLevel } from '../types/inspection';
import type { PointVerdict, RouteSegment, RouteVerdict } from '../types/route';

/** 阈值常量：依据《无障碍设计规范》常用核验口径 */
export const SLOPE_PASS = 5; // 坡度 ≤ 5% 为合格
export const SLOPE_FAIL = 8; // 坡度 > 8% 直接不合格
export const WIDTH_PASS = 120; // 净宽 ≥ 120cm 为合格
export const WIDTH_MIN = 90; // 净宽 < 90cm 不合格
export const CURB_PASS = 3; // 路缘高差 ≤ 3cm 可轮椅通行
export const CURB_FAIL = 6; // 路缘高差 > 6cm 判定不可通行

export interface JudgeInput {
  slope: number;
  clearWidth: number;
  hasHandrail: boolean;
  tactileContinuous: boolean;
  occupied: OccupiedLevel;
}

export interface JudgeResult {
  conclusion: InspectionConclusion;
  reasons: string[];
}

/** 按实测值给出结论建议 */
export function judgeInspection(input: JudgeInput): JudgeResult {
  const reasons: string[] = [];
  const slope = Number(input.slope) || 0;
  const clearWidth = Number(input.clearWidth) || 0;

  if (slope > SLOPE_FAIL) reasons.push(`坡度 ${slope}% 超过 ${SLOPE_FAIL}% 上限`);
  if (clearWidth < WIDTH_MIN) reasons.push(`净宽 ${clearWidth}cm 小于 ${WIDTH_MIN}cm 下限`);
  if (input.occupied === '长期占用') reasons.push('设施被长期占用，无法正常使用');
  if (reasons.length) return { conclusion: '不合格', reasons };

  const warns: string[] = [];
  if (slope > SLOPE_PASS) warns.push(`坡度 ${slope}% 超过 ${SLOPE_PASS}% 推荐值`);
  if (clearWidth < WIDTH_PASS) warns.push(`净宽 ${clearWidth}cm 小于 ${WIDTH_PASS}cm 推荐值`);
  if (!input.hasHandrail) warns.push('未设置扶手');
  if (!input.tactileContinuous) warns.push('盲道不连续');
  if (input.occupied === '临时占用') warns.push('设施被临时占用');
  if (warns.length) return { conclusion: '限期整改', reasons: warns };

  return { conclusion: '合格', reasons: ['坡度、净宽均满足推荐值，扶手与盲道完好'] };
}

/** 已落库的核验记录（可能带有历史结论）复判 */
export function rejudge(inspection: Inspection): JudgeResult {
  return judgeInspection({
    slope: inspection.slope,
    clearWidth: inspection.clearWidth,
    hasHandrail: inspection.hasHandrail,
    tactileContinuous: inspection.tactileContinuous,
    occupied: inspection.occupied,
  });
}

/**
 * 取一个点位的最新核验记录（按核验日期，同日按入库时间兜底）。
 * 路线是否可通行只认最新一次核验：历史合格记录已被新结论覆盖时不再作数。
 */
export function latestInspectionOf(inspections: Inspection[], pointId: string): Inspection | null {
  let latest: Inspection | null = null;
  for (const ins of inspections) {
    if (ins.pointId !== pointId) continue;
    if (
      !latest ||
      ins.date > latest.date ||
      (ins.date === latest.date && ins.createdAt > latest.createdAt)
    ) {
      latest = ins;
    }
  }
  return latest;
}

/**
 * 单个点位的通行核验判定。
 * 未核验、限期整改、不合格均不可通行；只有最新核验结论为「合格」才可通行。
 */
export function judgePoint(pointId: string, latest: Inspection | null): PointVerdict {
  if (!latest) {
    return {
      pointId,
      status: '未核验',
      latest: null,
      passable: false,
      reasons: ['尚无核验记录，无法确认通行条件'],
    };
  }
  if (latest.conclusion === '合格') {
    return {
      pointId,
      status: '合格',
      latest,
      passable: true,
      reasons: [`${latest.date} 核验合格`],
    };
  }
  if (latest.conclusion === '限期整改') {
    return {
      pointId,
      status: '限期整改',
      latest,
      passable: false,
      reasons: [
        `${latest.date} 核验结论为「限期整改」，整改复检合格前不可通行` +
          (latest.problem ? `；问题：${latest.problem}` : ''),
      ],
    };
  }
  return {
    pointId,
    status: '不合格',
    latest,
    passable: false,
    reasons: [
      `${latest.date} 核验结论为「不合格」` +
        (latest.problem ? `；问题：${latest.problem}` : ''),
    ],
  };
}

/** 单段物理指标判定（长度、障碍数、台阶数、路缘高差），不包含端点核验 */
export function judgeSegment(seg: Pick<RouteSegment, 'curbHeight' | 'stepCount' | 'obstacleCount'>): {
  passable: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  const curb = Number(seg.curbHeight) || 0;
  const steps = Number(seg.stepCount) || 0;
  const obstacles = Number(seg.obstacleCount) || 0;
  if (curb > CURB_FAIL) reasons.push(`路缘高差 ${curb}cm 超过 ${CURB_FAIL}cm，轮椅无法越障`);
  if (steps > 0) reasons.push(`存在 ${steps} 级台阶，需绕行或增设坡道`);
  if (obstacles > 2) reasons.push(`沿途障碍 ${obstacles} 处，通行风险偏高`);
  return { passable: reasons.length === 0, reasons };
}

/** 单段完整判定：物理指标 + 起讫点位最新核验，任一不达标该段即不可通行 */
export function judgeSegmentWithPoints(
  seg: Pick<RouteSegment, 'curbHeight' | 'stepCount' | 'obstacleCount'>,
  endpoints: { from: PointVerdict; to: PointVerdict },
): { passable: boolean; reasons: string[] } {
  const { reasons } = judgeSegment(seg);
  if (!endpoints.from.passable) {
    reasons.push(`起点点位核验未通过：${endpoints.from.reasons.join('；')}`);
  }
  if (!endpoints.to.passable) {
    reasons.push(`终点点位核验未通过：${endpoints.to.reasons.join('；')}`);
  }
  return { passable: reasons.length === 0, reasons };
}

/** 全线判定所需的核验上下文 */
export interface VerdictContext {
  /** 全部核验记录，函数内部按点位取最新一条 */
  inspections: Inspection[];
  /** 点位名称查表（可选），用于在阻断原因中点名具体点位 */
  nameOf?: (pointId: string) => string | undefined;
}

/**
 * 全线判定：逐段物理判定 + 全线涉及点位的最新核验汇总。
 * 任一点位未核验 / 限期整改 / 不合格，或任一段物理指标不达标，全线即不可通行。
 * context 缺省时仅按物理指标判定（不应在正式流程中使用）。
 */
export function buildVerdict(
  routeName: string,
  segments: Pick<
    RouteSegment,
    'curbHeight' | 'stepCount' | 'obstacleCount' | 'length' | 'order' | 'fromPointId' | 'toPointId'
  >[],
  context?: VerdictContext,
): RouteVerdict {
  const ordered = [...segments].sort((a, b) => a.order - b.order);
  const totalLength = Math.round(ordered.reduce((n, s) => n + (Number(s.length) || 0), 0) * 10) / 10;
  const totalObstacles = ordered.reduce((n, s) => n + (Number(s.obstacleCount) || 0), 0);
  const totalSteps = ordered.reduce((n, s) => n + (Number(s.stepCount) || 0), 0);
  const maxCurbHeight = ordered.reduce((n, s) => Math.max(n, Number(s.curbHeight) || 0), 0);

  // 按路线顺序收集涉及点位（起点与各段终点），去重但保留首次出现的顺序
  const pointIds: string[] = [];
  ordered.forEach((s) => {
    [s.fromPointId, s.toPointId].forEach((pid) => {
      if (!pointIds.includes(pid)) pointIds.push(pid);
    });
  });

  const pointVerdicts: PointVerdict[] = pointIds.map((pid) =>
    judgePoint(pid, context ? latestInspectionOf(context.inspections, pid) : null),
  );
  const qualifiedPoints = pointVerdicts.filter((v) => v.passable).length;

  const reasons: string[] = [];
  pointVerdicts.forEach((pv) => {
    if (!pv.passable) {
      const name = context?.nameOf?.(pv.pointId);
      reasons.push(`点位 ${name ? `${name}（` : ''}${pv.pointId}${name ? '）' : ''}：${pv.reasons.join('；')}`);
    }
  });
  ordered.forEach((s) => {
    const physical = judgeSegment(s);
    if (!physical.passable) {
      reasons.push(`第 ${s.order} 段：${physical.reasons.join('；')}`);
    }
  });

  return {
    routeName,
    passable: ordered.length > 0 && reasons.length === 0,
    totalLength,
    totalObstacles,
    totalSteps,
    maxCurbHeight,
    reasons: ordered.length === 0 ? ['尚未串联路段'] : reasons,
    pointVerdicts,
    qualifiedPoints,
  };
}
