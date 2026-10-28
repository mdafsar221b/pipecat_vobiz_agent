import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Menu, X } from 'lucide-react';
import Sidebar from './components/Sidebar';
import AlertBanner from './components/AlertBanner';
import LiveConsoleView from './components/LiveConsoleView';
import PendingCallsTab from './components/PendingCallsTab';
import BatchesTab from './components/BatchesTab';
import CompletedLogsTab from './components/CompletedLogsTab';

// Main Swargaseema AI Telephony Console Application with full-width Left Sidebar Layout
export default function App() {
  const [activeNav, setActiveNav] = useState('live');
  const [alertMessage, setAlertMessage] = useState('');
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  // Campaign & Live HUD State
  const [campaignData, setCampaignData] = useState({
    is_running: false,
    is_paused: false,
    stats: {},
    active_calls: [],
    next_call: null,
    last_completed_call: null,
  });

  const [manualPhone, setManualPhone] = useState('+917007173798');
  const [manualDialStatus, setManualDialStatus] = useState('');
  const [manualDialFeedback, setManualDialFeedback] = useState('');
  const [isDialingManual, setIsDialingManual] = useState(false);

  // Tabs Data State
  const [crmCalls, setCrmCalls] = useState([]);
  const [isLoadingCrm, setIsLoadingCrm] = useState(false);
  const [crmError, setCrmError] = useState('');

  const [batches, setBatches] = useState([]);
  const [isLoadingBatches, setIsLoadingBatches] = useState(false);

  const [completedCalls, setCompletedCalls] = useState([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);

  const wasCallActiveRef = useRef(false);

  // Fetch Completed Call Logs
  const fetchCompletedLogs = useCallback(async () => {
    setIsLoadingLogs(true);
    try {
      const res = await fetch('/calls?limit=50');
      if (!res.ok) return;
      const list = await res.json();
      setCompletedCalls(list || []);
    } catch (err) {
      setAlertMessage(`Failed to load call logs: ${err.message}`);
    } finally {
      setIsLoadingLogs(false);
    }
  }, []);

  // Poll Campaign Status
  const fetchCampaignStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/campaign/status');
      if (!res.ok) return;
      const data = await res.json();
      setCampaignData(data);

      if (data.error_message) {
        setAlertMessage(data.error_message);
      }

      const hasActive = data.active_calls && data.active_calls.length > 0;
      if (hasActive) {
        wasCallActiveRef.current = true;
        const ac = data.active_calls[0];
        setManualDialStatus(ac.status === 'dialing' ? 'DIALING' : 'IN CALL');
        setManualDialFeedback(
          ac.status === 'dialing'
            ? `Dialing ${ac.phone_number}... Awaiting customer pickup`
            : `Connected with ${ac.phone_number}. AI agent Ananya is in conversation.`
        );
      } else {
        setIsDialingManual(false);
        if (wasCallActiveRef.current) {
          wasCallActiveRef.current = false;
          fetchCompletedLogs();
        }

        if (data.last_completed_call) {
          const lc = data.last_completed_call;
          const disp = (lc.disposition || 'COMPLETED').toUpperCase();
          if (Date.now() / 1000 - lc.ended_at < 12) {
            setManualDialStatus(disp);
            setManualDialFeedback(
              `Call finished (${lc.duration}s). ${
                lc.diagnostic?.root_cause_summary || `Disposition: ${lc.disposition}`
              }`
            );
          }
        }
      }
    } catch {
      // Background poll failure caught cleanly
    }
  }, [fetchCompletedLogs]);

  // Fetch CRM Pending Calls
  const fetchCrmPendingCalls = useCallback(async (startDate, endDate) => {
    const today = new Date().toISOString().slice(0, 10);
    const start = startDate || today;
    const end = endDate || today;

    setIsLoadingCrm(true);
    setCrmError('');
    try {
      const res = await fetch(`/api/crm/pending-calls?start_date=${start}&end_date=${end}`);
      const data = await res.json();
      if (!res.ok || !data.ok) {
        const err = data.error || 'Failed to query CRM';
        setCrmError(err);
        setAlertMessage(`CRM Fetch Error: ${err}`);
        return;
      }
      setAlertMessage('');
      setCrmCalls(data.calls || []);
    } catch (err) {
      setCrmError(err.message);
      setAlertMessage(`Network error connecting to CRM: ${err.message}`);
    } finally {
      setIsLoadingCrm(false);
    }
  }, []);

  // Fetch Batches
  const fetchBatches = useCallback(async () => {
    setIsLoadingBatches(true);
    try {
      const res = await fetch('/api/campaign/batches');
      if (!res.ok) return;
      const data = await res.json();
      setBatches(data.batches || []);
    } catch (err) {
      setAlertMessage(`Failed to load batches: ${err.message}`);
    } finally {
      setIsLoadingBatches(false);
    }
  }, []);

  // Initial Load and 1s Interval
  useEffect(() => {
    fetchCrmPendingCalls();
    fetchCampaignStatus();
    fetchCompletedLogs();
    fetchBatches();

    const timer = setInterval(fetchCampaignStatus, 1000);
    return () => clearInterval(timer);
  }, [fetchCampaignStatus, fetchCrmPendingCalls, fetchCompletedLogs, fetchBatches]);

  // Campaign Actions
  const handleStartCampaign = async () => {
    try {
      const res = await fetch('/api/campaign/start', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        fetchCampaignStatus();
      }
    } catch (err) {
      setAlertMessage(err.message);
    }
  };

  const handlePauseCampaign = async () => {
    try {
      await fetch('/api/campaign/pause', { method: 'POST' });
      fetchCampaignStatus();
    } catch (err) {
      setAlertMessage(err.message);
    }
  };

  const handleResumeCampaign = async () => {
    try {
      await fetch('/api/campaign/resume', { method: 'POST' });
      fetchCampaignStatus();
    } catch (err) {
      setAlertMessage(err.message);
    }
  };

  const handleStopCampaign = async () => {
    try {
      await fetch('/api/campaign/stop', { method: 'POST' });
      fetchCampaignStatus();
    } catch (err) {
      setAlertMessage(err.message);
    }
  };

  const handleResetQueue = async () => {
    if (!window.confirm('Clear active queue and reset counters to start a fresh batch?')) return;
    try {
      const res = await fetch('/api/campaign/reset', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        await fetchCampaignStatus();
        await fetchBatches();
      }
    } catch (err) {
      setAlertMessage(`Failed to reset queue: ${err.message}`);
    }
  };

  const handleRetryFailed = async () => {
    try {
      await fetch('/api/campaign/reset', { method: 'POST' });
      fetchCampaignStatus();
    } catch (err) {
      setAlertMessage(err.message);
    }
  };

  const handleTriggerManualDial = async (phone, contactName = '') => {
    if (!phone) return;
    setIsDialingManual(true);
    setManualPhone(phone);
    setManualDialStatus('DIALING');
    setManualDialFeedback(`Call dispatched to ${phone}. Waiting for answer...`);
    setActiveNav('live');

    try {
      const res = await fetch('/api/dial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: phone, contact_name: contactName }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        const errMsg = data.error
          ? typeof data.error === 'object'
            ? JSON.stringify(data.error)
            : data.error
          : 'Dial failed';
        setAlertMessage(errMsg);
        setManualDialFeedback(`Error: ${errMsg}`);
        setManualDialStatus('FAILED');
        setIsDialingManual(false);
      } else {
        setAlertMessage('');
        fetchCampaignStatus();
      }
    } catch (err) {
      setAlertMessage(err.message);
      setManualDialFeedback(`Network error: ${err.message}`);
      setManualDialStatus('FAILED');
      setIsDialingManual(false);
    }
  };

  const handleQueueLeads = async (payload) => {
    try {
      const res = await fetch('/api/campaign/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.ok) {
        setAlertMessage('');
        fetchCampaignStatus();
        fetchBatches();
        setActiveNav('live');
      } else {
        setAlertMessage(`Failed to queue leads: ${data.error}`);
      }
    } catch (err) {
      setAlertMessage(`Network error: ${err.message}`);
    }
  };

  const activeCall = campaignData.active_calls?.[0] || null;

  return (
    <div className="min-h-screen bg-[#fafafa] font-sans text-slate-900 antialiased flex flex-col md:flex-row">
      {/* Mobile Header Bar */}
      <div className="md:hidden bg-[#0a0a0a] text-white p-4 flex items-center justify-between border-b border-neutral-800">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-[#008792] flex items-center justify-center font-bold text-white text-xs">
            S
          </div>
          <span className="font-bold text-sm tracking-tight">Swargaseema Voice AI</span>
        </div>
        <button
          onClick={() => setIsMobileSidebarOpen((v) => !v)}
          className="p-1 rounded text-neutral-400 hover:text-white"
        >
          {isMobileSidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Sidebar (Desktop fixed + Mobile drawer) */}
      <div className={`${isMobileSidebarOpen ? 'block' : 'hidden'} md:block fixed md:static inset-y-0 left-0 z-40`}>
        <Sidebar
          activeNav={activeNav}
          setActiveNav={(nav) => {
            setActiveNav(nav);
            setIsMobileSidebarOpen(false);
          }}
          campaignData={campaignData}
          crmCount={crmCalls.length}
          batchesCount={batches.length}
          completedCount={completedCalls.length}
        />
      </div>

      {/* Main Content Workspace */}
      <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 max-w-[1720px] mx-auto w-full overflow-y-auto">
        <AlertBanner alertMessage={alertMessage} />

        {/* View 1: Live Monitor & Campaign Dialer */}
        {activeNav === 'live' && (
          <LiveConsoleView
            activeCall={activeCall}
            lastCompletedCall={campaignData.last_completed_call}
            nextCall={campaignData.next_call}
            stats={campaignData.stats}
            isRunning={campaignData.is_running}
            isPaused={campaignData.is_paused}
            activeCalls={campaignData.active_calls || []}
            onStartCampaign={handleStartCampaign}
            onPauseCampaign={handlePauseCampaign}
            onResumeCampaign={handleResumeCampaign}
            onStopCampaign={handleStopCampaign}
            onResetQueue={handleResetQueue}
            onRetryFailed={handleRetryFailed}
            onTriggerManualDial={handleTriggerManualDial}
            manualDialStatus={manualDialStatus}
            manualDialFeedback={manualDialFeedback}
            manualPhone={manualPhone}
            setManualPhone={setManualPhone}
            isDialingManual={isDialingManual}
            onRefreshCampaign={fetchCampaignStatus}
            onRefreshBatches={fetchBatches}
          />
        )}

        {/* View 2: CRM Missed Calls */}
        {activeNav === 'pending' && (
          <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
            <div className="mb-4">
              <h2 className="text-base font-bold text-slate-900 tracking-tight">
                CRM Missed Calls (Pending Queue)
              </h2>
              <p className="text-xs text-slate-500">
                Filter and queue inbound missed calls from the real estate CRM into outbound campaigns
              </p>
            </div>
            <PendingCallsTab
              crmCalls={crmCalls}
              isLoadingCrm={isLoadingCrm}
              crmError={crmError}
              onFetchCrmCalls={fetchCrmPendingCalls}
              onQueueLeads={handleQueueLeads}
              onTriggerManualDial={handleTriggerManualDial}
              isDialingManual={isDialingManual}
            />
          </div>
        )}

        {/* View 3: Campaign Batches */}
        {activeNav === 'batches' && (
          <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
            <BatchesTab
              batches={batches}
              isLoadingBatches={isLoadingBatches}
              onRefreshBatches={fetchBatches}
              onRefreshCampaign={fetchCampaignStatus}
            />
          </div>
        )}

        {/* View 4: Completed Call Logs & Transcripts */}
        {activeNav === 'completed' && (
          <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
            <CompletedLogsTab
              completedCalls={completedCalls}
              isLoadingLogs={isLoadingLogs}
              onRefreshLogs={fetchCompletedLogs}
            />
          </div>
        )}
      </main>
    </div>
  );
}
