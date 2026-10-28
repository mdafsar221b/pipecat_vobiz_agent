import React, { useState, useEffect, useRef, useCallback } from 'react';
import Header from './components/Header';
import AlertBanner from './components/AlertBanner';
import LiveCallHud from './components/LiveCallHud';
import NextCallCard from './components/NextCallCard';
import CampaignController from './components/CampaignController';
import PendingCallsTab from './components/PendingCallsTab';
import BatchesTab from './components/BatchesTab';
import CompletedLogsTab from './components/CompletedLogsTab';

// Main Swargaseema AI Telephony Console Application
export default function App() {
  const [activeTab, setActiveTab] = useState('pending');
  const [alertMessage, setAlertMessage] = useState('');

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
        alert(
          `Successfully queued ${payload.leads.length} pending calls to the automated outbound dialer.`
        );
      } else {
        setAlertMessage(`Failed to queue leads: ${data.error}`);
      }
    } catch (err) {
      setAlertMessage(`Network error: ${err.message}`);
    }
  };

  const activeCall = campaignData.active_calls?.[0] || null;

  return (
    <div>
      <Header
        isPaused={campaignData.is_paused}
        isRunning={campaignData.is_running}
      />

      <AlertBanner alertMessage={alertMessage} />

      <div className="grid grid-cols-[430px_1fr] max-[1024px]:grid-cols-1 gap-4 items-start">
        {/* Left Column: Live HUD & Campaign Controls */}
        <div>
          <LiveCallHud
            activeCall={activeCall}
            lastCompletedCall={campaignData.last_completed_call}
          />

          <NextCallCard nextCall={campaignData.next_call} />

          <CampaignController
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
        </div>

        {/* Right Column: CRM Leads, Batches & Transcripts */}
        <div>
          <div className="bg-white border border-[#e2e8f0] rounded-[4px] p-[14px] mb-[14px]">
            {/* Tab Navigation */}
            <div className="flex gap-[2px] border-b border-[#e2e8f0] mb-3">
              <button
                onClick={() => {
                  setActiveTab('pending');
                }}
                className={`p-[6px_14px] bg-transparent border-none border-b-2 text-[0.78rem] font-semibold cursor-pointer ${
                  activeTab === 'pending'
                    ? 'text-[#0f172a] border-b-[#2563eb]'
                    : 'text-[#64748b] border-b-transparent hover:text-[#0f172a]'
                }`}
              >
                CRM Missed Calls (Pending Queue)
              </button>
              <button
                onClick={() => {
                  setActiveTab('batches');
                  fetchBatches();
                }}
                className={`p-[6px_14px] bg-transparent border-none border-b-2 text-[0.78rem] font-semibold cursor-pointer ${
                  activeTab === 'batches'
                    ? 'text-[#0f172a] border-b-[#2563eb]'
                    : 'text-[#64748b] border-b-transparent hover:text-[#0f172a]'
                }`}
              >
                Campaign Batches
              </button>
              <button
                onClick={() => {
                  setActiveTab('completed');
                  fetchCompletedLogs();
                }}
                className={`p-[6px_14px] bg-transparent border-none border-b-2 text-[0.78rem] font-semibold cursor-pointer ${
                  activeTab === 'completed'
                    ? 'text-[#0f172a] border-b-[#2563eb]'
                    : 'text-[#64748b] border-b-transparent hover:text-[#0f172a]'
                }`}
              >
                Completed Calls &amp; Transcripts
              </button>
            </div>

            {/* Tab 1: Pending Calls */}
            {activeTab === 'pending' && (
              <PendingCallsTab
                crmCalls={crmCalls}
                isLoadingCrm={isLoadingCrm}
                crmError={crmError}
                onFetchCrmCalls={fetchCrmPendingCalls}
                onQueueLeads={handleQueueLeads}
                onTriggerManualDial={handleTriggerManualDial}
                isDialingManual={isDialingManual}
              />
            )}

            {/* Tab 2: Batches */}
            {activeTab === 'batches' && (
              <BatchesTab
                batches={batches}
                isLoadingBatches={isLoadingBatches}
                onRefreshBatches={fetchBatches}
                onRefreshCampaign={fetchCampaignStatus}
              />
            )}

            {/* Tab 3: Completed Logs */}
            {activeTab === 'completed' && (
              <CompletedLogsTab
                completedCalls={completedCalls}
                isLoadingLogs={isLoadingLogs}
                onRefreshLogs={fetchCompletedLogs}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
