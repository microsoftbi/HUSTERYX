import { Handle, Position, type NodeProps, type NodeTypes } from '@xyflow/react';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { CATEGORY_ACCENT, getNodeMeta } from '@/lib/nodeMeta';
import { formatInt } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { NodeRunStatus, WorkflowNode } from '@/types';

/** 画布节点数据（ReactFlow data 字段）。 */
export interface HusterNodeData extends Record<string, unknown> {
  node: WorkflowNode;
  status: NodeRunStatus;
  rowCount: number;
  durationMs: number;
  /** 是否处于一次运行中；用于将「待执行 / 已跳过」节点整体置灰。 */
  runActive: boolean;
}

const STATUS_RING: Record<NodeRunStatus, string> = {
  pending: 'border-border',
  running: 'border-warning shadow-[0_0_0_3px_color-mix(in_oklch,var(--warning)_28%,transparent)]',
  success: 'border-[var(--success)]',
  error: 'border-destructive',
  skipped: 'border-border',
};

export function NodeCard({ data, selected }: NodeProps) {
  const { node, status, rowCount, runActive } = data as unknown as HusterNodeData;
  const meta = getNodeMeta(node.kind);
  const Icon = meta.icon;
  const showLabels = meta.inputs.length > 1;
  /** 运行时尚未执行（或已被跳过）的节点：整体置灰，表示「未参与 / 未生效」。 */
  const dimmed = runActive && (status === 'pending' || status === 'skipped');

  return (
    <div
      className={cn(
        'relative w-26 rounded-md border-2 bg-card shadow-md transition-all',
        STATUS_RING[status],
        dimmed && 'opacity-50 grayscale',
        selected && 'ring-2 ring-ring ring-offset-1 ring-offset-background',
      )}
    >
      <div className={cn('h-0.5 w-full rounded-t-sm', CATEGORY_ACCENT[meta.category])} />
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <div
          className={cn(
            'flex size-5 shrink-0 items-center justify-center rounded text-white',
            CATEGORY_ACCENT[meta.category],
          )}
        >
          <Icon className="size-3" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[10px] font-medium leading-tight">{node.name}</div>
          <div className="truncate text-[8px] leading-tight text-muted-foreground">{meta.label}</div>
        </div>
        {status === 'running' && <Loader2 className="size-3.5 shrink-0 animate-spin text-warning" />}
        {status === 'success' && (
          <CheckCircle2 className="size-3.5 shrink-0 text-[var(--success)]" />
        )}
        {status === 'error' && <AlertTriangle className="size-3.5 shrink-0 text-destructive" />}
      </div>
      {status === 'success' && (
        <div className="border-t border-border px-2 py-0.5 text-[8px] leading-tight text-muted-foreground">
          {formatInt(rowCount)} 行
        </div>
      )}

      {meta.inputs.map((input, index) => (
        <div key={input.id}>
          <Handle
            id={input.id}
            type="target"
            position={Position.Left}
            style={{ top: `${((index + 1) / (meta.inputs.length + 1)) * 100}%` }}
          />
          {showLabels && (
            <span
              className="pointer-events-none absolute -translate-y-1/2 text-[7px] text-muted-foreground"
              style={{
                left: 8,
                top: `${((index + 1) / (meta.inputs.length + 1)) * 100}%`,
              }}
            >
              {input.label}
            </span>
          )}
        </div>
      ))}

      {meta.hasOutput && (
        <Handle id="out" type="source" position={Position.Right} style={{ top: '50%' }} />
      )}
    </div>
  );
}

export const nodeTypes = { huster: NodeCard } satisfies NodeTypes;
