import React from 'react';
import { CreditCard } from 'lucide-react';
import PaymentSettings from '../components/PaymentSettings';

export default function PaymentPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">收款系統整合</h2>
        <p className="text-muted-foreground mt-1">Stripe · FPS · WeChat Pay HK · AlipayHK · 八達通</p>
      </div>
      <div className="bg-card border rounded-xl p-6">
        <PaymentSettings />
      </div>
    </div>
  );
}
