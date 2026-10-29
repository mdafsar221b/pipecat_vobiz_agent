import React, { useState } from 'react';
import {
  Play,
  Pause,
  Square,
  RotateCcw,
  Phone,
  PhoneCall,
  Users,
  ThumbsUp,
  ThumbsDown,
  PhoneOff,
} from 'lucide-react';

const PREDEFINED_TEST_CONTACTS = [
  { name: 'Afsar', phone: '+917007173798' },
  { name: 'Afsar 2', phone: '+916201856832' },
  { name: 'Nitesh', phone: '+917781911392' },
  { name: 'Krupali', phone: '+919769756433' },
  { name: 'Botify', phone: '+918065521614' },
  { name: 'Prakash', phone: '+917976818025' },
  {name:'Tanisq', phone:'+919989988024'},
  
];

// Campaign orchestration controls, KPI cards, and dialer actions
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
  const progressPercent = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
  const interestedCount = stats.interested || 0;
  const conversionRate = completed > 0 ? Math.round((interestedCount / completed) * 100) : 0;

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

  const statusLabel = isRunning ? (isPaused ? 'PAUSED' : 'ACTIVE') : 'IDLE';

  return (
    <div className="flex flex-col h-full min-h-0 divide-y divide-slate-200 bg-white">
      {/* 1. Header with Status & Progress */}
      <div className="p-3 bg-white flex-shrink-0">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-900 tracking-tight">
              Dialer Command Desk
            </span>
            <span
              className={`inline-flex items-center gap-1 px-1.5 py-0.2 text-[9px] font-bold tracking-wider uppercase border ${
                isRunning && !isPaused
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : isPaused
                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                  : 'bg-slate-100 text-slate-600 border-slate-200'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 ${
                  isRunning && !isPaused
                    ? 'bg-emerald-500 animate-pulse'
                    : isPaused
                    ? 'bg-amber-500'
                    : 'bg-slate-400'
                }`}
              />
              {statusLabel}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {retries > 0 && (
              <button
                onClick={onRetryFailed}
                className="text-xs font-semibold text-[#008792] hover:underline cursor-pointer"
              >
                Retry ({retries})
              </button>
            )}
            <span className="font-mono text-[11px] font-semibold text-slate-500">
              {completed}/{total} Leads ({progressPercent}%)
            </span>
          </div>
        </div>

        {/* Flat Progress Bar */}
        <div className="w-full bg-slate-100 h-1 overflow-hidden">
          <div
            className="bg-[#008792] h-1 transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* 2. Primary OBD Action Buttons */}
      <div className="p-3 bg-white flex-shrink-0">
        <div className="grid grid-cols-4 gap-1.5">
          <button
            onClick={onStartCampaign}
            disabled={isRunning}
            className="flex items-center justify-center gap-1 py-1.5 px-2 text-xs font-semibold bg-[#008792] hover:bg-[#007680] text-white transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            <Play className="w-3 h-3 fill-current" />
            <span>Start</span>
          </button>

          <button
            onClick={isPaused ? onResumeCampaign : onPauseCampaign}
            disabled={!isRunning}
            className="flex items-center justify-center gap-1 py-1.5 px-2 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            {isPaused ? <Play className="w-3 h-3 fill-current" /> : <Pause className="w-3 h-3 fill-current" />}
            <span>{isPaused ? 'Resume' : 'Pause'}</span>
          </button>

          <button
            onClick={onStopCampaign}
            disabled={!isRunning}
            className="flex items-center justify-center gap-1 py-1.5 px-2 text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            <Square className="w-3 h-3 fill-current" />
            <span>Stop</span>
          </button>

          <button
            onClick={onResetQueue}
            title="Clear queue and reset counters"
            className="flex items-center justify-center gap-1 py-1.5 px-2 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 transition cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Reset</span>
          </button>
        </div>
      </div>

      {/* 3. Compact Metrics & Outcomes Strip */}
      <div className="p-3 bg-slate-50/60 space-y-2 flex-shrink-0">
        <div className="grid grid-cols-4 gap-1.5">
          <div className="bg-white border border-slate-200 p-1.5 text-center">
            <span className="block text-sm font-bold font-mono text-slate-900 leading-tight">
              {total}
            </span>
            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
              Queue
            </span>
          </div>
          <div className="bg-white border border-[#008792]/30 p-1.5 text-center">
            <span className="block text-sm font-bold font-mono text-[#008792] leading-tight">
              {pending}
            </span>
            <span className="text-[9px] font-bold uppercase tracking-wider text-[#008792]">
              Pending
            </span>
          </div>
          <div className="bg-white border border-amber-200 p-1.5 text-center">
            <span className="block text-sm font-bold font-mono text-amber-700 leading-tight">
              {activeCount}
            </span>
            <span className="text-[9px] font-bold uppercase tracking-wider text-amber-600">
              Dialing
            </span>
          </div>
          <div className="bg-white border border-indigo-200 p-1.5 text-center">
            <span className="block text-sm font-bold font-mono text-indigo-700 leading-tight">
              {conversionRate}%
            </span>
            <span className="text-[9px] font-bold uppercase tracking-wider text-indigo-600">
              Interest
            </span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-1.5 text-xs">
          <div className="flex items-center gap-1.5 p-1 px-2 bg-white border border-emerald-200">
            <ThumbsUp className="w-3 h-3 text-emerald-600 flex-shrink-0" />
            <div className="min-w-0">
              <span className="font-bold text-emerald-800 block font-mono text-xs leading-none">
                {stats.interested || 0}
              </span>
              <span className="text-[9px] uppercase text-emerald-600 font-semibold block mt-0.5">
                Interested
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 p-1 px-2 bg-white border border-rose-200">
            <ThumbsDown className="w-3 h-3 text-rose-600 flex-shrink-0" />
            <div className="min-w-0">
              <span className="font-bold text-rose-800 block font-mono text-xs leading-none">
                {stats.not_interested || 0}
              </span>
              <span className="text-[9px] uppercase text-rose-600 font-semibold block mt-0.5">
                Not Interested
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 p-1 px-2 bg-white border border-slate-200">
            <PhoneOff className="w-3 h-3 text-slate-500 flex-shrink-0" />
            <div className="min-w-0">
              <span className="font-bold text-slate-800 block font-mono text-xs leading-none">
                {stats.no_answer || 0}
              </span>
              <span className="text-[9px] uppercase text-slate-500 font-semibold block mt-0.5">
                No Answer
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Single Direct Dial */}
      <div className="p-3 bg-white flex-shrink-0">
        <div className="flex items-center justify-between mb-1">
          <label className="text-[11px] font-bold text-slate-800 flex items-center gap-1">
            <Phone className="w-3 h-3 text-[#008792]" />
            <span>Single Direct Dial</span>
          </label>
          {manualDialStatus && (
            <span
              className={`text-[9px] font-mono font-bold px-1.5 py-0.2 border ${
                manualDialStatus === 'FAILED'
                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                  : manualDialStatus === 'IN CALL'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-amber-50 text-amber-700 border-amber-200'
              }`}
            >
              {manualDialStatus}
            </span>
          )}
        </div>

        <div className="flex gap-1.5">
          <input
            type="text"
            value={manualPhone}
            onChange={(e) => setManualPhone(e.target.value)}
            placeholder="+91XXXXXXXXXX"
            className="w-full bg-slate-50 border border-slate-300 text-slate-900 text-xs py-1.5 px-2.5 outline-none focus:border-[#008792] font-mono"
          />
          <button
            onClick={() => onTriggerManualDial(manualPhone)}
            disabled={isDialingManual || activeCalls.length > 0}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-[#008792] hover:bg-[#007680] text-white transition disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap cursor-pointer"
          >
            <PhoneCall className="w-3 h-3" />
            <span>{isDialingManual ? 'Calling...' : activeCalls.length > 0 ? 'Busy' : 'Dial'}</span>
          </button>
        </div>

        {manualDialFeedback && (
          <p className="text-[10px] text-slate-600 mt-1 p-1 bg-slate-50 border border-slate-200 leading-tight truncate">
            {manualDialFeedback}
          </p>
        )}
      </div>

      {/* 5. Predefined Test Contacts Batch */}
      <div className="p-3 bg-white flex-1 min-h-0 flex flex-col justify-between">
        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex items-center justify-between mb-1.5 flex-shrink-0">
            <div className="flex items-center gap-1 text-[11px] font-bold text-slate-800">
              <Users className="w-3 h-3 text-[#008792]" />
              <span>Test Contacts ({selectedContacts.length}/{PREDEFINED_TEST_CONTACTS.length})</span>
            </div>
            <button
              type="button"
              onClick={toggleAllContacts}
              className="text-[10px] text-[#008792] hover:underline font-semibold cursor-pointer"
            >
              {selectedContacts.length === PREDEFINED_TEST_CONTACTS.length ? 'Deselect All' : 'Select All'}
            </button>
          </div>

          <div className="space-y-1 overflow-y-auto pr-1 flex-1 min-h-[60px] border border-slate-200 divide-y divide-slate-100">
            {PREDEFINED_TEST_CONTACTS.map((c, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-1 px-2 bg-white hover:bg-slate-50 text-xs transition"
              >
                <label className="flex items-center gap-2 cursor-pointer flex-1 truncate select-none">
                  <input
                    type="checkbox"
                    checked={selectedContacts.includes(idx)}
                    onChange={() => toggleContact(idx)}
                    className="text-[#008792] focus:ring-0 cursor-pointer accent-[#008792]"
                  />
                  <span className="font-semibold text-slate-800 text-[11px]">{c.name}</span>
                  <span className="font-mono text-slate-400 text-[10px]">{c.phone}</span>
                </label>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setManualPhone(c.phone);
                  }}
                  className="text-[9px] text-slate-600 hover:text-[#008792] bg-slate-50 hover:bg-white border border-slate-200 px-1.5 py-0.2 font-medium ml-2 cursor-pointer"
                >
                  Use
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="pt-2 flex-shrink-0">
          <div className="flex gap-1.5">
            <button
              onClick={() => handleQueueTestBatch(true)}
              disabled={selectedContacts.length === 0 || isQueueingBatch}
              className="flex-1 py-1.5 px-2 text-xs font-semibold bg-[#008792] hover:bg-[#007680] text-white transition disabled:opacity-40 cursor-pointer"
            >
              Start Test Batch ({selectedContacts.length})
            </button>
            <button
              onClick={() => handleQueueTestBatch(false)}
              disabled={selectedContacts.length === 0 || isQueueingBatch}
              className="py-1.5 px-2.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 transition disabled:opacity-40 cursor-pointer"
            >
              Queue Only
            </button>
          </div>

          {testBatchFeedback && (
            <p className="text-[10px] text-slate-600 mt-1 p-1 bg-slate-50 border border-slate-200 truncate">
              {testBatchFeedback}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
