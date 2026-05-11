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
  const [coForm, setCoForm] = useState({ name: '', address: '', address2: '', phone: '', email: '', website: '', bank_name: '', bank_account: '', bank_swift: '', bank_address: '', signatory_name: '', tax_id: '' });
  const [logoFile, setLogoFile] = useState<string>('');
  const [coSaved, setCoSaved] = useState(false);

  React.useEffect(() => {
    if (company) setCoForm({
      name: company.name || '', address: company.address || '', address2: company.address2 || '',
      phone: company.phone || '', email: company.email || '', website: company.website || '',
      bank_name: company.bank_name || '', bank_account: company.bank_account || '',
      bank_swift: company.bank_swift || '', bank_address: company.bank_address || '',
      signatory_name: company.signatory_name || '', tax_id: company.tax_id || '',
    });
  }, [company]);

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

  return (
    <div className="space-y-6 max-w-3xl">
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
        <div className="flex items-center gap-4">
          <div className="w-20 h-20 border rounded-lg flex items-center justify-center bg-muted overflow-hidden">
            {logoFile ? <img src={logoFile} className="w-full h-full object-contain" /> : company?.logo_url ? <img src={company.logo_url} className="w-full h-full object-contain" /> : <Building2 className="h-8 w-8 text-muted-foreground/40" />}
          </div>
          <div>
            <label className="flex items-center gap-2 cursor-pointer text-sm text-primary hover:underline">
              <Upload className="h-4 w-4" /> 上傳 Logo (PNG)
              <input type="file" accept="image/png" onChange={handleLogoUpload} className="hidden" />
            </label>
            <p className="text-xs text-muted-foreground mt-1">建議 200×200px PNG</p>
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
        <button onClick={() => saveCompany.mutate(coForm)} disabled={saveCompany.isPending}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm hover:opacity-90 disabled:opacity-50">
          <Save className="h-4 w-4" /> {coSaved ? '已儲存！' : '儲存公司資料'}
        </button>
      </div>

    </div>
  );
}
