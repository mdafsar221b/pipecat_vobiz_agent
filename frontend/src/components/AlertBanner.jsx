import React from 'react';
import { AlertCircle } from 'lucide-react';

// Error banner shown when system or campaign alert is present
export default function AlertBanner({ alertMessage }) {
  if (!alertMessage) return null;

  return (
    <div className="flex items-center gap-2.5 p-3.5 px-4 rounded-xl mb-4 text-xs font-medium border border-rose-200 bg-rose-50 text-rose-800 shadow-2xs">
      <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
      <span className="leading-snug">{alertMessage}</span>
    </div>
  );
}
