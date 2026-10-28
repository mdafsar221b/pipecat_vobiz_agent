import React from 'react';

// Preview card showing next queued lead
export default function NextCallCard({ nextCall }) {
  const displayPhone = nextCall
    ? (nextCall.customer_name ? `${nextCall.customer_name} (${nextCall.phone_number})` : nextCall.phone_number)
    : 'No pending calls queued';

  const metaText = nextCall
    ? `Priority: 1 | Source: ${nextCall.source || 'CRM'}`
    : '--';

  return (
    <div className="bg-[#f8fafc] border border-dashed border-[#cbd5e1] rounded-[3px] p-[8px_10px] mb-3 flex justify-between items-center">
      <div>
        <div className="text-[0.68rem] uppercase tracking-wider text-[#64748b]">
          Next In Queue
        </div>
        <div className="font-mono font-semibold text-[0.85rem] text-[#1d4ed8]">
          {displayPhone}
        </div>
      </div>
      <div className="text-[0.7rem] text-[#64748b] text-right">
        {metaText}
      </div>
    </div>
  );
}
