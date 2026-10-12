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
  const fields = config.fields ?? [];

  const setFields = (next: SelectField[]) =>
    patch({ fields: next.map((field, index) => ({ ...field, order: index })) });

  const update = (index: number, p: Partial<SelectField>) =>
    setFields(fields.map((field, i) => (i === index ? { ...field, ...p } : field)));

  const remove = (index: number) => setFields(fields.filter((_, i) => i !== index));

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= fields.length) return;
    const copy = [...fields];
    [copy[index], copy[target]] = [copy[target], copy[index]];
    setFields(copy);
  };

  const autoFill = () =>
    setFields(inCols.map((col, index) => ({ source: col.name, alias: '', include: true, order: index })));

  return (
    <div className="flex flex-col gap-4">
      <Section
        title="输出字段"
        action={
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={inCols.length === 0}
              onClick={autoFill}
            >
              <Wand2 />
              按上游列生成
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setFields([...fields, { source: '', alias: '', include: true, order: fields.length }])}
            >
              <Plus />
              添加
            </Button>
          </div>
        }
      >
        {fields.length === 0 ? (
          <EmptyHint>未配置字段时输出全部列（等价于 SELECT *）</EmptyHint>
        ) : (
          <div className="flex flex-col gap-2">
            {fields.map((field, index) => (
              <RowShell key={index} onRemove={() => remove(index)}>
                <div className="flex items-center gap-1.5">
                  <ColumnSelect
                    value={field.source}
                    onChange={(value) => update(index, { source: value })}
                    columns={inCols}
                    className="flex-1"
                  />
                  <Input
                    value={field.alias ?? ''}
                    onChange={(event) => update(index, { alias: event.target.value })}
                    placeholder="别名（可选）"
                    className="h-8 flex-1 text-xs"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={field.include}
                      onChange={(event) => update(index, { include: event.target.checked })}
                    />
                    输出该列
                  </label>
                  <div className="flex items-center gap-0.5">
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
                      disabled={index === fields.length - 1}
                      onClick={() => move(index, 1)}
                      title="下移"
                    >
                      <ArrowDown className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </RowShell>
            ))}
          </div>
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
  const selectFields = config.selectFields ?? [];

  const setSelectFields = (next: JoinSelectField[]) => patch({ selectFields: next });

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
        title="输出字段（可选）"
        action={
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setSelectFields([...selectFields, { side: 'left', source: '', alias: '' }])}
            >
              <Plus />
              左列
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setSelectFields([...selectFields, { side: 'right', source: '', alias: '' }])}
            >
              <Plus />
              右列
            </Button>
          </div>
        }
      >
        {selectFields.length === 0 ? (
          <EmptyHint>留空则输出全部列（右表重名列自动加 right_ 前缀）</EmptyHint>
        ) : (
          <div className="flex flex-col gap-2">
            {selectFields.map((field, index) => (
              <RowShell
                key={index}
                onRemove={() => setSelectFields(selectFields.filter((_, i) => i !== index))}
              >
                <div className="flex items-center gap-1.5">
                  <Select
                    value={field.side}
                    onValueChange={(value) =>
                      setSelectFields(
                        selectFields.map((item, i) =>
                          i === index
                            ? { ...item, side: value as 'left' | 'right', source: '' }
                            : item,
                        ),
                      )
                    }
                  >
                    <SelectTrigger className="h-8 w-20 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="left">左表</SelectItem>
                      <SelectItem value="right">右表</SelectItem>
                    </SelectContent>
                  </Select>
                  <ColumnSelect
                    value={field.source}
                    onChange={(value) =>
                      setSelectFields(
                        selectFields.map((item, i) => (i === index ? { ...item, source: value } : item)),
                      )
                    }
                    columns={field.side === 'left' ? leftCols : rightCols}
                    className="flex-1"
                  />
                  <Input
                    value={field.alias ?? ''}
                    onChange={(event) =>
                      setSelectFields(
                        selectFields.map((item, i) =>
                          i === index ? { ...item, alias: event.target.value } : item,
                        ),
                      )
                    }
                    placeholder="别名"
                    className="h-8 w-24 text-xs"
                  />
                </div>
              </RowShell>
            ))}
          </div>
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
