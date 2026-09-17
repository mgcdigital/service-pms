const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Base URI without DB name
const MONGODB_BASE = process.env.MONGODB_BASE || 'mongodb+srv://mgc_admin:MgcIndia2026@cluster8.vv0w6gt.mongodb.net';

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, '..', '..', '..', '..', 'OneDrive', 'Desktop', 'Service PMS')));

// Flexible Mongoose Schemas
const TaskSchema = new mongoose.Schema({}, { strict: false });
const SiteSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  client: { type: String, default: '' },
  poNumber: { type: String, default: '' },
  deo: { type: String, default: '' },
  startDate: { type: String, default: '' },
  endDate: { type: String, default: '' },
  owner: { type: String, default: '' },
  vre: { type: String, default: '' },
  siteIncharge: { type: String, default: '' },
  coordinator: { type: String, default: '' },
  tasks: { type: [TaskSchema], default: [] }
}, { timestamps: true, strict: false });

// Two distinct DB connections: Service & Supply
let serviceConn = null;
let supplyConn = null;
let ServiceSite = null;
let SupplySite = null;

async function initDB() {
  try {
    serviceConn = mongoose.createConnection(`${MONGODB_BASE}/service_pms?retryWrites=true&w=majority&appName=Cluster0`, {
      serverSelectionTimeoutMS: 6000
    });
    ServiceSite = serviceConn.model('Site', SiteSchema);
    console.log('✅ Service PMS Database connected!');

    supplyConn = mongoose.createConnection(`${MONGODB_BASE}/supply_pms?retryWrites=true&w=majority&appName=Cluster0`, {
      serverSelectionTimeoutMS: 6000
    });
    SupplySite = supplyConn.model('Site', SiteSchema);
    console.log('✅ Supply PMS Database connected!');
  } catch (err) {
    console.error('DB Init warning:', err.message);
  }
}

function getModel(mode) {
  return (mode === 'supply') ? SupplySite : ServiceSite;
}

// Endpoints
app.get('/api/sites', async (req, res) => {
  const mode = (req.query.mode || 'service').toLowerCase();
  const Model = getModel(mode);
  if (!Model) return res.status(503).json({ error: 'DB initializing', fallback: true });
  try {
    const sites = await Model.find({}).lean();
    res.json(sites);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/sites', async (req, res) => {
  const mode = (req.query.mode || 'service').toLowerCase();
  const Model = getModel(mode);
  if (!Model) return res.status(503).json({ error: 'DB initializing' });
  try {
    const newSites = req.body;
    for (const site of newSites) {
      if (!site.id) continue;
      await Model.findOneAndUpdate({ id: site.id }, { $set: site }, { upsert: true, new: true, setDefaultsOnInsert: true });
    }
    res.json({ success: true, mode });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
