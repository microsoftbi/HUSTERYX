import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getApiBase, setApiBase } from '@/api/client';
import { getServerConfig, isTauri, setServerConfig } from '@/lib/desktop';
import { useWorkflowStore } from '@/store/workflowStore';

const MIN_LIMIT = 1;
const MAX_LIMIT = 10000;

type ConnMode = 'local' | 'remote';

/** 系统配置子窗体：预览缓存行数 + 后端连接方式。 */
export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const previewRowLimit = useWorkflowStore((s) => s.settings.previewRowLimit);
  const updateSettings = useWorkflowStore((s) => s.updateSettings);

  const [value, setValue] = useState(String(previewRowLimit));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const desktop = isTauri();
  const [mode, setMode] = useState<ConnMode>('local');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [initialMode, setInitialMode] = useState<ConnMode>('local');
  const [initialRemoteUrl, setInitialRemoteUrl] = useState('');

  // 每次打开时以当前配置初始化
  useEffect(() => {
    if (!open) return;
    setValue(String(previewRowLimit));
    setSaving(false);
    setError(null);
    void (async () => {
      if (!desktop) {
        setMode('local');
        setRemoteUrl(getApiBase());
        setInitialMode('local');
        setInitialRemoteUrl(getApiBase());
        return;
      }
      const config = await getServerConfig();
      const nextMode: ConnMode = config.mode === 'remote' ? 'remote' : 'local';
      const nextRemote = nextMode === 'remote' ? config.baseUrl : '';
      setMode(nextMode);
      setRemoteUrl(nextRemote);
      setInitialMode(nextMode);
      setInitialRemoteUrl(nextRemote);
    })();
  }, [open, previewRowLimit, desktop]);

  const parsed = Number(value);
  const invalid = !Number.isInteger(parsed) || parsed < MIN_LIMIT || parsed > MAX_LIMIT;
  const remoteInvalid = mode === 'remote' && !/^https?:\/\//.test(remoteUrl.trim());

  const handleSave = async () => {
    if (invalid) {
      setError(`请输入 ${MIN_LIMIT} - ${MAX_LIMIT} 之间的整数`);
      return;
    }
    if (remoteInvalid) {
      setError('远程地址需以 http:// 或 https:// 开头');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateSettings({ previewRowLimit: parsed });

      const connChanged =
        desktop &&
        (mode !== initialMode ||
          (mode === 'remote' && remoteUrl.trim().replace(/\/$/, '') !== initialRemoteUrl));
      if (connChanged) {
        const config = await setServerConfig(mode, mode === 'remote' ? remoteUrl.trim() : '');
        setApiBase(config.baseUrl);
        window.location.reload();
        return;
      }
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>系统配置</DialogTitle>
          <DialogDescription>配置数据预览行数与后端连接方式。</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor="preview-row-limit">预览缓存行数</Label>
          <Input
            id="preview-row-limit"
            type="number"
            min={MIN_LIMIT}
            max={MAX_LIMIT}
            step={1}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            范围 {MIN_LIMIT} - {MAX_LIMIT}，默认 10000。数据预览最多显示该行数，超出部分以「仅显示前 X / Y 行」提示。
          </p>
        </div>

        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <Label>后端连接</Label>
          {desktop ? (
            <>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={mode === 'local' ? 'default' : 'outline'}
                  onClick={() => setMode('local')}
                >
                  本地（内置引擎）
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={mode === 'remote' ? 'default' : 'outline'}
                  onClick={() => setMode('remote')}
                >
                  远程服务器
                </Button>
              </div>
              {mode === 'remote' && (
                <Input
                  placeholder="http://10.0.0.5:8787"
                  value={remoteUrl}
                  onChange={(event) => setRemoteUrl(event.target.value)}
                />
              )}
              <p className="text-xs text-muted-foreground">切换连接后应用将自动重新加载。</p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              当前为浏览器模式，后端地址：{getApiBase()}（由 VITE_API_BASE 决定）。
            </p>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            取消
          </Button>
          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || invalid || remoteInvalid}
          >
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
