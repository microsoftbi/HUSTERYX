import { useCallback, useEffect, useState } from 'react';
import { FilePlus2, FolderOpen, Loader2, Play, Save } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { api } from '@/api/client';
import { useWorkflowStore } from '@/store/workflowStore';
import { cn } from '@/lib/utils';

type BackendState = 'checking' | 'online' | 'offline';

export function Toolbar() {
  const workflowName = useWorkflowStore((s) => s.workflowName);
  const setWorkflowName = useWorkflowStore((s) => s.setWorkflowName);
  const dirty = useWorkflowStore((s) => s.dirty);
  const nodeCount = useWorkflowStore((s) => s.nodes.length);
  const runStatus = useWorkflowStore((s) => s.runStatus);
  const run = useWorkflowStore((s) => s.run);
  const saveWorkflow = useWorkflowStore((s) => s.saveWorkflow);
  const newWorkflow = useWorkflowStore((s) => s.newWorkflow);
  const openWorkflow = useWorkflowStore((s) => s.openWorkflow);

  const [saving, setSaving] = useState(false);
  const [backend, setBackend] = useState<BackendState>('checking');

  useEffect(() => {
    let cancelled = false;
    api
      .health()
      .then(() => !cancelled && setBackend('online'))
      .catch(() => !cancelled && setBackend('offline'));
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await saveWorkflow();
    } catch {
      /* 错误已在 store/控制台体现 */
    } finally {
      setSaving(false);
    }
  }, [saveWorkflow]);

  const handleOpen = useCallback(async () => {
    try {
      await openWorkflow();
    } catch (error) {
      console.error('打开工作流失败', error);
    }
  }, [openWorkflow]);

  const running = runStatus === 'running';

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-card/60 px-3">
      <div className="flex items-center gap-2">
        <div className="flex size-6 items-center justify-center rounded bg-primary text-[11px] font-bold text-primary-foreground">
          HX
        </div>
        <span className="text-sm font-semibold">HUSTERYX</span>
      </div>

      <div className="mx-2 h-6 w-px bg-border" />

      <Input
        value={workflowName}
        onChange={(event) => setWorkflowName(event.target.value)}
        className="h-8 w-64"
        placeholder="工作流名称"
      />
      {dirty && (
        <Badge variant="warning" className="shrink-0">
          未保存
        </Badge>
      )}

      <div className="ml-auto flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={newWorkflow}>
          <FilePlus2 />
          新建
        </Button>

        <Button variant="ghost" size="sm" onClick={handleOpen}>
          <FolderOpen />
          打开
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={handleSave}
          disabled={saving || nodeCount === 0}
        >
          {saving ? <Loader2 className="animate-spin" /> : <Save />}
          保存
        </Button>

        <Button size="sm" onClick={() => void run()} disabled={nodeCount === 0 || running}>
          {running ? <Loader2 className="animate-spin" /> : <Play />}
          {running ? '运行中' : '运行'}
        </Button>

        {runStatus === 'success' && (
          <Badge variant="success" className="shrink-0">
            成功
          </Badge>
        )}
        {runStatus === 'error' && (
          <Badge variant="destructive" className="shrink-0">
            失败
          </Badge>
        )}

        <div className="mx-1 h-6 w-px bg-border" />

        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={cn(
                'block size-2.5 rounded-full',
                backend === 'online' && 'bg-[var(--success)]',
                backend === 'offline' && 'bg-destructive',
                backend === 'checking' && 'bg-muted-foreground/50',
              )}
            />
          </TooltipTrigger>
          <TooltipContent>
            {backend === 'online' && '后端已连接'}
            {backend === 'offline' && '后端未连接（请启动 backend）'}
            {backend === 'checking' && '检测中…'}
          </TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
