import React from 'react';

// Error banner shown when alert is present
export default function AlertBanner({ alertMessage }) {
  if (!alertMessage) return null;

  return (
    <div className="p-2 px-3 rounded mb-[14px] text-[0.8rem] border border-[#dc2626] bg-[rgba(220,38,38,0.08)] text-[#991b1b]">
      {alertMessage}
    </div>
  );
}
