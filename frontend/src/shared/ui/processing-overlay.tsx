import { Card } from '@/shared/ui/card';
import { Sparkles } from 'lucide-react';
import React from 'react';

interface ProcessingOverlayProps {
  open: boolean;
  title: string;
  message?: string;
  subMessage?: string;
}

export function ProcessingOverlay({ open, title, message, subMessage }: ProcessingOverlayProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
      <Card className="p-8 bg-white shadow-2xl w-[420px] md:w-[480px]">
        <div className="flex flex-col items-center gap-4">
          <Sparkles className="w-12 h-12 text-primary animate-spin" />
          <div className="text-center">
            <h3 className="text-lg font-semibold text-slate-800 mb-2">{title}</h3>
            {message && <p className="text-sm text-slate-600">{message}</p>}
            {subMessage && <p className="text-xs text-slate-500 mt-2">{subMessage}</p>}
          </div>
        </div>
      </Card>
    </div>
  );
}

export default ProcessingOverlay;
