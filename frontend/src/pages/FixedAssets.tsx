import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useToast } from '../components/Toast';
import { Plus, Trash2, Calculator } from 'lucide-react';
import { tr } from '../lib/i18nHelpers';

export default function FixedAssets() {
  const { i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    asset_name: '', asset_code: '', category: 'office_equipment', purchase_date: '', cost: '',
    useful_life_years: '5', salvage_value: '0',
    account_code: '12201', depn_account_code: '66101', acc_depn_account_code: '12301', notes: '',
  });

  const { data, isLoading } = useQuery({
    queryKey: ['fixed-assets'],
    queryFn: () => api('/fixed-assets'),
  });
  const assets: any[] = data?.data || [];

  const createMut = useMutation({
    mutationFn: (body: any) => api('/fixed-assets', { method: 'POST', body }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['fixed-assets'] }); setShowForm(false); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api(`/fixed-assets/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['fixed-assets'] }),
  });

  const depnMut = useMutation({
    mutationFn: (period_end_date: string) => api('/fixed-assets/run-depreciation', { method: 'POST', body: { period_end_date } }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['fixed-assets'] });
      queryClient.invalidateQueries({ queryKey: ['entries'] });
      toast.info(`折舊完成！\n資產：${data.assets_depreciated} 項\n總折舊：HKD ${data.total_depreciation?.toLocaleString()}`);
    },
  });

  const totalCost = assets.reduce((s: number, a: any) => s + (a.cost || 0), 0);
  const totalAccDepn = assets.reduce((s: number, a: any) => s + (a.accumulated_depreciation || 0), 0);
  const totalNBV = assets.reduce((s: number, a: any) => s + (a.net_book_value || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">{tr('Fixed Assets', '固定資產 Fixed Assets', '固定资产 Fixed Assets')}</h2>
          <p className="text-muted-foreground mt-1">{tr('Fixed Asset Register & Depreciation Management', '固定資產登記冊及折舊管理', '固定资产登记册及折旧管理')}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => {
            const date = prompt('折舊計算至 (YYYY-MM-DD)：', new Date().toISOString().split('T')[0]);
            if (!date) return;
            depnMut.mutate(date);
          }} disabled={depnMut.isPending}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-40">
            <Calculator className="h-4 w-4" /> {tr('Run Depreciation', '計算折舊 Run Depreciation', '计算折旧 Run Depreciation')}
          </button>
          <button onClick={() => setShowForm(true)}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90">
            <Plus className="h-4 w-4" /> {tr('Add Asset', '新增資產', '新增资产')}
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-card border rounded-xl p-4">
          <span className="text-xs text-muted-foreground">{tr('Total Cost', '資產原值 Total Cost', '资产原值 Total Cost')}</span>
          <p className="text-xl font-bold mt-1">HKD {totalCost.toLocaleString()}</p>
        </div>
        <div className="bg-card border rounded-xl p-4">
          <span className="text-xs text-muted-foreground">{tr('Accum. Depreciation', '累計折舊 Accum. Depreciation', '累计折旧 Accum. Depreciation')}</span>
          <p className="text-xl font-bold mt-1 text-red-600">HKD {totalAccDepn.toLocaleString()}</p>
        </div>
        <div className="bg-card border rounded-xl p-4">
          <span className="text-xs text-muted-foreground">{tr('Net Book Value', '賬面淨值 Net Book Value', '账面净值 Net Book Value')}</span>
          <p className="text-xl font-bold mt-1 text-green-600">HKD {totalNBV.toLocaleString()}</p>
        </div>
      </div>

      {/* Asset list */}
      <div className="bg-card border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left p-3">{tr('Asset Name', '資產名稱', '资产名称')}</th>
              <th className="text-left p-3">{tr('Category', '類別', '类别')}</th>
              <th className="text-left p-3">{tr('Purchase Date', '購買日', '购买日')}</th>
              <th className="text-right p-3">{tr('Cost', '成本', '成本')}</th>
              <th className="text-right p-3">{tr('Life (yrs)', '年限', '年限')}</th>
              <th className="text-right p-3">{tr('Monthly Depn', '月折舊', '月折旧')}</th>
              <th className="text-right p-3">{tr('Accum. Depn', '累計折舊', '累计折旧')}</th>
              <th className="text-right p-3">{tr('NBV', '淨值 NBV', '净值 NBV')}</th>
              <th className="text-center p-3 w-[60px]">{tr('Actions', '操作', '操作')}</th>
            </tr>
          </thead>
          <tbody>
            {assets.map((a: any) => (
              <tr key={a.id} className={`border-b hover:bg-muted/30 ${!a.is_active ? 'opacity-50 line-through' : ''}`}>
                <td className="p-3 font-medium">{a.asset_name}</td>
                <td className="p-3 text-xs">{a.category}</td>
                <td className="p-3 text-muted-foreground">{a.purchase_date}</td>
                <td className="p-3 text-right font-mono">{a.cost?.toLocaleString()}</td>
                <td className="p-3 text-center">{a.useful_life_years} {tr('yr', '年', '年')}</td>
                <td className="p-3 text-right font-mono">{a.monthly_depreciation?.toLocaleString()}</td>
                <td className="p-3 text-right font-mono text-red-600">{a.accumulated_depreciation?.toLocaleString()}</td>
                <td className="p-3 text-right font-mono font-medium">{a.net_book_value?.toLocaleString()}</td>
                <td className="p-3 text-center">
                  <button onClick={() => { if (confirm(tr('Delete this asset?', '刪除此資產？', '删除此资产？'))) deleteMut.mutate(a.id); }}
                    className="text-destructive hover:underline text-xs"><Trash2 className="h-3 w-3" /></button>
                </td>
              </tr>
            ))}
            {assets.length === 0 && (
              <tr><td colSpan={9} className="text-center p-6 text-muted-foreground">{tr('No fixed asset records', '未有固定資產記錄', '未有固定资产记录')}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add asset form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowForm(false)}>
          <div className="bg-card border rounded-xl p-6 w-full max-w-lg mx-4 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-lg">{tr('Add Fixed Asset', '新增固定資產', '新增固定资产')}</h3>
            <form onSubmit={e => { e.preventDefault(); createMut.mutate(form); }} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <input required value={form.asset_name} onChange={e => setForm({...form, asset_name: e.target.value})}
                  placeholder={tr('Asset Name *', '資產名稱 *', '资产名称 *')} className="px-3 py-2 border rounded-md text-sm" />
                <input value={form.asset_code} onChange={e => setForm({...form, asset_code: e.target.value})}
                  placeholder={tr('Asset Code', '資產編號', '资产编号')} className="px-3 py-2 border rounded-md text-sm" />
                <select value={form.category} onChange={e => setForm({...form, category: e.target.value})}
                  className="px-3 py-2 border rounded-md text-sm bg-background">
                  <option value="office_equipment">{tr('Office Equipment', '辦公設備 Office Equipment', '办公设备 Office Equipment')}</option>
                  <option value="computer">{tr('Computer', '電腦設備 Computer', '电脑设备 Computer')}</option>
                  <option value="vehicle">{tr('Vehicle', '汽車 Vehicle', '汽车 Vehicle')}</option>
                  <option value="furniture">{tr('Furniture', '家具 Furniture', '家具 Furniture')}</option>
                  <option value="leasehold">{tr('Leasehold Improvement', '裝修 Leasehold Improvement', '装修 Leasehold Improvement')}</option>
                </select>
                <input type="date" required value={form.purchase_date} onChange={e => setForm({...form, purchase_date: e.target.value})}
                  className="px-3 py-2 border rounded-md text-sm" />
                <input type="number" step="0.01" required value={form.cost} onChange={e => setForm({...form, cost: e.target.value})}
                  placeholder={tr('Cost *', '購置成本 *', '购置成本 *')} className="px-3 py-2 border rounded-md text-sm" />
                <input type="number" step="0.1" value={form.useful_life_years} onChange={e => setForm({...form, useful_life_years: e.target.value})}
                  placeholder={tr('Useful Life (years)', '使用年限 (年)', '使用年限 (年)')} className="px-3 py-2 border rounded-md text-sm" />
                <input type="number" step="0.01" value={form.salvage_value} onChange={e => setForm({...form, salvage_value: e.target.value})}
                  placeholder={tr('Residual Value', '殘值', '残值')} className="px-3 py-2 border rounded-md text-sm" />
                <input value={form.notes} onChange={e => setForm({...form, notes: e.target.value})}
                  placeholder={tr('Notes', '備註', '备注')} className="px-3 py-2 border rounded-md text-sm col-span-2" />
              </div>
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 border rounded-md text-sm">{tr('Cancel', '取消', '取消')}</button>
                <button type="submit" disabled={createMut.isPending}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm">{tr('Create', '建立', '建立')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
