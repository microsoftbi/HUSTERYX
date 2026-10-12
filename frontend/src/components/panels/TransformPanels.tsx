import { useMemo } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import {
  ColumnSelect,
  EmptyHint,
  Field,
  MultiColumnSelect,
  Section,
  useInputCols,
  useNodeConfig,
  type PanelProps,
} from '@/components/panels/fields';
import type {
  AggregationConfig,
  AggregationFn,
  FilterConfig,
  JoinConfig,
  JoinSelectField,
  JoinType,
  SelectConfig,
  SelectField,
  SortConfig,
  SortItem,
} from '@/types';

/** 列表行外壳：统一边框与删除按钮。 */
function RowShell({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return (
    <div className="flex items-start gap-1.5 rounded-md border border-border p-2">
      <div className="flex min-w-0 flex-1 flex-col gap-2">{children}</div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground hover:text-destructive"
        onClick={onRemove}
        title="删除"
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  );
}

/* ----------------------------- Select 选择 ----------------------------- */

export function SelectPanel({ node }: PanelProps) {
  const [config, patch] = useNodeConfig<SelectConfig>(node);
  const inCols = useInputCols(node.id);

  /** 上游字段的默认行：原样列出全部字段。 */
  const defaultRows = useMemo<SelectField[]>(
    () => inCols.map((col, index) => ({ source: col.name, alias: col.name, include: true, order: index })),
    [inCols],
  );

  /** 展示行：以上游字段为准，叠加已保存的勾选/重命名/排序；上游新增字段自动追加在末尾。 */
  const rows = useMemo<SelectField[]>(() => {
    const configured = config.fields ?? [];
    if (configured.length === 0) return defaultRows;
    const saved = new Map(configured.map((f) => [f.source, f]));
    const merged = defaultRows.map((row) => {
      const hit = saved.get(row.source);
      return hit ? { ...row, include: hit.include !== false, alias: hit.alias ?? row.alias } : row;
    });
    const order = new Map(configured.map((f, index) => [f.source, index]));
    return merged.slice().sort((a, b) => {
      const ia = order.get(a.source);
      const ib = order.get(b.source);
      if (ia === undefined && ib === undefined) return 0;
      if (ia === undefined) return 1;
      if (ib === undefined) return -1;
      return ia - ib;
    });
  }, [defaultRows, config.fields]);

  const commit = (next: SelectField[]) =>
    patch({
      fields: next.map((row, index) => ({
        source: row.source,
        alias: row.alias ?? '',
        include: row.include !== false,
        order: index,
      })),
    });

  const update = (index: number, p: Partial<SelectField>) =>
    commit(rows.map((row, i) => (i === index ? { ...row, ...p } : row)));

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= rows.length) return;
    const copy = rows.slice();
    [copy[index], copy[target]] = [copy[target], copy[index]];
    commit(copy);
  };

  const includedCount = rows.filter((row) => row.include !== false).length;
  const allIncluded = rows.length > 0 && includedCount === rows.length;

  return (
    <div className="flex flex-col gap-4">
      <Section
        title="输出字段"
        action={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={rows.length === 0}
            onClick={() => patch({ fields: [] })}
          >
            <Wand2 />
            按上游列重置
          </Button>
        }
      >
        {rows.length === 0 ? (
          <EmptyHint>请先连接上游节点以获取字段</EmptyHint>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <input
                      type="checkbox"
                      ref={(el) => {
                        if (el) el.indeterminate = includedCount > 0 && !allIncluded;
                      }}
                      checked={allIncluded}
                      onChange={() => commit(rows.map((row) => ({ ...row, include: !allIncluded })))}
                      title="全选 / 全不选"
                    />
                  </TableHead>
                  <TableHead>字段名</TableHead>
                  <TableHead className="w-28">重命名</TableHead>
                  <TableHead className="w-12 text-right">顺序</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, index) => (
                  <TableRow key={row.source}>
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={row.include !== false}
                        onChange={(event) => update(index, { include: event.target.checked })}
                        title="是否输出该字段"
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs text-foreground">{row.source}</TableCell>
                    <TableCell>
                      <Input
                        value={row.alias ?? ''}
                        onChange={(event) => update(index, { alias: event.target.value })}
                        placeholder={row.source}
                        className="h-7 text-xs"
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-0.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={index === 0}
                          onClick={() => move(index, -1)}
                          title="上移"
                        >
                          <ArrowUp className="size-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={index === rows.length - 1}
                          onClick={() => move(index, 1)}
                          title="下移"
                        >
                          <ArrowDown className="size-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              取消勾选则不输出该字段，列表从上到下即输出顺序（已选 {includedCount} / {rows.length}）。
            </p>
          </>
        )}
      </Section>
    </div>
  );
}

/* ----------------------------- Filter 过滤 ----------------------------- */

export function FilterPanel({ node }: PanelProps) {
  const [config, patch] = useNodeConfig<FilterConfig>(node);
  const inCols = useInputCols(node.id);

  const appendColumn = (name: string) => {
    const expression = config.expression ?? '';
    patch({ expression: `${expression}${expression ? ' ' : ''}"${name}"` });
  };

  return (
    <div className="flex flex-col gap-4">
      <Field
        label="过滤条件"
        hint="填写 SQL 布尔表达式，例如 amount > 100 AND status = 'A'。"
      >
        <Textarea
          value={config.expression ?? ''}
          onChange={(event) => patch({ expression: event.target.value })}
          placeholder="amount > 100 AND status = 'A'"
          spellCheck={false}
          className="min-h-[100px] font-mono text-xs"
        />
      </Field>

      <Section title="插入列">
        {inCols.length === 0 ? (
          <EmptyHint>暂无可选列（请先运行一次上游节点）</EmptyHint>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {inCols.map((col) => (
              <button
                key={col.name}
                type="button"
                onClick={() => appendColumn(col.name)}
                className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                {col.name}
              </button>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

/* ----------------------------- Join 连接 ----------------------------- */

const JOIN_TYPES: { value: JoinType; label: string }[] = [
  { value: 'inner', label: '内连接 Inner' },
  { value: 'left', label: '左连接 Left' },
  { value: 'right', label: '右连接 Right' },
  { value: 'full', label: '全连接 Full' },
];

export function JoinPanel({ node }: PanelProps) {
  const [config, patch] = useNodeConfig<JoinConfig>(node);
  const leftCols = useInputCols(node.id, 'left');
  const rightCols = useInputCols(node.id, 'right');

  /** 上游字段的默认行：左表原样；右表与左侧重名时自动加 right_ 前缀去重。 */
  const defaultRows = useMemo<JoinSelectField[]>(() => {
    const used = new Set<string>();
    const rows: JoinSelectField[] = [];
    for (const col of leftCols) {
      rows.push({ side: 'left', source: col.name, alias: col.name, include: true });
      used.add(col.name);
    }
    for (const col of rightCols) {
      let alias = col.name;
      if (used.has(alias)) alias = `right_${alias}`;
      let candidate = alias;
      let i = 2;
      while (used.has(candidate)) {
        candidate = `${alias}_${i}`;
        i += 1;
      }
      used.add(candidate);
      rows.push({ side: 'right', source: col.name, alias: candidate, include: true });
    }
    return rows;
  }, [leftCols, rightCols]);

  /** 展示行：以上游字段为准，叠加已保存的勾选/重命名/排序；上游新增字段自动追加在末尾。 */
  const rows = useMemo<JoinSelectField[]>(() => {
    const configured = config.selectFields ?? [];
    if (configured.length === 0) return defaultRows;
    const saved = new Map(configured.map((f) => [`${f.side}:${f.source}`, f]));
    const merged = defaultRows.map((row) => {
      const hit = saved.get(`${row.side}:${row.source}`);
      return hit ? { ...row, include: hit.include !== false, alias: hit.alias ?? row.alias } : row;
    });
    const order = new Map(configured.map((f, index) => [`${f.side}:${f.source}`, index]));
    return merged.slice().sort((a, b) => {
      const ia = order.get(`${a.side}:${a.source}`);
      const ib = order.get(`${b.side}:${b.source}`);
      if (ia === undefined && ib === undefined) return 0;
      if (ia === undefined) return 1;
      if (ib === undefined) return -1;
      return ia - ib;
    });
  }, [defaultRows, config.selectFields]);

  const commit = (next: JoinSelectField[]) =>
    patch({
      selectFields: next.map((row) => ({
        side: row.side,
        source: row.source,
        alias: row.alias ?? '',
        include: row.include !== false,
      })),
    });

  const update = (index: number, p: Partial<JoinSelectField>) =>
    commit(rows.map((row, i) => (i === index ? { ...row, ...p } : row)));

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= rows.length) return;
    const copy = rows.slice();
    [copy[index], copy[target]] = [copy[target], copy[index]];
    commit(copy);
  };

  const includedCount = rows.filter((row) => row.include !== false).length;
  const allIncluded = rows.length > 0 && includedCount === rows.length;

  return (
    <div className="flex flex-col gap-4">
      <Field label="连接类型">
        <Select
          value={config.joinType ?? 'inner'}
          onValueChange={(value) => patch({ joinType: value as JoinType })}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {JOIN_TYPES.map((type) => (
              <SelectItem key={type.value} value={type.value}>
                {type.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="左表连接键">
          <ColumnSelect
            value={config.leftKey ?? ''}
            onChange={(value) => patch({ leftKey: value })}
            columns={leftCols}
          />
        </Field>
        <Field label="右表连接键">
          <ColumnSelect
            value={config.rightKey ?? ''}
            onChange={(value) => patch({ rightKey: value })}
            columns={rightCols}
          />
        </Field>
      </div>

      <Section
        title="输出字段"
        action={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={rows.length === 0}
            onClick={() => patch({ selectFields: undefined })}
          >
            <Wand2 />
            按上游列重置
          </Button>
        }
      >
        {rows.length === 0 ? (
          <EmptyHint>请先连接并运行左、右两个输入节点以获取字段</EmptyHint>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <input
                      type="checkbox"
                      ref={(el) => {
                        if (el) el.indeterminate = includedCount > 0 && !allIncluded;
                      }}
                      checked={allIncluded}
                      onChange={() => commit(rows.map((row) => ({ ...row, include: !allIncluded })))}
                      title="全选 / 全不选"
                    />
                  </TableHead>
                  <TableHead className="w-10">来源</TableHead>
                  <TableHead>字段名</TableHead>
                  <TableHead className="w-28">重命名</TableHead>
                  <TableHead className="w-12 text-right">顺序</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, index) => (
                  <TableRow key={`${row.side}:${row.source}`}>
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={row.include !== false}
                        onChange={(event) => update(index, { include: event.target.checked })}
                        title="是否输出该字段"
                      />
                    </TableCell>
                    <TableCell className="text-[11px] text-muted-foreground">
                      {row.side === 'left' ? '左' : '右'}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-foreground">{row.source}</TableCell>
                    <TableCell>
                      <Input
                        value={row.alias ?? ''}
                        onChange={(event) => update(index, { alias: event.target.value })}
                        placeholder={row.source}
                        className="h-7 text-xs"
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-0.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={index === 0}
                          onClick={() => move(index, -1)}
                          title="上移"
                        >
                          <ArrowUp className="size-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={index === rows.length - 1}
                          onClick={() => move(index, 1)}
                          title="下移"
                        >
                          <ArrowDown className="size-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              取消勾选则不输出该字段，列表从上到下即输出顺序（已选 {includedCount} / {rows.length}）。
            </p>
          </>
        )}
      </Section>
    </div>
  );
}

/* ----------------------------- Aggregation 汇总 ----------------------------- */

const AGG_FNS: AggregationFn[] = ['sum', 'count', 'max', 'min', 'avg'];

export function AggregationPanel({ node }: PanelProps) {
  const [config, patch] = useNodeConfig<AggregationConfig>(node);
  const inCols = useInputCols(node.id);
  const aggregations = config.aggregations ?? [];

  const setAggregations = (next: typeof aggregations) => patch({ aggregations: next });

  const update = (index: number, p: Partial<(typeof aggregations)[number]>) =>
    setAggregations(aggregations.map((item, i) => (i === index ? { ...item, ...p } : item)));

  return (
    <div className="flex flex-col gap-4">
      <Section title="分组键">
        <MultiColumnSelect
          value={config.groupBy ?? []}
          onChange={(groupBy) => patch({ groupBy })}
          columns={inCols}
        />
      </Section>

      <Section
        title="聚合"
        action={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setAggregations([...aggregations, { field: '', fn: 'sum', alias: '' }])}
          >
            <Plus />
            添加
          </Button>
        }
      >
        {aggregations.length === 0 ? (
          <EmptyHint>尚未配置聚合（仅按分组键去重输出）</EmptyHint>
        ) : (
          <div className="flex flex-col gap-2">
            {aggregations.map((item, index) => (
              <RowShell
                key={index}
                onRemove={() => setAggregations(aggregations.filter((_, i) => i !== index))}
              >
                <div className="flex items-center gap-1.5">
                  <Select
                    value={item.fn}
                    onValueChange={(value) => update(index, { fn: value as AggregationFn })}
                  >
                    <SelectTrigger className="h-8 w-24 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AGG_FNS.map((fn) => (
                        <SelectItem key={fn} value={fn}>
                          {fn.toUpperCase()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <ColumnSelect
                    value={item.field}
                    onChange={(value) => update(index, { field: value })}
                    columns={inCols}
                    placeholder="字段"
                    emptyLabel="COUNT(*)"
                    className="flex-1"
                  />
                </div>
                <Input
                  value={item.alias ?? ''}
                  onChange={(event) => update(index, { alias: event.target.value })}
                  placeholder="输出列名（可选）"
                  className="h-8 text-xs"
                />
              </RowShell>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

/* ----------------------------- Sort 排序 ----------------------------- */

export function SortPanel({ node }: PanelProps) {
  const [config, patch] = useNodeConfig<SortConfig>(node);
  const inCols = useInputCols(node.id);
  const sorts = config.sorts ?? [];

  const setSorts = (next: SortItem[]) => patch({ sorts: next });
  const update = (index: number, p: Partial<SortItem>) =>
    setSorts(sorts.map((item, i) => (i === index ? { ...item, ...p } : item)));

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= sorts.length) return;
    const copy = [...sorts];
    [copy[index], copy[target]] = [copy[target], copy[index]];
    setSorts(copy);
  };

  return (
    <Section
      title="排序规则"
      action={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setSorts([...sorts, { field: '', direction: 'asc', nulls: 'last' }])}
        >
          <Plus />
          添加
        </Button>
      }
    >
      {sorts.length === 0 ? (
        <EmptyHint>添加排序规则，按从上到下的优先级排序</EmptyHint>
      ) : (
        <div className="flex flex-col gap-2">
          {sorts.map((item, index) => (
            <RowShell key={index} onRemove={() => setSorts(sorts.filter((_, i) => i !== index))}>
              <ColumnSelect
                value={item.field}
                onChange={(value) => update(index, { field: value })}
                columns={inCols}
              />
              <div className="flex items-center gap-1.5">
                <Select
                  value={item.direction}
                  onValueChange={(value) => update(index, { direction: value as 'asc' | 'desc' })}
                >
                  <SelectTrigger className="h-8 flex-1 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="asc">升序 ASC</SelectItem>
                    <SelectItem value="desc">降序 DESC</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={item.nulls ?? 'last'}
                  onValueChange={(value) => update(index, { nulls: value as 'first' | 'last' })}
                >
                  <SelectTrigger className="h-8 flex-1 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="first">空值在前</SelectItem>
                    <SelectItem value="last">空值在后</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-end gap-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  title="上移"
                >
                  <ArrowUp className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={index === sorts.length - 1}
                  onClick={() => move(index, 1)}
                  title="下移"
                >
                  <ArrowDown className="size-3.5" />
                </Button>
              </div>
            </RowShell>
          ))}
        </div>
      )}
    </Section>
  );
}
