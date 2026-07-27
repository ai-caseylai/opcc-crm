import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { CreditCard, QrCode, Smartphone, Upload, Check, X } from 'lucide-react';

const METHOD_OPTIONS = [
  { key: 'card', label: 'Visa / Mastercard', icon: CreditCard, desc: '需設定 Stripe API Key' },
  { key: 'fps', label: '轉數快 FPS', icon: QrCode, desc: '上傳 FPS QR 碼' },
  { key: 'wechat', label: 'WeChat Pay HK', icon: Smartphone, desc: '上傳 WeChat 收款碼' },
  { key: 'alipay', label: 'AlipayHK', icon: Smartphone, desc: '上傳 Alipay 收款碼' },
  { key: 'octopus', label: '八達通 Octopus', icon: Smartphone, desc: '上傳八達通收款碼' },
];

export default function PaymentSettings() {
  const queryClient = useQueryClient();
  const [stripePub, setStripePub] = useState('');
  const [stripeSec, setStripeSec] = useState('');
  const [saved, setSaved] = useState(false);

  const { data: cfg } = useQuery({
    queryKey: ['payment-config'],
    queryFn: () => api('/payment/config'),
  });

  React.useEffect(() => {
    if (cfg) {
      setStripePub(cfg.stripe_publishable || '');
    }
  }, [cfg]);

  const methods: string[] = cfg?.methods || [];
  const hasQR = (k: string) => !!(cfg as any)?.[`qr_${k}`];

  const toggleMethod = (key: string) => {
    const next = methods.includes(key) ? methods.filter(m => m !== key) : [...methods, key];
    api('/payment/config', { method: 'PUT', body: { methods: next } })
      .then(() => queryClient.invalidateQueries({ queryKey: ['payment-config'] }));
  };

  const saveStripe = () => {
    api('/payment/config', { method: 'PUT', body: { stripe_publishable: stripePub, stripe_secret: stripeSec } })
      .then(() => { queryClient.invalidateQueries({ queryKey: ['payment-config'] }); setSaved(true); setStripeSec(''); setTimeout(() => setSaved(false), 2000); });
  };

  const uploadQR = (key: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const base64 = ev.target?.result as string;
      api('/payment/config', { method: 'PUT', body: { [`qr_${key}`]: base64 } })
        .then(() => queryClient.invalidateQueries({ queryKey: ['payment-config'] }));
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-4">
      <h3 className="font-semibold flex items-center gap-2"><CreditCard className="h-4 w-4" /> 網上收款設定</h3>
      <p className="text-sm text-muted-foreground">發票會自動顯示已啟用的付款方式，客戶可掃碼或線上付款</p>

      {/* Method toggles */}
      <div className="grid grid-cols-1 gap-2">
        {METHOD_OPTIONS.map((m) => {
          const active = methods.includes(m.key);
          const Icon = m.icon;
          return (
            <div key={m.key} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${active ? 'border-primary/30 bg-primary/5' : 'border-border bg-muted/20'}`}
              onClick={() => toggleMethod(m.key)}>
              <Icon className={`h-5 w-5 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
              <div className="flex-1">
                <div className="text-sm font-medium">{m.label}</div>
                <div className="text-xs text-muted-foreground">{m.desc}</div>
              </div>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${active ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                {active ? <Check className="h-4 w-4" /> : <span className="text-xs text-muted-foreground">+</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* QR Uploads */}
      {methods.some(m => ['fps','wechat','alipay','octopus'].includes(m)) && (
        <div className="border-t pt-3 space-y-2">
          <p className="text-sm font-medium">上傳收款 QR 碼</p>
          <div className="grid grid-cols-2 gap-2">
            {['fps','wechat','alipay','octopus'].filter(k => methods.includes(k)).map(k => (
              <label key={k} className="flex items-center gap-2 p-2 border rounded-md cursor-pointer hover:bg-muted/30 text-sm">
                <div className="w-10 h-10 border rounded flex items-center justify-center bg-muted overflow-hidden">
                  {hasQR(k) ? <img src={(cfg as any)[`qr_${k}`]} className="w-full h-full object-contain" /> : <QrCode className="h-5 w-5 text-muted-foreground/50" />}
                </div>
                <span className="text-xs">{({fps:'FPS',wechat:'WeChat',alipay:'Alipay',octopus:'八達通'} as any)[k]}</span>
                <input type="file" accept="image/*" onChange={e => uploadQR(k, e)} className="hidden" />
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Stripe */}
      {methods.includes('card') && (
        <div className="border-t pt-3 space-y-3">
          <p className="text-sm font-medium">Stripe 設定（Visa / Mastercard）</p>
          <input value={stripePub} onChange={e => setStripePub(e.target.value)}
            placeholder="Publishable Key (pk_live_...)" className="w-full px-3 py-2 border rounded-md bg-background text-sm" />
          <input value={stripeSec} onChange={e => setStripeSec(e.target.value)}
            placeholder="Secret Key (sk_live_...)" type="password" className="w-full px-3 py-2 border rounded-md bg-background text-sm" />
          <button onClick={saveStripe}
            className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm hover:opacity-90">
            {saved ? '已儲存！' : '儲存 Stripe'}
          </button>
          <p className="text-xs text-muted-foreground">Webhook endpoint: <code className="bg-muted px-1 rounded">/api/payment/stripe-webhook</code></p>
        </div>
      )}
    </div>
  );
}
