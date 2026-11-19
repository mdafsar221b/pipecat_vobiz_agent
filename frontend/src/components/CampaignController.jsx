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
  PhoneMissed,
  MicOff,
  UserX,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { apiFetch } from '../utils/auth';

const PREDEFINED_TEST_CONTACTS = [
  { name: 'Afsar', phone: '+917007173798' },
  { name: 'Afsar 2', phone: '+916201856832' },
  { name: 'Nitesh', phone: '+917781911392' },
  { name: 'Krupali', phone: '+919769756433' },
  { name: 'Botify', phone: '+918065521614' },
  { name: 'Prakash', phone: '+917976818025' },
  { name: 'Tanisq', phone: '+919989988024' },
];

// Campaign orchestration controls, KPI cards, and dialer actions built with shadcn components
export default function CampaignController({
  stats = {},
  isRunning = false,
  isPaused = false,
  activeCalls = [],
  templates = [],
  selectedTemplateId = 'production_callback_conversion',
  onSelectTemplate,
  onNavigateToTemplates,
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
  const [showTestContacts, setShowTestContacts] = useState(false);

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
      const res = await apiFetch('/api/campaign/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leads,
          batch_name: batchName,
          source_filter: 'Predefined Test Contacts',
          template_id: selectedTemplateId,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setTestBatchFeedback(`Error: ${data.error || 'Failed to queue'}`);
        return;
      }

      if (startImmediately) {
        setTestBatchFeedback(`Starting OBD dialer for ${leads.length} calls...`);
        await apiFetch('/api/campaign/start', { method: 'POST' });
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
    <div className="flex flex-col h-full min-h-0 overflow-y-auto divide-y divide-border bg-background text-foreground">
      {/* 1. Header with Status & Progress */}
      <div className="p-3 bg-card shrink-0">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-foreground tracking-tight">
              Dialer Command Desk
            </span>
            <Badge
              variant="outline"
              className={cn(
                'text-[9px] font-bold tracking-wider uppercase h-5 px-1.5',
                isRunning && !isPaused
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600'
                  : isPaused
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-600'
                  : 'border-border bg-muted text-muted-foreground'
              )}
            >
              <span
                className={cn(
                  'mr-1 h-1.5 w-1.5 rounded-full',
                  isRunning && !isPaused
                    ? 'bg-emerald-500 animate-pulse'
                    : isPaused
                    ? 'bg-amber-500'
                    : 'bg-muted-foreground'
                )}
              />
              {statusLabel}
            </Badge>
          </div>

          <div className="flex items-center gap-2">
            {retries > 0 && (
              <Button
                variant="link"
                size="xs"
                onClick={onRetryFailed}
                className="h-auto p-0 text-xs font-semibold text-[#008792]"
              >
                Retry ({retries})
              </Button>
            )}
            <span className="font-mono text-[11px] font-semibold text-muted-foreground">
              {completed}/{total} Leads ({progressPercent}%)
            </span>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="w-full bg-muted h-1 rounded-full overflow-hidden">
          <div
            className="bg-[#008792] h-full transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* 1.5 Active Campaign Strategy Selector */}
      <div className="p-3 bg-muted/40 shrink-0">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Campaign Script Strategy
          </span>
          {onNavigateToTemplates && (
            <Button
              variant="link"
              size="xs"
              type="button"
              onClick={onNavigateToTemplates}
              className="h-auto p-0 text-[11px] font-semibold text-[#008792]"
            >
              Edit / Tweak Script &rarr;
            </Button>
          )}
        </div>
        <select
          value={selectedTemplateId}
          onChange={(e) => onSelectTemplate?.(e.target.value)}
          className="w-full h-8 px-2.5 text-xs font-semibold bg-background border border-input rounded-md focus:border-[#008792] focus:ring-1 focus:ring-[#008792] outline-none"
        >
          {templates.map((t) => (
            <option key={t.template_id} value={t.template_id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      {/* 2. Primary OBD Action Buttons using shadcn Button */}
      <div className="p-3 bg-card shrink-0">
        <div className="grid grid-cols-4 gap-1.5">
          <Button
            size="sm"
            onClick={onStartCampaign}
            disabled={isRunning}
            className="h-8 bg-[#008792] hover:bg-[#007680] text-white gap-1 text-xs font-semibold shadow-xs"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Start</span>
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={isPaused ? onResumeCampaign : onPauseCampaign}
            disabled={!isRunning}
            className="h-8 border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 gap-1 text-xs font-semibold"
          >
            {isPaused ? <Play className="w-3.5 h-3.5 fill-current" /> : <Pause className="w-3.5 h-3.5 fill-current" />}
            <span>{isPaused ? 'Resume' : 'Pause'}</span>
          </Button>

          <Button
            size="sm"
            variant="destructive"
            onClick={onStopCampaign}
            disabled={!isRunning}
            className="h-8 gap-1 text-xs font-semibold shadow-xs"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            <span>Stop</span>
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={onResetQueue}
            title="Clear queue and reset counters"
            className="h-8 gap-1 text-xs font-semibold"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset</span>
          </Button>
        </div>
      </div>

      {/* 3. Compact Metrics & Outcomes Strip using shadcn Card */}
      <div className="p-3 bg-muted/30 space-y-2 shrink-0">
        <div className="grid grid-cols-4 gap-1.5">
          <Card className="p-2 text-center rounded-lg shadow-none bg-card border-border">
            <span className="block text-sm font-bold font-mono text-foreground leading-tight">
              {total}
            </span>
            <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
              Queue
            </span>
          </Card>
          <Card className="p-2 text-center rounded-lg shadow-none bg-card border-[#008792]/30">
            <span className="block text-sm font-bold font-mono text-[#008792] leading-tight">
              {pending}
            </span>
            <span className="text-[9px] font-bold uppercase tracking-wider text-[#008792]">
              Pending
            </span>
          </Card>
          <Card className="p-2 text-center rounded-lg shadow-none bg-card border-amber-300">
            <span className="block text-sm font-bold font-mono text-amber-600 leading-tight">
              {activeCount}
            </span>
            <span className="text-[9px] font-bold uppercase tracking-wider text-amber-600">
              Dialing
            </span>
          </Card>
          <Card className="p-2 text-center rounded-lg shadow-none bg-card border-indigo-200">
            <span className="block text-sm font-bold font-mono text-indigo-600 leading-tight">
              {conversionRate}%
            </span>
            <span className="text-[9px] font-bold uppercase tracking-wider text-indigo-600">
              Interest
            </span>
          </Card>
        </div>

        {/* 6 Disposition KPI Cards */}
        <div className="grid grid-cols-3 gap-1.5 text-xs">
          {/* 1. Interested */}
          <Card className="flex flex-row items-center gap-1.5 p-1.5 px-2 bg-emerald-500/5 border-emerald-500/30 rounded-md shadow-none" title="Interested leads">
            <ThumbsUp className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <div className="min-w-0">
              <span className="font-bold text-emerald-700 block font-mono text-xs leading-none">
                {stats.interested || 0}
              </span>
              <span className="text-[9px] uppercase text-emerald-600 font-semibold block mt-0.5 truncate">
                Interested
              </span>
            </div>
          </Card>

          {/* 2. Not Interested */}
          <Card className="flex flex-row items-center gap-1.5 p-1.5 px-2 bg-rose-500/5 border-rose-500/30 rounded-md shadow-none" title="Declined leads">
            <ThumbsDown className="w-3.5 h-3.5 text-rose-600 shrink-0" />
            <div className="min-w-0">
              <span className="font-bold text-rose-700 block font-mono text-xs leading-none">
                {stats.not_interested || 0}
              </span>
              <span className="text-[9px] uppercase text-rose-600 font-semibold block mt-0.5 truncate">
                Not Int.
              </span>
            </div>
          </Card>

          {/* 3. Dropped */}
          <Card className="flex flex-row items-center gap-1.5 p-1.5 px-2 bg-red-500/5 border-red-500/30 rounded-md shadow-none" title="Early disconnects / dropped calls">
            <PhoneMissed className="w-3.5 h-3.5 text-red-600 shrink-0" />
            <div className="min-w-0">
              <span className="font-bold text-red-700 block font-mono text-xs leading-none">
                {stats.dropped || 0}
              </span>
              <span className="text-[9px] uppercase text-red-600 font-semibold block mt-0.5 truncate">
                Dropped
              </span>
            </div>
          </Card>

          {/* 4. Silent / Not Talking */}
          <Card className="flex flex-row items-center gap-1.5 p-1.5 px-2 bg-amber-500/5 border-amber-500/30 rounded-md shadow-none" title="Answered but silent / no speech">
            <MicOff className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            <div className="min-w-0">
              <span className="font-bold text-amber-700 block font-mono text-xs leading-none">
                {stats.not_talking || 0}
              </span>
              <span className="text-[9px] uppercase text-amber-600 font-semibold block mt-0.5 truncate">
                Silent
              </span>
            </div>
          </Card>

          {/* 5. No Answer / Busy */}
          <Card className="flex flex-row items-center gap-1.5 p-1.5 px-2 bg-muted/40 border-border rounded-md shadow-none" title="Unanswered, busy, or unreachable">
            <PhoneOff className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <span className="font-bold text-foreground block font-mono text-xs leading-none">
                {stats.no_answer || 0}
              </span>
              <span className="text-[9px] uppercase text-muted-foreground font-semibold block mt-0.5 truncate">
                No Answer
              </span>
            </div>
          </Card>

          {/* 6. Wrong Number */}
          <Card className="flex flex-row items-center gap-1.5 p-1.5 px-2 bg-purple-500/5 border-purple-500/30 rounded-md shadow-none" title="Confirmed wrong numbers">
            <UserX className="w-3.5 h-3.5 text-purple-600 shrink-0" />
            <div className="min-w-0">
              <span className="font-bold text-purple-700 block font-mono text-xs leading-none">
                {stats.wrong_number || 0}
              </span>
              <span className="text-[9px] uppercase text-purple-600 font-semibold block mt-0.5 truncate">
                Wrong No.
              </span>
            </div>
          </Card>
        </div>
      </div>

      {/* 4. Single Direct Dial using shadcn Input + Button */}
      <div className="p-3 bg-card shrink-0">
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-[11px] font-bold text-foreground flex items-center gap-1">
            <Phone className="w-3.5 h-3.5 text-[#008792]" />
            <span>Single Direct Dial</span>
          </label>
          {manualDialStatus && (
            <Badge
              variant="outline"
              className={cn(
                'text-[9px] font-mono font-bold h-4 px-1.5',
                manualDialStatus === 'FAILED'
                  ? 'border-rose-300 bg-rose-50 text-rose-700'
                  : manualDialStatus === 'IN CALL'
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                  : 'border-amber-300 bg-amber-50 text-amber-700'
              )}
            >
              {manualDialStatus}
            </Badge>
          )}
        </div>

        <div className="flex gap-1.5">
          <Input
            type="text"
            value={manualPhone}
            onChange={(e) => setManualPhone(e.target.value)}
            placeholder="+91XXXXXXXXXX"
            className="h-8 text-xs font-mono bg-background"
          />
          <Button
            size="sm"
            onClick={() => onTriggerManualDial(manualPhone)}
            disabled={isDialingManual || activeCalls.length > 0}
            className="h-8 bg-[#008792] hover:bg-[#007680] text-white text-xs font-semibold shrink-0 gap-1"
          >
            <PhoneCall className="w-3.5 h-3.5" />
            <span>{isDialingManual ? 'Calling...' : activeCalls.length > 0 ? 'Busy' : 'Dial'}</span>
          </Button>
        </div>

        {manualDialFeedback && (
          <p className="text-[10px] text-muted-foreground mt-1.5 p-1.5 bg-muted/40 border border-border rounded leading-tight truncate">
            {manualDialFeedback}
          </p>
        )}
      </div>

      {/* 5. Predefined Test Contacts Batch (Collapsible) */}
      <div className="p-3 bg-card shrink-0 flex flex-col gap-2">
        <div className="flex flex-col">
          <div className="flex items-center justify-between shrink-0">
            <button
              type="button"
              onClick={() => setShowTestContacts(!showTestContacts)}
              className="flex items-center gap-1 text-[11px] font-bold text-foreground hover:text-[#008792] cursor-pointer"
            >
              <Users className="w-3.5 h-3.5 text-[#008792]" />
              <span>Test Contacts ({selectedContacts.length}/{PREDEFINED_TEST_CONTACTS.length})</span>
              <span className="text-[10px] text-muted-foreground ml-1 font-normal">
                {showTestContacts ? '(Click to collapse)' : '(Click to expand)'}
              </span>
            </button>
            {showTestContacts && (
              <Button
                variant="link"
                size="xs"
                type="button"
                onClick={toggleAllContacts}
                className="h-auto p-0 text-[10px] text-[#008792]"
              >
                {selectedContacts.length === PREDEFINED_TEST_CONTACTS.length ? 'Deselect All' : 'Select All'}
              </Button>
            )}
          </div>

          {showTestContacts && (
            <div className="mt-2 space-y-1 max-h-36 overflow-y-auto pr-1 border border-border rounded-md divide-y divide-border">
              {PREDEFINED_TEST_CONTACTS.map((c, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-1.5 px-2 bg-background hover:bg-muted/40 text-xs transition-colors"
                >
                  <label className="flex items-center gap-2 cursor-pointer flex-1 truncate select-none">
                    <input
                      type="checkbox"
                      checked={selectedContacts.includes(idx)}
                      onChange={() => toggleContact(idx)}
                      className="h-3.5 w-3.5 rounded border-input text-[#008792] focus:ring-0 cursor-pointer accent-[#008792]"
                    />
                    <span className="font-semibold text-foreground text-[11px]">{c.name}</span>
                    <span className="font-mono text-muted-foreground text-[10px]">{c.phone}</span>
                  </label>
                  <Button
                    size="xs"
                    variant="ghost"
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setManualPhone(c.phone);
                    }}
                    className="h-5 px-1.5 text-[9px] text-muted-foreground hover:text-[#008792]"
                  >
                    Use
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {showTestContacts && (
          <div className="pt-1 shrink-0">
            <div className="flex gap-1.5">
              <Button
                size="sm"
                onClick={() => handleQueueTestBatch(true)}
                disabled={selectedContacts.length === 0 || isQueueingBatch}
                className="flex-1 h-8 bg-[#008792] hover:bg-[#007680] text-white text-xs font-semibold"
              >
                Start Test Batch ({selectedContacts.length})
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleQueueTestBatch(false)}
                disabled={selectedContacts.length === 0 || isQueueingBatch}
                className="h-8 text-xs font-semibold"
              >
                Queue Only
              </Button>
            </div>

            {testBatchFeedback && (
              <p className="text-[10px] text-muted-foreground mt-1.5 p-1.5 bg-muted/40 border border-border rounded truncate">
                {testBatchFeedback}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
