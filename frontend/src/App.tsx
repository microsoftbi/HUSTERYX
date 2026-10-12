import { ReactFlowProvider } from '@xyflow/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Workbench } from '@/pages/Workbench';

export default function App() {
  return (
    <TooltipProvider delayDuration={200}>
      <ReactFlowProvider>
        <Workbench />
      </ReactFlowProvider>
    </TooltipProvider>
  );
}
