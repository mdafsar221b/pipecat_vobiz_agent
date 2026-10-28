import React from 'react';
import { UserCheck, Layers, ArrowRight } from 'lucide-react';

// Preview card showing the next queued lead ready for dialing
export default function NextCallCard({ nextCall }) {
  const hasLead = Boolean(nextCall);
  const displayPhone = nextCall
    ? (nextCall.customer_name ? `${nextCall.customer_name} (${nextCall.phone_number})` : nextCall.phone_number)
    : 'No pending calls in queue';

  const sourceText = nextCall?.source || 'CRM Outbound Queue';

  return (
    <div className="bg-white border border-slate-200/90 rounded-xl p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)] flex items-center justify-between transition-all">
      <div className="flex items-center gap-3 min-w-0">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
          hasLead ? 'bg-[#008792]/10 text-[#008792]' : 'bg-slate-100 text-slate-400'
        }`}>
          {hasLead ? <UserCheck className="w-4 h-4" /> : <Layers className="w-4 h-4" />}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Next Up in Queue
            </span>
            {hasLead && (
              <span className="inline-flex items-center px-1.5 py-0.2 text-[9px] font-semibold text-[#008792] bg-[#008792]/10 rounded">
                Priority 1
              </span>
            )}
          </div>
          <div className="font-mono text-xs font-bold text-slate-900 truncate mt-0.5">
            {displayPhone}
          </div>
        </div>
      </div>

      <div className="text-right flex-shrink-0 ml-3">
        <span className="text-[11px] font-medium text-slate-400 block">
          {hasLead ? sourceText : 'Queue is idle'}
        </span>
        {hasLead && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#008792] hover:underline mt-0.5">
            <span>Ready to dial</span>
            <ArrowRight className="w-3 h-3" />
          </span>
        )}
      </div>
    </div>
  );
}
