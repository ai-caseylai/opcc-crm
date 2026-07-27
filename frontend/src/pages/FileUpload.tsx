import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, WORKER_API_BASE } from '../lib/api';
import { useToast } from '../components/Toast';
import { Upload, FileText, FileSpreadsheet, Image, File } from 'lucide-react';
import SupervisorPasswordModal from '../components/SupervisorPasswordModal';
import { useAuth } from '../contexts/AuthContext';
import { tr } from '../lib/i18nHelpers';

export default function FileUpload() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [dragOver, setDragOver] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [folder, setFolder] = useState('');
  const [description, setDescription] = useState('');
  const [uploading, setUploading] = useState(false);
  const [showSupervisorModal, setShowSupervisorModal] = useState(false);
  const [pendingUploads, setPendingUploads] = useState<{ id: string; filename: string; type: string; autoType?: string }[]>([]);

  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setDragOver(true); }, []);
  const handleDragLeave = useCallback(() => setDragOver(false), []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    if (e.dataTransfer.files.length > 0) setFiles(Array.from(e.dataTransfer.files));
  }, []);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) setFiles(Array.from(e.target.files));
  }, []);

  const autoFolder = (filename: string, fileType: string): string => {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    if (fileType.includes('pdf') || ext === 'pdf') return 'Documents/PDF';
    if (fileType.includes('sheet') || ext === 'xls' || ext === 'xlsx' || ext === 'csv') return 'Spreadsheets';
    if (fileType.includes('image') || ext === 'png' || ext === 'jpg' || ext === 'jpeg') return 'Images';
    return 'Other';
  };

  const uploadFile = async (file: File): Promise<any> => {
    const token = localStorage.getItem('token');
    const formData = new FormData();
    formData.append('file', file);
    formData.append('folder', folder || autoFolder(file.name, file.type));
    formData.append('description', description);
    const res = await fetch(`${WORKER_API_BASE}/file-storage`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    return res.json();
  };

  const handleUpload = async () => {
    if (files.length === 0) return;
    if (user?.role === 'staff' && (user as any)?.permission_tier !== 'higher') {
      setShowSupervisorModal(true);
      return;
    }
    setUploading(true);
    const results: any[] = [];
    for (const file of files) {
      try {
        const result = await uploadFile(file);
        results.push(result);
        if (result.needs_review) {
          setPendingUploads(prev => [...prev, { id: result.id, filename: file.name, type: file.type, autoType: result.auto_type }]);
        }
      } catch (e: any) {
        toast.error(`${file.name}: ${e.message}`);
      }
    }
    setUploading(false);
    setFiles([]);
    setDescription('');
    const successCount = results.filter(r => !r.error).length;
    if (successCount > 0) {
      toast.success(tr(`${successCount} file(s) uploaded`, `已上傳 ${successCount} 個文件`, `已上传 ${successCount} 个文件`));
      queryClient.invalidateQueries({ queryKey: ['file-storage'] });
    }
    if (results.some((r: any) => r.needs_review)) {
      const reviewFile = results.find((r: any) => r.needs_review);
      if (reviewFile) nav(`/bank-statements/review/${reviewFile.id}`);
    }
  };

  const showReviewPrompt = pendingUploads.length > 0 && pendingUploads.some(f => f.autoType === 'bank_statement' || f.autoType === 'invoice');

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">{tr('File Upload', '上傳文件', '上传文件')}</h2>

      {/* Upload area */}
      <div onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
        className={`bg-card border-2 border-dashed rounded-xl p-8 transition-colors ${dragOver ? 'border-primary bg-primary/5' : 'border-border'}`}>
        <div className="flex flex-col items-center gap-4">
          <div className={`rounded-full p-4 transition-colors ${dragOver ? 'bg-primary/10' : 'bg-muted'}`}>
            <Upload className={`h-8 w-8 ${dragOver ? 'text-primary' : 'text-muted-foreground'}`} />
          </div>
          <div className="text-center">
            <p className="font-medium">{dragOver ? t('fileStorage.dropHere') : tr('Drag & drop files here, or click to browse', '拖放文件至此，或點擊瀏覽', '拖放文件至此，或点击浏览')}</p>
            <p className="text-sm text-muted-foreground mt-1">{tr('Supports PDF, PNG, JPG, XLSX, CSV (max 25MB per file)', '支援 PDF、PNG、JPG、XLSX、CSV（每個檔案最大 25MB）', '支援 PDF、PNG、JPG、XLSX、CSV（每个档案最大 25MB）')}</p>
          </div>
          <label className="cursor-pointer bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90">
            {uploading ? tr('Uploading...', '上傳中...', '上传中...') : tr('Select Files', '選擇文件', '选择文件')}
            <input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.gif,.webp,.csv,.txt,.ppt,.pptx,.zip" onChange={handleFileInput} className="hidden" multiple />
          </label>
        </div>
        {files.length > 0 && (
          <div className="mt-4 pt-4 border-t">
            <p className="text-sm font-medium mb-2">{files.length} {tr('file(s) selected', '個文件已選擇', '个文件已选择')}</p>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {files.map((f, i) => (
                <div key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
                  {f.type.includes('pdf') ? <FileText className="h-4 w-4 text-red-500" />
                   : f.type.includes('sheet') || f.name.endsWith('.csv') ? <FileSpreadsheet className="h-4 w-4 text-green-600" />
                   : f.type.includes('image') ? <Image className="h-4 w-4 text-blue-500" />
                   : <File className="h-4 w-4 text-gray-500" />}
                  <span className="truncate">{f.name}</span>
                  <span className="text-xs">({(f.size / 1024).toFixed(1)} KB)</span>
                </div>
              ))}
            </div>
          </div>
        )}
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
        {files.length > 0 && (
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => { setFiles([]); setDescription(''); }}
              className="px-4 py-2 border rounded-md text-sm hover:bg-muted">{tr('Clear', '清除', '清除')}</button>
            <button onClick={handleUpload} disabled={uploading}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50">
              {tr('Upload Files', '上傳文件', '上传文件')}
            </button>
          </div>
        )}
      </div>

      {showReviewPrompt && (
        <div className="bg-card border rounded-xl p-4 border-amber-300 bg-amber-50 dark:bg-amber-950/20">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
            {tr('Some files need review', '部分文件需要檢視', '部分文件需要检视')}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {tr('Bank statements and invoices detected. Please review and confirm before saving.', '已檢測到銀行月結單及發票。請在儲存前檢查並確認。', '已检测到银行月结单及发票。请在储存前检查并确认。')}
          </p>
          <button onClick={() => { const f = pendingUploads.find(x => x.autoType === 'bank_statement' || x.autoType === 'invoice'); if (f) nav(`/bank-statements/review/${f.id}`); }}
            className="mt-3 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium">
            {tr('Review Now', '立即檢視', '立即检视')}
          </button>
        </div>
      )}

      {showSupervisorModal && (
        <SupervisorPasswordModal
          onConfirm={() => { setShowSupervisorModal(false); handleUpload(); }}
          onCancel={() => setShowSupervisorModal(false)}
          action={tr('upload files', '上傳文件', '上传文件')}
        />
      )}
    </div>
  );
}
