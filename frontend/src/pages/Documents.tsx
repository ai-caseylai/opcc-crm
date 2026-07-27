import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, WORKER_API_BASE } from '../lib/api';
import { Upload, Eye, Trash2, FileText } from 'lucide-react';

type DocType = 'br' | 'ci' | 'ei' | 'ec' | 'tc' | 'rl';

export default function Documents() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [docType, setDocType] = useState<DocType>('br');
  const [docYear, setDocYear] = useState(new Date().getFullYear());

  const { data: docs, isLoading } = useQuery({
    queryKey: ['documents'],
    queryFn: () => api('/documents'),
  });

  const uploadMut = useMutation({
    mutationFn: (body: any) => api('/documents/upload', { method: 'POST', body, baseUrl: WORKER_API_BASE }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['documents'] }),
    onError: (err: any) => {
      alert(`上傳失敗：${err?.message || err?.error || '未知錯誤'}`);
      setUploading(false);
    },
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
  const eiDocs = docList.filter((d: any) => d.doc_type === 'ei');
  const ecDocs = docList.filter((d: any) => d.doc_type === 'ec');
  const tcDocs = docList.filter((d: any) => d.doc_type === 'tc');
  const rlDocs = docList.filter((d: any) => d.doc_type === 'rl');

  const renderDocSection = (title: string, items: any[], emptyKey: string) => (
    <div className="bg-card border rounded-xl p-6 space-y-3">
      <h3 className="font-semibold flex items-center gap-2">
        <FileText className="h-4 w-4" /> {title} ({items.length})
      </h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(emptyKey)}</p>
      ) : (
        <div className="space-y-2">
          {items.map((d: any) => (
            <div key={d.id} className="flex items-center justify-between border rounded-md px-4 py-3">
              <div className="space-y-0.5">
                <div className="text-sm font-medium">{d.file_name || title}</div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{d.doc_year}</span>
                  {d.br_number && <span className="bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-mono">{d.br_number}</span>}
                  {d.ocr_text && <span className="text-blue-600">OCR ✓</span>}
                </div>
              </div>
              <div className="flex gap-2">
                <a href={`/api/documents/${d.id}/file?token=${localStorage.getItem('token') || ''}`} target="_blank" className="p-1.5 hover:bg-muted rounded"><Eye className="h-4 w-4" /></a>
                <button onClick={() => { if (confirm(t('common.confirmDelete'))) deleteMut.mutate(d.id); }} className="p-1.5 hover:bg-muted rounded text-destructive"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{t('documents.title')}</h2>
        <p className="text-muted-foreground mt-1">{t('documents.desc')}</p>
      </div>

      {renderDocSection(t('documents.brCert'), brDocs, 'documents.noBr')}
      {renderDocSection(t('documents.ciCert'), ciDocs, 'documents.noCi')}
      {renderDocSection(t('documents.eiCert'), eiDocs, 'documents.noEi')}
      {renderDocSection(t('documents.ecCert'), ecDocs, 'documents.noEc')}
      {renderDocSection(t('documents.tcCert'), tcDocs, 'documents.noTc')}
      {renderDocSection(t('documents.rlCert'), rlDocs, 'documents.noRl')}
    </div>
  );
}
