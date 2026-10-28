// crm_service.js — query pending missed calls from realestate_db using workflow logic
const path = require('path');
const mongoose = require('C:/Users/an941/Desktop/KPro Stuffs/D-Pro/realestate/server/node_modules/mongoose');
const { getInboundMissedCallsAnalytics } = require('C:/Users/an941/Desktop/KPro Stuffs/D-Pro/realestate/server/features/workflows/missedCalls.workflow.js');

const MONGO_URI = process.env.REAL_MONGO_URI || 'mongodb://mongo_admin:Realestate123%24@76.13.242.179:27017/realestate_db?authSource=admin';

let isConnected = false;

async function connect() {
  if (isConnected) return;
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 8000 });
  isConnected = true;
}

async function fetchPendingCalls(startDate, endDate) {
  await connect();
  const query = {
    callbackStatus: 'pending',
    callbackStatusFilter: 'pending',
    limit: 100,
  };
  if (startDate) query.startDate = startDate;
  if (endDate) query.endDate = endDate;
  if (!startDate && !endDate) query.timeRange = 'today';

  let allCalls = [];
  let page = 1;
  let totalReported = 0;
  let lastKpis = {};

  // Loop through all pages because CRM workflow clamps limit to 100 per page
  while (true) {
    query.page = page;
    const res = await getInboundMissedCallsAnalytics(null, query);
    lastKpis = res.kpis || lastKpis;
    totalReported = res.pagination?.total || totalReported;
    const batch = res.calls || [];
    if (batch.length === 0) break;
    allCalls.push(...batch);
    if (batch.length < 100 || allCalls.length >= totalReported || page >= 10) break;
    page++;
  }
  
  // Format clean results for voice outbound queue
  const calls = allCalls.map(c => ({
    id: c.id,
    callId: c.callId,
    phone_number: c.customerNumber,
    customer_name: c.customerName !== 'nt' && c.customerName !== 'Unknown' ? c.customerName : '',
    source: c.source,
    dialedDid: c.dialedDid,
    campaign: c.campaign,
    missedAgents: c.missedAgents || [],
    duration: c.duration,
    circle: c.circle,
    operator: c.operator,
    createdAt: c.createdAt,
    status: 'pending',
  }));

  // Deduplicate by 10-digit unique phone number
  const seenNumbers = new Set();
  const uniqueCalls = [];
  for (const c of calls) {
    const rawDigits = String(c.phone_number || '').replace(/\D/g, '').slice(-10);
    if (rawDigits && !seenNumbers.has(rawDigits)) {
      seenNumbers.add(rawDigits);
      uniqueCalls.push(c);
    }
  }

  return {
    kpis: lastKpis,
    calls: calls,
    uniqueCalls: uniqueCalls,
    total: calls.length,
    uniqueTotal: uniqueCalls.length,
    totalReported: totalReported,
  };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const start = args[0] || '2026-10-27';
  const end = args[1] || '2026-10-27';
  fetchPendingCalls(start, end).then(data => {
    console.log(JSON.stringify(data));
    process.exit(0);
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { fetchPendingCalls };
