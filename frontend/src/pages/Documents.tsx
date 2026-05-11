import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { Upload, Eye, Trash2, FileText } from 'lucide-react';

export default function Documents() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [docType, setDocType] = useState<'br'|'ci'>('br');
  const [docYear, setDocYear] = useState(new Date().getFullYear());

  const { data: docs, isLoading } = useQuery({
    queryKey: ['documents'],
    queryFn: () => api('/documents'),
  });

  const uploadMut = useMutation({
    mutationFn: (body: any) => api('/documents/upload', { method: 'POST', body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['documents'] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api(`/documents/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['documents'] }),
  });

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const base64 = ev.target?.result as string;
      uploadMut.mutate({ doc_type: docType, doc_year: docYear, file_name: file.name, file_type: file.type, file_data: base64 });
      setUploading(false);
    };
    reader.readAsDataURL(file);
  };

  const docList = (docs?.data || []) as any[];
  const brDocs = docList.filter((d: any) => d.doc_type === 'br');
  const ciDocs = docList.filter((d: any) => d.doc_type === 'ci');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{t('documents.title')}</h2>
        <p className="text-muted-foreground mt-1">{t('documents.desc')}</p>
      </div>

      {/* Upload */}
      <div className="bg-card border rounded-xl p-6 space-y-4">
        <h3 className="font-semibold">{t('documents.uploadTitle')}</h3>
        <div className="flex items-end gap-3">
          <div>
            <label className="text-xs text-muted-foreground">{t('documents.docType')}</label>
            <select value={docType} onChange={e => setDocType(e.target.value as 'br'|'ci')}
              className="px-3 py-2 border rounded-md bg-background text-sm w-28">
              <option value="br">{t('documents.br')}</option>
              <option value="ci">{t('documents.ci')}</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">{t('documents.year')}</label>
            <input type="number" value={docYear} onChange={e => setDocYear(parseInt(e.target.value))}
              className="px-3 py-2 border rounded-md bg-background text-sm w-24" />
          </div>
          <label className="flex items-center gap-2 cursor-pointer bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90">
            <Upload className="h-4 w-4" /> {uploading ? '...' : t('documents.upload')}
            <input type="file" accept="image/*,.pdf" onChange={handleUpload} className="hidden" />
          </label>
        </div>
      </div>

      {/* BR List */}
      <div className="bg-card border rounded-xl p-6 space-y-3">
        <h3 className="font-semibold flex items-center gap-2">
          <FileText className="h-4 w-4" /> {t('documents.brCert')} ({brDocs.length})
        </h3>
        {brDocs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('documents.noBr')}</p>
        ) : (
          <div className="space-y-2">
            {brDocs.map((d: any) => (
              <div key={d.id} className="flex items-center justify-between border rounded-md px-4 py-3">
                <div className="space-y-0.5">
                  <div className="text-sm font-medium">{d.file_name || 'BR'}</div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{d.doc_year}</span>
                    {d.br_number && <span className="bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-mono">{d.br_number}</span>}
                    {d.ocr_text && <span className="text-blue-600">OCR ✓</span>}
                  </div>
                </div>
                <div className="flex gap-2">
                  <a href={`/api/documents/${d.id}/file`} target="_blank" className="p-1.5 hover:bg-muted rounded"><Eye className="h-4 w-4" /></a>
                  <button onClick={() => { if (confirm(t('common.confirmDelete'))) deleteMut.mutate(d.id); }} className="p-1.5 hover:bg-muted rounded text-destructive"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* CI List */}
      <div className="bg-card border rounded-xl p-6 space-y-3">
        <h3 className="font-semibold flex items-center gap-2">
          <FileText className="h-4 w-4" /> {t('documents.ciCert')} ({ciDocs.length})
        </h3>
        {ciDocs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('documents.noCi')}</p>
        ) : (
          <div className="space-y-2">
            {ciDocs.map((d: any) => (
              <div key={d.id} className="flex items-center justify-between border rounded-md px-4 py-3">
                <div className="space-y-0.5">
                  <div className="text-sm font-medium">{d.file_name || 'CI'}</div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {d.ocr_text && <span className="text-blue-600">OCR ✓</span>}
                  </div>
                </div>
                <div className="flex gap-2">
                  <a href={`/api/documents/${d.id}/file`} target="_blank" className="p-1.5 hover:bg-muted rounded"><Eye className="h-4 w-4" /></a>
                  <button onClick={() => { if (confirm(t('common.confirmDelete'))) deleteMut.mutate(d.id); }} className="p-1.5 hover:bg-muted rounded text-destructive"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
