import React, { useState } from 'react';

const PREDEFINED_TEST_CONTACTS = [
  { name: 'Afsar', phone: '+917007173798' },
  { name: 'Afsar 2', phone: '+916201856832' },
  { name: 'Nitesh', phone: '+917781911392' },
  { name: 'Krupali', phone: '+919769756433' },
  { name: 'Botify', phone: '+918065521614' },
  { name: 'Prakash', phone: '+917976818025' }
];

// Controls for managing OBD campaign, test dialing, and test batches
export default function CampaignController({
  stats = {},
  isRunning = false,
  isPaused = false,
  activeCalls = [],
  onStartCampaign,
  onPauseCampaign,
  onResumeCampaign,
  onStopCampaign,
  onResetQueue,
  onRetryFailed,
  onTriggerManualDial,
  manualDialStatus,
  manualDialFeedback,
  manualPhone,
  setManualPhone,
  isDialingManual,
  onRefreshCampaign,
  onRefreshBatches,
}) {
  const [selectedContacts, setSelectedContacts] = useState(
    PREDEFINED_TEST_CONTACTS.map((_, i) => i)
  );
  const [testBatchFeedback, setTestBatchFeedback] = useState('');
  const [isQueueingBatch, setIsQueueingBatch] = useState(false);

  const total = stats.total || 0;
  const pending = stats.pending || 0;
  const activeCount = (stats.dialing || 0) + (stats.in_call || 0);
  const completed = Math.max(0, total - pending - activeCount);
  const retries = stats.retry_scheduled || 0;

  const toggleContact = (idx) => {
    if (selectedContacts.includes(idx)) {
      setSelectedContacts(selectedContacts.filter((i) => i !== idx));
    } else {
      setSelectedContacts([...selectedContacts, idx]);
    }
  };

  const toggleAllContacts = () => {
    if (selectedContacts.length === PREDEFINED_TEST_CONTACTS.length) {
      setSelectedContacts([]);
    } else {
      setSelectedContacts(PREDEFINED_TEST_CONTACTS.map((_, i) => i));
    }
  };

  const handleQueueTestBatch = async (startImmediately) => {
    if (selectedContacts.length === 0) {
      alert('Please select at least one contact.');
      return;
    }

    const leads = selectedContacts.map((i) => ({
      phone_number: PREDEFINED_TEST_CONTACTS[i].phone,
      customer_name: PREDEFINED_TEST_CONTACTS[i].name,
      source: 'Predefined Test Contact',
    }));

    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const batchName = `Test Batch (${timeStr}) - ${leads.length} calls`;

    setIsQueueingBatch(true);
    setTestBatchFeedback(`Queueing ${leads.length} contacts...`);

    try {
      const res = await fetch('/api/campaign/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leads,
          batch_name: batchName,
          source_filter: 'Predefined Test Contacts',
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setTestBatchFeedback(`Error: ${data.error || 'Failed to queue'}`);
        return;
      }

      if (startImmediately) {
        setTestBatchFeedback(`Starting OBD dialer for ${leads.length} calls...`);
        await fetch('/api/campaign/start', { method: 'POST' });
      }

      setTestBatchFeedback(
        startImmediately
          ? `Started OBD for ${leads.length} contacts (${batchName})`
          : `Queued ${leads.length} contacts. Ready to start OBD.`
      );
      setTimeout(() => setTestBatchFeedback(''), 5000);

      onRefreshCampaign?.();
      onRefreshBatches?.();
    } catch (err) {
      setTestBatchFeedback(`Network error: ${err.message}`);
    } finally {
      setIsQueueingBatch(false);
    }
  };

  return (
    <div className="bg-white border border-[#e2e8f0] rounded-[4px] p-[14px] mb-[14px]">
      <div className="flex justify-between items-center mb-3 pb-2 border-b border-[#e2e8f0]">
        <span className="text-[0.82rem] font-bold uppercase tracking-wider text-[#0f172a]">
          Automated Dialer Controls
        </span>
        <div className="flex gap-2 items-center">
          {retries > 0 && (
            <button
              onClick={onRetryFailed}
              title="Reset retries for failed/unanswered calls"
              className="bg-transparent border-none text-[#2563eb] text-[0.68rem] cursor-pointer underline p-0"
            >
              Retry Failed ({retries})
            </button>
          )}
          <span className="text-[0.72rem] text-[#64748b] font-mono">
            {completed} / {total}
          </span>
        </div>
      </div>

      {/* KPI Counters */}
      <div className="grid grid-cols-4 gap-[6px] mb-3">
        <div className="bg-[#f8fafc] border border-[#e2e8f0] p-[6px_4px] rounded-[3px] text-center min-w-0">
          <span className="block text-[1.05rem] font-bold font-mono leading-none text-[#0f172a]">
            {total}
          </span>
          <span className="text-[0.6rem] uppercase tracking-tight text-[#64748b] truncate block">
            Total
          </span>
        </div>
        <div className="bg-[#f8fafc] border border-[#e2e8f0] p-[6px_4px] rounded-[3px] text-center min-w-0">
          <span className="block text-[1.05rem] font-bold font-mono leading-none text-[#2563eb]">
            {pending}
          </span>
          <span className="text-[0.6rem] uppercase tracking-tight text-[#64748b] truncate block">
            Pending
          </span>
        </div>
        <div className="bg-[#f8fafc] border border-[#e2e8f0] p-[6px_4px] rounded-[3px] text-center min-w-0">
          <span className="block text-[1.05rem] font-bold font-mono leading-none text-[#d97706]">
            {activeCount}
          </span>
          <span className="text-[0.6rem] uppercase tracking-tight text-[#64748b] truncate block">
            Active
          </span>
        </div>
        <div className="bg-[#f8fafc] border border-[#e2e8f0] p-[6px_4px] rounded-[3px] text-center min-w-0">
          <span className="block text-[1.05rem] font-bold font-mono leading-none text-[#059669]">
            {stats.interested || 0}
          </span>
          <span className="text-[0.6rem] uppercase tracking-tight text-[#64748b] truncate block">
            Interested
          </span>
        </div>
        <div className="bg-[#f8fafc] border border-[#e2e8f0] p-[6px_4px] rounded-[3px] text-center min-w-0">
          <span className="block text-[1.05rem] font-bold font-mono leading-none text-[#dc2626]">
            {stats.not_interested || 0}
          </span>
          <span className="text-[0.6rem] uppercase tracking-tight text-[#64748b] truncate block">
            Not Interested
          </span>
        </div>
        <div className="bg-[#f8fafc] border border-[#e2e8f0] p-[6px_4px] rounded-[3px] text-center min-w-0">
          <span className="block text-[1.05rem] font-bold font-mono leading-none text-[#7c3aed]">
            {stats.wrong_number || 0}
          </span>
          <span className="text-[0.6rem] uppercase tracking-tight text-[#64748b] truncate block">
            Wrong Number
          </span>
        </div>
        <div className="bg-[#f8fafc] border border-[#e2e8f0] p-[6px_4px] rounded-[3px] text-center min-w-0">
          <span className="block text-[1.05rem] font-bold font-mono leading-none text-[#ea580c]">
            {stats.not_talking || 0}
          </span>
          <span className="text-[0.6rem] uppercase tracking-tight text-[#64748b] truncate block">
            Not Talking
          </span>
        </div>
        <div className="bg-[#f8fafc] border border-[#e2e8f0] p-[6px_4px] rounded-[3px] text-center min-w-0">
          <span className="block text-[1.05rem] font-bold font-mono leading-none text-[#64748b]">
            {stats.no_answer || 0}
          </span>
          <span className="text-[0.6rem] uppercase tracking-tight text-[#64748b] truncate block">
            No Answer
          </span>
        </div>
        <div className="bg-[#f8fafc] border border-[#e2e8f0] p-[6px_4px] rounded-[3px] text-center min-w-0">
          <span className="block text-[1.05rem] font-bold font-mono leading-none text-[#e11d48]">
            {stats.dropped || 0}
          </span>
          <span className="text-[0.6rem] uppercase tracking-tight text-[#64748b] truncate block">
            Dropped
          </span>
        </div>
      </div>

      {/* Button Group */}
      <div className="grid grid-cols-4 gap-[6px] mb-3">
        <button
          onClick={onStartCampaign}
          disabled={isRunning}
          className="p-[7px_10px] rounded-[3px] text-[0.78rem] font-semibold text-center transition bg-[#059669] hover:bg-[#047857] text-white disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Start OBD
        </button>
        <button
          onClick={isPaused ? onResumeCampaign : onPauseCampaign}
          disabled={!isRunning}
          className="p-[7px_10px] rounded-[3px] text-[0.78rem] font-semibold text-center transition bg-[#d97706] hover:bg-[#b45309] text-white disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isPaused ? 'Resume' : 'Pause'}
        </button>
        <button
          onClick={onStopCampaign}
          disabled={!isRunning}
          className="p-[7px_10px] rounded-[3px] text-[0.78rem] font-semibold text-center transition bg-[#dc2626] hover:bg-[#b91c1c] text-white disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Stop
        </button>
        <button
          onClick={onResetQueue}
          title="Clear all leads from active queue and reset counters to start fresh"
          className="p-[7px_10px] rounded-[3px] text-[0.78rem] font-semibold text-center transition bg-white border border-[#cbd5e1] text-[#334155] hover:bg-[#f1f5f9] hover:text-[#0f172a]"
        >
          Reset Queue
        </button>
      </div>

      {/* Manual Single Dial */}
      <div className="border-t border-[#e2e8f0] pt-[10px] mt-2">
        <div className="flex justify-between items-center mb-[6px]">
          <span className="text-[0.72rem] text-[#64748b] uppercase">Single Test Dial</span>
          {manualDialStatus && (
            <span
              className="text-[0.7rem] font-mono font-semibold"
              style={{
                color:
                  manualDialStatus === 'FAILED'
                    ? '#dc2626'
                    : manualDialStatus === 'IN CALL'
                    ? '#15803d'
                    : manualDialStatus === 'INTERESTED'
                    ? '#16a34a'
                    : '#b45309',
              }}
            >
              {manualDialStatus}
            </span>
          )}
        </div>
        <div className="flex gap-[6px]">
          <input
            type="text"
            value={manualPhone}
            onChange={(e) => setManualPhone(e.target.value)}
            placeholder="+91XXXXXXXXXX"
            className="flex-1 bg-white border border-[#cbd5e1] text-[#0f172a] text-[0.78rem] p-[5px_8px] rounded-[3px] outline-none focus:border-[#2563eb]"
          />
          <button
            onClick={() => onTriggerManualDial(manualPhone)}
            disabled={isDialingManual || activeCalls.length > 0}
            className="p-[7px_10px] rounded-[3px] text-[0.78rem] font-semibold text-center transition bg-[#2563eb] hover:bg-[#1d4ed8] text-white whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isDialingManual ? 'Dialing...' : activeCalls.length > 0 ? 'In Call' : 'Dial'}
          </button>
        </div>
        {manualDialFeedback && (
          <div className="text-[0.72rem] mt-[6px] text-[#64748b]">
            {manualDialFeedback}
          </div>
        )}
      </div>

      {/* Predefined Test Contacts Batch */}
      <div className="border-t border-[#e2e8f0] pt-[10px] mt-[10px]">
        <div className="flex justify-between items-center mb-2">
          <span className="text-[0.72rem] text-[#64748b] uppercase font-semibold">
            Test Batch Contacts ({selectedContacts.length}/{PREDEFINED_TEST_CONTACTS.length})
          </span>
          <button
            type="button"
            onClick={toggleAllContacts}
            className="text-[0.68rem] text-[#2563eb] bg-transparent border-none cursor-pointer p-0 font-medium"
          >
            {selectedContacts.length === PREDEFINED_TEST_CONTACTS.length
              ? 'Deselect All'
              : 'Select All'}
          </button>
        </div>

        <div className="flex flex-col gap-[5px] mb-[10px]">
          {PREDEFINED_TEST_CONTACTS.map((c, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between p-[4px_6px] bg-[#f8fafc] border border-[#e2e8f0] rounded-[4px] text-[0.74rem]"
            >
              <label className="flex items-center gap-[6px] cursor-pointer flex-1 m-0 select-none">
                <input
                  type="checkbox"
                  checked={selectedContacts.includes(idx)}
                  onChange={() => toggleContact(idx)}
                  className="cursor-pointer"
                />
                <span className="font-semibold text-[#1e293b]">{c.name}</span>
                <span className="font-mono text-[#64748b] text-[0.7rem]">{c.phone}</span>
              </label>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setManualPhone(c.phone);
                }}
                title="Use in Single Test Dial"
                className="text-[0.65rem] text-[#475569] bg-[#e2e8f0] border-none rounded-[3px] p-[2px_6px] cursor-pointer ml-1 hover:bg-[#cbd5e1]"
              >
                Use
              </button>
            </div>
          ))}
        </div>

        <div className="flex gap-[6px]">
          <button
            onClick={() => handleQueueTestBatch(true)}
            disabled={selectedContacts.length === 0 || isQueueingBatch}
            className="flex-1 p-[7px_10px] rounded-[3px] text-[0.74rem] font-semibold text-center transition bg-[#2563eb] hover:bg-[#1d4ed8] text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Start Test Batch ({selectedContacts.length})
          </button>
          <button
            onClick={() => handleQueueTestBatch(false)}
            disabled={selectedContacts.length === 0 || isQueueingBatch}
            title="Queue contacts into dialer without starting immediately"
            className="p-[7px_8px] rounded-[3px] text-[0.72rem] font-semibold text-center transition bg-white border border-[#cbd5e1] text-[#334155] hover:bg-[#f1f5f9] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Queue Only
          </button>
        </div>

        {testBatchFeedback && (
          <div className="text-[0.7rem] mt-[6px] text-[#64748b]">
            {testBatchFeedback}
          </div>
        )}
      </div>
    </div>
  );
}
