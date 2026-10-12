import { Toolbar } from '@/components/canvas/Toolbar';
import { NodePalette } from '@/components/canvas/NodePalette';
import { FlowCanvas } from '@/components/canvas/FlowCanvas';
import { NodeConfigPanel } from '@/components/panels/NodeConfigPanel';
import { BottomPanel } from '@/components/preview/BottomPanel';
import { RunErrorDialog } from '@/components/preview/RunErrorDialog';
import { useInputSchemaSync } from '@/lib/useInputSchemaSync';

export function Workbench() {
  useInputSchemaSync();

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <Toolbar />
      <NodePalette />
      <div className="flex min-h-0 flex-1">
        <NodeConfigPanel />
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <FlowCanvas />
          </div>
          <BottomPanel />
        </main>
      </div>
      <RunErrorDialog />
    </div>
  );
}
