import React, { useState, useRef } from 'react';
import {
  Clock,
  Volume2,
  RefreshCw,
  Phone,
  RotateCcw,
  Bot,
  User,
  Activity,
  Download,
  Play,
  Pause,
  Pencil,
  X,
} from 'lucide-react';
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from './ui/table';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
  DrawerClose,
} from './ui/drawer';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { cn } from '@/lib/utils';
import {
  formatBytes,
  formatDuration,
  formatTime,
  getDispositionConfig,
  getDiagnosticConfig,
} from '../utils/formatters';

// Unified compact telephony calls table with slide-out details and audio drawer
export default function CallsTable({
  calls = [],
  isLoading = false,
  emptyTitle = 'No calls match the selected filters',
  emptyDescription = 'Try adjusting your search query or filter criteria.',
  onResetFilters,
  selectedUuids,
  onToggleSelect,
  onToggleSelectAll,
  onCallUpdated,
  containerClassName = 'max-h-[calc(100vh-220px)]',
}) {
  const [inspectingCall, setInspectingCall] = useState(null);
  const [activeDrawerTab, setActiveDrawerTab] = useState('transcript');

  // Inline audio player state
  const [playingUuid, setPlayingUuid] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const audioPlayerRef = useRef(null);

  // Edit Disposition & Callback Modal State
  const [editingCall, setEditingCall] = useState(null);
  const [editForm, setEditForm] = useState({
    disposition: 'interested',
    callback_time: '',
    customer_name: '',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [callOverrides, setCallOverrides] = useState({});

  const openEditModal = (call) => {
    if (!call) return;
    const callUuid = call.call_uuid || call.lead_id;
    const overrides = callOverrides[callUuid] || {};
    setEditingCall(call);
    setEditForm({
      disposition: overrides.disposition || call.disposition || 'interested',
      callback_time: overrides.callback_time !== undefined ? overrides.callback_time : (call.callback_time || ''),
      customer_name: overrides.customer_name !== undefined ? overrides.customer_name : (call.customer_name || ''),
    });
    setSaveError('');
  };

  const handleSaveCorrections = async () => {
    if (!editingCall) return;
    const targetUuid = editingCall.call_uuid || editingCall.lead_id;
    if (!targetUuid) return;

    setIsSaving(true);
    setSaveError('');
    try {
      const updates = {
        disposition: editForm.disposition,
        callback_time: editForm.callback_time,
        customer_name: editForm.customer_name,
      };

      const res = await fetch(`/api/call/${encodeURIComponent(targetUuid)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      setCallOverrides((prev) => ({
        ...prev,
        [targetUuid]: {
          ...prev[targetUuid],
          ...updates,
        },
      }));

      if (inspectingCall && (inspectingCall.call_uuid === targetUuid || inspectingCall.lead_id === targetUuid)) {
        setInspectingCall((prev) => (prev ? { ...prev, ...updates } : prev));
      }

      onCallUpdated?.(targetUuid, updates);
      setEditingCall(null);
    } catch (err) {
      setSaveError(`Failed to save changes: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleTogglePlay = (e, callUuid) => {
    e.stopPropagation();
    if (!audioPlayerRef.current) return;

    if (playingUuid === callUuid) {
      if (isPlaying) {
        audioPlayerRef.current.pause();
        setIsPlaying(false);
      } else {
        audioPlayerRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
      }
    } else {
      setPlayingUuid(callUuid);
      audioPlayerRef.current.src = `/api/recording/${encodeURIComponent(callUuid)}`;
      audioPlayerRef.current.currentTime = 0;
      audioPlayerRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  };

  const showSelection = Boolean(selectedUuids && onToggleSelect);
  const allSelected =
    showSelection &&
    calls.length > 0 &&
    calls.every((c) => selectedUuids.has(c.call_uuid || c.lead_id));

  const colSpanCount = showSelection ? 6 : 5;

  return (
    <>
      {/* Hidden audio element for compact in-row audio playback */}
      <audio
        ref={audioPlayerRef}
        className="hidden"
        preload="none"
        onTimeUpdate={(e) => setAudioProgress(e.currentTarget.currentTime)}
        onEnded={() => {
          setIsPlaying(false);
          setAudioProgress(0);
          setPlayingUuid(null);
        }}
        onPause={() => setIsPlaying(false)}
        onPlay={() => setIsPlaying(true)}
      />

      <div className={cn("overflow-x-auto border border-border rounded-lg bg-card shadow-xs", containerClassName)}>
        <Table>
          <TableHeader className="bg-muted/80 sticky top-0 z-10 backdrop-blur-xs">
            <TableRow className="hover:bg-transparent border-b">
              {showSelection && (
                <TableHead className="w-8 px-2 py-1">
                  <input
                    type="checkbox"
                    checked={Boolean(allSelected)}
                    onChange={onToggleSelectAll}
                    className="w-3.5 h-3.5 rounded border-input text-[#008792] focus:ring-0 cursor-pointer accent-[#008792]"
                  />
                </TableHead>
              )}
              <TableHead className="px-2.5 py-1 whitespace-nowrap text-xs">Recipient</TableHead>
              <TableHead className="px-2.5 py-1 whitespace-nowrap text-xs">Disposition</TableHead>
              <TableHead className="px-2.5 py-1 whitespace-nowrap text-xs">Duration</TableHead>
              <TableHead className="px-2.5 py-1 whitespace-nowrap text-xs">Time &amp; Callback</TableHead>
              <TableHead className="px-2.5 py-1 whitespace-nowrap text-xs text-right pr-3">Recording</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={colSpanCount} className="text-center py-12 text-muted-foreground">
                  <RefreshCw className="w-6 h-6 animate-spin text-[#008792] mx-auto mb-2" />
                  <span className="text-xs font-medium">Fetching call audio telemetry and transcripts...</span>
                </TableCell>
              </TableRow>
            ) : calls.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colSpanCount} className="text-center py-12 bg-muted/20">
                  <Phone className="w-7 h-7 text-muted-foreground mx-auto mb-2 opacity-50" />
                  <p className="font-semibold text-xs text-foreground">{emptyTitle}</p>
                  {emptyDescription && (
                    <p className="text-[11px] text-muted-foreground mt-1 max-w-sm mx-auto">
                      {emptyDescription}
                    </p>
                  )}
                  {onResetFilters && (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={onResetFilters}
                      className="mt-3 gap-1 text-[#008792]"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Reset Filters</span>
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ) : (
              calls.map((entry, idx) => {
                const callUuid = entry.call_uuid || entry.lead_id || `call-${idx}`;
                const shortUuid = String(callUuid).slice(0, 8);
                const displayPhone =
                  entry.phone_number ||
                  (entry.events || []).find((e) => e.to || e.params?.To)?.to ||
                  (entry.events || []).find((e) => e.params?.To)?.params?.To ||
                  (entry.events || []).find((e) => e.params?.From)?.params?.From ||
                  String(callUuid).slice(0, 12);

                const recEvent = (entry.events || []).find((e) => e.kind === 'recording');
                const recUrl = entry.recording_url || (recEvent ? recEvent.recording_url || recEvent.params?.RecordUrl : '');
                const hangupEvent = (entry.events || []).find((e) => e.kind === 'hangup');
                const rawDuration =
                  entry.duration !== undefined && entry.duration !== null && entry.duration > 0
                    ? entry.duration
                    : hangupEvent?.params?.Duration || 0;
                const durationSec = Number(rawDuration) || 0;

                const overrides = callOverrides[callUuid] || {};
                const effectiveDisp = overrides.disposition || entry.disposition;
                const dispConf = getDispositionConfig(effectiveDisp);
                const custName = overrides.customer_name !== undefined ? overrides.customer_name : (entry.customer_name || entry.contact_name || '');
                const cbTime = overrides.callback_time !== undefined ? overrides.callback_time : (entry.callback_time || '');
                const callWithOverrides = { ...entry, ...overrides, disposition: effectiveDisp, callback_time: cbTime, customer_name: custName };
                const diag = entry.diagnostic || {};
                const am = diag.audio_metrics || entry.audio_metrics || {};
                const inBytes = am.inbound_bytes || 0;
                const outBytes = am.outbound_bytes || 0;
                const hasRecording = Boolean(recUrl || (durationSec > 5 && (inBytes > 0 || outBytes > 0)));

                const isChecked = selectedUuids ? selectedUuids.has(callUuid) : false;
                const isSelected = inspectingCall?.call_uuid === callUuid;

                return (
                  <TableRow
                    key={callUuid}
                    onClick={() => setInspectingCall(callWithOverrides)}
                    className={cn(
                      "cursor-pointer transition-colors hover:bg-muted/40",
                      isChecked && "bg-[#008792]/5",
                      isSelected && "bg-muted/60"
                    )}
                  >
                    {showSelection && (
                      <TableCell className="w-8 px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => onToggleSelect && onToggleSelect(callUuid)}
                          className="w-3.5 h-3.5 rounded border-input text-[#008792] focus:ring-0 cursor-pointer accent-[#008792]"
                        />
                      </TableCell>
                    )}

                    {/* Recipient */}
                    <TableCell className="px-2.5 py-1.5 whitespace-nowrap">
                      <div className="flex items-center gap-1.5 font-mono text-xs">
                        <span className="font-semibold text-foreground">
                          {displayPhone}
                        </span>
                        {custName && (
                          <span className="font-sans text-[10px] font-medium text-[#008792] bg-[#008792]/10 px-1 py-0.2 rounded">
                            {custName}
                          </span>
                        )}
                        <span className="text-[10px] text-muted-foreground font-normal">
                          #{shortUuid}
                        </span>
                      </div>
                    </TableCell>

                    {/* Disposition */}
                    <TableCell className="px-2.5 py-1.5 whitespace-nowrap">
                      <span className={cn(
                        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium border",
                        dispConf.bg, dispConf.text, dispConf.border
                      )}>
                        <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", dispConf.dot)} />
                        {dispConf.label}
                      </span>
                    </TableCell>

                    {/* Duration */}
                    <TableCell className="px-2.5 py-1.5 whitespace-nowrap font-mono text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3 h-3 text-muted-foreground/60" />
                        <span className="text-foreground">{formatDuration(durationSec)}</span>
                        {hasRecording && (
                          <Volume2 className="w-3 h-3 text-[#008792]" title="Audio recording available in drawer" />
                        )}
                      </span>
                    </TableCell>

                    {/* Time & Callback */}
                    <TableCell className="px-2.5 py-1.5 whitespace-nowrap font-mono text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="text-muted-foreground">
                          {formatTime(entry.started || entry.created_at)}
                        </span>
                        {cbTime && (
                          <span className="font-sans font-medium text-emerald-700 bg-emerald-50 px-1 py-0.2 border border-emerald-200 text-[10px] rounded">
                            CB: {cbTime}
                          </span>
                        )}
                      </div>
                    </TableCell>

                    {/* Recording Player & Actions Upfront */}
                    <TableCell className="px-2.5 py-1 whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        {hasRecording ? (
                          <>
                            <Button
                              size="xs"
                              variant={playingUuid === callUuid && isPlaying ? "default" : "outline"}
                              onClick={(e) => handleTogglePlay(e, callUuid)}
                              className={cn(
                                "h-6 px-2 gap-1 text-[11px] font-medium transition-all cursor-pointer",
                                playingUuid === callUuid && isPlaying
                                  ? "bg-[#008792] hover:bg-[#007680] text-white border-transparent"
                                  : "hover:border-[#008792] hover:text-[#008792]"
                              )}
                              title={playingUuid === callUuid && isPlaying ? "Pause Audio" : "Play Recording"}
                            >
                              {playingUuid === callUuid && isPlaying ? (
                                <>
                                  <Pause className="w-3 h-3 fill-current" />
                                  <span className="font-mono text-[10px]">
                                    {Math.floor(audioProgress)}s
                                  </span>
                                </>
                              ) : (
                                <>
                                  <Play className="w-3 h-3 fill-current" />
                                  <span>Play</span>
                                </>
                              )}
                            </Button>

                            <a
                              href={`/api/recording/${encodeURIComponent(callUuid)}`}
                              download={`${callUuid}.wav`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center justify-center h-6 w-6 rounded border border-input bg-background hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                              title="Download Audio WAV"
                            >
                              <Download className="w-3 h-3" />
                            </a>
                          </>
                        ) : (
                          <span className="text-[11px] text-muted-foreground/40 italic pr-1">--</span>
                        )}

                        {/* Quick Edit Disposition & Callback */}
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => openEditModal(callWithOverrides)}
                          className="h-6 w-6 p-0 text-muted-foreground hover:text-[#008792] hover:bg-[#008792]/10 cursor-pointer"
                          title="Edit Disposition & Callback"
                        >
                          <Pencil className="w-3 h-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Slide-out Drawer for Call Details, Audio, Transcript & Carrier Logs */}
      <Drawer
        open={Boolean(inspectingCall)}
        onOpenChange={(open) => {
          if (!open) setInspectingCall(null);
        }}
        swipeDirection="right"
      >
        <DrawerContent className="p-0 border-l border-border bg-background flex flex-col h-full max-h-screen">
          {inspectingCall && (() => {
            const recEv = (inspectingCall.events || []).find((e) => e.kind === 'recording');
            const recUrl = inspectingCall.recording_url || (recEv ? recEv.recording_url || recEv.params?.RecordUrl : '');
            const hEvent = (inspectingCall.events || []).find((e) => e.kind === 'hangup');
            const durSec = Number(
              inspectingCall.duration !== undefined && inspectingCall.duration !== null && inspectingCall.duration > 0
                ? inspectingCall.duration
                : hEvent?.params?.Duration || 0
            ) || 0;
            const targetUuid = inspectingCall.call_uuid || inspectingCall.lead_id || '';
            const overrides = callOverrides[targetUuid] || {};
            const effectiveDisp = overrides.disposition || inspectingCall.disposition;
            const disp = getDispositionConfig(effectiveDisp);
            const diag = inspectingCall.diagnostic || {};
            const diagConf = getDiagnosticConfig(diag.classification);
            const am = diag.audio_metrics || inspectingCall.audio_metrics || {};
            const inB = am.inbound_bytes || 0;
            const outB = am.outbound_bytes || 0;
            const inCh = am.inbound_chunks || 0;
            const hangCause = diag.hangup?.cause || hEvent?.params?.HangupCause || inspectingCall.reason || '';
            const toPhone =
              inspectingCall.phone_number ||
              (inspectingCall.events || []).find((e) => e.to || e.params?.To)?.to ||
              (inspectingCall.events || []).find((e) => e.params?.To)?.params?.To ||
              (inspectingCall.events || []).find((e) => e.params?.From)?.params?.From ||
              '';
            const cbTime = overrides.callback_time !== undefined ? overrides.callback_time : (inspectingCall.callback_time || '');
            const custName = overrides.customer_name !== undefined ? overrides.customer_name : (inspectingCall.customer_name || '');
            const callForEdit = { ...inspectingCall, ...overrides, disposition: effectiveDisp, callback_time: cbTime, customer_name: custName };
            const hasRec = Boolean(recUrl || (durSec > 5 && (inB > 0 || outB > 0)));
            const turns = inspectingCall.turns || [];
            const events = inspectingCall.events || [];

            return (
              <div className="flex flex-col h-full overflow-hidden">
                {/* Drawer Header */}
                <DrawerHeader className="p-4 pb-3 border-b border-border/80 shrink-0">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-[#008792]/10 flex items-center justify-center shrink-0">
                        <Phone className="w-4 h-4 text-[#008792]" />
                      </div>
                      <div className="min-w-0">
                        <DrawerTitle className="font-mono text-sm font-bold text-foreground flex items-center gap-2 truncate">
                          <span>{toPhone || String(targetUuid).slice(0, 14)}</span>
                          {custName && (
                            <Badge variant="secondary" className="text-[11px] font-semibold text-[#008792]">
                              {custName}
                            </Badge>
                          )}
                        </DrawerTitle>
                        <DrawerDescription className="text-[10px] font-mono text-muted-foreground mt-0.5 truncate">
                          UUID: {targetUuid}
                        </DrawerDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => openEditModal(callForEdit)}
                        className="h-6 px-2 gap-1 text-[11px] font-medium text-foreground hover:border-[#008792] hover:text-[#008792] cursor-pointer"
                        title="Edit Disposition & Callback"
                      >
                        <Pencil className="w-3 h-3" />
                        <span>Edit</span>
                      </Button>
                      <Badge variant="outline" className={`gap-1 text-[11px] font-semibold ${disp.bg} ${disp.text} ${disp.border}`}>
                        <span className={`w-1.5 h-1.5 rounded-full inline-block ${disp.dot}`} />
                        {disp.label}
                      </Badge>
                      <DrawerClose asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground cursor-pointer">
                          <X className="w-4 h-4" />
                        </Button>
                      </DrawerClose>
                    </div>
                  </div>

                  {/* Quick Metrics Bar */}
                  <div className="grid grid-cols-3 gap-2 mt-3 pt-2.5 border-t border-border/60 text-[11px]">
                    <div>
                      <span className="text-muted-foreground block text-[10px] uppercase font-semibold">Started</span>
                      <span className="font-mono text-foreground font-medium">{formatTime(inspectingCall.started || inspectingCall.created_at)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[10px] uppercase font-semibold">Duration</span>
                      <span className="font-mono text-foreground font-medium">{formatDuration(durSec)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[10px] uppercase font-semibold">Stream Health</span>
                      {diagConf ? (
                        <span className="font-bold text-[10px] uppercase tracking-wider text-foreground">
                          {diagConf.label}
                        </span>
                      ) : (
                        <span className="text-muted-foreground font-medium">Normal</span>
                      )}
                    </div>
                  </div>

                  {cbTime && (
                    <div className="mt-2.5 pt-2 border-t border-border/60 flex items-center justify-between text-xs bg-blue-50/60 dark:bg-blue-950/20 px-2.5 py-1.5 rounded border border-blue-200/60 dark:border-blue-900/40">
                      <div className="flex items-center gap-1.5 text-blue-700 dark:text-blue-300 font-medium">
                        <Clock className="w-3.5 h-3.5" />
                        <span>Scheduled Callback:</span>
                        <strong className="font-mono">{cbTime}</strong>
                      </div>
                      <button
                        type="button"
                        onClick={() => openEditModal(callForEdit)}
                        className="text-[11px] text-[#008792] hover:underline font-semibold cursor-pointer"
                      >
                        Change
                      </button>
                    </div>
                  )}
                </DrawerHeader>

                {/* Audio Player Bar */}
                <div className="px-4 py-2.5 border-b border-border bg-muted/20 shrink-0">
                  {hasRec ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-foreground flex items-center gap-1.5">
                          <Volume2 className="w-3.5 h-3.5 text-[#008792]" />
                          <span>Call Audio Recording</span>
                        </span>
                        <a
                          href={`/api/recording/${encodeURIComponent(targetUuid)}`}
                          download={`${targetUuid}.wav`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] text-[#008792] hover:underline flex items-center gap-1 font-medium"
                        >
                          <Download className="w-3 h-3" />
                          <span>Download WAV</span>
                        </a>
                      </div>
                      <audio
                        controls
                        preload="auto"
                        className="w-full h-8 outline-none rounded"
                        src={`/api/recording/${encodeURIComponent(targetUuid)}`}
                      />
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground py-0.5">
                      <Volume2 className="w-3.5 h-3.5 text-muted-foreground/60" />
                      <span>No audio recording available for this call session</span>
                    </div>
                  )}
                </div>

                {/* Tab Switcher */}
                <div className="px-4 pt-3 pb-2 shrink-0">
                  <div className="grid grid-cols-2 gap-1 p-1 bg-muted/70 border border-border rounded-lg text-xs font-medium">
                    <button
                      type="button"
                      onClick={() => setActiveDrawerTab('transcript')}
                      className={cn(
                        "flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md transition-all text-xs font-semibold cursor-pointer",
                        activeDrawerTab === 'transcript'
                          ? "bg-background text-foreground shadow-xs border border-border/60"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Bot className="w-3.5 h-3.5 text-[#008792]" />
                      <span>Transcript ({turns.length})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveDrawerTab('logs')}
                      className={cn(
                        "flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md transition-all text-xs font-semibold cursor-pointer",
                        activeDrawerTab === 'logs'
                          ? "bg-background text-foreground shadow-xs border border-border/60"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Activity className="w-3.5 h-3.5 text-[#008792]" />
                      <span>Carrier Logs ({events.length})</span>
                    </button>
                  </div>
                </div>

                {/* Tab Content Body */}
                <div className="flex-1 overflow-y-auto px-4 py-2 space-y-3">
                  {activeDrawerTab === 'transcript' ? (
                    turns.length > 0 ? (
                      <div className="space-y-3 py-1">
                        {turns.map((t, idx) => {
                          const isAgent = t.role === 'agent';
                          return (
                            <div
                              key={idx}
                              className={cn(
                                "flex flex-col gap-1",
                                isAgent ? "items-start" : "items-end"
                              )}
                            >
                              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-semibold uppercase px-1">
                                {isAgent ? (
                                  <>
                                    <Bot className="w-3 h-3 text-[#008792]" />
                                    <span>Ananya (Voice AI)</span>
                                  </>
                                ) : (
                                  <>
                                    <User className="w-3 h-3 text-emerald-600" />
                                    <span>Customer</span>
                                  </>
                                )}
                              </div>
                              <div
                                className={cn(
                                  "max-w-[85%] px-3.5 py-2.5 text-xs leading-relaxed rounded-2xl shadow-xs",
                                  isAgent
                                    ? "bg-[#008792]/10 text-foreground border border-[#008792]/20 rounded-tl-xs"
                                    : "bg-muted text-foreground border border-border rounded-tr-xs"
                                )}
                              >
                                {t.text}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-center py-16 text-muted-foreground">
                        <Bot className="w-8 h-8 mx-auto mb-2 opacity-40 text-muted-foreground" />
                        <p className="text-xs font-semibold text-foreground">No dialog turns recorded</p>
                        <p className="text-[11px] mt-1">This call was either unanswered or terminated before conversational speech.</p>
                      </div>
                    )
                  ) : (
                    <div className="space-y-3 py-1">
                      {/* Session Diagnostics */}
                      <div className="p-3 bg-muted/30 border border-border rounded-lg space-y-2 text-xs">
                        <div className="flex items-center justify-between text-xs font-semibold text-foreground">
                          <span>Session Diagnostics</span>
                          {diagConf && (
                            <Badge variant="outline" className={`text-[10px] font-bold uppercase tracking-wider ${diagConf.bg} ${diagConf.text} ${diagConf.border}`}>
                              {diagConf.label}
                            </Badge>
                          )}
                        </div>
                        <p className="text-[11px] text-foreground font-normal leading-relaxed">
                          {diag.root_cause_summary || 'Normal conversational call flow without carrier anomalies.'}
                        </p>
                        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/60 text-[11px] font-mono text-muted-foreground">
                          <div>
                            <span className="text-foreground font-semibold">Duration:</span> {formatDuration(durSec)}
                          </div>
                          <div>
                            <span className="text-foreground font-semibold">Hangup:</span> {hangCause || 'Normal'}
                          </div>
                          <div>
                            <span className="text-foreground font-semibold">Inbound Audio:</span> {formatBytes(inB)} ({inCh}c)
                          </div>
                          <div>
                            <span className="text-foreground font-semibold">Outbound Audio:</span> {formatBytes(outB)}
                          </div>
                        </div>
                      </div>

                      {/* Carrier Lifecycle Events */}
                      <div className="space-y-2">
                        <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                          Carrier Events ({events.length})
                        </div>
                        {events.length > 0 ? (
                          <div className="relative pl-4 space-y-3 before:absolute before:left-1.5 before:top-1.5 before:bottom-1.5 before:w-0.5 before:bg-border">
                            {events.map((ev, idx) => {
                              const note =
                                ev.details?.telephony_status ||
                                ev.details?.cause ||
                                ev.details?.error ||
                                '';
                              return (
                                <div key={idx} className="relative text-xs">
                                  <span className="absolute -left-[14px] top-1.5 w-2 h-2 rounded-full bg-[#008792] ring-2 ring-background" />
                                  <div className="flex items-baseline justify-between gap-2">
                                    <div className="font-semibold text-foreground">
                                      <span>{ev.event}</span>
                                      {note && (
                                        <span className="text-[11px] font-normal text-muted-foreground ml-2">
                                          ({note})
                                        </span>
                                      )}
                                    </div>
                                    <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                                      {ev.timestamp ? ev.timestamp.slice(11, 23) : '--'}
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground py-6 text-center">
                            No milestone events recorded for this session.
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Drawer Footer */}
                <DrawerFooter className="p-3 border-t border-border bg-muted/20 flex flex-row items-center justify-between shrink-0">
                  <span className="text-[10px] text-muted-foreground font-mono">
                    {inspectingCall.callback_time ? `Callback: ${inspectingCall.callback_time}` : formatTime(inspectingCall.started || inspectingCall.created_at)}
                  </span>
                  <DrawerClose asChild>
                    <Button size="sm" variant="outline" className="h-7 text-xs px-3 cursor-pointer">
                      Close
                    </Button>
                  </DrawerClose>
                </DrawerFooter>
              </div>
            );
          })()}
        </DrawerContent>
      </Drawer>

      {/* Edit Call Disposition & Callback Dialog */}
      <Dialog open={Boolean(editingCall)} onOpenChange={(open) => !open && setEditingCall(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
              <Pencil className="w-4 h-4 text-[#008792]" />
              <span>Edit Call Disposition &amp; Callback</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Update the customer qualification and follow-up callback schedule based on call recording verification.
            </DialogDescription>
          </DialogHeader>

          {editingCall && (
            <div className="space-y-3.5 py-1 text-xs">
              {/* Recipient Details Reference */}
              <div className="p-2.5 bg-muted/40 rounded-md border border-border/60 flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-muted-foreground uppercase font-semibold block">Customer Number</span>
                  <span className="font-mono font-bold text-foreground text-xs">
                    {editingCall.phone_number || editingCall.call_uuid?.slice(0, 12)}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-muted-foreground uppercase font-semibold block">Session Duration</span>
                  <span className="font-mono text-muted-foreground text-xs">
                    {formatDuration(editingCall.duration || 0)}
                  </span>
                </div>
              </div>

              {/* Disposition Dropdown */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground block">
                  Call Disposition <span className="text-red-500">*</span>
                </label>
                <select
                  value={editForm.disposition}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, disposition: e.target.value }))}
                  className="w-full h-8 rounded-md border border-input bg-background px-2.5 text-xs text-foreground outline-none cursor-pointer focus:border-[#008792]"
                >
                  <option value="interested">Interested (Lead Qualified / Plot Inquiry)</option>
                  <option value="not_interested">Not Interested (Declined)</option>
                  <option value="callback">Callback Requested (Needs follow-up)</option>
                  <option value="wrong_number">Wrong Number / Invalid Lead</option>
                  <option value="not_talking">Not Talking / Silent Call</option>
                  <option value="no_answer">No Answer / Did Not Pick Up</option>
                  <option value="busy">Busy Line</option>
                  <option value="dropped">Call Dropped Early</option>
                </select>
              </div>

              {/* Callback Time Input with Quick Presets */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-foreground block">
                    Scheduled Callback Time
                  </label>
                  {editForm.callback_time && (
                    <button
                      type="button"
                      onClick={() => setEditForm((prev) => ({ ...prev, callback_time: '' }))}
                      className="text-[10px] text-muted-foreground hover:text-red-600 underline cursor-pointer"
                    >
                      Clear Callback
                    </button>
                  )}
                </div>
                <Input
                  type="text"
                  placeholder="e.g. Today 5:00 PM, Tomorrow 11:30 AM, or 2026-11-17 14:00"
                  value={editForm.callback_time}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, callback_time: e.target.value }))}
                  className="h-8 text-xs font-mono"
                />
                {/* Quick Presets */}
                <div className="flex flex-wrap items-center gap-1 pt-0.5">
                  <span className="text-[10px] text-muted-foreground mr-1">Presets:</span>
                  {[
                    'Today 5:00 PM',
                    'Tomorrow 10:00 AM',
                    'Tomorrow 2:00 PM',
                    'In 2 Days',
                  ].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setEditForm((prev) => ({ ...prev, callback_time: preset }))}
                      className="text-[10px] px-1.5 py-0.5 rounded border border-border bg-muted/40 hover:bg-muted text-foreground transition-colors cursor-pointer"
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              {/* Customer Name Input */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground block">
                  Customer Name (Optional)
                </label>
                <Input
                  type="text"
                  placeholder="e.g. Ramesh Kumar"
                  value={editForm.customer_name}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, customer_name: e.target.value }))}
                  className="h-8 text-xs"
                />
              </div>

              {saveError && (
                <div className="p-2 rounded bg-rose-50 border border-rose-200 text-rose-700 text-[11px]">
                  {saveError}
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setEditingCall(null)}
              disabled={isSaving}
              className="text-xs h-8 cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSaveCorrections}
              disabled={isSaving}
              className="text-xs h-8 bg-[#008792] hover:bg-[#007680] text-white font-semibold cursor-pointer"
            >
              {isSaving ? 'Saving Corrections...' : 'Save Corrections'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
