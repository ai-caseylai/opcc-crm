import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface ConfirmDialogProps {
  show: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  icon?: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  show, title, message, confirmLabel = 'OK', cancelLabel = 'Cancel',
  danger = false, icon, onConfirm, onCancel,
}: ConfirmDialogProps) {
  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center backdrop-blur-sm">
      <div className="bg-card rounded-lg p-6 max-w-sm mx-4 shadow-2xl">
        <div className="text-center mb-4">
          <div className="text-3xl mb-2">
            {icon || (danger ? <AlertTriangle className="h-8 w-8 text-red-500 mx-auto" /> : <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto" />)}
          </div>
          <h3 className="font-bold text-lg">{title}</h3>
          <p className="text-sm text-muted-foreground mt-2 whitespace-pre-line">{message}</p>
        </div>
        <div className="flex gap-3 justify-center">
          <button
            onClick={onConfirm}
            className={`px-6 py-2 rounded-md text-sm font-medium hover:opacity-90 ${
              danger
                ? 'bg-red-600 text-white'
                : 'bg-primary text-primary-foreground'
            }`}
          >
            {confirmLabel}
          </button>
          <button
            onClick={onCancel}
            className="px-6 py-2 border border-border rounded-md text-sm font-medium hover:bg-muted"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
