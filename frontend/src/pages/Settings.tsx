import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import { Settings as SettingsIcon, Building2, Upload, Save } from 'lucide-react';
// Website → /website-generator | Modules → /modules | API/WB → /integrations

export default function Settings() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // ── Company profile ──
  const { data: company } = useQuery({ queryKey: ['company'], queryFn: () => api('/company') });
  const [coForm, setCoForm] = useState({ name: '', address: '', address2: '', phone: '', email: '', website: '', bank_name: '', bank_account: '', bank_swift: '', bank_address: '', signatory_name: '', tax_id: '', invoice_number_pattern: 'INV{YY}{MM}-{NNN}' });
  const [logoFile, setLogoFile] = useState<string>('');
  const [coSaved, setCoSaved] = useState(false);

  React.useEffect(() => {
    if (company) setCoForm({
      name: company.name || user?.company_name || '', address: company.address || '', address2: company.address2 || '',
      phone: company.phone || '', email: company.email || user?.email || '', website: company.website || '',
      bank_name: company.bank_name || '', bank_account: company.bank_account || '',
      bank_swift: company.bank_swift || '', bank_address: company.bank_address || '',
      signatory_name: company.signatory_name || user?.name || '', tax_id: company.tax_id || '',
      invoice_number_pattern: company.invoice_number_pattern || 'INV{YY}{MM}-{NNN}',
    });
  }, [company, user]);

  const saveCompany = useMutation({
    mutationFn: (body: any) => api('/company', { method: 'PUT', body }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['company'] }); setCoSaved(true); setTimeout(() => setCoSaved(false), 2000); },
  });

  const uploadLogo = useMutation({
    mutationFn: (image: string) => api('/company/logo', { method: 'POST', body: { image } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['company'] }),
  });

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const base64 = ev.target?.result as string;
      setLogoFile(base64);
      uploadLogo.mutate(base64);
    };
    reader.readAsDataURL(file);
  };

  const uploadPdfImage = useMutation({
    mutationFn: ({ endpoint, image }: { endpoint: string; image: string }) => api(`/company/${endpoint}`, { method: 'POST', body: { image } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['company'] }),
  });

  const handlePdfImageUpload = (endpoint: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const base64 = ev.target?.result as string;
      uploadPdfImage.mutate({ endpoint, image: base64 });
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">設定 Settings</h2>
        <p className="text-muted-foreground mt-1">帳戶與 API 設定</p>
      </div>

      {/* Account Info */}
      <div className="bg-card border rounded-xl p-6 space-y-3">
        <h3 className="font-semibold flex items-center gap-2">
          <SettingsIcon className="h-4 w-4" /> 帳戶資訊
        </h3>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><span className="text-muted-foreground">姓名:</span> {user?.name}</div>
          <div><span className="text-muted-foreground">角色:</span> {user?.role}</div>
          <div><span className="text-muted-foreground">電郵:</span> {user?.email}</div>
          <div><span className="text-muted-foreground">公司:</span> {user?.company_name || '-'}</div>
        </div>
      </div>

      {/* Company Profile */}
      <div className="bg-card border rounded-xl p-6 space-y-4">
        <h3 className="font-semibold flex items-center gap-2"><Building2 className="h-4 w-4" /> 公司資料</h3>
        <h4 className="text-sm font-medium mt-2">PDF 文件圖案</h4>
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-2 text-center">
            <label className="text-xs text-muted-foreground">Header Logo</label>
            <label className="flex flex-col items-center gap-1 cursor-pointer border rounded-lg p-3 hover:bg-muted/30">
              <Upload className="h-5 w-5 text-muted-foreground" />
              <span className="text-xs text-primary">上傳 PDF Logo</span>
              <input type="file" accept="image/png" onChange={handlePdfImageUpload('pdf-logo')} className="hidden" />
            </label>
          </div>
          <div className="space-y-2 text-center">
            <label className="text-xs text-muted-foreground">公司印章 Chop</label>
            <label className="flex flex-col items-center gap-1 cursor-pointer border rounded-lg p-3 hover:bg-muted/30">
              <Upload className="h-5 w-5 text-muted-foreground" />
              <span className="text-xs text-primary">上傳 Chop</span>
              <input type="file" accept="image/png" onChange={handlePdfImageUpload('pdf-chop')} className="hidden" />
            </label>
          </div>
          <div className="space-y-2 text-center">
            <label className="text-xs text-muted-foreground">簽名章 Stamp</label>
            <label className="flex flex-col items-center gap-1 cursor-pointer border rounded-lg p-3 hover:bg-muted/30">
              <Upload className="h-5 w-5 text-muted-foreground" />
              <span className="text-xs text-primary">上傳簽名章</span>
              <input type="file" accept="image/png" onChange={handlePdfImageUpload('pdf-stamp')} className="hidden" />
            </label>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-xs text-muted-foreground">公司名稱</label><input value={coForm.name} onChange={e => setCoForm({...coForm, name: e.target.value})} className="w-full px-3 py-2 border rounded-md bg-background text-sm mt-0.5" /></div>
          <div><label className="text-xs text-muted-foreground">電話</label><input value={coForm.phone} onChange={e => setCoForm({...coForm, phone: e.target.value})} className="w-full px-3 py-2 border rounded-md bg-background text-sm mt-0.5" /></div>
          <div><label className="text-xs text-muted-foreground">電郵</label><input value={coForm.email} onChange={e => setCoForm({...coForm, email: e.target.value})} className="w-full px-3 py-2 border rounded-md bg-background text-sm mt-0.5" /></div>
          <div><label className="text-xs text-muted-foreground">網站</label><input value={coForm.website} onChange={e => setCoForm({...coForm, website: e.target.value})} className="w-full px-3 py-2 border rounded-md bg-background text-sm mt-0.5" /></div>
          <div className="col-span-2"><label className="text-xs text-muted-foreground">地址</label><input value={coForm.address} onChange={e => setCoForm({...coForm, address: e.target.value})} className="w-full px-3 py-2 border rounded-md bg-background text-sm mt-0.5" /></div>
          <div><label className="text-xs text-muted-foreground">簽署人</label><input value={coForm.signatory_name} onChange={e => setCoForm({...coForm, signatory_name: e.target.value})} className="w-full px-3 py-2 border rounded-md bg-background text-sm mt-0.5" /></div>
          <div><label className="text-xs text-muted-foreground">稅號</label><input value={coForm.tax_id} onChange={e => setCoForm({...coForm, tax_id: e.target.value})} className="w-full px-3 py-2 border rounded-md bg-background text-sm mt-0.5" /></div>
        </div>
        <h4 className="text-sm font-medium mt-2">銀行資料</h4>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-xs text-muted-foreground">銀行名稱</label><input value={coForm.bank_name} onChange={e => setCoForm({...coForm, bank_name: e.target.value})} className="w-full px-3 py-2 border rounded-md bg-background text-sm mt-0.5" /></div>
          <div><label className="text-xs text-muted-foreground">帳戶號碼</label><input value={coForm.bank_account} onChange={e => setCoForm({...coForm, bank_account: e.target.value})} className="w-full px-3 py-2 border rounded-md bg-background text-sm mt-0.5" /></div>
          <div><label className="text-xs text-muted-foreground">Swift/BIC</label><input value={coForm.bank_swift} onChange={e => setCoForm({...coForm, bank_swift: e.target.value})} className="w-full px-3 py-2 border rounded-md bg-background text-sm mt-0.5" /></div>
          <div><label className="text-xs text-muted-foreground">銀行地址</label><input value={coForm.bank_address} onChange={e => setCoForm({...coForm, bank_address: e.target.value})} className="w-full px-3 py-2 border rounded-md bg-background text-sm mt-0.5" /></div>
        </div>
        <h4 className="text-sm font-medium mt-2">發票號碼格式</h4>
        <p className="text-xs text-muted-foreground">建立發票時自動產生號碼，留空或刪除則手動輸入</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <select value={coForm.invoice_number_pattern} onChange={e => setCoForm({...coForm, invoice_number_pattern: e.target.value})}
              className="w-full px-3 py-2 border rounded-md bg-background text-sm mt-0.5">
              {[
                { v: 'INV{YY}{MM}-{NNN}', label: 'INV2605-001' },
                { v: 'INV{YYYY}{MM}-{NNN}', label: 'INV202605-001' },
                { v: 'INV{YY}{MM}-{NNNN}', label: 'INV2605-0001' },
                { v: '#{YYYY}{MM}{NNN}', label: '#202605001' },
                { v: '#{YY}{MM}{DD}-{NN}', label: '#260511-01' },
                { v: 'INV-{NNNNN}', label: 'INV-00001 (流水號)' },
              ].map(p => <option key={p.v} value={p.v}>{p.v} → {p.label}</option>)}
            </select>
          </div>
          <div className="flex items-end pb-2">
            <span className="text-xs text-muted-foreground">
              預覽: {(() => {
                const now = new Date();
                const p = coForm.invoice_number_pattern || 'INV{YY}{MM}-{NNN}';
                return p
                  .replace('{YYYY}', now.getFullYear().toString())
                  .replace('{YY}', now.getFullYear().toString().slice(-2))
                  .replace('{MM}', (now.getMonth()+1).toString().padStart(2,'0'))
                  .replace('{DD}', now.getDate().toString().padStart(2,'0'))
                  .replace(/\{N+\}/g, '001');
              })()}
            </span>
          </div>
        </div>
        <button onClick={() => saveCompany.mutate(coForm)} disabled={saveCompany.isPending}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm hover:opacity-90 disabled:opacity-50">
          <Save className="h-4 w-4" /> {coSaved ? '已儲存！' : '儲存公司資料'}
        </button>
      </div>

    </div>
  );
}
