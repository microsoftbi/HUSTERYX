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

/* ----------------------------- 工作流文件 ----------------------------- */

/** 「打开」对话框返回的工作流文件。 */
export interface OpenedWorkflowFile {
  /** 文件路径（浏览器降级时为文件名）。 */
  path: string;
  /** 文件文本内容。 */
  contents: string;
}

/** 非 Tauri 环境下的降级实现：触发浏览器下载。 */
function downloadTextFile(name: string, contents: string): void {
  const blob = new Blob([contents], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * 保存工作流文件：已有路径时直接覆盖（相当于 Ctrl+S），否则弹出「另存为」对话框。
 * 返回落盘路径；用户取消时返回 null。非 Tauri 环境降级为浏览器下载。
 */
export async function saveWorkflowFile(
  defaultName: string,
  contents: string,
  existingPath: string | null,
): Promise<string | null> {
  if (!isTauri()) {
    downloadTextFile(defaultName, contents);
    return defaultName;
  }
  return callTauri<string | null>('save_workflow_file', {
    defaultName,
    contents,
    path: existingPath,
  });
}

/**
 * 打开工作流文件：Tauri 环境调用系统「打开」对话框，浏览器环境用隐藏 input 选择文件。
 * 用户取消时返回 null。
 */
export async function openWorkflowFile(): Promise<OpenedWorkflowFile | null> {
  if (isTauri()) {
    return callTauri<OpenedWorkflowFile | null>('open_workflow_file');
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.htyx,application/json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve({ path: file.name, contents: String(reader.result ?? '') });
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    };
    input.click();
  });
}
