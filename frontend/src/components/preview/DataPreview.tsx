import { useEffect } from 'react';
import { Loader2, RefreshCw, TableProperties } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useWorkflowStore } from '@/store/workflowStore';
import { formatCell, formatDuration, formatInt } from '@/lib/format';

/** 阶段数据预览：展示运行后缓存在 DuckDB 中的当前节点输出。 */
export function DataPreview({ nodeId }: { nodeId: string }) {
  const status = useWorkflowStore((s) => s.nodeStatus[nodeId]);
  const result = useWorkflowStore((s) => s.nodeResults[nodeId]);
  const entry = useWorkflowStore((s) => s.previews[nodeId]);
  const runStatus = useWorkflowStore((s) => s.runStatus);
  const loadPreview = useWorkflowStore((s) => s.loadPreview);

  const data = entry?.data;
  const canPreview = runStatus === 'success' && status === 'success';

  // 切换节点时按需加载其运行后缓存的预览数据
  useEffect(() => {
    const state = useWorkflowStore.getState();
    if (
      state.runStatus === 'success' &&
      state.nodeStatus[nodeId] === 'success' &&
      !state.previews[nodeId]
    ) {
      void state.loadPreview(nodeId);
    }
  }, [nodeId, runStatus]);

  const refreshButton = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={!canPreview || entry?.loading}
      onClick={() => void loadPreview(nodeId)}
    >
      {entry?.loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
      刷新
    </Button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-[11px] text-muted-foreground">
          {result ? `${formatInt(result.rowCount)} 行 · ${formatDuration(result.durationMs)}` : '暂无运行结果'}
        </span>
        {data?.truncated && (
          <Badge variant="warning">
            仅显示前 {formatInt(data.rows.length)} / {formatInt(data.totalRows)} 行
          </Badge>
        )}
        <div className="ml-auto">{refreshButton}</div>
      </div>

      <div className="min-h-0 flex-1">
        {status === 'error' ? (
          <StateBlock tone="error" title="该阶段运行失败" detail={result?.error} />
        ) : !runStatus || runStatus === 'idle' ? (
          <StateBlock title="尚未运行" detail="点击右上角「运行」后即可查看各阶段缓存数据。" />
        ) : status === 'running' || status === 'pending' ? (
          <StateBlock title="等待运行完成" detail="该阶段正在执行或被上游阻塞。" />
        ) : entry?.loading ? (
          <StateBlock title="加载中…" />
        ) : entry?.error ? (
          <StateBlock tone="error" title="预览加载失败" detail={entry.error} />
        ) : !data ? (
          <StateBlock title="暂无数据" detail="该阶段可能没有输出行。" />
        ) : data.rows.length === 0 ? (
          <StateBlock title="空结果集" detail={`共 ${formatInt(data.totalRows)} 行`} />
        ) : (
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                {data.columns.map((column) => (
                  <TableHead key={column.name} className="whitespace-nowrap">
                    <span className="text-foreground">{column.name}</span>
                    <span className="ml-1 text-[9px] text-muted-foreground/70">{column.type}</span>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((row, rowIndex) => (
                <TableRow key={rowIndex}>
                  {data.columns.map((column) => {
                    const text = formatCell(row[column.name]);
                    return (
                      <TableCell
                        key={column.name}
                        title={text}
                        className="max-w-[240px] truncate whitespace-nowrap text-xs"
                      >
                        {text || <span className="text-muted-foreground/50">NULL</span>}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

function StateBlock({
  title,
  detail,
  tone = 'default',
}: {
  title: string;
  detail?: string;
  tone?: 'default' | 'error';
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <TableProperties className="size-6 text-muted-foreground/60" />
      <div className={tone === 'error' ? 'text-sm font-medium text-destructive' : 'text-sm font-medium'}>
        {title}
      </div>
      {detail && (
        <div className={tone === 'error' ? 'text-xs text-destructive/80' : 'text-xs text-muted-foreground'}>
          {detail}
        </div>
      )}
    </div>
  );
}
