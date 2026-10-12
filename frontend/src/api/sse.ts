import { API_BASE } from '@/api/client';
import type { NodeResultEvent, RunLogEvent, RunStatusEvent, SseEvent } from '@/types';

function isNodeResult(event: SseEvent): event is NodeResultEvent {
  return (event as NodeResultEvent).type === 'node-result';
}

function isRunStatus(event: SseEvent): event is RunStatusEvent {
  return (event as RunStatusEvent).type === 'run-status';
}

export interface RunStreamHandlers {
  onLog?: (event: RunLogEvent) => void;
  onNodeResult?: (event: NodeResultEvent) => void;
  onRunStatus?: (event: RunStatusEvent) => void;
  onError?: (error: Event) => void;
}

/**
 * 订阅一次运行的 SSE 事件流。返回取消订阅函数。
 * 运行结束（success/error）后自动关闭连接。
 */
export function subscribeRun(runId: string, handlers: RunStreamHandlers): () => void {
  const source = new EventSource(`${API_BASE}/api/runs/${runId}/events`);

  source.onmessage = (message) => {
    if (!message.data) return;
    let event: SseEvent;
    try {
      event = JSON.parse(message.data) as SseEvent;
    } catch {
      return;
    }
    if (isNodeResult(event)) {
      handlers.onNodeResult?.(event);
      return;
    }
    if (isRunStatus(event)) {
      handlers.onRunStatus?.(event);
      if (event.status === 'success' || event.status === 'error') {
        source.close();
      }
      return;
    }
    handlers.onLog?.(event as RunLogEvent);
  };

  source.onerror = (error) => {
    handlers.onError?.(error);
  };

  return () => source.close();
}
