import React, { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { Upload, Download, Trash2, Search, Pencil, X, Check, File, FileText, FileSpreadsheet, Image } from 'lucide-react';

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function fileIcon(type: string) {
  if (type.includes('pdf')) return <FileText className="h-5 w-5 text-red-500" />;
  if (type.includes('sheet') || type.includes('excel') || type.includes('xls')) return <FileSpreadsheet className="h-5 w-5 text-green-600" />;
  if (type.includes('image') || type.includes('png') || type.includes('jpg')) return <Image className="h-5 w-5 text-blue-500" />;
  return <File className="h-5 w-5 text-gray-500" />;
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

export default function FileStorage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [folder, setFolder] = useState('');
  const [description, setDescription] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [filterFolder, setFilterFolder] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editFolder, setEditFolder] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [dragOver, setDragOver] = useState(false);

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
    mutationFn: (body: unknown) => api('/file-storage/upload', { method: 'POST', body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['file-storage'] });
      queryClient.invalidateQueries({ queryKey: ['file-storage-folders'] });
      setDescription('');
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

  const uploadFiles = useCallback((fileList: FileList | File[]) => {
    const arr = Array.from(fileList);
    if (arr.length === 0) return;
    setUploading(true);
    let pending = arr.length;
    arr.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const base64 = ev.target?.result as string;
        uploadMut.mutate({
          filename: file.name,
          original_name: file.name,
          file_type: file.type || 'application/octet-stream',
          file_size: file.size,
          file_data: base64,
          folder: folder || 'General',
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

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) uploadFiles(e.dataTransfer.files);
  };

  const startEdit = (f: Record<string, unknown>) => {
    setEditingId(f.id as string);
    setEditName(f.filename as string || '');
    setEditFolder(f.folder as string || '');
    setEditDesc(f.description as string || '');
  };

  const saveEdit = (id: string) => {
    updateMut.mutate({ id, body: { filename: editName, folder: editFolder, description: editDesc } });
  };

  const fileList = (files?.data || []) as Record<string, unknown>[];
  const folderList = (folders?.data || []) as string[];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{t('fileStorage.title')}</h2>
        <p className="text-muted-foreground mt-1">{t('fileStorage.desc')}</p>
      </div>

      {/* Upload area — click or drag */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`bg-card border-2 border-dashed rounded-xl p-8 transition-colors ${dragOver ? 'border-primary bg-primary/5' : 'border-border'}`}
      >
        <div className="flex flex-col items-center gap-4">
          <div className={`rounded-full p-4 transition-colors ${dragOver ? 'bg-primary/10' : 'bg-muted'}`}>
            <Upload className={`h-8 w-8 ${dragOver ? 'text-primary' : 'text-muted-foreground'}`} />
          </div>
          <div className="text-center">
            <p className="font-medium">{dragOver ? t('fileStorage.dropHere') || 'Drop files here' : t('fileStorage.dragDrop') || 'Drag & drop files here'}</p>
            <p className="text-sm text-muted-foreground mt-1">{t('fileStorage.orClick') || 'or click to browse'}</p>
          </div>
          <label className="cursor-pointer bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90">
            {uploading ? 'Uploading...' : t('fileStorage.upload')}
            <input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.gif,.webp,.csv,.txt,.ppt,.pptx,.zip" onChange={handleFileInput} className="hidden" multiple />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-4 pt-4 border-t">
          <div>
            <label className="text-xs text-muted-foreground">{t('fileStorage.folder')}</label>
            <input value={folder} onChange={e => setFolder(e.target.value)} placeholder={t('fileStorage.folderPlaceholder')}
              className="px-3 py-2 border rounded-md bg-background text-sm w-44" />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs text-muted-foreground">{t('fileStorage.description')}</label>
            <input value={description} onChange={e => setDescription(e.target.value)} placeholder={t('fileStorage.description')}
              className="px-3 py-2 border rounded-md bg-background text-sm w-full" />
          </div>
        </div>
      </div>

      {/* Search & Filter */}
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
      </div>

      {/* File List */}
      <div className="bg-card border rounded-xl p-6">
        {isLoading ? (
          <div className="flex justify-center py-8"><div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" /></div>
        ) : fileList.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">{t('fileStorage.noData')}</p>
        ) : (
          <div className="space-y-2">
            {fileList.map((f) => {
              const id = f.id as string;
              const isEditing = editingId === id;
              return (
                <div key={id} className="flex items-center justify-between border rounded-md px-4 py-3">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    {fileIcon(f.file_type as string || '')}
                    <div className="min-w-0 flex-1">
                      {isEditing ? (
                        <div className="space-y-2">
                          <input value={editName} onChange={e => setEditName(e.target.value)} className="px-2 py-1 border rounded text-sm w-full" />
                          <div className="flex gap-2">
                            <input value={editFolder} onChange={e => setEditFolder(e.target.value)} placeholder={t('fileStorage.folder')} className="px-2 py-1 border rounded text-sm w-32" />
                            <input value={editDesc} onChange={e => setEditDesc(e.target.value)} placeholder={t('fileStorage.description')} className="px-2 py-1 border rounded text-sm flex-1" />
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="text-sm font-medium truncate">{f.filename as string || f.original_name}</div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="bg-secondary px-1.5 py-0.5 rounded">{f.folder as string}</span>
                            <span>{formatSize(f.file_size as number || 0)}</span>
                            <span>{(f.created_at as string)?.slice(0, 10)}</span>
                            {f.description && <span className="truncate max-w-[200px]">— {f.description as string}</span>}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 ml-2 shrink-0">
                    {isEditing ? (
                      <>
                        <button onClick={() => saveEdit(id)} className="p-1.5 hover:bg-muted rounded text-green-600"><Check className="h-4 w-4" /></button>
                        <button onClick={() => setEditingId(null)} className="p-1.5 hover:bg-muted rounded"><X className="h-4 w-4" /></button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => downloadFile(id, (f.filename as string) || 'file')} className="p-1.5 hover:bg-muted rounded"><Download className="h-4 w-4" /></button>
                        <button onClick={() => startEdit(f)} className="p-1.5 hover:bg-muted rounded"><Pencil className="h-4 w-4" /></button>
                        <button onClick={() => { if (confirm(t('common.confirmDelete'))) deleteMut.mutate(id); }} className="p-1.5 hover:bg-muted rounded text-destructive"><Trash2 className="h-4 w-4" /></button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
