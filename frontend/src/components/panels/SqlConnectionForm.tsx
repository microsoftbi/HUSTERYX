import { useState } from 'react';
import { CheckCircle2, Loader2, PlugZap, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { api } from '@/api/client';
import { cn } from '@/lib/utils';
import type { SqlServerConnection } from '@/types';

interface Props {
  connection: SqlServerConnection;
  onChange: (connection: SqlServerConnection) => void;
}

export function SqlConnectionForm({ connection, onChange }: Props) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const patch = (p: Partial<SqlServerConnection>) => {
    setResult(null);
    onChange({ ...connection, ...p });
  };

  const handleTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      const res = await api.testSqlServer(connection);
      setResult({
        ok: res.ok,
        message: res.ok
          ? `连接成功${res.version ? ` · ${res.version}` : ''}`
          : res.message,
      });
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-[1fr_88px] gap-2">
        <div className="flex flex-col gap-1.5">
          <Label>服务器</Label>
          <Input
            value={connection.server}
            onChange={(event) => patch({ server: event.target.value })}
            placeholder="127.0.0.1 或 host\\instance"
            className="h-8 text-xs"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>端口</Label>
          <Input
            type="number"
            value={connection.port ?? 1433}
            onChange={(event) => patch({ port: Number(event.target.value) || 1433 })}
            className="h-8 text-xs"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>数据库</Label>
        <Input
          value={connection.database}
          onChange={(event) => patch({ database: event.target.value })}
          placeholder="数据库名称"
          className="h-8 text-xs"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1.5">
          <Label>用户名</Label>
          <Input
            value={connection.user}
            onChange={(event) => patch({ user: event.target.value })}
            className="h-8 text-xs"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>密码</Label>
          <Input
            type="password"
            value={connection.password}
            onChange={(event) => patch({ password: event.target.value })}
            className="h-8 text-xs"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-md border border-border p-2.5">
        <label className="flex items-center justify-between text-xs text-muted-foreground">
          加密连接（encrypt）
          <Switch
            checked={connection.encrypt ?? true}
            onCheckedChange={(checked) => patch({ encrypt: checked })}
          />
        </label>
        <label className="flex items-center justify-between text-xs text-muted-foreground">
          信任服务器证书
          <Switch
            checked={connection.trustServerCertificate ?? true}
            onCheckedChange={(checked) => patch({ trustServerCertificate: checked })}
          />
        </label>
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleTest}
          disabled={testing || !connection.server || !connection.database}
        >
          {testing ? <Loader2 className="animate-spin" /> : <PlugZap />}
          测试连接
        </Button>
        {result && (
          <span
            className={cn(
              'flex items-center gap-1 text-[11px]',
              result.ok ? 'text-[var(--success)]' : 'text-destructive',
            )}
          >
            {result.ok ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}
            <span className="truncate" title={result.message}>
              {result.message}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
