import type { ServerConfig } from '@/types';

/** 是否运行在 Tauri webview 中。 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** 懒加载 Tauri core，避免纯浏览器环境因缺少宿主而报错。 */
async function callTauri<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

export function getServerConfig(): Promise<ServerConfig> {
  return callTauri<ServerConfig>('get_server_config');
}

export function setServerConfig(mode: string, baseUrl: string): Promise<ServerConfig> {
  return callTauri<ServerConfig>('set_server_config', { mode, baseUrl });
}
