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
    <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] space-y-5">
      {/* Header with status and progress */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2.5">
            <h2 className="text-sm font-bold text-slate-900 tracking-tight">
              Campaign Orchestration &amp; Controls
            </h2>
            <span
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase border ${
                isRunning && !isPaused
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : isPaused
                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                  : 'bg-slate-100 text-slate-600 border-slate-200'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
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

          <div className="flex items-center gap-3">
            {retries > 0 && (
              <button
                onClick={onRetryFailed}
                className="text-xs font-semibold text-[#008792] hover:text-[#007680] hover:underline"
              >
                Retry Failed ({retries})
              </button>
            )}
            <span className="font-mono text-xs font-semibold text-slate-500">
              {completed} / {total} Leads ({progressPercent}%)
            </span>
          </div>
        </div>

        {/* Nugget Teal Progress Bar */}
        <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
          <div
            className="bg-gradient-to-r from-[#008792] to-[#00a2af] h-2 rounded-full transition-all duration-500"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3 text-center">
          <span className="block text-lg font-bold font-mono text-slate-900 leading-tight">
            {total}
          </span>
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Total In Queue
          </span>
        </div>
        <div className="bg-[#008792]/5 border border-[#008792]/20 rounded-xl p-3 text-center">
          <span className="block text-lg font-bold font-mono text-[#008792] leading-tight">
            {pending}
          </span>
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#008792]/80">
            Pending Leads
          </span>
        </div>
        <div className="bg-amber-50/70 border border-amber-200/80 rounded-xl p-3 text-center">
          <span className="block text-lg font-bold font-mono text-amber-700 leading-tight">
            {activeCount}
          </span>
          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600/80">
            Live Dialing
          </span>
        </div>
        <div className="bg-emerald-50/70 border border-emerald-200/80 rounded-xl p-3 text-center">
          <span className="block text-lg font-bold font-mono text-emerald-700 leading-tight">
            {completed}
          </span>
          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600/80">
            Completed
          </span>
        </div>
        <div className="bg-indigo-50/70 border border-indigo-200/80 rounded-xl p-3 text-center col-span-2 sm:col-span-1">
          <span className="block text-lg font-bold font-mono text-indigo-700 leading-tight">
            {conversionRate}%
          </span>
          <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600/80">
            Interest Rate
          </span>
        </div>
      </div>

      {/* Outcomes breakdown row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="flex items-center gap-2.5 p-2.5 bg-emerald-50/60 rounded-xl border border-emerald-100">
          <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center flex-shrink-0 text-emerald-700">
            <ThumbsUp className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <span className="font-bold text-emerald-800 block font-mono text-sm leading-tight">
              {stats.interested || 0}
            </span>
            <span className="text-[10px] uppercase text-emerald-600 font-semibold block tracking-wider">
              Interested
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2.5 p-2.5 bg-rose-50/60 rounded-xl border border-rose-100">
          <div className="w-8 h-8 rounded-lg bg-rose-100 flex items-center justify-center flex-shrink-0 text-rose-700">
            <ThumbsDown className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <span className="font-bold text-rose-800 block font-mono text-sm leading-tight">
              {stats.not_interested || 0}
            </span>
            <span className="text-[10px] uppercase text-rose-600 font-semibold block tracking-wider">
              Declined
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2.5 p-2.5 bg-slate-50 rounded-xl border border-slate-200">
          <div className="w-8 h-8 rounded-lg bg-slate-200/80 flex items-center justify-center flex-shrink-0 text-slate-600">
            <PhoneOff className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <span className="font-bold text-slate-800 block font-mono text-sm leading-tight">
              {stats.no_answer || 0}
            </span>
            <span className="text-[10px] uppercase text-slate-500 font-semibold block tracking-wider">
              No Answer
            </span>
          </div>
        </div>
      </div>

      {/* OBD Action Control Buttons */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
        <button
          onClick={onStartCampaign}
          disabled={isRunning}
          className="flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-xl text-xs font-semibold bg-[#008792] hover:bg-[#007680] text-white shadow-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Play className="w-3.5 h-3.5 fill-current" />
          <span>Start Campaign OBD</span>
        </button>

        <button
          onClick={isPaused ? onResumeCampaign : onPauseCampaign}
          disabled={!isRunning}
          className="flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-xl text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white shadow-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isPaused ? <Play className="w-3.5 h-3.5 fill-current" /> : <Pause className="w-3.5 h-3.5 fill-current" />}
          <span>{isPaused ? 'Resume Dialing' : 'Pause Dialer'}</span>
        </button>

        <button
          onClick={onStopCampaign}
          disabled={!isRunning}
          className="flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white shadow-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Square className="w-3.5 h-3.5 fill-current" />
          <span>Stop Campaign</span>
        </button>

        <button
          onClick={onResetQueue}
          title="Clear queue and reset counters"
          className="flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-xl text-xs font-semibold bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 shadow-2xs transition"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Reset Queue</span>
        </button>
      </div>

      {/* Lower Dual Panel: Single Test Dial & Test Contacts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-4 border-t border-slate-100">
        {/* Single Direct Dial */}
        <div className="bg-slate-50/70 border border-slate-200/80 rounded-xl p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5 text-[#008792]" />
                <span>Single Test Dial</span>
              </label>
              {manualDialStatus && (
                <span
                  className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
                    manualDialStatus === 'FAILED'
                      ? 'bg-rose-100 text-rose-700'
                      : manualDialStatus === 'IN CALL'
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-amber-100 text-amber-700'
                  }`}
                >
                  {manualDialStatus}
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-500 mb-3">
              Directly dispatch a test call to any phone number to test voice pipeline latency and dialog flow.
            </p>

            <div className="flex gap-2">
              <input
                type="text"
                value={manualPhone}
                onChange={(e) => setManualPhone(e.target.value)}
                placeholder="+91XXXXXXXXXX"
                className="w-full bg-white border border-slate-200 text-slate-900 text-xs py-2 px-3 rounded-lg outline-none focus:ring-1 focus:ring-[#008792] focus:border-[#008792] font-mono shadow-2xs"
              />
              <button
                onClick={() => onTriggerManualDial(manualPhone)}
                disabled={isDialingManual || activeCalls.length > 0}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-[#008792] hover:bg-[#007680] text-white shadow-sm transition disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
              >
                <PhoneCall className="w-3.5 h-3.5" />
                <span>{isDialingManual ? 'Dialing...' : activeCalls.length > 0 ? 'In Call' : 'Dial Now'}</span>
              </button>
            </div>
          </div>

          {manualDialFeedback && (
            <p className="text-[11px] text-slate-600 mt-2.5 p-2 bg-white rounded-lg border border-slate-200 leading-snug">
              {manualDialFeedback}
            </p>
          )}
        </div>

        {/* Predefined Test Contacts Batch */}
        <div className="bg-slate-50/70 border border-slate-200/80 rounded-xl p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                <Users className="w-3.5 h-3.5 text-[#008792]" />
                <span>Test Contacts ({selectedContacts.length}/{PREDEFINED_TEST_CONTACTS.length})</span>
              </div>
              <button
                type="button"
                onClick={toggleAllContacts}
                className="text-[11px] text-[#008792] hover:text-[#007680] font-semibold"
              >
                {selectedContacts.length === PREDEFINED_TEST_CONTACTS.length ? 'Deselect All' : 'Select All'}
              </button>
            </div>

            <div className="space-y-1.5 max-h-[130px] overflow-y-auto pr-1">
              {PREDEFINED_TEST_CONTACTS.map((c, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-1.5 px-2 bg-white hover:bg-slate-100/70 border border-slate-200/70 rounded-lg text-xs transition"
                >
                  <label className="flex items-center gap-2 cursor-pointer flex-1 truncate select-none">
                    <input
                      type="checkbox"
                      checked={selectedContacts.includes(idx)}
                      onChange={() => toggleContact(idx)}
                      className="rounded text-[#008792] focus:ring-0 cursor-pointer"
                    />
                    <span className="font-semibold text-slate-800">{c.name}</span>
                    <span className="font-mono text-slate-400 text-[11px]">{c.phone}</span>
                  </label>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setManualPhone(c.phone);
                    }}
                    className="text-[10px] text-slate-600 hover:text-[#008792] bg-slate-50 hover:bg-white border border-slate-200 rounded px-2 py-0.5 font-medium ml-2 shadow-2xs"
                  >
                    Use
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-3">
            <div className="flex gap-2">
              <button
                onClick={() => handleQueueTestBatch(true)}
                disabled={selectedContacts.length === 0 || isQueueingBatch}
                className="flex-1 py-2 px-3 rounded-lg text-xs font-semibold bg-[#008792] hover:bg-[#007680] text-white shadow-sm transition disabled:opacity-40"
              >
                Start Test Batch ({selectedContacts.length})
              </button>
              <button
                onClick={() => handleQueueTestBatch(false)}
                disabled={selectedContacts.length === 0 || isQueueingBatch}
                className="py-2 px-3 rounded-lg text-xs font-semibold bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 shadow-2xs transition disabled:opacity-40"
              >
                Queue Only
              </button>
            </div>

            {testBatchFeedback && (
              <p className="text-[11px] text-slate-600 mt-2 p-1.5 bg-white rounded border border-slate-200">
                {testBatchFeedback}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
