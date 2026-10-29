import React from 'react';
import { UserCheck, Layers, ArrowRight } from 'lucide-react';

// Preview card showing the next queued lead ready for dialing
export default function NextCallCard({ nextCall }) {
  const hasLead = Boolean(nextCall);
  const displayPhone = nextCall
    ? (nextCall.customer_name ? `${nextCall.customer_name} (${nextCall.phone_number})` : nextCall.phone_number)
    : 'No pending calls in queue';

  const sourceText = nextCall?.source || 'CRM Queue';

  return (
    <div className="bg-white px-4 py-2.5 flex items-center justify-between">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className={`w-7 h-7 flex items-center justify-center flex-shrink-0 ${
          hasLead ? 'bg-[#008792]/10 text-[#008792]' : 'bg-slate-100 text-slate-400'
        }`}>
          {hasLead ? <UserCheck className="w-3.5 h-3.5" /> : <Layers className="w-3.5 h-3.5" />}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Next In Queue
            </span>
            {hasLead && (
              <span className="inline-flex items-center px-1.5 py-0.2 text-[9px] font-semibold text-[#008792] bg-[#008792]/10">
                Priority 1
              </span>
            )}
          </div>
          <div className="font-mono text-xs font-bold text-slate-900 truncate">
            {displayPhone}
          </div>
        </div>
      </div>

      <div className="text-right flex-shrink-0 ml-2">
        <span className="text-[10px] font-medium text-slate-400 block truncate max-w-[120px]">
          {hasLead ? sourceText : 'Queue idle'}
        </span>
        {hasLead && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#008792]">
            <span>Ready</span>
            <ArrowRight className="w-2.5 h-2.5" />
          </span>
        )}
      </div>
    </div>
  );
}
