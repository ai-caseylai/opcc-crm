import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Upload, FileUp, Check } from 'lucide-react';

export default function ImportData() {
  const queryClient = useQueryClient();
  type ImportType = 'customers' | 'suppliers' | 'products' | 'invoices' | 'quotations';
const [type, setType] = useState<ImportType>('customers');
  const [csvText, setCsvText] = useState('');
  const [parsedData, setParsedData] = useState<any[] | null>(null);
  const [result, setResult] = useState<{ imported: number; skipped: number; total: number } | null>(null);

  const parseMut = useMutation({
    mutationFn: () => api('/import/parse-csv', { method: 'POST', body: { csv: csvText, type } }),
    onSuccess: (data) => setParsedData(data.rows),
  });

  const importMut = useMutation({
    mutationFn: () => api(`/import/${type}`, { method: 'POST', body: { data: parsedData } }),
    onSuccess: (data) => {
      setResult(data);
      queryClient.invalidateQueries({ queryKey: [type] });
    },
  });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setCsvText(ev.target?.result as string);
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-2xl font-bold">導入數據 Import</h2>
        <p className="text-muted-foreground mt-1">從 CSV 導入客戶、供應商、產品、發票和報價單</p>
      </div>

      {/* Type Selection */}
      <div className="flex flex-wrap gap-2">
        {(['customers', 'suppliers', 'products', 'invoices', 'quotations'] as ImportType[]).map((t) => (
          <button key={t} onClick={() => { setType(t); setParsedData(null); setResult(null); }}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${type === t ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-accent'}`}>
            {{ customers: '客戶', suppliers: '供應商', products: '產品', invoices: '📄 發票', quotations: '📋 報價單' }[t]}
          </button>
        ))}
      </div>

      {/* Upload */}
      <div className="bg-card border rounded-xl p-6 space-y-4">
        <h3 className="font-semibold">上傳 CSV 檔案</h3>
        <div className="border-2 border-dashed rounded-lg p-8 text-center">
          <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" id="csv-upload" />
          <label htmlFor="csv-upload" className="cursor-pointer space-y-2">
            <FileUp className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">點擊上傳 CSV 檔案</p>
            <p className="text-xs text-muted-foreground">第一行為標題欄</p>
          </label>
        </div>

        {/* Manual CSV input */}
        <div>
          <label className="block text-sm font-medium mb-1">或貼上 CSV 內容</label>
          <textarea value={csvText} onChange={(e) => setCsvText(e.target.value)}
            placeholder={`name,company_name,email,phone\nExample Ltd,Example Co,test@example.com,+852 12345678`}
            className="w-full px-3 py-2 border rounded-md bg-background text-sm font-mono" rows={6} />
        </div>

        <button onClick={() => parseMut.mutate()} disabled={!csvText || parseMut.isPending}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50">
          <Upload className="h-4 w-4" /> 解析 CSV Parse
        </button>
      </div>

      {/* Preview */}
      {parsedData && (
        <div className="bg-card border rounded-xl p-6 space-y-4">
          <h3 className="font-semibold">預覽 {parsedData.length} 筆數據</h3>
          <div className="max-h-64 overflow-y-auto text-sm">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50">
                  {Object.keys(parsedData[0] || {}).map((k) => (
                    <th key={k} className="text-left p-2 font-medium">{k}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parsedData.slice(0, 20).map((row, idx) => (
                  <tr key={idx} className="border-b">
                    {Object.values(row).map((v: any, i) => (
                      <td key={i} className="p-2">{v}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={() => importMut.mutate()} disabled={importMut.isPending}
            className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50">
            <Check className="h-4 w-4" /> 導入 {parsedData.length} 筆數據
          </button>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-6 space-y-2">
          <h3 className="font-semibold text-green-800">導入完成</h3>
          <p className="text-sm text-green-700">成功導入: {result.imported} | 跳過: {result.skipped} | 總計: {result.total}</p>
        </div>
      )}
    </div>
  );
}
