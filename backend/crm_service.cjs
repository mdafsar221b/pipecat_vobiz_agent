// crm_service.cjs — query missed calls / pending callbacks using workflow logic
const path = require('path');
const fs = require('fs');

// Load environment variables from .env if not already loaded
const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  try {
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const idx = trimmed.indexOf('=');
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        if (!process.env[key]) {
          process.env[key] = val.replace(/^["']|["']$/g, '');
        }
      }
    }
  } catch {
    // Ignore .env read error
  }
}

// Auto-detect realestate server directory across known environments if available
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

const MONGO_URI = process.env.REAL_MONGO_URI || process.env.MONGO_URI;

let isConnected = false;
let mongoose = null;
let getInboundMissedCallsAnalytics = null;

if (serverPath) {
  try {
    mongoose = require(path.join(serverPath, 'node_modules/mongoose'));
    getInboundMissedCallsAnalytics = require(path.join(serverPath, 'features/workflows/missedCalls.workflow.js')).getInboundMissedCallsAnalytics;
  } catch (loadErr) {
    // Workflow or mongoose not loaded
  }
}

// Connect to MongoDB
async function connect() {
  if (isConnected || !mongoose || !MONGO_URI) return;
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 8000 });
  isConnected = true;
}

// Fetch missed calls / pending callbacks from CRM workflow
async function fetchPendingCalls(startDate, endDate, statusFilter = 'pending') {
  if (!serverPath || !mongoose || !getInboundMissedCallsAnalytics || !MONGO_URI) {
    return {
      kpis: {},
      calls: [],
      uniqueCalls: [],
      total: 0,
      uniqueTotal: 0,
      totalReported: 0,
    };
  }

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
    // Always output valid JSON on error so callers never receive unexpected EOF
    console.log(JSON.stringify({ kpis: {}, calls: [], uniqueCalls: [], total: 0, uniqueTotal: 0, totalReported: 0, error: err.message }));
    process.exit(0);
  });
}

module.exports = { fetchPendingCalls };
