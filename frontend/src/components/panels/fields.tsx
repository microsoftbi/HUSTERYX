import { useCallback, useMemo, type ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useWorkflowStore } from '@/store/workflowStore';
import { inputColumns } from '@/lib/graph';
import { cn } from '@/lib/utils';
import type { ColumnMeta, WorkflowNode } from '@/types';

/** Radix Select 不允许空字符串作为 value，用哨兵值表示「无」。 */
export const NONE_VALUE = '__none__';

/** 所有节点配置面板的统一入参。 */
export interface PanelProps {
  node: WorkflowNode;
}

/** 配置读写 hook：读取当前节点配置，并支持合并式补丁更新。 */
export function useNodeConfig<T extends object>(
  node: WorkflowNode,
): [T, (patch: Partial<T>) => void] {
  const updateNodeConfig = useWorkflowStore((s) => s.updateNodeConfig);
  const patch = useCallback(
    (p: Partial<T>) => {
      updateNodeConfig(node.id, { ...node.config, ...p });
    },
    [node.id, node.config, updateNodeConfig],
  );
  return [node.config as unknown as T, patch];
}

/** 读取某输入端口的上游列（来自上一次运行成功后回填的 schema）。 */
export function useInputCols(nodeId: string, handle = 'in'): ColumnMeta[] {
  const nodeColumns = useWorkflowStore((s) => s.nodeColumns);
  const edges = useWorkflowStore((s) => s.edges);
  return useMemo(
    () => inputColumns(nodeColumns, edges, nodeId, handle),
    [nodeColumns, edges, nodeId, handle],
  );
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label !== undefined && <Label>{label}</Label>}
      {children}
      {hint !== undefined && <p className="text-[10px] leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Section({
  title,
  action,
  children,
  className,
}: {
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

export function EmptyHint({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[11px] text-muted-foreground">
      {children}
    </div>
  );
}

/** 列下拉：候选项来自上游 schema；当前值若不在候选中也会保留展示。 */
export function ColumnSelect({
  value,
  onChange,
  columns,
  placeholder = '选择列',
  emptyLabel,
  disabled,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  columns: ColumnMeta[];
  placeholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  const names = columns.map((c) => c.name);
  const hasFallback = Boolean(value) && !names.includes(value);
  return (
    <Select
      value={value || (emptyLabel ? NONE_VALUE : '')}
      onValueChange={(next) => onChange(next === NONE_VALUE ? '' : next)}
      disabled={disabled}
    >
      <SelectTrigger className={cn('h-8 text-xs', className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {emptyLabel && <SelectItem value={NONE_VALUE}>{emptyLabel}</SelectItem>}
        {hasFallback && <SelectItem value={value}>{value}</SelectItem>}
        {names.map((name) => (
          <SelectItem key={name} value={name}>
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** 多列选择（用于分组键）：以可切换的标签形式呈现。 */
export function MultiColumnSelect({
  value,
  onChange,
  columns,
  emptyHint = '暂无可选列（请先运行一次上游节点）',
}: {
  value: string[];
  onChange: (value: string[]) => void;
  columns: ColumnMeta[];
  emptyHint?: string;
}) {
  const names = useMemo(
    () => Array.from(new Set([...columns.map((c) => c.name), ...value])),
    [columns, value],
  );

  if (names.length === 0) {
    return <EmptyHint>{emptyHint}</EmptyHint>;
  }

  const toggle = (name: string) => {
    onChange(value.includes(name) ? value.filter((v) => v !== name) : [...value, name]);
  };

  return (
    <div className="flex flex-wrap gap-1.5 rounded-md border border-border p-2">
      {names.map((name) => {
        const active = value.includes(name);
        return (
          <button
            key={name}
            type="button"
            onClick={() => toggle(name)}
            className={cn(
              'rounded border px-1.5 py-0.5 text-[11px] transition-colors',
              active
                ? 'border-primary bg-primary/15 text-primary'
                : 'border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            {name}
          </button>
        );
      })}
    </div>
  );
}
