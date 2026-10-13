import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '@/App';
import { initApiBase, waitForBackendReady } from '@/api/client';
import '@/index.css';

async function bootstrap(): Promise<void> {
  // 先确定后端基址，再等待内置引擎就绪，最后渲染：
  // 避免首屏请求打到错误地址，或与 sidecar 冷启动竞争导致误判离线。
  await initApiBase();
  await waitForBackendReady();

  const container = document.getElementById('root');
  if (!container) throw new Error('未找到 #root 容器');

  ReactDOM.createRoot(container).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void bootstrap();
