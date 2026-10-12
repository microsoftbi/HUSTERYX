import { CATEGORY_ACCENT, NODE_CATEGORY_LABEL, NODE_META, type NodeCategory } from '@/lib/nodeMeta';
import { useWorkflowStore } from '@/store/workflowStore';
import { cn } from '@/lib/utils';

const CATEGORIES: NodeCategory[] = ['input', 'transform', 'output'];

/** 顶部单行分组工具条：按类别展示可拖拽节点，横向可滚动。 */
export function NodePalette() {
  const runStatus = useWorkflowStore((s) => s.runStatus);
  const running = runStatus === 'running';

  return (
    <div className="flex h-14 shrink-0 items-center border-b border-border bg-card/40 px-3">
      <div className="flex min-w-0 flex-1 items-center gap-3 overflow-x-auto">
        {CATEGORIES.map((category, index) => (
          <div key={category} className="flex shrink-0 items-center gap-2">
            {index > 0 && <div className="mr-1 h-8 w-px shrink-0 bg-border" />}
            <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {NODE_CATEGORY_LABEL[category]}
            </span>
            <div className="flex items-center gap-1.5">
              {Object.values(NODE_META)
                .filter((meta) => meta.category === category)
                .map((meta) => {
                  const Icon = meta.icon;
                  return (
                    <div
                      key={meta.kind}
                      draggable={!running}
                      title={running ? '运行中，暂不可添加节点' : meta.description}
                      onDragStart={(event) => {
                        if (running) return;
                        event.dataTransfer.setData('application/husteryx-node', meta.kind);
                        event.dataTransfer.effectAllowed = 'move';
                      }}
                      className={cn(
                        'flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1.5 transition-colors',
                        running
                          ? 'cursor-not-allowed opacity-50 grayscale'
                          : 'cursor-grab hover:border-primary/60 hover:bg-accent active:cursor-grabbing',
                      )}
                    >
                      <div
                        className={cn(
                          'flex size-5 shrink-0 items-center justify-center rounded text-white',
                          CATEGORY_ACCENT[category],
                        )}
                      >
                        <Icon className="size-3" />
                      </div>
                      <span className="whitespace-nowrap text-xs font-medium">{meta.label}</span>
                    </div>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
      {running && (
        <span className="ml-3 shrink-0 text-[10px] text-muted-foreground">
          运行中，画布与配置已锁定。
        </span>
      )}
    </div>
  );
}
