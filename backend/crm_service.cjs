// crm_service.cjs — query missed calls / pending callbacks from realestate_db using workflow logic
const path = require('path');
const fs = require('fs');

// Auto-detect realestate server directory across known environments
const CANDIDATE_PATHS = [
  process.env.REALESTATE_SERVER_PATH,
  'C:/KPRO/Nitesh/ai voice/realestate/server',
  'C:/KPRO/Nitesh/ai voice new project/realestate/server',
  'C:/KPRO/Nitesh/realestate4/realestate/server',
  'C:/KPRO/Nitesh/realestate/server',
].filter(Boolean);

let serverPath = null;
for (const p of CANDIDATE_PATHS) {
  if (fs.existsSync(path.join(p, 'features/workflows/missedCalls.workflow.js'))) {
    serverPath = p;
    break;
  }
}

if (!serverPath) {
  console.error(JSON.stringify({ error: 'Could not find realestate server directory' }));
  process.exit(1);
}

const mongoose = require(path.join(serverPath, 'node_modules/mongoose'));
const { getInboundMissedCallsAnalytics } = require(path.join(serverPath, 'features/workflows/missedCalls.workflow.js'));

const MONGO_URI = process.env.REAL_MONGO_URI || process.env.MONGO_URI || 'mongodb://mongo_admin:Realestate123%24@76.13.242.179:27017/realestate_db?authSource=admin';

let isConnected = false;

// Connect to MongoDB realestate_db
async function connect() {
  if (isConnected) return;
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  isConnected = true;
}

// Fetch missed calls / pending callbacks from CRM workflow
async function fetchPendingCalls(startDate, endDate, statusFilter = 'pending') {
  await connect();

  const isAll = statusFilter === 'all';
  const query = {
    limit: 100,
  };

  if (!isAll) {
    query.callbackStatus = 'pending';
    query.callbackStatusFilter = 'pending';
  } else {
    query.callbackStatusFilter = 'all';
  }

  if (startDate && endDate) {
    query.timeRange = 'custom';
    query.startDate = startDate;
    query.endDate = endDate;
  } else if (startDate) {
    query.timeRange = 'custom';
    query.startDate = startDate;
    query.endDate = startDate;
  } else {
    query.timeRange = 'today';
  }

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
    if (batch.length < 100 || allCalls.length >= totalReported || page >= 15) break;
    page++;
  }

  // Format clean results for voice outbound queue
  const calls = allCalls.map(c => {
    const isPending = !c.callback || c.callback.called === false || c.callback.status === 'none' || c.callback.status === 'pending';
    return {
      id: c.id,
      callId: c.callId,
      phone_number: c.customerNumber,
      customer_name: c.customerName !== 'nt' && c.customerName !== 'Unknown' ? (c.customerName || '') : '',
      source: c.source || '',
      dialedDid: c.dialedDid || '',
      campaign: c.campaign || '',
      missedAgents: c.missedAgents || [],
      duration: c.duration || 0,
      circle: c.circle || '',
      operator: c.operator || '',
      createdAt: c.createdAt,
      startStamp: c.startStamp || '',
      status: isPending ? 'pending' : 'called',
    };
  });

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
  const start = args[0] ? args[0].trim() : '';
  const end = args[1] ? args[1].trim() : '';
  const status = args[2] ? args[2].trim() : 'pending';
  fetchPendingCalls(start, end, status).then(data => {
    console.log(JSON.stringify(data));
    process.exit(0);
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { fetchPendingCalls };
