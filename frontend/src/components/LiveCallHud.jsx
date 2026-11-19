import React, { useRef, useEffect, useState, useMemo } from 'react';
import {
  Radio,
  Clock,
  Bot,
  User,
  PhoneCall,
  Phone,
  Play,
  Pause,
  Activity,
  RefreshCw,
  X,
  Volume2,
} from 'lucide-react';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from './ui/table';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
  DrawerClose,
} from './ui/drawer';
import { cn } from '@/lib/utils';
import { getDispositionConfig, getDiagnosticConfig, formatDuration, formatTime } from '../utils/formatters';

// Live Telephony Workspace Monitor with real-time in-call HUD and shadcn slide-out details drawer
export default function LiveCallHud({
  activeCall,
  activeCalls = [],
  lastCompletedCall,
  completedCalls = [],
  onRefreshLogs,
}) {
  const activeTranscriptRef = useRef(null);
  const audioPlayerRef = useRef(null);
  const [selectedCallUuid, setSelectedCallUuid] = useState(null);
  const [playingUuid, setPlayingUuid] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [inspectingCall, setInspectingCall] = useState(null);
  const [activeDrawerTab, setActiveDrawerTab] = useState('transcript');

  // Multi-channel focus: resolve effective active call from active calls list (filtering out completed calls)
  const effectiveCall = useMemo(() => {
      // Check recent completed calls to prevent ghost running timers
      const completedUuids = new Set(
        (completedCalls || []).map((c) => String(c.call_uuid || '').toLowerCase())
      );

      const liveList = (activeCalls || []).filter((c) => {
        if (!c || c.status === 'completed' || c.status === 'hung_up' || c.disposition) {
          return false;
        }
          if (c.call_uuid && completedUuids.has(String(c.call_uuid).toLowerCase())) {
            return false;
          }
      return true;
    });

  if (liveList.length > 0) {
    if (selectedCallUuid) {
      const found = liveList.find((c) => c.call_uuid === selectedCallUuid);
      if (found) return found;
    }
    return liveList[0];
  }

  if (
    activeCall &&
    activeCall.status !== 'completed' &&
    activeCall.status !== 'hung_up' &&
    !activeCall.disposition &&
    (!activeCall.call_uuid || !completedUuids.has(String(activeCall.call_uuid).toLowerCase()))
  ) {
    return activeCall;
  }
  return null;
}, [activeCalls, selectedCallUuid, activeCall, completedCalls]);

// Auto-scroll active call transcript container
useEffect(() => {
  if (activeTranscriptRef.current) {
    activeTranscriptRef.current.scrollTop = activeTranscriptRef.current.scrollHeight;
  }
}, [effectiveCall?.turns]);

// Audio Play / Pause handler
const handleTogglePlay = (e, callUuid) => {
  e.stopPropagation();
  if (!audioPlayerRef.current) return;

  if (playingUuid === callUuid) {
    if (isPlaying) {
      audioPlayerRef.current.pause();
      setIsPlaying(false);
    } else {
      audioPlayerRef.current
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => { });
    }
  } else {
    setPlayingUuid(callUuid);
    audioPlayerRef.current.src = `/api/recording/${encodeURIComponent(callUuid)}`;
    audioPlayerRef.current.currentTime = 0;
    audioPlayerRef.current
      .play()
      .then(() => setIsPlaying(true))
      .catch(() => setIsPlaying(false));
  }
};

// Active call formatting
const isDialing = effectiveCall?.status === 'dialing';
const activeElapsed = effectiveCall?.elapsed_sec || 0;
const activeMins = String(Math.floor(activeElapsed / 60)).padStart(2, '0');
const activeSecs = String(Math.round(activeElapsed % 60)).padStart(2, '0');
const activeTimerStr = `${activeMins}:${activeSecs}`;

// Recent calls (top 20 calls from session)
const recentCalls = useMemo(() => {
  return (completedCalls || []).slice(0, 20);
}, [completedCalls]);

return (
  <div className="flex flex-col h-full min-h-0 bg-background divide-y divide-border">
    {/* Hidden global audio element */}
    <audio
      ref={audioPlayerRef}
      onEnded={() => setIsPlaying(false)}
      onPause={() => setIsPlaying(false)}
      onPlay={() => setIsPlaying(true)}
      className="hidden"
    />

    {/* UPPER SECTION: Live Active Call Stream HUD (or compact Last Call summary) */}
    {effectiveCall ? (
      <div className="flex flex-col shrink-0 bg-card border-b border-border overflow-hidden">
        {/* Active Call Header */}
        <div className="px-4 py-2 border-b border-border flex items-center justify-between shrink-0 bg-muted/20">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase border',
                isDialing
                  ? 'bg-amber-50 text-amber-700 border-amber-300'
                  : 'bg-[#008792]/10 text-[#008792] border-[#008792]/20'
              )}
            >
              <span
                className={cn(
                  'w-1.5 h-1.5 rounded-full',
                  isDialing ? 'bg-amber-500 animate-ping' : 'bg-[#008792] animate-pulse'
                )}
              />
              <span>{isDialing ? 'DIALING CARRIER' : 'VOICE STREAM ACTIVE'}</span>
            </span>

            {/* Animated Audio Waveform */}
            {!isDialing && (
              <div className="flex items-center gap-0.5 h-4 px-1.5 bg-[#008792]/10 border border-[#008792]/20 rounded">
                <span className="w-0.5 h-3 bg-[#008792] animate-pulse" />
                <span className="w-0.5 h-4 bg-[#008792] animate-ping" />
                <span className="w-0.5 h-2.5 bg-[#008792] animate-pulse" />
                <span className="w-0.5 h-3.5 bg-[#008792] animate-ping" />
                <span className="w-0.5 h-2 bg-[#008792] animate-pulse" />
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-muted-foreground hidden sm:inline">
              Agent: Ananya {effectiveCall.created_by ? `(${effectiveCall.created_by})` : ''}
            </span>
            <div className="flex items-center gap-1 font-mono text-xs font-bold px-2 py-0.5 bg-slate-900 text-white rounded">
              <Clock className="w-3 h-3 text-[#008792]" />
              <span>{activeTimerStr}</span>
            </div>
          </div>
        </div>

        {/* Active Recipient Details */}
        <div className="px-4 py-1.5 border-b border-border flex items-center justify-between shrink-0 bg-muted/40">
          <div className="flex items-center gap-2 truncate">
            <span className="font-mono text-sm font-bold text-foreground">
              {effectiveCall.phone_number}
            </span>
            {effectiveCall.customer_name && (
              <Badge variant="secondary" className="text-[10px] font-semibold text-[#008792]">
                {effectiveCall.customer_name}
              </Badge>
            )}
            {effectiveCall.call_uuid && (
              <span className="text-[10px] font-mono text-muted-foreground hidden sm:inline">
                #{String(effectiveCall.call_uuid).slice(0, 8)}
              </span>
            )}
            {effectiveCall.created_by && (
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-purple-500/10 text-purple-600 font-medium">
                By {effectiveCall.created_by}
              </span>
            )}
          </div>

          <div className="text-[10px] font-mono text-muted-foreground">
            Carrier &bull; SIP Voice Line
          </div>
        </div>

        {/* Live Speech Turns Stream */}
        <div
          ref={activeTranscriptRef}
          className="overflow-y-auto max-h-[180px] p-3 space-y-2 bg-muted/10 text-xs"
        >
          {isDialing ? (
            <div className="flex flex-col items-center justify-center text-center text-amber-700 py-3">
              <Radio className="w-5 h-5 mb-1 text-amber-500 animate-pulse" />
              <span className="font-semibold text-xs">Ringing recipient handset...</span>
              <span className="text-[10px] text-muted-foreground mt-0.5">
                Awaiting carrier answer signal to begin voice stream
              </span>
            </div>
          ) : effectiveCall.turns && effectiveCall.turns.length > 0 ? (
            effectiveCall.turns.map((t, idx) => {
              const isAgent = t.role === 'agent';
              return (
                <div
                  key={idx}
                  className={cn('flex flex-col', isAgent ? 'items-start' : 'items-end')}
                >
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-0.5 px-0.5 font-semibold uppercase tracking-wider">
                    {isAgent ? (
                      <span className="inline-flex items-center gap-1 text-[#008792]">
                        <Bot className="w-3 h-3" />
                        <span>Ananya (AI)</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-slate-700">
                        <User className="w-3 h-3" />
                        <span>Customer</span>
                      </span>
                    )}
                  </div>
                  <div
                    className={cn(
                      'max-w-[85%] p-2 rounded text-xs leading-relaxed border',
                      isAgent
                        ? 'bg-card text-foreground border-border shadow-2xs'
                        : 'bg-[#008792]/10 text-teal-950 border-[#008792]/20 shadow-2xs'
                    )}
                  >
                    {t.text || t.content || t.message}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="text-center py-2 text-muted-foreground text-xs">
              Audio pipeline connected. Waiting for recipient speech...
            </div>
          )}
        </div>
      </div>
    ) : lastCompletedCall ? (
      // Slim Last Call Session Summary
      (() => {
        const lc = lastCompletedCall;
        const lcDisp = getDispositionConfig(lc.disposition);
        const lcDiag = lc.diagnostic?.root_cause_summary;
        const lcDur = lc.duration || 0;
        return (
          <div className="px-4 py-2 bg-card border-b border-border flex items-center justify-between shrink-0 gap-3">
            <div className="flex items-center gap-2 truncate">
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground shrink-0" />
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider shrink-0">
                Last Call:
              </span>
              <span className="font-mono text-xs font-bold text-foreground shrink-0">
                {lc.phone_number || 'Completed Call'}
              </span>
              <Badge
                variant="outline"
                className={cn(
                  'text-[10px] font-semibold px-1.5 py-0.2 gap-1 shrink-0',
                  lcDisp.bg,
                  lcDisp.text,
                  lcDisp.border
                )}
              >
                <span className={cn('w-1.5 h-1.5 rounded-full', lcDisp.dot)} />
                {lcDisp.label}
              </Badge>
              <span className="font-mono text-[11px] text-muted-foreground shrink-0">
                ({formatDuration(lcDur)})
              </span>
              {lcDiag && (
                <span className="text-[11px] text-muted-foreground truncate hidden md:inline">
                  &bull; {lcDiag}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {lcDur > 0 && lc.call_uuid && (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={(e) => handleTogglePlay(e, lc.call_uuid)}
                  className={cn(
                    'h-6 px-2 text-[11px] gap-1 font-semibold cursor-pointer',
                    playingUuid === lc.call_uuid && isPlaying
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                      : 'text-foreground hover:border-[#008792] hover:text-[#008792]'
                  )}
                >
                  {playingUuid === lc.call_uuid && isPlaying ? (
                    <>
                      <Pause className="w-3 h-3 fill-current" />
                      <span>Pause</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3 h-3 fill-current" />
                      <span>Play Audio</span>
                    </>
                  )}
                </Button>
              )}
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setInspectingCall(lc)}
                className="h-6 px-2 text-[11px] text-[#008792] hover:underline cursor-pointer"
              >
                Details &rarr;
              </Button>
            </div>
          </div>
        );
      })()
    ) : null}

    {/* LOWER SECTION: Full-Width Session Call Activity Stream */}
    <div className="flex-1 min-h-0 flex flex-col bg-card overflow-hidden">
      {/* Stream Table Header */}
      <div className="px-4 py-2 border-b border-border flex items-center justify-between shrink-0 bg-muted/20">
        <div className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-[#008792]" />
          <span className="text-xs font-bold text-foreground tracking-tight">
            Session Call Activity Stream
          </span>
          <span className="text-[10px] font-mono text-muted-foreground">
            ({recentCalls.length} calls)
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground hidden sm:inline">
            Click any row to open slide-out drawer
          </span>
          {onRefreshLogs && (
            <Button
              size="xs"
              variant="ghost"
              onClick={onRefreshLogs}
              className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
              title="Refresh session logs"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Refresh</span>
            </Button>
          )}
        </div>
      </div>

      {/* Dense Calls Table */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40 border-b border-border">
              <TableHead className="px-3 py-1.5 text-xs font-semibold text-foreground whitespace-nowrap">
                Recipient
              </TableHead>
              <TableHead className="px-3 py-1.5 text-xs font-semibold text-foreground whitespace-nowrap">
                Disposition
              </TableHead>
              <TableHead className="px-3 py-1.5 text-xs font-semibold text-foreground whitespace-nowrap">
                Duration
              </TableHead>
              <TableHead className="px-3 py-1.5 text-xs font-semibold text-foreground whitespace-nowrap">
                Time
              </TableHead>
              <TableHead className="px-3 py-1.5 text-xs font-semibold text-foreground whitespace-nowrap text-right pr-4">
                Recording
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recentCalls.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-12 text-xs text-muted-foreground">
                  <PhoneCall className="w-7 h-7 text-[#008792] animate-pulse mx-auto mb-2 opacity-50" />
                  <p className="font-semibold text-foreground">Waiting for dialing activity...</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Completed calls will appear here in real time as the dialer reaches leads.
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              recentCalls.map((c, idx) => {
                const callUuid = c.call_uuid || c.lead_id || `call-${idx}`;
                const cDisp = getDispositionConfig(c.disposition);
                const dur = c.duration || 0;
                const hasAudio = dur > 0 || c.recording_url;

                return (
                  <TableRow
                    key={callUuid}
                    onClick={() => setInspectingCall(c)}
                    className="cursor-pointer hover:bg-muted/50 transition-colors border-b border-border/60 text-xs group"
                  >
                    {/* Recipient */}
                    <TableCell className="px-3 py-1.5 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-medium text-foreground group-hover:text-[#008792] transition-colors">
                          {c.phone_number || String(callUuid).slice(0, 12)}
                        </span>
                        {c.customer_name && (
                          <Badge
                            variant="secondary"
                            className="text-[10px] font-semibold text-[#008792]"
                          >
                            {c.customer_name}
                          </Badge>
                        )}
                      </div>
                    </TableCell>

                    {/* Disposition */}
                    <TableCell className="px-3 py-1.5 whitespace-nowrap">
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-[10px] font-semibold px-2 py-0.2 gap-1',
                          cDisp.bg,
                          cDisp.text,
                          cDisp.border
                        )}
                      >
                        <span className={cn('w-1.5 h-1.5 rounded-full', cDisp.dot)} />
                        {cDisp.label}
                      </Badge>
                    </TableCell>

                    {/* Duration */}
                    <TableCell className="px-3 py-1.5 whitespace-nowrap font-mono text-muted-foreground text-xs">
                      {formatDuration(dur)}
                    </TableCell>

                    {/* Time */}
                    <TableCell className="px-3 py-1.5 whitespace-nowrap font-mono text-muted-foreground text-xs">
                      {formatTime(c.started || c.created_at)}
                    </TableCell>

                    {/* Recording Audio Button */}
                    <TableCell
                      className="px-3 py-1.5 whitespace-nowrap text-right pr-4"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {hasAudio ? (
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={(e) => handleTogglePlay(e, callUuid)}
                          className={cn(
                            'h-5 px-2 text-[10px] gap-1 font-semibold cursor-pointer',
                            playingUuid === callUuid && isPlaying
                              ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                              : 'text-foreground hover:border-[#008792] hover:text-[#008792]'
                          )}
                        >
                          {playingUuid === callUuid && isPlaying ? (
                            <>
                              <Pause className="w-2.5 h-2.5 fill-current" />
                              <span>Pause</span>
                            </>
                          ) : (
                            <>
                              <Play className="w-2.5 h-2.5 fill-current" />
                              <span>Play</span>
                            </>
                          )}
                        </Button>
                      ) : (
                        <span className="text-muted-foreground font-mono text-[10px]">--</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>

    {/* Slide-out shadcn Drawer for Call Inspection (identical to Tables drawer) */}
    <Drawer
      open={Boolean(inspectingCall)}
      onOpenChange={(open) => {
        if (!open) setInspectingCall(null);
      }}
      swipeDirection="right"
    >
      <DrawerContent className="p-0 border-l border-border bg-background flex flex-col h-full max-h-screen sm:max-w-md w-full">
        {inspectingCall && (() => {
          const disp = getDispositionConfig(inspectingCall.disposition);
          const diag = inspectingCall.diagnostic || {};
          const diagConf = getDiagnosticConfig(diag.classification);
          const dur = inspectingCall.duration || 0;
          const turns = inspectingCall.turns || inspectingCall.transcripts || [];
          const hasAudio = dur > 0 || inspectingCall.recording_url;

          return (
            <div className="flex flex-col h-full overflow-hidden">
              {/* Drawer Header */}
              <DrawerHeader className="p-4 pb-3 border-b border-border shrink-0">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-[#008792]/10 flex items-center justify-center shrink-0">
                      <Phone className="w-4 h-4 text-[#008792]" />
                    </div>
                    <div className="min-w-0">
                      <DrawerTitle className="font-mono text-sm font-bold text-foreground flex items-center gap-2 truncate">
                        <span>{inspectingCall.phone_number || 'Unknown'}</span>
                        {inspectingCall.customer_name && (
                          <Badge variant="secondary" className="text-[11px] font-semibold text-[#008792]">
                            {inspectingCall.customer_name}
                          </Badge>
                        )}
                      </DrawerTitle>
                      <DrawerDescription className="text-[10px] font-mono text-muted-foreground mt-0.5 truncate">
                        UUID: {inspectingCall.call_uuid || inspectingCall.lead_id}
                      </DrawerDescription>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant="outline" className={`gap-1 text-[11px] font-semibold ${disp.bg} ${disp.text} ${disp.border}`}>
                      <span className={`w-1.5 h-1.5 rounded-full inline-block ${disp.dot}`} />
                      {disp.label}
                    </Badge>
                    <DrawerClose asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7 cursor-pointer text-muted-foreground hover:text-foreground">
                        <X className="w-4 h-4" />
                      </Button>
                    </DrawerClose>
                  </div>
                </div>

                {/* Metrics Bar */}
                <div className="grid grid-cols-3 gap-2 mt-3 pt-2.5 border-t border-border text-[11px]">
                  <div>
                    <span className="text-muted-foreground block text-[10px] uppercase font-semibold">Started</span>
                    <span className="font-mono text-foreground font-medium">{formatTime(inspectingCall.started || inspectingCall.created_at)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[10px] uppercase font-semibold">Duration</span>
                    <span className="font-mono text-foreground font-medium">{formatDuration(dur)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[10px] uppercase font-semibold">Stream Health</span>
                    <span className="font-bold text-[10px] uppercase tracking-wider text-foreground">
                      {diagConf ? diagConf.label : 'NORMAL'}
                    </span>
                  </div>
                </div>
              </DrawerHeader>

              {/* Audio Player Bar */}
              {hasAudio && inspectingCall.call_uuid && (
                <div className="px-4 py-2 border-b border-border bg-muted/20 shrink-0 flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-foreground flex items-center gap-1.5">
                    <Volume2 className="w-3.5 h-3.5 text-[#008792]" />
                    <span>Audio Recording</span>
                  </span>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={(e) => handleTogglePlay(e, inspectingCall.call_uuid)}
                    className={cn(
                      'h-6 px-2 text-[11px] gap-1 font-semibold cursor-pointer',
                      playingUuid === inspectingCall.call_uuid && isPlaying
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                        : 'text-foreground hover:border-[#008792] hover:text-[#008792]'
                    )}
                  >
                    {playingUuid === inspectingCall.call_uuid && isPlaying ? (
                      <>
                        <Pause className="w-3 h-3 fill-current" />
                        <span>Pause Audio</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-3 h-3 fill-current" />
                        <span>Play Audio</span>
                      </>
                    )}
                  </Button>
                </div>
              )}

              {/* Drawer Tabs Header */}
              <div className="px-4 pt-2 border-b border-border bg-muted/10 shrink-0">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setActiveDrawerTab('transcript')}
                    className={cn(
                      'px-3 py-1.5 text-xs font-semibold border-b-2 transition-colors cursor-pointer',
                      activeDrawerTab === 'transcript'
                        ? 'border-[#008792] text-[#008792]'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    )}
                  >
                    Conversation Transcript ({turns.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveDrawerTab('diag')}
                    className={cn(
                      'px-3 py-1.5 text-xs font-semibold border-b-2 transition-colors cursor-pointer',
                      activeDrawerTab === 'diag'
                        ? 'border-[#008792] text-[#008792]'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    )}
                  >
                    Diagnostic &amp; Telemetry
                  </button>
                </div>
              </div>

              {/* Drawer Tab Content */}
              <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2.5">
                {activeDrawerTab === 'transcript' ? (
                  turns.length > 0 ? (
                    turns.map((t, idx) => {
                      const isAgent = t.role === 'agent';
                      return (
                        <div
                          key={idx}
                          className={cn('flex flex-col', isAgent ? 'items-start' : 'items-end')}
                        >
                          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide px-0.5 mb-0.5">
                            {isAgent ? 'Ananya (AI)' : 'Customer'}
                          </span>
                          <div
                            className={cn(
                              'max-w-[85%] p-2.5 rounded text-xs leading-relaxed border',
                              isAgent
                                ? 'bg-card text-foreground border-border shadow-2xs'
                                : 'bg-[#008792]/10 text-teal-950 border-[#008792]/20 shadow-2xs'
                            )}
                          >
                            {t.text || t.content || t.message}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-xs text-muted-foreground text-center py-8">
                      No dialog turns captured for this session.
                    </p>
                  )
                ) : (
                  <div className="space-y-3 text-xs">
                    {diag.root_cause_summary && (
                      <div className="p-3 bg-muted/40 rounded border border-border">
                        <strong className="text-[#008792] block text-[11px] uppercase font-bold mb-1">Root Cause Summary</strong>
                        <p className="text-foreground">{diag.root_cause_summary}</p>
                      </div>
                    )}
                    <div className="p-3 bg-muted/40 rounded border border-border space-y-1.5 font-mono text-[11px]">
                      <div><strong className="text-muted-foreground">Classification:</strong> {diag.classification || 'NORMAL'}</div>
                      <div><strong className="text-muted-foreground">Duration:</strong> {formatDuration(dur)}</div>
                      <div><strong className="text-muted-foreground">Hangup Cause:</strong> {diag.hangup?.cause || inspectingCall.reason || 'NORMAL_CLEARING'}</div>
                    </div>
                  </div>
                )}
              </div>

              {/* Drawer Footer */}
              <DrawerFooter className="p-3 border-t border-border bg-muted/20 flex flex-row items-center justify-between shrink-0">
                <span className="text-[10px] text-muted-foreground font-mono">
                  {formatTime(inspectingCall.started || inspectingCall.created_at)}
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
  </div>
);
}
