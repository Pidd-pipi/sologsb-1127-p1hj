import type { Inspection, InspectionConclusion, OccupiedLevel } from '../types/inspection';
import type { PointGate, PointGateStatus, RouteJudgeContext, RouteSegment, RouteVerdict } from '../types/route';

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
 * 从一个点位的全部核验记录中取最新一条。
 * 先按核验日期、再按入库时间排序；两者完全相同时取排序末尾，保证结果稳定。
 */
export function pickLatestInspection(inspections: Inspection[]): Inspection | undefined {
  return [...inspections].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.createdAt < b.createdAt ? -1 : 1;
  })[inspections.length - 1];
}

/** 便捷工具：从全量核验中建立 pointId → 最新核验 的索引 */
export function latestInspectionMap(inspections: Inspection[]): Map<string, Inspection> {
  const map = new Map<string, Inspection>();
  for (const ins of inspections) {
    const cur = map.get(ins.pointId);
    if (!cur || cur.date < ins.date || (cur.date === ins.date && cur.createdAt < ins.createdAt)) {
      map.set(ins.pointId, ins);
    }
  }
  return map;
}

/**
 * 点位核验闸门：路线上的每个点位都必须有「最新一次核验且结论为合格」的记录。
 * 未核验、限期整改、不合格均不放行，并给出点位与原因。
 */
export function judgePointGate(
  pointId: string,
  ctx: Pick<RouteJudgeContext, 'nameOf' | 'latestInspectionOf'>,
): PointGate {
  const pointName = ctx.nameOf(pointId) || pointId;
  const latest = ctx.latestInspectionOf(pointId);
  if (!latest) {
    return {
      pointId,
      pointName,
      status: '未核验',
      passable: false,
      reasons: ['尚无核验记录，无法确认轮椅可通行'],
      latestDate: '',
    };
  }

  const status: PointGateStatus = latest.conclusion;
  if (latest.conclusion === '合格') {
    return {
      pointId,
      pointName,
      status,
      passable: true,
      reasons: latest.problem
        ? [`${latest.date} 核验合格：${latest.problem}`]
        : [`${latest.date} 核验合格`],
      latestDate: latest.date,
    };
  }

  const detail = latest.problem || rejudge(latest).reasons.join('；') || '见核验记录';
  if (latest.conclusion === '限期整改') {
    return {
      pointId,
      pointName,
      status,
      passable: false,
      reasons: [`${latest.date} 核验结论为限期整改，整改复测合格前不可通行：${detail}`],
      latestDate: latest.date,
    };
  }
  return {
    pointId,
    pointName,
    status,
    passable: false,
    reasons: [`${latest.date} 核验结论为不合格，不具备轮椅通行条件：${detail}`],
    latestDate: latest.date,
  };
}

/** 仅依据路段物理条件（路缘高差、台阶、障碍）判定 */
export function judgeSegmentPhysical(seg: Pick<RouteSegment, 'curbHeight' | 'stepCount' | 'obstacleCount'>): {
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

/** 路段两端点位的核验闸门结果 */
export interface SegmentGateResult {
  fromGate: PointGate;
  toGate: PointGate;
}

/**
 * 单段可轮椅通行判定：物理条件合格，且起、止点位的最新核验均合格。
 * 与全线判定使用同一规则（保存路段时同样按此规则判定）。
 */
export function judgeSegment(
  seg: Pick<RouteSegment, 'curbHeight' | 'stepCount' | 'obstacleCount' | 'fromPointId' | 'toPointId'>,
  ctx?: Pick<RouteJudgeContext, 'nameOf' | 'latestInspectionOf'>,
): {
  passable: boolean;
  reasons: string[];
  gates: SegmentGateResult;
} {
  const physical = judgeSegmentPhysical(seg);
  const reasons = [...physical.reasons];
  const fromGate = ctx ? judgePointGate(seg.fromPointId, ctx) : undefined;
  const toGate = ctx ? judgePointGate(seg.toPointId, ctx) : undefined;
  if (ctx && fromGate && toGate) {
    if (!fromGate.passable) reasons.push(`起点 ${fromGate.pointName}：${fromGate.reasons.join('；')}`);
    if (!toGate.passable) reasons.push(`终点 ${toGate.pointName}：${toGate.reasons.join('；')}`);
  }
  return {
    passable: reasons.length === 0,
    reasons,
    gates: {
      fromGate: fromGate ?? {
        pointId: seg.fromPointId,
        pointName: seg.fromPointId,
        status: '未核验',
        passable: false,
        reasons: ['缺少核验上下文'],
        latestDate: '',
      },
      toGate: toGate ?? {
        pointId: seg.toPointId,
        pointName: seg.toPointId,
        status: '未核验',
        passable: false,
        reasons: ['缺少核验上下文'],
        latestDate: '',
      },
    },
  };
}

/** 全线判定：逐段物理判定 + 逐点位核验闸门，任一不满足则全线不可通行 */
export function buildVerdict(
  routeName: string,
  segments: Pick<
    RouteSegment,
    'curbHeight' | 'stepCount' | 'obstacleCount' | 'length' | 'order' | 'fromPointId' | 'toPointId'
  >[],
  ctx: RouteJudgeContext,
): RouteVerdict {
  const ordered = [...segments].sort((a, b) => a.order - b.order);
  const totalLength = Math.round(ordered.reduce((n, s) => n + (Number(s.length) || 0), 0) * 10) / 10;
  const totalObstacles = ordered.reduce((n, s) => n + (Number(s.obstacleCount) || 0), 0);
  const totalSteps = ordered.reduce((n, s) => n + (Number(s.stepCount) || 0), 0);
  const maxCurbHeight = ordered.reduce((n, s) => Math.max(n, Number(s.curbHeight) || 0), 0);

  // 按路线经过顺序收集点位并去重（相邻段共用衔接点）
  const orderedPointIds: string[] = [];
  ordered.forEach((s) => {
    [s.fromPointId, s.toPointId].forEach((id) => {
      if (!orderedPointIds.includes(id)) orderedPointIds.push(id);
    });
  });
  const pointGates = orderedPointIds.map((id) => judgePointGate(id, ctx));
  const blockedPoints = pointGates.filter((g) => !g.passable);

  const reasons: string[] = [];
  ordered.forEach((s) => {
    const r = judgeSegmentPhysical(s);
    if (!r.passable) {
      reasons.push(`第 ${s.order} 段：${r.reasons.join('；')}`);
    }
  });
  blockedPoints.forEach((g) => {
    reasons.push(`点位 ${g.pointName}：${g.reasons.join('；')}`);
  });

  if (ordered.length === 0) {
    reasons.push('尚未串联路段');
  }

  return {
    routeName,
    passable: ordered.length > 0 && blockedPoints.length === 0 && reasons.length === 0,
    totalLength,
    totalObstacles,
    totalSteps,
    maxCurbHeight,
    reasons,
    pointGates,
    blockedPoints,
  };
}
