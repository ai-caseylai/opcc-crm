import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, WORKER_API_BASE } from '../lib/api';
import { useToast } from '../components/Toast';
import { Upload, FileText, Image, File, Loader2 } from 'lucide-react';
import { tr } from '../lib/i18nHelpers';

export default function FileUpload() {
  const nav = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [dragOver, setDragOver] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [folder, setFolder] = useState('');
  const [description, setDescription] = useState('');
  const [uploading, setUploading] = useState(false);
  const [processingMsg, setProcessingMsg] = useState<string | null>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setDragOver(true); }, []);
  const handleDragLeave = useCallback(() => setDragOver(false), []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    if (e.dataTransfer.files.length > 0) setFiles(Array.from(e.dataTransfer.files));
  }, []);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) setFiles(Array.from(e.target.files));
  }, []);

  // Upload one file: base64 → upload → import-document (OCR + type detection) → navigate
  const uploadFile = async (file: File): Promise<string> => {
    const token = localStorage.getItem('token');
    const activeClient = localStorage.getItem('activeClient');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    };
    if (activeClient) {
      try { const c = JSON.parse(activeClient); if (c?.id) headers['X-Active-Client'] = c.id; } catch {}
    }

    // Convert to base64
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });

    // Step 1: Upload to file-storage
    const uploadBody = {
      filename: file.name,
      original_name: file.name,
      file_type: file.type,
      file_size: file.size,
      file_data: base64,
      folder: folder || 'Uploads',
      description: description,
    };

    const uploadData = await api('/file-storage/upload', {
      method: 'POST', body: uploadBody, baseUrl: WORKER_API_BASE,
    }) as any;
    const fileId = uploadData?.id;
    if (!fileId) throw new Error('Upload succeeded but no file ID');

    // Step 2: Run OCR + document type detection
    setProcessingMsg(tr('Running OCR and AI analysis… (20-40 sec)', 'OCR 及 AI 分析中… (20-40秒)', 'OCR 及 AI 分析中… (20-40秒)'));
    const importResp = await fetch(
      `${WORKER_API_BASE}/file-storage/${fileId}/import-document`,
      { method: 'POST', headers }
    );
    const result = await importResp.json().catch(() => ({}));
    setProcessingMsg(null);

    // Duplicate handling
    if (importResp.status === 409) {
      const dupInfo = result?.duplicate_info;
      if (result?.type === 'card_statement' && result?.statement_id) {
        toast.warning(tr('Duplicate card statement. Opening existing.', '重複的信用卡月結單。開啟現有。', '重复的信用卡月结单。开启现有。'));
        nav(`/card-statements/review/${result.statement_id}`);
        return 'duplicate';
      }
      if (result?.type === 'bank_statement' && result?.statement_id) {
        toast.warning(tr('Duplicate bank statement. Opening existing.', '重複的銀行月結單。開啟現有。', '重复的银行月结单。开启现有。'));
        nav(`/bank-statements/review/${result.statement_id}`);
        return 'duplicate';
      }
      toast.warning(result?.error || tr('Duplicate file.', '重複文件。', '重复文件。'));
      return 'duplicate';
    }

    // Route based on detected document type
    const docType = result?.type;
    if (docType === 'card_statement' && result?.statement_id) {
      if (result?.ocr_failed) toast.warning(tr('Could not auto-read. Please enter details manually.', '無法自動讀取。請手動輸入。', '无法自动读取。请手动输入。'));
      nav(`/card-statements/review/${result.statement_id}`);
    } else if (docType === 'bank_statement' && result?.statement_id) {
      if (result?.ocr_failed) toast.warning(tr('Could not auto-read. Please enter details manually.', '無法自動讀取。請手動輸入。', '无法自动读取。请手动输入。'));
      nav(`/bank-statements/review/${result.statement_id}`);
    } else if (docType === 'invoice' && result?.invoice_id) {
      nav(`/invoices/review/${result.invoice_id}`);
    } else if (result?.error) {
      toast.error(tr('Processing error:', '處理錯誤：', '处理错误：') + ' ' + result.error);
    }
    return 'ok';
  };

  const handleUpload = async () => {
    if (files.length === 0) return;
    setUploading(true);
    let ok = 0;
    for (const file of files) {
      try {
        await uploadFile(file);
        ok++;
      } catch (e: any) {
        toast.error(`${file.name}: ${e.message}`);
      }
    }
    setUploading(false);
    setFiles([]);
    setDescription('');
    if (ok > 0) queryClient.invalidateQueries({ queryKey: ['file-storage'] });
  };

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold flex items-center gap-2">
        <Upload className="h-6 w-6" /> {tr('File Upload', '上傳文件', '上传文件')}
      </h2>

      <div onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
        className={`bg-card border-2 border-dashed rounded-xl p-8 transition-colors ${dragOver ? 'border-primary bg-primary/5' : 'border-border'}`}>
        <div className="flex flex-col items-center gap-4">
          <div className={`rounded-full p-4 transition-colors ${dragOver ? 'bg-primary/10' : 'bg-muted'}`}>
            <Upload className={`h-8 w-8 ${dragOver ? 'text-primary' : 'text-muted-foreground'}`} />
          </div>
          <div className="text-center">
            <p className="font-medium">{dragOver ? tr('Drop files here', '放開以上傳', '放開以上传') : tr('Drag & drop files here, or click to browse', '拖放文件至此，或點擊瀏覽', '拖放文件至此，或点击浏览')}</p>
            <p className="text-sm text-muted-foreground mt-1">{tr('Supports PDF, PNG, JPG. OCR auto-detects bank statements, card statements & invoices.', '支援 PDF、PNG、JPG。OCR 自動檢測銀行月結單、信用卡月結單及發票。', '支援 PDF、PNG、JPG。OCR 自动检测银行月结单、信用卡月结单及发票。')}</p>
          </div>
          <label className="cursor-pointer bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90">
            {uploading ? tr('Uploading...', '上傳中...', '上传中...') : tr('Select Files', '選擇文件', '选择文件')}
            <input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={handleFileInput} className="hidden" multiple />
          </label>
        </div>
        {files.length > 0 && (
          <>
            <div className="mt-4 pt-4 border-t">
              <p className="text-sm font-medium mb-2">{files.length} {tr('file(s) selected', '個文件已選擇', '个文件已选择')}</p>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
                    {f.type.includes('pdf') ? <FileText className="h-4 w-4 text-red-500" />
                     : f.type.includes('image') ? <Image className="h-4 w-4 text-blue-500" />
                     : <File className="h-4 w-4 text-gray-500" />}
                    <span className="truncate">{f.name}</span>
                    <span className="text-xs">({(f.size / 1024).toFixed(1)} KB)</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 mt-4 pt-4 border-t">
              <div>
                <label className="text-xs text-muted-foreground">{tr('Folder', '文件夾', '文件夹')}</label>
                <input value={folder} onChange={e => setFolder(e.target.value)} placeholder={tr('e.g. FY2026', '例如：FY2026', '例如：FY2026')}
                  className="px-3 py-2 border rounded-md bg-background text-sm w-52 focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
              <div className="flex-1 min-w-[200px]">
                <label className="text-xs text-muted-foreground">{tr('Description', '描述', '描述')}</label>
                <input value={description} onChange={e => setDescription(e.target.value)} placeholder={tr('Optional description', '可選描述', '可选描述')}
                  className="px-3 py-2 border rounded-md bg-background text-sm w-full focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => { setFiles([]); setDescription(''); }}
                className="px-4 py-2 border rounded-md text-sm hover:bg-muted">{tr('Clear', '清除', '清除')}</button>
              <button onClick={handleUpload} disabled={uploading}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-2">
                {uploading && <Loader2 className="h-4 w-4 animate-spin" />}
                {tr('Upload & Analyze', '上傳並分析', '上传并分析')}
              </button>
            </div>
          </>
        )}
      </div>

      {processingMsg && (
        <div className="bg-primary/10 border border-primary/30 rounded-lg p-4 flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <div>
            <p className="text-sm font-medium">{processingMsg}</p>
            <p className="text-xs text-muted-foreground">{tr('DeepSeek AI is extracting transactions…', 'DeepSeek AI 正在提取交易記錄…', 'DeepSeek AI 正在提取交易记录…')}</p>
          </div>
        </div>
      )}
    </div>
  );
}
