import { useMemo, useState } from 'react';
import {
  App,
  Alert,
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Popover,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  DeleteOutlined,
  InfoCircleOutlined,
  NodeIndexOutlined,
  SaveOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import StatusBadge from '../components/common/StatusBadge';
import EmptyState from '../components/common/EmptyState';
import { usePointStore } from '../stores/pointStore';
import { useRouteStore, type DraftSegment } from '../stores/routeStore';
import type { RouteJudgeContext, RouteSegment, RouteVerdict } from '../types/route';
import type { PointGate } from '../types/route';
import { buildVerdict, judgeSegment, CURB_FAIL, CURB_PASS, latestInspectionMap } from '../utils/routeCheck';

/** 点位核验闸门清单：每个点位都必须有最新「合格」记录 */
function PointGateList({ gates }: { gates: PointGate[] }) {
  return (
    <div data-testid="point-gate-list" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Typography.Text strong>点位最新核验闸门（逐点放行）</Typography.Text>
      {gates.map((g) => (
        <Space key={g.pointId} size={8} wrap align="start" data-testid={`point-gate-${g.pointId}`}>
          <StatusBadge value={g.status} kind="conclusion" />
          <Typography.Text>{g.pointName}</Typography.Text>
          <Typography.Text type={g.passable ? 'secondary' : 'danger'} className="gb-muted">
            {g.reasons.join('；')}
          </Typography.Text>
        </Space>
      ))}
    </div>
  );
}

export default function Routes() {
  const { message } = App.useApp();
  const points = usePointStore((s) => s.points);
  const inspections = usePointStore((s) => s.inspections);
  const {
    segments,
    draftName,
    chain,
    draftSegments,
    setDraftName,
    setChain,
    buildChainSegments,
    updateDraftSegment,
    removeDraftSegment,
    computeVerdict,
    saveRoute,
    resetDraft,
  } = useRouteStore();
  const [saving, setSaving] = useState(false);

  const pointOptions = useMemo(
    () => points.map((p) => ({ value: p.id, label: `${p.code} ${p.name}` })),
    [points],
  );
  const nameOf = (id: string) => points.find((p) => p.id === id)?.name ?? id;

  /** 路线判定上下文：始终基于当前全部核验记录取最新一条 */
  const judgeCtx: RouteJudgeContext = useMemo(() => {
    const latestMap = latestInspectionMap(inspections);
    return {
      nameOf,
      latestInspectionOf: (pointId: string) => latestMap.get(pointId),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, inspections]);

  /** 编制中路线的实时判定：核验数据变化（新增 / 复测）后自动重算 */
  const liveVerdict: RouteVerdict | null = useMemo(
    () => (draftSegments.length ? buildVerdict(draftName || '未命名路线', draftSegments, judgeCtx) : null),
    [draftName, draftSegments, judgeCtx],
  );
  const draftVerdict = liveVerdict;

  const handleBuild = () => {
    if (chain.length < 2) {
      message.warning('请至少选择起点与终点两个点位');
      return;
    }
    buildChainSegments(points);
    message.success(`已自动串联 ${chain.length - 1} 段路段`);
  };

  const handleSave = async () => {
    if (!draftSegments.length) {
      message.warning('请先串联路段');
      return;
    }
    setSaving(true);
    try {
      const n = await saveRoute(judgeCtx);
      const verdict = buildVerdict(draftName || '未命名路线', draftSegments, judgeCtx);
      message.success(
        verdict.passable ? `已保存 ${n} 段路线，全线可通行` : `已保存 ${n} 段路线；按最新核验全线暂不可通行`,
      );
      resetDraft();
    } catch (e) {
      message.error(`路线保存失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const draftColumns: ColumnsType<DraftSegment> = [
    { title: '段序', dataIndex: 'order', width: 60 },
    { title: '起点', dataIndex: 'fromPointId', render: (v: string) => nameOf(v) },
    { title: '终点', dataIndex: 'toPointId', render: (v: string) => nameOf(v) },
    {
      title: '长度(m)',
      dataIndex: 'length',
      width: 110,
      render: (v: number, row) => (
        <InputNumber
          aria-label={`长度-${row.order}`}
          min={1}
          max={100000}
          value={v}
          onChange={(nv) => updateDraftSegment(row.key, { length: Number(nv ?? 0) })}
          style={{ width: 100 }}
        />
      ),
    },
    {
      title: '沿途障碍数',
      dataIndex: 'obstacleCount',
      width: 120,
      render: (v: number, row) => (
        <InputNumber
          aria-label={`障碍数-${row.order}`}
          min={0}
          max={50}
          value={v}
          onChange={(nv) => updateDraftSegment(row.key, { obstacleCount: Number(nv ?? 0) })}
          style={{ width: 100 }}
        />
      ),
    },
    {
      title: '台阶数',
      dataIndex: 'stepCount',
      width: 110,
      render: (v: number, row) => (
        <InputNumber
          aria-label={`台阶数-${row.order}`}
          min={0}
          max={50}
          value={v}
          onChange={(nv) => updateDraftSegment(row.key, { stepCount: Number(nv ?? 0) })}
          style={{ width: 100 }}
        />
      ),
    },
    {
      title: '路缘高差(cm)',
      dataIndex: 'curbHeight',
      width: 130,
      render: (v: number, row) => (
        <InputNumber
          aria-label={`路缘高差-${row.order}`}
          min={0}
          max={60}
          step={0.5}
          value={v}
          onChange={(nv) => updateDraftSegment(row.key, { curbHeight: Number(nv ?? 0) })}
          style={{ width: 110 }}
        />
      ),
    },
    {
      title: '段判定',
      width: 110,
      render: (_, row) => {
        const r = judgeSegment(row, judgeCtx);
        const badge = <StatusBadge value={r.passable ? '可通行' : '不可通行'} kind="route" />;
        return r.passable ? (
          badge
        ) : (
          <Tooltip title={r.reasons.join('；')}>
            <span style={{ borderBottom: '1px dashed #ff4d4f', cursor: 'help' }}>{badge}</span>
          </Tooltip>
        );
      },
    },
    {
      title: '操作',
      width: 80,
      render: (_, row) => (
        <Button
          size="small"
          danger
          icon={<DeleteOutlined />}
          onClick={() => removeDraftSegment(row.key)}
          data-testid={`remove-segment-${row.order}`}
        />
      ),
    },
  ];

  const savedColumns: ColumnsType<RouteSegment> = [
    { title: '路线名称', dataIndex: 'routeName', width: 200 },
    { title: '段序', dataIndex: 'order', width: 70 },
    { title: '起点', dataIndex: 'fromPointId', render: (v: string) => nameOf(v) },
    { title: '终点', dataIndex: 'toPointId', render: (v: string) => nameOf(v) },
    { title: '长度(m)', dataIndex: 'length', width: 100 },
    { title: '障碍数', dataIndex: 'obstacleCount', width: 90 },
    { title: '台阶数', dataIndex: 'stepCount', width: 90 },
    { title: '路缘高差(cm)', dataIndex: 'curbHeight', width: 120 },
    {
      title: '当前可轮椅通行',
      width: 150,
      render: (_, row) => {
        // 动态复判：物理条件 + 起终点最新核验闸门；历史路段记录本身不被改写
        const r = judgeSegment(row, judgeCtx);
        const snapshotText = `保存时刻快照：${row.wheelchairPassable ? '可通行' : '不可通行'}（历史记录不再改写）`;
        const liveText = r.passable ? '当前按最新核验可通行' : `当前不可通行：${r.reasons.join('；')}`;
        const badge = <StatusBadge value={r.passable ? '可通行' : '不可通行'} kind="route" />;
        return (
          <Space size={4}>
            {r.passable ? (
              badge
            ) : (
              <Tooltip title={liveText}>
                <span style={{ borderBottom: '1px dashed #ff4d4f', cursor: 'help' }}>{badge}</span>
              </Tooltip>
            )}
            <Tooltip title={snapshotText}>
              <InfoCircleOutlined style={{ color: '#8c8c8c' }} data-testid={`snapshot-${row.id}`} />
            </Tooltip>
          </Space>
        );
      },
    },
  ];

  const savedVerdicts = useMemo(() => {
    const byName = new Map<string, RouteSegment[]>();
    for (const s of segments) {
      const list = byName.get(s.routeName) ?? [];
      list.push(s);
      byName.set(s.routeName, list);
    }
    const rows: RouteVerdict[] = [];
    byName.forEach((list, name) => rows.push(buildVerdict(name, list, judgeCtx)));
    return rows;
  }, [segments, judgeCtx]);

  return (
    <div>
      <div className="gb-page-head">
        <div>
          <h1 className="gb-page-title">通行路线编制</h1>
          <Typography.Text type="secondary">
            选择起点与途经点位后自动串联路段，逐段录入障碍数、台阶数与路缘高差；全线判定同时核验每个点位的最新核验记录。
          </Typography.Text>
        </div>
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card title="路线编制" size="small">
            <Form layout="vertical">
              <Row gutter={12}>
                <Col xs={24} md={10}>
                  <Form.Item label="路线名称">
                    <Input
                      id="routeName"
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      placeholder="如 东单—王府井轮椅通道"
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={14}>
                  <Form.Item label="按顺序选择点位（起点 → 途经 → 终点）">
                    <Select
                      id="chain"
                      mode="multiple"
                      value={chain}
                      onChange={(v) => setChain(v)}
                      options={pointOptions}
                      placeholder="先选起点，再依次选择终点"
                      style={{ width: '100%' }}
                      maxTagCount={3}
                    />
                  </Form.Item>
                </Col>
              </Row>
              <Space wrap>
                <Button
                  type="primary"
                  icon={<NodeIndexOutlined />}
                  onClick={handleBuild}
                  data-testid="build-route"
                >
                  自动串联路段
                </Button>
                <Button
                  icon={<ThunderboltOutlined />}
                  onClick={() => {
                    if (!draftSegments.length) {
                      message.warning('请先串联路段');
                      return;
                    }
                    computeVerdict(judgeCtx);
                  }}
                  data-testid="compute-verdict"
                >
                  输出全线判定
                </Button>
                <Button
                  type="primary"
                  icon={<SaveOutlined />}
                  loading={saving}
                  onClick={handleSave}
                  data-testid="save-route"
                >
                  保存路线
                </Button>
                <Button onClick={resetDraft} data-testid="reset-route">
                  清空编制
                </Button>
              </Space>
            </Form>

            <div style={{ marginTop: 16 }} data-testid="draft-segments">
              {draftSegments.length ? (
                <Table<DraftSegment>
                  rowKey="key"
                  size="small"
                  pagination={false}
                  dataSource={draftSegments}
                  columns={draftColumns}
                />
              ) : (
                <EmptyState
                  title="尚未串联路段"
                  description="选择至少两个点位后点击「自动串联路段」"
                  compact
                />
              )}
            </div>
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Card title="全线判定" size="small" data-testid="verdict-card">
            {draftVerdict ? (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Space size={8} wrap>
                  <StatusBadge
                    value={draftVerdict.passable ? '可通行' : '不可通行'}
                    kind="route"
                    bordered
                  />
                  <Typography.Text strong data-testid="verdict-name">
                    {draftVerdict.routeName}
                  </Typography.Text>
                </Space>
                <Row gutter={12}>
                  <Col span={12}>
                    <Statistic title="全线长度" value={draftVerdict.totalLength} suffix="m" />
                  </Col>
                  <Col span={12}>
                    <Statistic title="沿途障碍" value={draftVerdict.totalObstacles} suffix="处" />
                  </Col>
                  <Col span={12}>
                    <Statistic title="台阶总数" value={draftVerdict.totalSteps} suffix="级" />
                  </Col>
                  <Col span={12}>
                    <Statistic title="最大路缘高差" value={draftVerdict.maxCurbHeight} suffix="cm" />
                  </Col>
                </Row>
                <PointGateList gates={draftVerdict.pointGates} />
                {draftVerdict.passable ? (
                  <Alert type="success" showIcon message="全线满足轮椅通行条件，各点位最新核验均为合格" />
                ) : (
                  <Alert
                    type="error"
                    showIcon
                    message="全线暂不可通行，请勿指引家属前往"

                    description={
                      <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                        {draftVerdict.reasons.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    }
                  />
                )}
                <Typography.Text type="secondary" className="gb-muted">
                  判定规则：路缘高差 ≤ {CURB_PASS}cm 可通行、&gt; {CURB_FAIL}cm 不可通行，存在台阶即需绕行；
                  且路线上每个点位都必须有最新一次「合格」核验记录，未核验、限期整改或不合格均判定全线不可通行。
                  复测合格后无需重新编制，本判定自动恢复可通行。
                </Typography.Text>
              </Space>
            ) : (
              <EmptyState
                title="尚未输出判定"
                description="串联路段后将自动按路段实测值与点位最新核验输出判定"
                compact
              />
            )}
          </Card>

          <Card title="已编制路线判定（按最新核验实时复判）" size="small" style={{ marginTop: 16 }}>
            {savedVerdicts.length ? (
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                {savedVerdicts.map((v) => (
                  <div key={v.routeName} data-testid={`saved-verdict-${v.routeName}`}>
                    <Space size={8} wrap>
                      <StatusBadge value={v.passable ? '可通行' : '不可通行'} kind="route" />
                      <Typography.Text>{v.routeName}</Typography.Text>
                      <Tag>{v.totalLength} m</Tag>
                      <Tag>台阶 {v.totalSteps}</Tag>
                      <Tag>障碍 {v.totalObstacles}</Tag>
                      {!v.passable ? (
                        <Popover
                          trigger="click"
                          title="不可通行点位与原因"
                          content={
                            <ul style={{ margin: 0, paddingInlineStart: 18, maxWidth: 320 }}>
                              {v.reasons.map((r) => (
                                <li key={r}>{r}</li>
                              ))}
                            </ul>
                          }
                        >
                          <Tag color="error" style={{ cursor: 'pointer' }} data-testid={`blocked-tag-${v.routeName}`}>
                            {v.blockedPoints.length} 个点位未放行，查看原因
                          </Tag>
                        </Popover>
                      ) : null}
                    </Space>
                  </div>
                ))}
              </Space>
            ) : (
              <EmptyState title="暂无已保存路线" compact />
            )}
          </Card>
        </Col>
      </Row>

      <Card title="已保存路段明细" size="small" style={{ marginTop: 16 }}>
        {segments.length ? (
          <Table<RouteSegment>
            rowKey="id"
            size="small"
            pagination={{ pageSize: 8, hideOnSinglePage: true }}
            dataSource={segments}
            columns={savedColumns}
          />
        ) : (
          <EmptyState title="暂无路段记录" description="编制并保存后在此查看" compact />
        )}
      </Card>
    </div>
  );
}
