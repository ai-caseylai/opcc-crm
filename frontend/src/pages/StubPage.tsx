import { Construction } from 'lucide-react';
import { tr } from '../lib/i18nHelpers';

interface StubPageProps {
  title: string;
  zhHant?: string;
  zhHans?: string;
  description?: string;
}

export default function StubPage({ title, zhHant, zhHans, description }: StubPageProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{tr(title, zhHant || title, zhHans || title)}</h2>
        <p className="text-muted-foreground mt-1">
          {description || tr('This page is under development.', '此頁面正在開發中。', '此页面正在开发中。')}
        </p>
      </div>
      <div className="bg-card border rounded-xl p-12 text-center" style={{ borderColor: 'hsl(var(--border))' }}>
        <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: 'hsl(var(--primary)/0.08)' }}>
          <Construction className="h-8 w-8 text-primary" />
        </div>
        <h3 className="text-sm font-semibold mb-2">
          {tr('Coming Soon', '即將推出', '即将推出')}
        </h3>
        <p className="text-xs text-muted-foreground">
          {tr('This feature will be available in an upcoming release.', '此功能將於未來版本推出。', '此功能将于未来版本推出。')}
        </p>
      </div>
    </div>
  );
}
