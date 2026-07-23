import React, { useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, WORKER_API_BASE } from '../lib/api';
import { Upload, Download, Trash2, Search, Pencil, X, Check, File, FileText, FileSpreadsheet, Image, FolderOpen, Folder, ChevronRight, ChevronDown, Zap } from 'lucide-react';

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function fileIcon(type: string) {
  if (type.includes('pdf')) return <FileText className="h-5 w-5 text-red-500" />;
  if (type.includes('sheet') || type.includes('excel') || type.includes('xls') || type.includes('csv')) return <FileSpreadsheet className="h-5 w-5 text-green-600" />;
  if (type.includes('image') || type.includes('png') || type.includes('jpg')) return <Image className="h-5 w-5 text-blue-500" />;
  return <File className="h-5 w-5 text-gray-500" />;
}

function autoFolder(filename: string, fileType: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const t = (fileType || '').toLowerCase();
  if (t.includes('pdf') || ext === 'pdf') return 'Documents/PDF';
  if (t.includes('word') || ext === 'doc' || ext === 'docx') return 'Documents/Word';
  if (t.includes('sheet') || t.includes('excel') || ext === 'xls' || ext === 'xlsx') return 'Spreadsheets';
  if (t.includes('csv') || ext === 'csv') return 'Spreadsheets/CSV';
  if (t.includes('image') || ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'gif' || ext === 'webp') return 'Images';
  if (ext === 'zip' || ext === 'rar' || ext === '7z') return 'Archives';
  if (ext === 'txt') return 'Documents/Text';
  if (ext === 'ppt' || ext === 'pptx') return 'Documents/Slides';
  return 'Other';
}

async function downloadFile(id: string, filename: string) {
  const token = localStorage.getItem('token');
  const res = await fetch(`/api/file-storage/${id}/download`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Download failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

interface FileItem {
  id: string;
  filename: string;
  original_name?: string;
  file_type: string;
  file_size: number;
  folder: string;
  description?: string;
  category?: string;
  direction?: string;
  payment_status?: string;
  amount?: number;
  created_at: string;
}

interface TreeNode {
  name: string;
  path: string;
  files: FileItem[];
  children: TreeNode[];
}

function buildTree(files: FileItem[]): TreeNode {
  const root: TreeNode = { name: 'All Files', path: '', files: [], children: [] };
  for (const f of files) {
    const parts = (f.folder || 'Other').split('/');
    let node = root;
    for (const part of parts) {
      let child = node.children.find(c => c.name === part);
      if (!child) {
        child = { name: part, path: [...(node.path ? [node.path] : []), part].join('/'), files: [], children: [] };
        node.children.push(child);
      }
      node = child;
    }
    node.files.push(f);
  }
  // Sort: folders first, then files; folders alphabetically
  const sortNode = (n: TreeNode) => {
    n.children.sort((a, b) => a.name.localeCompare(b.name));
    n.children.forEach(sortNode);
  };
  sortNode(root);
  return root;
}

function FolderTree({ node, depth, expanded, toggle, onFileAction, onSetDirection }: {
  node: TreeNode; depth: number; expanded: Set<string>; toggle: (p: string) => void;
  onFileAction: (action: string, f: FileItem) => void;
  onSetDirection: (id: string, direction: string) => void;
}) {
  const { t } = useTranslation();
  const isExpanded = expanded.has(node.path) || depth === 0;
  const hasContent = node.children.length > 0 || node.files.length > 0;

  return (
    <div>
      {depth > 0 && hasContent && (
        <button onClick={() => toggle(node.path)}
          className="flex items-center gap-2 w-full text-left hover:bg-muted/50 rounded-md px-2 py-1.5"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}>
          {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
          {isExpanded ? <FolderOpen className="h-4 w-4 text-amber-500 shrink-0" /> : <Folder className="h-4 w-4 text-amber-500 shrink-0" />}
          <span className="text-sm font-medium">{node.name}</span>
          <span className="text-xs text-muted-foreground">({node.files.length})</span>
        </button>
      )}
      {isExpanded && (
        <>
          {node.children.map(child => (
            <FolderTree key={child.path} node={child} depth={depth + 1} expanded={expanded} toggle={toggle} onFileAction={onFileAction} onSetDirection={onSetDirection} />
          ))}
          {node.files.map(f => (
            <div key={f.id} className="flex items-center justify-between hover:bg-muted/30 rounded-md px-2 py-1.5"
              style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}>
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {fileIcon(f.file_type)}
                <div className="min-w-0 flex-1">
                  <div className="text-sm truncate">{f.filename || f.original_name}</div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{formatSize(f.file_size || 0)}</span>
                    <span>{f.created_at?.slice(0, 10)}</span>
                    {f.category === 'invoice' && f.direction && (
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        f.direction === 'outgoing' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
                      }`}>{f.direction === 'outgoing' ? '銷售' : '採購'}</span>
                    )}
                    {f.category === 'invoice' && f.payment_status && f.payment_status !== 'unmatched' && (
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        f.payment_status === 'received' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                        : f.payment_status === 'paid' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                        : 'bg-gray-100 text-gray-700'
                      }`}>{f.payment_status === 'received' ? '已收' : f.payment_status === 'paid' ? '已付' : f.payment_status}</span>
                    )}
                    {f.category === 'invoice' && f.amount != null && (
                      <span className="font-mono">${f.amount.toLocaleString()}</span>
                    )}
                    {f.description && <span className="truncate max-w-[200px]">— {f.description}</span>}
                  </div>
                </div>
              </div>
              <div className="flex gap-1 ml-2 shrink-0">
                {f.category === 'invoice' && (
                  <button onClick={() => onSetDirection(f.id, f.direction === 'outgoing' ? 'incoming' : 'outgoing')}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                      f.direction === 'outgoing' ? 'border-blue-300 text-blue-600 hover:bg-blue-50' :
                      f.direction === 'incoming' ? 'border-orange-300 text-orange-600 hover:bg-orange-50' :
                      'border-gray-300 text-gray-500 hover:bg-gray-50'
                    }`} title="切換銷售/採購">
                    {!f.direction ? '?' : f.direction === 'outgoing' ? '銷' : '採'}
                  </button>
                )}
                <button onClick={() => downloadFile(f.id, f.filename || 'file')} className="p-1 hover:bg-muted rounded"><Download className="h-3.5 w-3.5" /></button>
                {(f.category === 'bank_statement' || f.category === 'bank' || (f.file_type || '').includes('pdf')) && (
                  <button onClick={() => onFileAction('import-statement', f)} className="px-1.5 py-0.5 rounded text-[10px] font-medium border border-green-300 text-green-600 hover:bg-green-50" title="匯入為銀行月結單">
                    匯入
                  </button>
                )}
                {(f.category === 'invoice' || f.category === 'receipt' || (f.file_type || '').includes('pdf')) && (
                  <button onClick={() => onFileAction('import-invoice', f)} className="px-1.5 py-0.5 rounded text-[10px] font-medium border border-blue-300 text-blue-600 hover:bg-blue-50" title="匯入為發票">
                    發票
                  </button>
                )}
                <button onClick={() => onFileAction('edit', f)} className="p-1 hover:bg-muted rounded"><Pencil className="h-3.5 w-3.5" /></button>
                <button onClick={() => { if (confirm(t('common.confirmDelete'))) onFileAction('delete', f); }} className="p-1 hover:bg-muted rounded text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export default function FileStorage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [folder, setFolder] = useState('');
  const [description, setDescription] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [filterFolder, setFilterFolder] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editFolder, setEditFolder] = useState('');
  const [editDesc, setEditDesc] = useState('');

  const { data: files, isLoading } = useQuery({
    queryKey: ['file-storage', filterFolder, searchQ],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filterFolder) params.set('folder', filterFolder);
      if (searchQ) params.set('q', searchQ);
      const qs = params.toString();
      return api(`/file-storage${qs ? `?${qs}` : ''}`);
    },
  });

  const { data: folders } = useQuery({
    queryKey: ['file-storage-folders'],
    queryFn: () => api('/file-storage/folders'),
  });

  const uploadMut = useMutation({
    mutationFn: (body: unknown) => api('/file-storage/upload', { method: 'POST', body, baseUrl: WORKER_API_BASE }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['file-storage'] });
      queryClient.invalidateQueries({ queryKey: ['file-storage-folders'] });
      setDescription('');
    },
    onError: (err: any) => {
      alert(`上傳失敗：${err?.message || err?.error || '未知錯誤'}`);
      setUploading(false);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api(`/file-storage/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['file-storage'] });
      queryClient.invalidateQueries({ queryKey: ['file-storage-folders'] });
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) => api(`/file-storage/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['file-storage'] });
      queryClient.invalidateQueries({ queryKey: ['file-storage-folders'] });
      setEditingId(null);
    },
  });

  const autoMatchMut = useMutation({
    mutationFn: () => api('/file-storage/auto-match-invoices', { method: 'POST' }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['file-storage'] });
      alert(`配對完成：${data.matched?.length || 0} 筆成功，${data.unmatched || 0} 筆未配對`);
    },
  });

  const importStmtMut = useMutation({
    mutationFn: (id: string) => api(`/file-storage/${id}/import-statement`, { method: 'POST' }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['file-storage'] });
      queryClient.invalidateQueries({ queryKey: ['file-storage-folders'] });
      queryClient.invalidateQueries({ queryKey: ['bank-statements'] });
      alert(`已匯入銀行月結單！\n交易筆數：${data.transactions_count || 0}\n銀行：${data.bank_name || '未知'}`);
    },
    onError: (err: any) => {
      alert(`匯入失敗：${err?.message || err?.error || '未知錯誤'}`);
    },
  });

  const importInvMut = useMutation({
    mutationFn: (id: string) => api(`/file-storage/${id}/import-invoice`, { method: 'POST' }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['file-storage'] });
      queryClient.invalidateQueries({ queryKey: ['file-storage-folders'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      if (data.ocr_failed) {
        alert('已建立發票草稿。\nOCR 無法自動辨識，請在手動審查頁面輸入資料。');
        window.location.href = '/invoices/review/' + data.invoice_id;
      } else {
        alert(`已匯入發票！\n發票號碼：${data.invoice_number || 'DRAFT'}\n品項數：${data.items_count || 0}`);
      }
    },
    onError: (err: any) => {
      alert(`匯入失敗：${err?.message || err?.error || '未知錯誤'}`);
    },
  });

  const uploadFiles = useCallback((fileList: FileList | File[]) => {
    const arr = Array.from(fileList);
    if (arr.length === 0) return;
    setUploading(true);
    let pending = arr.length;
    arr.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const base64 = ev.target?.result as string;
        const autoFolderName = folder || autoFolder(file.name, file.type);
        uploadMut.mutate({
          filename: file.name,
          original_name: file.name,
          file_type: file.type || 'application/octet-stream',
          file_size: file.size,
          file_data: base64,
          folder: autoFolderName,
          description,
        });
        pending--;
        if (pending === 0) setUploading(false);
      };
      reader.readAsDataURL(file);
    });
  }, [folder, description, uploadMut]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) uploadFiles(e.target.files);
    e.target.value = '';
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setDragOver(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setDragOver(false); };
  const handleDrop = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setDragOver(false); if (e.dataTransfer.files.length > 0) uploadFiles(e.dataTransfer.files); };

  const toggleFolder = (path: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };

  const handleFileAction = (action: string, f: FileItem) => {
    if (action === 'edit') {
      setEditingId(f.id);
      setEditName(f.filename || '');
      setEditFolder(f.folder || '');
      setEditDesc(f.description || '');
    } else if (action === 'delete') {
      deleteMut.mutate(f.id);
    } else if (action === 'import-statement') {
      if (confirm(`確定要將「${f.filename}」匯入為銀行月結單嗎？系統會自動 OCR 辨識並解析交易紀錄。`)) {
        importStmtMut.mutate(f.id);
      }
    } else if (action === 'import-invoice') {
      if (confirm(`確定要將「${f.filename}」匯入為發票嗎？系統會自動 OCR 辨識並解析品項。`)) {
        importInvMut.mutate(f.id);
      }
    }
  };

  const directionMut = useMutation({
    mutationFn: ({ id, direction }: { id: string; direction: string }) =>
      api(`/file-storage/${id}/direction`, { method: 'PATCH', body: JSON.stringify({ direction }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['file-storage'] }),
  });

  const handleSetDirection = (id: string, direction: string) => {
    directionMut.mutate({ id, direction });
  };

  const fileList = (files?.data || []) as FileItem[];
  const folderList = (folders?.data || []) as string[];
  const tree = useMemo(() => buildTree(fileList), [fileList]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{t('fileStorage.title')}</h2>
        <p className="text-muted-foreground mt-1">{t('fileStorage.desc')}</p>
      </div>

      {/* Upload area */}
      <div onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
        className={`bg-card border-2 border-dashed rounded-xl p-8 transition-colors ${dragOver ? 'border-primary bg-primary/5' : 'border-border'}`}>
        <div className="flex flex-col items-center gap-4">
          <div className={`rounded-full p-4 transition-colors ${dragOver ? 'bg-primary/10' : 'bg-muted'}`}>
            <Upload className={`h-8 w-8 ${dragOver ? 'text-primary' : 'text-muted-foreground'}`} />
          </div>
          <div className="text-center">
            <p className="font-medium">{dragOver ? t('fileStorage.dropHere') : t('fileStorage.dragDrop')}</p>
            <p className="text-sm text-muted-foreground mt-1">{t('fileStorage.orClick')}（自動分類到對應資料夾）</p>
          </div>
          <label className="cursor-pointer bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90">
            {uploading ? 'Uploading...' : t('fileStorage.upload')}
            <input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.gif,.webp,.csv,.txt,.ppt,.pptx,.zip" onChange={handleFileInput} className="hidden" multiple />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-4 pt-4 border-t">
          <div>
            <label className="text-xs text-muted-foreground">{t('fileStorage.folder')}（留空自動分類）</label>
            <input value={folder} onChange={e => setFolder(e.target.value)} placeholder={t('fileStorage.folderPlaceholder')}
              className="px-3 py-2 border rounded-md bg-background text-sm w-52" />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs text-muted-foreground">{t('fileStorage.description')}</label>
            <input value={description} onChange={e => setDescription(e.target.value)} placeholder={t('fileStorage.description')}
              className="px-3 py-2 border rounded-md bg-background text-sm w-full" />
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder={t('fileStorage.search')}
            className="pl-9 pr-3 py-2 border rounded-md bg-background text-sm w-full" />
        </div>
        <select value={filterFolder} onChange={e => setFilterFolder(e.target.value)}
          className="px-3 py-2 border rounded-md bg-background text-sm min-w-[160px]">
          <option value="">{t('fileStorage.allFolders')}</option>
          {folderList.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <span className="text-xs text-muted-foreground">{fileList.length} 個檔案</span>
        <button onClick={() => autoMatchMut.mutate()} disabled={autoMatchMut.isPending}
          className="flex items-center gap-1 px-3 py-2 bg-primary text-primary-foreground rounded-md text-xs hover:opacity-90 disabled:opacity-40">
          <Zap className="h-3 w-3" /> 配對發票
        </button>
      </div>

      {/* Folder Tree View */}
      {editingId ? (
        <div className="bg-card border rounded-xl p-6">
          <div className="space-y-3">
            <input value={editName} onChange={e => setEditName(e.target.value)} className="px-3 py-2 border rounded-md text-sm w-full" placeholder="檔案名稱" />
            <div className="flex gap-3">
              <input value={editFolder} onChange={e => setEditFolder(e.target.value)} className="px-3 py-2 border rounded-md text-sm flex-1" placeholder="資料夾（可用 / 分隔層級）" />
              <input value={editDesc} onChange={e => setEditDesc(e.target.value)} className="px-3 py-2 border rounded-md text-sm flex-1" placeholder="描述" />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setEditingId(null)} className="px-3 py-1.5 border rounded-md text-sm">取消</button>
              <button onClick={() => updateMut.mutate({ id: editingId, body: { filename: editName, folder: editFolder, description: editDesc } })}
                className="px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm">儲存</button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="bg-card border rounded-xl p-4">
        {isLoading ? (
          <div className="flex justify-center py-8"><div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" /></div>
        ) : fileList.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">{t('fileStorage.noData')}</p>
        ) : (
          <FolderTree node={tree} depth={0} expanded={expanded} toggle={toggleFolder} onFileAction={handleFileAction} onSetDirection={handleSetDirection} />
        )}
      </div>
    </div>
  );
}
