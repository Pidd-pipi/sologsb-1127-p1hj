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
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DeleteOutlined, NodeIndexOutlined, SaveOutlined, ThunderboltOutlined } from '@ant-design/icons';
import StatusBadge from '../components/common/StatusBadge';
import EmptyState from '../components/common/EmptyState';
import { usePointStore } from '../stores/pointStore';
import { useRouteStore, type DraftSegment } from '../stores/routeStore';
import type { PointVerdict, RouteSegment, RouteVerdict } from '../types/route';
import {
  buildVerdict,
  judgePoint,
  judgeSegmentWithPoints,
  latestInspectionOf,
  CURB_FAIL,
  CURB_PASS,
} from '../utils/routeCheck';

export default function Routes() {
  const { message } = App.useApp();
  const points = usePointStore((s) => s.points);
  const inspections = usePointStore((s) => s.inspections);
  const {
    segments,
    draftName,
    chain,
    draftSegments,
    verdict,
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

  /** 每个点位的当前最新核验判定（核验数据变化时自动重算，已编制路线结果随之变化） */
  const pointVerdictMap = useMemo(() => {
    const map = new Map<string, PointVerdict>();
    for (const p of points) {
      map.set(p.id, judgePoint(p.id, latestInspectionOf(inspections, p.id)));
    }
    return map;
  }, [points, inspections]);

  const buildContext = useMemo(
    () => ({ inspections, nameOf: (id: string) => points.find((p) => p.id === id)?.name }),
    [inspections, points],
  );

  const draftVerdict = verdict ?? null;

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
      const n = await saveRoute();
      const current = buildVerdict(draftName || '未命名路线', draftSegments, buildContext);
      if (current.passable) {
        message.success(`已保存 ${n} 段路线，全线当前可通行`);
      } else {
        message.warning({
          content: `已保存 ${n} 段路线，但全线当前不可通行（${current.reasons.length} 项阻断），复测合格后自动恢复`,
          duration: 5,
        });
      }
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
        const from = pointVerdictMap.get(row.fromPointId);
        const to = pointVerdictMap.get(row.toPointId);
        const r =
          from && to ? judgeSegmentWithPoints(row, { from, to }) : { passable: false, reasons: ['端点点位缺失'] };
        return (
          <Popover
            trigger="hover"
            placement="left"
            title={`第 ${row.order} 段阻断原因`}
            content={
              <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                {r.reasons.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            }
          >
            <StatusBadge value={r.passable ? '可通行' : '不可通行'} kind="route" />
          </Popover>
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

  /** 当前实时判定（含端点点位核验），落库快照不参与计算 */
  const currentOfSegment = (seg: RouteSegment) => {
    const from = pointVerdictMap.get(seg.fromPointId);
    const to = pointVerdictMap.get(seg.toPointId);
    if (!from || !to) return { passable: false, reasons: ['端点点位缺失'] };
    return judgeSegmentWithPoints(seg, { from, to });
  };

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
      title: '保存时判定',
      dataIndex: 'wheelchairPassable',
      width: 120,
      render: (v: boolean) => <StatusBadge value={v ? '可通行' : '不可通行'} kind="route" />,
    },
    {
      title: '当前判定',
      width: 110,
      render: (_, row) => {
        const r = currentOfSegment(row);
        return (
          <Popover
            trigger="hover"
            placement="left"
            title={`第 ${row.order} 段当前阻断原因`}
            content={
              <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                {r.reasons.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            }
          >
            <StatusBadge value={r.passable ? '可通行' : '不可通行'} kind="route" />
          </Popover>
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
    byName.forEach((list, name) => rows.push(buildVerdict(name, list, buildContext)));
    return rows;
  }, [segments, buildContext]);

  const renderReasons = (v: RouteVerdict) =>
    v.passable ? null : (
      <Popover
        title="全线阻断原因"
        trigger="click"
        content={
          <ul style={{ margin: 0, paddingInlineStart: 18, maxWidth: 380 }}>
            {v.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        }
      >
        <Button size="small" type="link" data-testid={`blocked-reasons-${v.routeName}`}>
          查看 {v.reasons.length} 项阻断原因
        </Button>
      </Popover>
    );

  return (
    <div>
      <div className="gb-page-head">
        <div>
          <h1 className="gb-page-title">通行路线编制</h1>
          <Typography.Text type="secondary">
            选择起点与途经点位后自动串联路段，全线判定同时依据逐段实测值与各点位的最新核验结论：任一
            点位未核验、限期整改或不合格，全线即不可通行。
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
                    computeVerdict();
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

                <Card size="small" style={{ background: '#fafafa' }} data-testid="verdict-points">
                  <Space size={8} wrap style={{ marginBottom: draftVerdict.pointVerdicts.length ? 8 : 0 }}>
                    <Typography.Text strong>
                      点位最新核验（{draftVerdict.qualifiedPoints}/{draftVerdict.pointVerdicts.length} 合格）
                    </Typography.Text>
                  </Space>
                  {draftVerdict.pointVerdicts.length ? (
                    <Space size={[6, 6]} wrap>
                      {draftVerdict.pointVerdicts.map((pv) => (
                        <Popover
                          key={pv.pointId}
                          title={`${nameOf(pv.pointId)} · 最新核验`}
                          trigger="hover"
                          content={
                            <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                              {pv.reasons.map((r) => (
                                <li key={r}>{r}</li>
                              ))}
                            </ul>
                          }
                        >
                          <Tag
                            color={
                              pv.status === '合格'
                                ? 'success'
                                : pv.status === '未核验'
                                  ? 'default'
                                  : 'error'
                            }
                            data-testid={`verdict-point-${pv.pointId}`}
                          >
                            {nameOf(pv.pointId)} · {pv.status}
                          </Tag>
                        </Popover>
                      ))}
                    </Space>
                  ) : (
                    <Typography.Text type="secondary">尚未串联点位</Typography.Text>
                  )}
                </Card>

                {draftVerdict.passable ? (
                  <Alert type="success" showIcon message="全线满足轮椅通行条件：各点位最新核验均合格，逐段实测值达标" />
                ) : (
                  <Alert
                    type="warning"
                    showIcon
                    message="全线当前不可通行"
                    description={
                      <ul style={{ margin: 0, paddingInlineStart: 18 }} data-testid="verdict-reasons">
                        {draftVerdict.reasons.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    }
                  />
                )}
                <Typography.Text type="secondary" className="gb-muted">
                  判定规则：沿线每个点位都必须有最新「合格」核验记录；路缘高差 ≤ {CURB_PASS}cm 可通行，&gt;{' '}
                  {CURB_FAIL}cm 判定不可通行；存在台阶即需绕行。
                </Typography.Text>
              </Space>
            ) : (
              <EmptyState
                title="尚未输出判定"
                description="串联路段后自动按点位最新核验判定，也可点击「输出全线判定」刷新"
                compact
              />
            )}
          </Card>

          <Card title="已编制路线判定（随最新核验实时变化）" size="small" style={{ marginTop: 16 }}>
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
                      <Tag color={v.qualifiedPoints === v.pointVerdicts.length ? 'success' : 'error'}>
                        点位合格 {v.qualifiedPoints}/{v.pointVerdicts.length}
                      </Tag>
                      {renderReasons(v)}
                    </Space>
                  </div>
                ))}
                <Typography.Text type="secondary" className="gb-muted">
                  新增或复测核验后，以上判定自动更新；历史路段的「保存时判定」快照不会被改写。
                </Typography.Text>
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
