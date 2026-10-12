import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/api/client';
import { Field, useNodeConfig, type PanelProps } from '@/components/panels/fields';
import { FilePathField } from '@/components/panels/FilePicker';
import { SqlConnectionForm } from '@/components/panels/SqlConnectionForm';
import type { FileUploadResult, InputCsvConfig, InputExcelConfig, InputSqlServerConfig } from '@/types';

/* ----------------------------- CSV 输入 ----------------------------- */

export function InputCsvPanel({ node }: PanelProps) {
  const [config, patch] = useNodeConfig<InputCsvConfig>(node);
  return (
    <div className="flex flex-col gap-4">
      <Field label="CSV 文件" hint="可直接填写路径，或点击上传按钮导入本地文件。">
        <FilePathField
          value={config.path ?? ''}
          onChange={(path) => patch({ path })}
          accept=".csv,.txt,.tsv"
          placeholder="data.csv 或绝对路径"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="分隔符">
          <Select
            value={config.delimiter ?? ','}
            onValueChange={(value) => patch({ delimiter: value })}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value=",">逗号 ,</SelectItem>
              <SelectItem value={'\t'}>制表符 Tab</SelectItem>
              <SelectItem value=";">分号 ;</SelectItem>
              <SelectItem value="|">竖线 |</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field label="编码">
          <Select
            value={config.encoding ?? 'utf-8'}
            onValueChange={(value) => patch({ encoding: value as 'utf-8' | 'gbk' })}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="utf-8">UTF-8</SelectItem>
              <SelectItem value="gbk">GBK</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>

      <label className="flex items-center justify-between rounded-md border border-border p-2.5 text-xs text-muted-foreground">
        首行为表头
        <Switch
          checked={config.hasHeader ?? true}
          onCheckedChange={(checked) => patch({ hasHeader: checked })}
        />
      </label>
    </div>
  );
}

/* ----------------------------- Excel 输入 ----------------------------- */

export function InputExcelPanel({ node }: PanelProps) {
  const [config, patch] = useNodeConfig<InputExcelConfig>(node);
  const [sheets, setSheets] = useState<string[]>([]);
  const [loadingSheets, setLoadingSheets] = useState(false);

  const loadSheets = useCallback(async (path: string) => {
    if (!path) {
      setSheets([]);
      return;
    }
    setLoadingSheets(true);
    try {
      const res = await api.listSheets(path);
      setSheets(res.sheets);
    } catch {
      setSheets([]);
    } finally {
      setLoadingSheets(false);
    }
  }, []);

  useEffect(() => {
    void loadSheets(config.path ?? '');
  }, [config.path, loadSheets]);

  const handleUploaded = (result: FileUploadResult) => {
    if (result.sheets && result.sheets.length > 0) {
      setSheets(result.sheets);
      if (!config.sheet) patch({ sheet: result.sheets[0] });
    }
  };

  const sheetValue = config.sheet ?? '';
  const hasFallback = Boolean(sheetValue) && !sheets.includes(sheetValue);

  return (
    <div className="flex flex-col gap-4">
      <Field label="Excel 文件" hint="支持 .xlsx / .xls，可填写路径或上传本地文件。">
        <FilePathField
          value={config.path ?? ''}
          onChange={(path) => patch({ path })}
          accept=".xlsx,.xls"
          placeholder="data.xlsx 或绝对路径"
          onUploaded={handleUploaded}
        />
      </Field>

      <Field
        label="工作表"
        hint={sheets.length > 0 ? `共 ${sheets.length} 个工作表` : '未填写工作表时读取第一个工作表'}
      >
        <div className="flex items-center gap-1.5">
          {sheets.length > 0 ? (
            <Select value={sheetValue} onValueChange={(value) => patch({ sheet: value })}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="选择工作表" />
              </SelectTrigger>
              <SelectContent>
                {hasFallback && <SelectItem value={sheetValue}>{sheetValue}</SelectItem>}
                {sheets.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={sheetValue}
              onChange={(event) => patch({ sheet: event.target.value })}
              placeholder="Sheet1"
              className="h-8 text-xs"
            />
          )}
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            title="刷新工作表列表"
            disabled={loadingSheets || !config.path}
            onClick={() => void loadSheets(config.path ?? '')}
          >
            {loadingSheets ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          </Button>
        </div>
      </Field>

      <label className="flex items-center justify-between rounded-md border border-border p-2.5 text-xs text-muted-foreground">
        首行为表头
        <Switch
          checked={config.hasHeader ?? true}
          onCheckedChange={(checked) => patch({ hasHeader: checked })}
        />
      </label>
    </div>
  );
}

/* ----------------------------- SQL Server 输入 ----------------------------- */

export function InputSqlServerPanel({ node }: PanelProps) {
  const [config, patch] = useNodeConfig<InputSqlServerConfig>(node);
  return (
    <div className="flex flex-col gap-4">
      <SqlConnectionForm
        connection={config.connection}
        onChange={(connection) => patch({ connection })}
      />
      <Field label="SQL 查询" hint="写入标准 T-SQL 查询，结果将作为本节点的输出表。">
        <Textarea
          value={config.query ?? ''}
          onChange={(event) => patch({ query: event.target.value })}
          placeholder="SELECT * FROM dbo.Customers"
          spellCheck={false}
          className="min-h-[120px] font-mono text-xs"
        />
      </Field>
    </div>
  );
}
