
// Helper to parse dates from various formats (DD-MM-YYYY, DD/MM/YYYY, YYYY-MM-DD, etc.)
function parseAnyDate(str) {
  if (!str) return null;
  const s = String(str).trim();

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // DD-MM-YYYY or DD/MM/YYYY
  const dmyMatch = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, '0');
    const month = dmyMatch[2].padStart(2, '0');
    const year = dmyMatch[3];
    return `${year}-${month}-${day}`;
  }

  // YYYY/MM/DD
  const ymdSlash = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (ymdSlash) {
    return `${ymdSlash[1]}-${ymdSlash[2].padStart(2, '0')}-${ymdSlash[3].padStart(2, '0')}`;
  }

  return null;
}

﻿// Service PMS Application Logic

// Local storage key
const STORAGE_KEY = 'SERVICE_PMS_DATA_V5';
const ROLE_STORAGE_KEY = 'SERVICE_PMS_USER_ROLE';

// Initial state
let sitesData = [];
let activeSiteId = null;
let currentEditingTaskId = null;
let currentUserRole = localStorage.getItem(ROLE_STORAGE_KEY) || 'Super Admin';

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
  await loadData();
  setupRoleBadges();
  setupEventListeners();
  renderSites();
  populateSiteDropdown();
});

function setupRoleBadges() {
  const doerBadge = document.querySelector('.role-badge.doer');
  const superAdminBadge = document.querySelector('.role-badge.super-admin');

  function updateRoleUI() {
    if (doerBadge) doerBadge.classList.toggle('active', currentUserRole === 'Doer');
    if (superAdminBadge) superAdminBadge.classList.toggle('active', currentUserRole === 'Super Admin');
  }

  updateRoleUI();

  if (doerBadge) {
    doerBadge.addEventListener('click', () => {
      currentUserRole = 'Doer';
      localStorage.setItem(ROLE_STORAGE_KEY, currentUserRole);
      updateRoleUI();
      if (activeSiteId) renderSiteTasks();
    });
  }

  if (superAdminBadge) {
    superAdminBadge.addEventListener('click', () => {
      currentUserRole = 'Super Admin';
      localStorage.setItem(ROLE_STORAGE_KEY, currentUserRole);
      updateRoleUI();
      if (activeSiteId) renderSiteTasks();
    });
  }
}

// Delete task (Super Admin only)
function deleteTask(taskId) {
  if (currentUserRole !== 'Super Admin') {
    alert('Access Denied: Only Super Admin can delete tasks.');
    return;
  }

  const site = sitesData.find(s => s.id === activeSiteId);
  if (!site) return;

  const taskIdx = site.tasks.findIndex(t => t.id === taskId);
  if (taskIdx === -1) return;

  const task = site.tasks[taskIdx];
  if (confirm(`Are you sure you want to delete task "${task.title}"?`)) {
    site.tasks.splice(taskIdx, 1);
    saveData();
    renderSiteTasks();

    // Sheets log
    sendGoogleSheetsLog({
      uniqueId: task.id,
      projectName: site.name,
      action: `Task Deleted: ${task.title}`,
      poNumber: site.poNumber || '',
      client: site.client || '',
      stakeholders: `${site.owner || ''}, ${site.siteIncharge || ''}`,
      status: 'Deleted',
      updatedBy: 'Super Admin'
    });
  }
}

// Load Data from LocalStorage or seed_data.json

// MongoDB API sync helper
let isMongoOnline = false;

function updateDbBadge(status, text) {
  const dot = document.getElementById('dbStatusDot');
  const label = document.getElementById('dbStatusText');
  if (!dot || !label) return;

  if (status === 'connected') {
    dot.style.background = '#22c55e'; // Green
    label.textContent = text || 'MongoDB: Live';
    label.style.color = '#86efac';
  } else if (status === 'syncing') {
    dot.style.background = '#38bdf8'; // Sky blue
    label.textContent = text || 'MongoDB: Syncing...';
    label.style.color = '#bae6fd';
  } else {
    dot.style.background = '#f59e0b'; // Amber / fallback
    label.textContent = text || 'Storage: Local Fallback';
    label.style.color = '#fde68a';
  }
}

async function loadData() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      sitesData = JSON.parse(saved);
      if (sitesData.length > 0) {
        // Ensure all tasks have duration calculated from dates if missing
        sitesData.forEach(s => {
          s.tasks.forEach(t => {
            if (!t.isHeader && (!t.duration || t.duration <= 1)) {
              if (t.startDate && t.endDate) {
                try {
                  const d1 = new Date(t.startDate);
                  const d2 = new Date(t.endDate);
                  const diff = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
                  t.duration = Math.max(1, diff);
                } catch(e) { t.duration = 7; }
              } else {
                t.duration = 7;
              }
            }
          });
        });
        activeSiteId = sitesData[0].id;
        return;
      }
    } catch (e) {
      console.error('Error loading localStorage data:', e);
    }
  }

  // Load initial seed data
  try {
    const response = await fetch('seed_data.json');
    sitesData = await response.json();
    
    // Ensure all tasks have calculated duration
    sitesData.forEach(s => {
      s.tasks.forEach(t => {
        if (!t.isHeader && (!t.duration || t.duration <= 1)) {
          if (t.startDate && t.endDate) {
            try {
              const d1 = new Date(t.startDate);
              const d2 = new Date(t.endDate);
              const diff = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
              t.duration = Math.max(1, diff);
            } catch(e) { t.duration = 7; }
          } else {
            t.duration = 7;
          }
        }
      });
    });

    if (sitesData.length > 0) {
      activeSiteId = sitesData[0].id;
    }
    saveData();
  } catch (err) {
    console.error('Failed to load seed_data.json:', err);
    // Fallback default site
    sitesData = [{
      id: 'site-1',
      name: 'RDM Service PMS of 2 MVA Portal Substation',
      client: 'MAHESHWARI DISTRIBUTORS',
      poNumber: '5100033887',
      owner: 'DK Shriwal',
      siteIncharge: 'Dinesh Purohit',
      tasks: []
    }];
    activeSiteId = 'site-1';
    saveData();
  }
}

// Add demo sites matching the user's screenshots
function addInitialDemoSites() {
  sitesData.push({
    id: 'site-ev-clzs',
    name: 'EV Charging_CLZS',
    client: 'HZL CLZS',
    poNumber: '4200088912',
    owner: 'Arun Sharma',
    siteIncharge: 'Ramesh Patel',
    tasks: [
      {
        id: 'CLZS001',
        wbs: '1.0',
        title: 'Civil foundation for EV Charger units',
        totalQty: 10,
        completedQty: 10,
        uom: 'Nos',
        doer: 'Ramesh Patel',
        manpower: '8',
        startDate: '2026-08-01',
        endDate: '2026-08-15',
        progressPct: 100,
        remark: 'Completed successfully',
        isHeader: false
      },
      {
        id: 'CLZS002',
        wbs: '2.0',
        title: 'Cable trenching and pipe laying',
        totalQty: 250,
        completedQty: 150,
        uom: 'Mtr',
        doer: 'Vikram Singh',
        manpower: '6',
        startDate: '2026-08-16',
        endDate: '2026-09-05',
        progressPct: 60,
        remark: '150m done, remaining in progress',
        isHeader: false
      },
      {
        id: 'CLZS003',
        wbs: '3.0',
        title: 'Installation of EV Charger Dispensers',
        totalQty: 5,
        completedQty: 0,
        uom: 'Nos',
        doer: 'Vikram Singh',
        manpower: '4',
        startDate: '2026-09-10',
        endDate: '2026-09-20',
        progressPct: 0,
        remark: 'Awaiting delivery',
        isHeader: false
      }
    ]
  });

  sitesData.push({
    id: 'site-dsc-common',
    name: 'DSC Common-RD',
    client: 'HZL Smelter',
    poNumber: '4500012900',
    owner: 'Mukesh Vyas',
    siteIncharge: 'Sohan Lal',
    tasks: [
      {
        id: 'DSC001',
        wbs: '1.0',
        title: 'HT Panel Erection & Alignment',
        totalQty: 6,
        completedQty: 6,
        uom: 'Sets',
        doer: 'Sohan Lal',
        manpower: '12',
        startDate: '2026-07-01',
        endDate: '2026-07-20',
        progressPct: 100,
        remark: 'Testing done',
        isHeader: false
      },
      {
        id: 'DSC002',
        wbs: '2.0',
        title: 'Control cable termination & ferruling',
        totalQty: 120,
        completedQty: 60,
        uom: 'Cores',
        doer: 'Sunil Kumar',
        manpower: '4',
        startDate: '2026-08-01',
        endDate: '2026-08-25',
        progressPct: 50,
        remark: 'Half completed',
        isHeader: false
      }
    ]
  });

  sitesData.push({
    id: 'site-debari',
    name: 'Debari Substation Maintenance',
    client: 'Debari Zinc Smelter',
    poNumber: '5100098231',
    owner: 'Pawan Joshi',
    siteIncharge: 'Govind Ram',
    tasks: [
      {
        id: 'DEB001',
        wbs: '1.0',
        title: 'Transformer oil filtration and BDV testing',
        totalQty: 2,
        completedQty: 1,
        uom: 'Nos',
        doer: 'Govind Ram',
        manpower: '5',
        startDate: '2026-08-10',
        endDate: '2026-08-20',
        progressPct: 50,
        remark: 'TR-1 completed, TR-2 scheduled next week',
        isHeader: false
      }
    ]
  });
}

// Save Data to LocalStorage
function saveData() {
  // Always update LocalStorage immediately for instant UI responsiveness
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sitesData));

  // Background sync to MongoDB API
  syncToMongoBackend();
}

let syncTimeout = null;
function syncToMongoBackend() {
  if (syncTimeout) clearTimeout(syncTimeout);
  // Debounce sync slightly to batch rapid edits
  syncTimeout = setTimeout(async () => {
    try {
      updateDbBadge('syncing', 'MongoDB: Saving...');
      const res = await fetch('/api/sites', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sitesData)
      });
      if (res.ok) {
        isMongoOnline = true;
        updateDbBadge('connected', 'MongoDB: Live');
      } else {
        updateDbBadge('offline', 'Storage: Local (Offline)');
      }
    } catch (e) {
      console.warn('Background MongoDB sync skipped/failed:', e.message);
      updateDbBadge('offline', 'Storage: Local (Offline)');
    }
  }, 400);
}

// Calculate site stats
function getSiteStats(site) {
  const actionableTasks = site.tasks.filter(t => !t.isHeader && t.totalQty !== null);
  const total = actionableTasks.length;
  if (total === 0) {
    return { total: 0, done: 0, inProgress: 0, pending: 0, avgProgress: 0 };
  }

  let done = 0;
  let inProgress = 0;
  let pending = 0;
  let sumPct = 0;

  actionableTasks.forEach(t => {
    sumPct += t.progressPct || 0;
    if (t.progressPct >= 100) {
      done++;
    } else if (t.progressPct > 0) {
      inProgress++;
    } else {
      pending++;
    }
  });

  const avgProgress = Math.round(sumPct / total);
  return { total, done, inProgress, pending, avgProgress };
}


let currentServiceTab = 'ACTIVE';

function setServiceProjectTab(tab) {
  currentServiceTab = tab;
  const btnActive = document.getElementById('tabServiceActive');
  const btnCompleted = document.getElementById('tabServiceCompleted');
  if (btnActive && btnCompleted) {
    if (tab === 'ACTIVE') {
      btnActive.style.background = '#2563eb';
      btnActive.style.color = '#ffffff';
      btnCompleted.style.background = 'transparent';
      btnCompleted.style.color = '#94a3b8';
    } else {
      btnCompleted.style.background = '#2563eb';
      btnCompleted.style.color = '#ffffff';
      btnActive.style.background = 'transparent';
      btnActive.style.color = '#94a3b8';
    }
  }
  renderSites();
}

function openCompleteModal(siteId, siteName) {
  document.getElementById('completeSiteIdInput').value = siteId;
  document.getElementById('completeSiteTitleDisplay').innerText = siteName;
  document.getElementById('completeSiteNoteInput').value = '';
  const modal = document.getElementById('modalCompleteSite');
  if (modal) modal.style.display = 'flex';
}

function closeCompleteModal() {
  const modal = document.getElementById('modalCompleteSite');
  if (modal) modal.style.display = 'none';
}

async function confirmCompleteServiceSite() {
  const siteId = document.getElementById('completeSiteIdInput').value;
  const note = document.getElementById('completeSiteNoteInput').value.trim();
  const site = sitesData.find(s => s.id === siteId);
  if (!site) return;

  site.status = 'COMPLETED';
  site.completed_at = new Date().toISOString();
  site.completed_by = 'Super Admin';
  site.completion_note = note;

  // Persist locally & server if available
  saveSitesDataLocally();
  try {
    await fetch(`${API_BASE_URL}/api/sites/${siteId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(site)
    });
  } catch (e) {}

  closeCompleteModal();
  renderSites();
}

async function reopenServiceSite(siteId, siteName, event) {
  if (event) event.stopPropagation();
  if (!confirm(`Are you sure you want to reopen project "${siteName}" and return it to Active Projects?`)) return;

  const site = sitesData.find(s => s.id === siteId);
  if (!site) return;

  site.status = 'ACTIVE';
  site.completed_at = null;
  site.completion_note = '';

  saveSitesDataLocally();
  try {
    await fetch(`${API_BASE_URL}/api/sites/${siteId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(site)
    });
  } catch (e) {}

  renderSites();
}

// Render Sites Directory
function renderSites() {
  const container = document.getElementById('sitesGridContainer');
  const showHidden = document.getElementById('chkShowHidden').checked;
  container.innerHTML = '';

  const sitesToDisplay = showHidden ? sitesData : sitesData.filter(s => !s.hidden);

  if (sitesToDisplay.length === 0) {
    container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #64748b;">
      No sites to display. Click "+ Add New Site" to create one.
    </div>`;
    return;
  }

  sitesToDisplay.forEach(site => {
    const stats = getSiteStats(site);
    const packagesCount = site.tasks.filter(t => t.isHeader).length || 1;

    const card = document.createElement('div');
    card.className = 'site-card';
    card.innerHTML = `
      <div class="site-card-header">
        <div class="site-name-wrap" onclick="openSiteTasks('${site.id}')">
          <span class="site-bullet"></span>
          <span class="site-title">${site.name}</span>
        </div>
        <div class="site-card-tools">
          <button class="tool-icon-btn" title="Toggle Hide Site" onclick="toggleHideSite('${site.id}', event)">
            <i class="fa-solid ${site.hidden ? 'fa-eye-slash' : 'fa-eye'}"></i>
          </button>
          <button class="tool-icon-btn" title="Rename Site" onclick="editSite('${site.id}', event)">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button class="tool-icon-btn" title="Delete Site" onclick="deleteSite('${site.id}', event)">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>

      <div class="site-card-progress-meta">
        <span>Progress: ${stats.done}/${stats.total} Steps (${stats.avgProgress}%)</span>
        <span class="site-packages-badge">${packagesCount} Packages</span>
      </div>

      <div class="site-progress-track">
        <div class="site-progress-bar" style="width: ${stats.avgProgress}%;"></div>
      </div>

      <div class="site-card-footer">
        <div class="site-stats-tags">
          <span class="stat-pill done">Done: ${stats.done}</span>
          <span class="stat-pill pending">In Progress: ${stats.inProgress}</span>
          <span class="stat-pill delayed">Pending: ${stats.pending}</span>
        </div>
        <button class="btn-card-task" onclick="openSiteTasks('${site.id}')">
          + Task View
        </button>
      </div>
    `;
    container.appendChild(card);
  });
}

// Populate Site dropdown inside Tasks view
function populateSiteDropdown() {
  const select = document.getElementById('selectActiveSiteDropdown');
  select.innerHTML = '';
  sitesData.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name;
    if (s.id === activeSiteId) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });
}

// Switch between View 1 (Sites) and View 2 (Tasks)
function switchView(viewName) {
  const viewSites = document.getElementById('viewSites');
  const viewTasks = document.getElementById('viewTasks');
  const dockSites = document.getElementById('dockBtnSites');
  const dockTasks = document.getElementById('dockBtnTasks');

  if (viewName === 'tasks') {
    viewSites.classList.remove('active');
    viewTasks.classList.add('active');
    dockSites.classList.remove('active');
    dockTasks.classList.add('active');
  } else {
    viewSites.classList.add('active');
    viewTasks.classList.remove('active');
    dockSites.classList.add('active');
    dockTasks.classList.remove('active');
    renderSites();
  }
}

// Open tasks view for a specific site
function openSiteTasks(siteId) {
  activeSiteId = siteId;
  const select = document.getElementById('selectActiveSiteDropdown');
  select.value = siteId;
  renderSiteTasks();
  switchView('tasks');
}

// Render Tasks of the Active Site
// ================= PROJECT BUFFER DAYS / TIME BANK =================
/**
 * Calculates buffer stats for a project site.
 * Returns: { plannedDays, bufferAllowed, actualDays, bufferUsed, bufferRemaining, beyondBuffer, status, isOverdue }
 */
function calcBufferStats(site) {
  const bufferAllowed = parseInt(site.bufferDays) || 0;

  if (!site.startDate) {
    return {
      plannedDays: 0, bufferAllowed, actualDays: 0,
      bufferUsed: 0, bufferRemaining: bufferAllowed,
      beyondBuffer: 0, status: 'Not Started', isOverdue: false
    };
  }

  const start = new Date(site.startDate);
  start.setHours(0, 0, 0, 0);

  // Planned end = project end date (from site.endDate)
  let plannedEnd = null;
  if (site.endDate) {
    plannedEnd = new Date(site.endDate);
    plannedEnd.setHours(0, 0, 0, 0);
  }

  const plannedDays = plannedEnd
    ? Math.max(0, Math.round((plannedEnd - start) / 86400000))
    : 0;

  // Actual days = today (if ongoing) based on overall project progress
  const stats = getSiteStats(site);
  const isFullyDone = stats.total > 0 && stats.done === stats.total;

  // Use today as reference for actual elapsed days
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const actualDays = Math.max(0, Math.round((today - start) / 86400000));

  // Buffer calculations
  const overPlanned = Math.max(0, actualDays - plannedDays);
  const bufferUsed = Math.min(overPlanned, bufferAllowed);
  const bufferRemaining = Math.max(0, bufferAllowed - overPlanned);
  const beyondBuffer = Math.max(0, overPlanned - bufferAllowed);

  // Status label
  let status;
  if (actualDays <= 0) {
    status = 'Not Started';
  } else if (actualDays < plannedDays) {
    const savedDays = plannedDays - actualDays;
    status = isFullyDone ? `Completed Early (+${savedDays}d saved)` : 'On Track';
  } else if (actualDays === plannedDays) {
    status = isFullyDone ? 'Completed on Time' : 'At Deadline';
  } else if (beyondBuffer === 0 && bufferUsed > 0) {
    status = `In Buffer (${bufferUsed}d used)`;
  } else if (beyondBuffer === 0 && bufferUsed === bufferAllowed && bufferAllowed > 0) {
    status = 'Buffer Fully Used';
  } else if (beyondBuffer > 0) {
    status = `${beyondBuffer}d Beyond Buffer`;
  } else {
    status = 'On Track';
  }

  return {
    plannedDays,
    bufferAllowed,
    actualDays,
    bufferUsed,
    bufferRemaining,
    beyondBuffer,
    status,
    isOverdue: beyondBuffer > 0,
    isFullyDone
  };
}

/**
 * Renders the Buffer Status Bar in the project header.
 */
function renderBufferBar(site) {
  const bar = document.getElementById('bufferStatusBar');
  if (!bar) return;

  const b = calcBufferStats(site);

  if (b.plannedDays === 0 && b.bufferAllowed === 0) {
    bar.style.display = 'none';
    return;
  }
  bar.style.display = '';

  // Fill pill values
  document.getElementById('bufferValPlan').textContent = `${b.plannedDays} Days`;
  document.getElementById('bufferValBuffer').textContent = `${b.bufferAllowed} Days`;
  document.getElementById('bufferValUsed').textContent = `${b.bufferUsed} Days`;
  document.getElementById('bufferValRemaining').textContent = `${b.bufferRemaining} Days`;

  // Color coding for Used pill
  const usedPill = document.getElementById('bufferPillUsed');
  usedPill.className = 'buffer-pill';
  if (b.bufferUsed === 0) {
    usedPill.classList.add('buffer-pill-safe');
  } else if (b.bufferUsed < b.bufferAllowed) {
    usedPill.classList.add('buffer-pill-warn');
  } else {
    usedPill.classList.add('buffer-pill-critical');
  }

  // Color coding for Remaining pill
  const remainPill = document.getElementById('bufferPillRemaining');
  remainPill.className = 'buffer-pill';
  if (b.bufferRemaining > 0) {
    remainPill.classList.add('buffer-pill-safe');
  } else {
    remainPill.classList.add('buffer-pill-critical');
  }

  // Beyond Buffer pill
  const beyondPill = document.getElementById('bufferPillBeyond');
  const beyondDiv = document.getElementById('bufferBeyondDivider');
  if (b.beyondBuffer > 0) {
    beyondPill.style.display = '';
    beyondDiv.style.display = '';
    document.getElementById('bufferValBeyond').textContent = `${b.beyondBuffer} Days`;
  } else {
    beyondPill.style.display = 'none';
    beyondDiv.style.display = 'none';
  }

  // Status badge
  const statusBadge = document.getElementById('bufferStatusBadge');
  statusBadge.textContent = b.status;
  statusBadge.className = 'buffer-status-badge';
  if (b.isOverdue) {
    statusBadge.classList.add('badge-overdue');
  } else if (b.bufferUsed > 0) {
    statusBadge.classList.add('badge-in-buffer');
  } else if (b.actualDays < b.plannedDays || b.isFullyDone) {
    statusBadge.classList.add('badge-on-track');
  } else {
    statusBadge.classList.add('badge-warning');
  }

  // Progress track bar
  const totalVisualDays = b.plannedDays + b.bufferAllowed + Math.max(0, b.beyondBuffer);
  if (totalVisualDays > 0) {
    const plannedPct = Math.min(100, (b.plannedDays / totalVisualDays) * 100);
    // Show actual elapsed within the planned zone
    const elapsedInPlanned = Math.min(b.actualDays, b.plannedDays);
    const usedPct = Math.min(100 - plannedPct, (b.bufferUsed / totalVisualDays) * 100);
    const beyondPct = (b.beyondBuffer / totalVisualDays) * 100;

    document.getElementById('bufferTrackPlanned').style.width = `${plannedPct}%`;
    document.getElementById('bufferTrackUsed').style.width = `${usedPct}%`;
    document.getElementById('bufferTrackBeyond').style.width = `${beyondPct}%`;
  }

  document.getElementById('bufferTrackLabelStart').textContent = site.startDate || 'Start';
  document.getElementById('bufferTrackLabelEnd').textContent = site.endDate ? `Planned: ${site.endDate}` : 'Planned End';
  const bufferEndDate = (() => {
    if (!site.endDate || !b.bufferAllowed) return '';
    const d = new Date(site.endDate);
    d.setDate(d.getDate() + b.bufferAllowed);
    return `Buffer End: ${d.toISOString().split('T')[0]}`;
  })();
  document.getElementById('bufferTrackLabelBuffer').textContent = bufferEndDate;
}
function renderSiteTasks() {
  const site = sitesData.find(s => s.id === activeSiteId);
  if (!site) return;

  // Banner details
  const stats = getSiteStats(site);
  document.getElementById('currentSiteTitle').textContent = site.name;
  const progressTextEl = document.getElementById('currentSiteProgressText');
  if (progressTextEl) {
    progressTextEl.textContent = `${stats.avgProgress}% Complete (${stats.done}/${stats.total})`;
  } else {
    document.getElementById('currentSiteProgressBadge').textContent = `${stats.avgProgress}% Complete (${stats.done}/${stats.total})`;
  }

  // Render Project Metadata Header Card
  document.getElementById('metaClient').textContent = site.client || 'MAHESHWARI DISTRIBUTORS';
  document.getElementById('metaPO').textContent = site.poNumber || '5100033887';
  document.getElementById('metaDEO').textContent = site.deo || 'Mahender Kumar Gurjar';
  document.getElementById('metaStartDate').textContent = site.startDate || '2026-06-02';
  document.getElementById('metaEndDate').textContent = site.endDate || '2026-08-20';

  // Duration calculation
  let durationStr = '-';
  if (site.startDate && site.endDate) {
    const d1 = new Date(site.startDate);
    const d2 = new Date(site.endDate);
    const diffDays = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
    durationStr = `${diffDays > 0 ? diffDays : 0} Days`;
  }
  document.getElementById('metaDuration').textContent = durationStr;

  document.getElementById('metaOwner').textContent = site.owner || 'DK Shriwal :- 8233330578';
  document.getElementById('metaVRE').textContent = site.vre || 'Aarti Bala :- 8824133320';
  document.getElementById('metaIncharge').textContent = site.siteIncharge || 'Dinesh Purohit :- 8003698657';
  document.getElementById('metaCoordinator').textContent = site.coordinator || 'Tulsi Sen :- 9875789834';

  // Render Buffer Status Bar
  renderBufferBar(site);

  const tbody = document.getElementById('tasksTableBody');
  tbody.innerHTML = '';

  // Bulk Delete bar: Super Admin only
  const bulkBar = document.getElementById('bulkActionBar');
  const thCheckbox = document.getElementById('thCheckboxCol');
  if (bulkBar) bulkBar.style.display = currentUserRole === 'Super Admin' ? '' : 'none';
  if (thCheckbox) thCheckbox.style.display = currentUserRole === 'Super Admin' ? '' : 'none';
  // Reset selection state on every re-render
  selectedTaskIds.clear();
  updateBulkActionBar();

  const filterStatus = document.getElementById('selectStatusFilter').value;
  const searchQuery = document.getElementById('taskSearchInput').value.trim().toLowerCase();

  let filteredTasks = site.tasks.filter(task => {
    // Search query filter
    if (searchQuery) {
      const matchText = (task.id + ' ' + (task.wbs || '') + ' ' + task.title + ' ' + (task.doer || '') + ' ' + (task.remark || '')).toLowerCase();
      if (!matchText.includes(searchQuery)) return false;
    }

    // Status filter
    if (filterStatus === 'COMPLETED') {
      return !task.isHeader && (task.progressPct >= 100);
    }
    if (filterStatus === 'IN_PROGRESS') {
      return !task.isHeader && (task.progressPct > 0 && task.progressPct < 100);
    }
    if (filterStatus === 'PENDING') {
      return !task.isHeader && (!task.progressPct || task.progressPct === 0);
    }
    return true;
  });

  if (filteredTasks.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 40px; color: #64748b;">
      No tasks match the filter criteria.
    </td></tr>`;
    return;
  }

  filteredTasks.forEach(task => {
    const tr = document.createElement('tr');

    // If it's a section header row (e.g. WBS Category)
            if (task.isHeader) {
      tr.className = 'header-row';
      const sectionActionHtml = (currentUserRole === 'Super Admin') 
        ? `<div class="action-buttons-cell"><button class="btn-icon-edit" onclick="openEditTaskModal('${task.id}')" title="Edit Section"><i class="fa-solid fa-pen"></i></button></div>`
        : '';
      tr.innerHTML = `
        ${currentUserRole === 'Super Admin' ? `<td class="td-checkbox"><input type="checkbox" class="row-checkbox" data-id="${task.id}" onchange="onRowCheckboxChange(this)"></td>` : ''}
        <td class="uid-cell">
          <i class="fa-solid fa-folder-open text-primary"></i> ${task.id}
        </td>
        <td class="wbs-cell">${task.wbs || ''}</td>
        <td colspan="6" class="task-title" style="font-weight: 700; color: #1e1b4b;">
          ${task.title}
        </td>
        <td style="text-align: center;">${sectionActionHtml}</td>
      `;
      tbody.appendChild(tr);
      return;
    }

    // Calculate status badge
    let statusBadge = '';
    const pct = task.progressPct || 0;
    if (pct >= 100) {
      statusBadge = `<span class="badge badge-completed"><i class="fa-solid fa-circle-check"></i> Completed</span>`;
    } else if (pct > 0) {
      statusBadge = `<span class="badge badge-inprogress"><i class="fa-solid fa-spinner"></i> In Progress (${pct}%)</span>`;
    } else {
      statusBadge = `<span class="badge badge-pending"><i class="fa-regular fa-clock"></i> Pending</span>`;
    }

    // Total vs Completed Qty display
    let qtyDisplay = '';
    if (task.totalQty !== null && task.totalQty !== undefined) {
      const uom = task.uom || '';
      qtyDisplay = `
        <div class="qty-progress-wrap">
          <div class="qty-text">
            <strong>${task.completedQty || 0}</strong> / ${task.totalQty} ${uom}
          </div>
          <div class="progress-track-sm">
            <div class="progress-fill-sm" style="width: ${Math.min(pct, 100)}%;"></div>
          </div>
          <span class="progress-pct-badge">${pct}% Done</span>
        </div>
      `;
    } else {
      qtyDisplay = `<div class="qty-text"><strong>${pct}%</strong></div>`;
    }

    const planDates = (task.startDate || task.endDate) 
      ? `<span style="font-size: 0.74rem; color: #475569;">${task.startDate || ''}<br>&rarr; ${task.endDate || ''}</span>`
      : `<span style="color: #94a3b8;">-</span>`;

    const remarksText = task.remark 
      ? `<div class="remark-wrap-box">${task.remark}</div>`
      : `<span style="color: #cbd5e1;">-</span>`;

    tr.innerHTML = `
        ${currentUserRole === 'Super Admin' ? `<td class="td-checkbox"><input type="checkbox" class="row-checkbox" data-id="${task.id}" onchange="onRowCheckboxChange(this)"></td>` : ''}
      <td class="uid-cell">
        <i class="fa-solid fa-play uid-arrow"></i> ${task.id}
      </td>
      <td class="wbs-cell">${task.wbs || '-'}</td>
      <td>
        <div class="task-title">${task.title}</div>
      </td>
      <td>${qtyDisplay}</td>
      <td>
        <div style="font-weight: 600; color: #1e293b; font-size: 0.8rem;">${task.doer || 'Unassigned'}</div>
        ${task.manpower ? `<span style="font-size: 0.7rem; color: #64748b;">${task.manpower} workers</span>` : ''}
      </td>
      <td>${planDates}</td>
      <td>${remarksText}</td>
      <td>${statusBadge}</td>
      <td style="text-align: center;">
        ${renderTaskActionColumn(task)}
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Also render Gantt timeline with current filter
  renderGanttTimeline(filteredTasks);
}

// Render Action column based on user role (Super Admin vs Admin/Normal User)
function renderTaskActionColumn(task) {
  // Super Admin gets both: Mark Done (✓) + Edit Pencil (✏️)
  // Doer gets ONLY Mark Done (✓). Pencil is hidden.
  const isSuperAdmin = (currentUserRole === 'Super Admin');
  const editBtnHtml = isSuperAdmin ? `
    <button class="btn-icon-edit" onclick="openEditTaskModal('${task.id}')" title="Edit task details">
      <i class="fa-solid fa-pen"></i>
    </button>
  ` : '';

  return `
    <div class="action-buttons-cell">
      <button class="btn-icon-done" onclick="openUpdateModal('${task.id}')" title="Mark as Done / Update Progress">
        <i class="fa-solid fa-circle-check"></i>
      </button>
      ${editBtnHtml}
    </div>
  `;
}

// ================= DELETE SECTION =================
function deleteSection(sectionId) {
  if (currentUserRole !== 'Super Admin') {
    alert('Access Denied: Only Super Admin can delete sections.');
    return;
  }

  const site = sitesData.find(s => s.id === activeSiteId);
  if (!site) return;

  const section = site.tasks.find(t => t.id === sectionId);
  if (!section) return;

  if (!confirm(`Delete section "${section.title}"?\n\nNote: This only deletes the section header. Tasks inside it will remain.`)) return;

  site.tasks = site.tasks.filter(t => t.id !== sectionId);
  saveData();
  renderSiteTasks();

  sendGoogleSheetsLog({
    uniqueId: sectionId,
    projectName: site.name,
    action: `Section Deleted: ${section.title}`,
    poNumber: site.poNumber || '',
    client: site.client || '',
    stakeholders: '',
    status: 'Deleted',
    updatedBy: currentUserRole
  });
}

// ================= EDIT TASK MODAL =================
function openEditTaskModal(taskId) {
  if (currentUserRole !== 'Super Admin') {
    alert('Access Denied: Only Super Admin can edit task configurations.');
    return;
  }
  const site = sitesData.find(s => s.id === activeSiteId);
  if (!site) return;
  const task = site.tasks.find(t => t.id === taskId);
  if (!task) return;

  document.getElementById('editTaskId').value = task.id;
  document.getElementById('editTaskSubtitle').textContent = `ID: ${task.id}`;
  document.getElementById('editTaskWbs').value = task.wbs || '';
  document.getElementById('editTaskType').value = task.isHeader ? 'header' : 'task';
  document.getElementById('editTaskTitle').value = task.title || '';
  document.getElementById('editTaskTotalQty').value = task.totalQty !== undefined && task.totalQty !== null ? task.totalQty : '';
  document.getElementById('editTaskCompletedQty').value = task.completedQty !== undefined ? task.completedQty : '';
  document.getElementById('editTaskUom').value = task.uom || '';
  document.getElementById('editTaskDoer').value = task.doer || '';
  document.getElementById('editTaskManpower').value = task.manpower || '';
  document.getElementById('editTaskStartDate').value = task.startDate || '';
  document.getElementById('editTaskEndDate').value = task.endDate || '';
  document.getElementById('editTaskRemark').value = task.remark || '';

  // Show/hide qty fields
  const qtySection = document.getElementById('editQtySection');
  if (qtySection) qtySection.style.display = task.isHeader ? 'none' : 'flex';

  // Pre-fill progress % slider + display
  const editProgressEl = document.getElementById('editTaskProgressPct');
  const editProgressDisplay = document.getElementById('editProgressPctDisplay');
  const pctVal = task.progressPct !== undefined ? task.progressPct : 0;
  if (editProgressEl) editProgressEl.value = pctVal;
  if (editProgressDisplay) editProgressDisplay.textContent = pctVal + '%';

  // Wire up live qty → progress auto-calc
  const compQtyInput = document.getElementById('editTaskCompletedQty');
  const totalQtyInput = document.getElementById('editTaskTotalQty');
  if (compQtyInput && totalQtyInput) {
    const syncProgress = () => {
      const total = parseFloat(totalQtyInput.value) || 0;
      const done = parseFloat(compQtyInput.value) || 0;
      if (total > 0) {
        const pct = Math.min(100, Math.round((done / total) * 100));
        if (editProgressEl) { editProgressEl.value = pct; }
        if (editProgressDisplay) editProgressDisplay.textContent = pct + '%';
      }
    };
    compQtyInput.oninput = syncProgress;
    totalQtyInput.oninput = syncProgress;
  }

  document.getElementById('modalEditTask').classList.add('open');
}

function closeEditTaskModal() {
  document.getElementById('modalEditTask').classList.remove('open');
}

function saveEditTask() {
  const taskId = document.getElementById('editTaskId').value;
  const site = sitesData.find(s => s.id === activeSiteId);
  if (!site) return;
  const task = site.tasks.find(t => t.id === taskId);
  if (!task) return;

  const title = document.getElementById('editTaskTitle').value.trim();
  if (!title) { alert('Task description cannot be empty.'); return; }

  const isHeader = document.getElementById('editTaskType').value === 'header';
  task.wbs = document.getElementById('editTaskWbs').value.trim();
  task.title = title;
  task.isHeader = isHeader;
  task.doer = document.getElementById('editTaskDoer').value.trim();
  task.manpower = document.getElementById('editTaskManpower').value.trim();
  task.startDate = document.getElementById('editTaskStartDate').value;
  task.endDate = document.getElementById('editTaskEndDate').value;
  task.remark = document.getElementById('editTaskRemark').value.trim();

  if (!isHeader) {
    const total = parseFloat(document.getElementById('editTaskTotalQty').value);
    const completed = parseFloat(document.getElementById('editTaskCompletedQty').value);
    task.uom = document.getElementById('editTaskUom').value.trim();
    if (!isNaN(total)) task.totalQty = total;
    if (!isNaN(completed)) {
      task.completedQty = completed;
      // Auto-calculate progress from qty
      task.progressPct = task.totalQty > 0 ? Math.min(100, Math.round((completed / task.totalQty) * 100)) : 0;
    }
    // Allow manual progress override if direct % field is filled
    const manualPct = document.getElementById('editTaskProgressPct');
    if (manualPct && manualPct.value !== '' && (isNaN(completed) || document.getElementById('editTaskCompletedQty').value === '')) {
      task.progressPct = Math.min(100, Math.max(0, parseInt(manualPct.value) || 0));
    }
    // Recalculate duration
    if (task.startDate && task.endDate) {
      const d1 = new Date(task.startDate);
      const d2 = new Date(task.endDate);
      task.duration = Math.max(1, Math.round((d2 - d1) / (1000 * 60 * 60 * 24)));
    }
  }

  saveData();
  closeEditTaskModal();
  renderSiteTasks();

  sendGoogleSheetsLog({
    uniqueId: task.id,
    projectName: site.name,
    action: `Task Edited: ${task.title}`,
    poNumber: site.poNumber || '',
    client: site.client || '',
    stakeholders: '',
    status: isHeader ? 'Section' : (task.progressPct >= 100 ? 'Completed' : task.progressPct > 0 ? 'In Progress' : 'Pending'),
    updatedBy: currentUserRole
  });
}

// ================= RENDER GANTT TIMELINE =================
function renderGanttTimeline(tasksToRender) {
  const container = document.getElementById('ganttTimelineContainer');
  if (!container) return;
  container.innerHTML = '';

  if (tasksToRender.length === 0) {
    container.innerHTML = `<div style="text-align: center; padding: 40px; color: #64748b;">No tasks to display in timeline.</div>`;
    return;
  }

  // Find max duration among actionable tasks for proportional scaling
  let maxDuration = 1;
  tasksToRender.forEach(t => {
    if (!t.isHeader && t.duration) {
      if (t.duration > maxDuration) maxDuration = t.duration;
    }
  });

  // Minimum visual width scale
  const scaleMaxDays = Math.max(maxDuration, 30);

  tasksToRender.forEach(task => {
    const row = document.createElement('div');

    if (task.isHeader) {
      row.className = 'gantt-row header-gantt-row';
      row.innerHTML = `
        <div style="font-size: 0.85rem; font-weight: 700; color: #1e1b4b; display: flex; align-items: center; gap: 8px;">
          <i class="fa-solid fa-folder-open text-primary"></i>
          <span>${task.wbs ? '[' + task.wbs + '] ' : ''}${task.title}</span>
        </div>
      `;
      container.appendChild(row);
      return;
    }

    row.className = 'gantt-row';

    // Duration display and tag styling
    const dur = task.duration || 1;
    let durTagClass = 'duration-tag-short';
    if (dur >= 20) {
      durTagClass = 'duration-tag-long';
    } else if (dur >= 7) {
      durTagClass = 'duration-tag-mid';
    }

    // Bar progress class
    const pct = task.progressPct || 0;
    let barClass = 'bar-pending';
    if (pct >= 100) {
      barClass = 'bar-completed';
    } else if (pct > 0) {
      barClass = 'bar-inprogress';
    }

    // Calculate bar percentage width relative to longest task
    // At least 15% width so short tasks are readable, scaled up to 100%
    const relativeWidthPct = Math.min(100, Math.max(12, Math.round((dur / scaleMaxDays) * 100)));

    const dateRangeStr = (task.startDate || task.endDate) 
      ? `${task.startDate || 'Start'} &rarr; ${task.endDate || 'End'}` 
      : 'No dates set';

    row.innerHTML = `
      <div class="gantt-task-info">
        <div class="gantt-task-header-row">
          <span class="gantt-uid">${task.id}</span>
          <span class="gantt-task-name" title="${task.title}">${task.title}</span>
        </div>
        <div class="gantt-task-meta">
          <span>${task.doer || 'Site Incharge'}</span> &bull; 
          <span>${dateRangeStr}</span>
        </div>
      </div>

      <div class="gantt-track-col">
        <div class="gantt-bar-wrap">
          <div class="gantt-bar-fill ${barClass}" style="width: ${relativeWidthPct}%;">
            <span>${pct}% Done (${dur} Days)</span>
          </div>
        </div>
        <div class="gantt-duration-badge">
          <span class="${durTagClass}">${dur} Days</span>
        </div>
      </div>
    `;

    container.appendChild(row);
  });
}

// ================= MODAL: UPDATE TASK QUANTITY =================
function openUpdateModal(taskId) {
  const site = sitesData.find(s => s.id === activeSiteId);
  if (!site) return;

  const task = site.tasks.find(t => t.id === taskId);
  if (!task) return;

  currentEditingTaskId = taskId;

  document.getElementById('updateModalTaskTitle').textContent = task.title;
  document.getElementById('updateModalTaskSub').textContent = `Task ID: ${task.id} | WBS: ${task.wbs || '-'} | Incharge: ${task.doer || 'Site Incharge'}`;

  const total = task.totalQty !== null ? task.totalQty : 1;
  const completed = task.completedQty !== null ? task.completedQty : 0;
  const remaining = Math.max(0, total - completed);
  const uom = task.uom || 'Unit';

  document.getElementById('dispTotalQty').textContent = `${total} ${uom}`;
  document.getElementById('dispCompletedQty').textContent = `${completed} ${uom}`;
  document.getElementById('dispRemainingQty').textContent = `${remaining} ${uom}`;
  document.getElementById('dispUomBadge').textContent = uom;

  // Set initial inputs
  const inputQty = document.getElementById('inputNewCompletedQty');
  inputQty.value = completed;
  inputQty.max = total * 1.5; // Allow slight overrun if needed

  document.getElementById('inputDoerName').value = task.doer || '';
  document.getElementById('inputManpower').value = task.manpower || '';
  document.getElementById('inputRemarks').value = task.remark || '';

  // Trigger calculation
  updateModalLivePreview();

  // Show modal
  document.getElementById('modalUpdateQty').classList.add('open');
}

function updateModalLivePreview() {
  const site = sitesData.find(s => s.id === activeSiteId);
  if (!site || !currentEditingTaskId) return;
  const task = site.tasks.find(t => t.id === currentEditingTaskId);
  if (!task) return;

  const total = task.totalQty !== null && task.totalQty > 0 ? task.totalQty : 100;
  const enteredQty = parseFloat(document.getElementById('inputNewCompletedQty').value) || 0;

  const calculatedPct = Math.min(Math.round((enteredQty / total) * 100), 100);

  document.getElementById('calcProgressPctText').textContent = `${calculatedPct}%`;
  document.getElementById('calcProgressFill').style.width = `${calculatedPct}%`;

  const statusEl = document.getElementById('calcProgressStatus');
  if (calculatedPct >= 100) {
    statusEl.innerHTML = '<i class="fa-solid fa-check-circle"></i> 100% Completed! (Task will be marked Finished)';
    statusEl.style.color = '#15803d';
  } else if (calculatedPct > 0) {
    statusEl.innerHTML = `<i class="fa-solid fa-spinner"></i> In Progress (${calculatedPct}%)`;
    statusEl.style.color = '#0284c7';
  } else {
    statusEl.innerHTML = '<i class="fa-regular fa-clock"></i> Pending (0%)';
    statusEl.style.color = '#64748b';
  }
}

// Save progress from Update Modal
function saveTaskProgress() {
  const site = sitesData.find(s => s.id === activeSiteId);
  if (!site || !currentEditingTaskId) return;
  const task = site.tasks.find(t => t.id === currentEditingTaskId);
  if (!task) return;

  const newCompleted = parseFloat(document.getElementById('inputNewCompletedQty').value) || 0;
  const total = task.totalQty !== null && task.totalQty > 0 ? task.totalQty : 1;

  task.completedQty = newCompleted;
  task.progressPct = Math.min(Math.round((newCompleted / total) * 100), 100);
  task.doer = document.getElementById('inputDoerName').value.trim() || task.doer;
  task.manpower = document.getElementById('inputManpower').value.trim();
  task.remark = document.getElementById('inputRemarks').value.trim();

  saveData();
  closeUpdateModal();
  renderSiteTasks();

  // Real-time Google Sheets Logging
  sendGoogleSheetsLog({
    uniqueId: task.id || ('PMS-' + Date.now()),
    projectName: site.name,
    action: `Task Progress Updated: ${task.title} (${task.completedQty}/${total} ${task.uom || ''} - ${task.progressPct}%)`,
    poNumber: site.poNumber || '',
    client: site.client || '',
    stakeholders: `${site.owner || ''}, ${site.siteIncharge || ''}`,
    status: task.progressPct >= 100 ? 'Completed' : 'In Progress',
    updatedBy: task.doer || site.deo || 'Site Incharge'
  });
}

function closeUpdateModal() {
  document.getElementById('modalUpdateQty').classList.remove('open');
  currentEditingTaskId = null;
}

// Helper to parse "Name :- Phone" or return parts
function parseStakeholder(val) {
  if (!val) return { name: '', phone: '' };
  if (typeof val === 'object' && val !== null) {
    return { name: val.name || '', phone: val.phone || '' };
  }
  const str = String(val).trim();
  if (str.includes(':-')) {
    const parts = str.split(':-');
    return { name: parts[0].trim(), phone: (parts[1] || '').trim() };
  }
  if (str.includes('-') && !str.startsWith('-')) {
    const parts = str.split('-');
    return { name: parts[0].trim(), phone: (parts[1] || '').trim() };
  }
  return { name: str, phone: '' };
}

function formatStakeholder(name, phone) {
  const n = (name || '').trim();
  const p = (phone || '').trim();
  if (n && p) return `${n} :- ${p}`;
  if (n) return n;
  if (p) return p;
  return '';
}

// Site Modal State (Create or Edit)
let editingSiteId = null;

// ================= MODAL: ADD / EDIT SITE =================
function openAddSiteModal(siteToEdit = null) {
  const modal = document.getElementById('modalAddSite');
  const templateGroup = document.getElementById('siteTemplateGroup');
  const title = document.getElementById('siteModalHeading');
  const btnText = document.getElementById('siteModalSubmitBtnText');

  if (siteToEdit) {
    editingSiteId = siteToEdit.id;
    title.textContent = 'Edit Project Information';
    btnText.textContent = 'Save Changes';
    templateGroup.style.display = 'none';

    document.getElementById('newSiteName').value = siteToEdit.name || '';
    document.getElementById('newSiteClient').value = siteToEdit.client || '';
    document.getElementById('newSitePO').value = siteToEdit.poNumber || '';
    document.getElementById('newSiteDEO').value = siteToEdit.deo || '';
    document.getElementById('newSiteStartDate').value = siteToEdit.startDate || '';
    document.getElementById('newSiteEndDate').value = siteToEdit.endDate || '';
    document.getElementById('newSiteBufferDays').value = siteToEdit.bufferDays !== undefined ? siteToEdit.bufferDays : 0;

    const ownerParts = parseStakeholder(siteToEdit.owner);
    document.getElementById('newSiteOwnerName').value = ownerParts.name || 'DK Shriwal';
    document.getElementById('newSiteOwnerPhone').value = ownerParts.phone || '8233330578';

    const vreParts = parseStakeholder(siteToEdit.vre);
    document.getElementById('newSiteVREName').value = vreParts.name || 'Aarti Bala';
    document.getElementById('newSiteVREPhone').value = vreParts.phone || '8824133320';

    const inchargeParts = parseStakeholder(siteToEdit.siteIncharge);
    document.getElementById('newSiteInchargeName').value = inchargeParts.name || 'Dinesh Purohit';
    document.getElementById('newSiteInchargePhone').value = inchargeParts.phone || '8003698657';

    const coordParts = parseStakeholder(siteToEdit.coordinator);
    document.getElementById('newSiteCoordinatorName').value = coordParts.name || 'Tulsi Sen';
    document.getElementById('newSiteCoordinatorPhone').value = coordParts.phone || '9875789834';
  } else {
    editingSiteId = null;
    title.textContent = 'Create New Service Site / Project';
    btnText.textContent = 'Create Project';
    templateGroup.style.display = 'block';

    document.getElementById('newSiteName').value = '';
    document.getElementById('newSiteClient').value = 'MAHESHWARI DISTRIBUTORS';
    document.getElementById('newSitePO').value = '5100033887';
    document.getElementById('newSiteDEO').value = 'Mahender Kumar Gurjar';
    document.getElementById('newSiteStartDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('newSiteEndDate').value = '';

    document.getElementById('newSiteOwnerName').value = 'DK Shriwal';
    document.getElementById('newSiteOwnerPhone').value = '8233330578';

    document.getElementById('newSiteVREName').value = 'Aarti Bala';
    document.getElementById('newSiteVREPhone').value = '8824133320';

    document.getElementById('newSiteInchargeName').value = 'Dinesh Purohit';
    document.getElementById('newSiteInchargePhone').value = '8003698657';

    document.getElementById('newSiteCoordinatorName').value = 'Tulsi Sen';
    document.getElementById('newSiteCoordinatorPhone').value = '9875789834';
  }

  modal.classList.add('open');
  document.getElementById('newSiteName').focus();
}

function closeAddSiteModal() {
  document.getElementById('modalAddSite').classList.remove('open');
  editingSiteId = null;
}

function submitNewSite() {
  const name = document.getElementById('newSiteName').value.trim();
  if (!name) {
    alert('Please enter a Project Title / Site name');
    return;
  }

  const client = document.getElementById('newSiteClient').value.trim() || 'MAHESHWARI DISTRIBUTORS';
  const poNumber = document.getElementById('newSitePO').value.trim() || '5100033887';
  const deo = document.getElementById('newSiteDEO').value.trim() || 'Mahender Kumar Gurjar';
  const startDate = document.getElementById('newSiteStartDate').value;
  const endDate = document.getElementById('newSiteEndDate').value;

  const ownerName = document.getElementById('newSiteOwnerName').value.trim() || 'DK Shriwal';
  const ownerPhone = document.getElementById('newSiteOwnerPhone').value.trim() || '8233330578';
  const owner = formatStakeholder(ownerName, ownerPhone);

  const vreName = document.getElementById('newSiteVREName').value.trim() || 'Aarti Bala';
  const vrePhone = document.getElementById('newSiteVREPhone').value.trim() || '8824133320';
  const vre = formatStakeholder(vreName, vrePhone);

  const siteInchargeName = document.getElementById('newSiteInchargeName').value.trim() || 'Dinesh Purohit';
  const siteInchargePhone = document.getElementById('newSiteInchargePhone').value.trim() || '8003698657';
  const siteIncharge = formatStakeholder(siteInchargeName, siteInchargePhone);

  const coordinatorName = document.getElementById('newSiteCoordinatorName').value.trim() || 'Tulsi Sen';
  const coordinatorPhone = document.getElementById('newSiteCoordinatorPhone').value.trim() || '9875789834';
  const coordinator = formatStakeholder(coordinatorName, coordinatorPhone);

  // Check if editing existing site
  if (editingSiteId) {
    const site = sitesData.find(s => s.id === editingSiteId);
    if (site) {
      site.name = name;
      site.client = client;
      site.poNumber = poNumber;
      site.deo = deo;
      site.startDate = startDate;
      site.endDate = endDate;
      site.bufferDays = parseInt(document.getElementById('newSiteBufferDays').value) || 0;
      site.owner = owner;
      site.vre = vre;
      site.siteIncharge = siteIncharge;
      site.coordinator = coordinator;

      saveData();
      populateSiteDropdown();
      renderSites();
      if (activeSiteId === site.id) {
        renderSiteTasks();
      }
      closeAddSiteModal();

      // Real-time Google Sheets Logging
      sendGoogleSheetsLog({
        uniqueId: site.id || ('PMS-SITE-' + Date.now()),
        projectName: site.name,
        action: 'Project Information Updated',
        poNumber: site.poNumber || '',
        client: site.client || '',
        stakeholders: `${site.owner || ''}, ${site.siteIncharge || ''}`,
        status: 'Active',
        updatedBy: site.deo || 'Data Entry Operator'
      });
      return;
    }
  }

  // Creating new site
  const template = document.getElementById('newSiteTemplate').value;
  let initialTasks = [];
  if (template === 'substation' && sitesData.length > 0 && sitesData[0].tasks.length > 0) {
    // Clone standard 101 tasks template with reset quantities
    initialTasks = JSON.parse(JSON.stringify(sitesData[0].tasks)).map(t => ({
      ...t,
      completedQty: 0,
      progressPct: 0,
      remark: ''
    }));
  }

  const newSite = {
    id: 'site-' + Date.now(),
    name,
    client,
    poNumber,
    deo,
    startDate,
    endDate,
    bufferDays: parseInt(document.getElementById('newSiteBufferDays').value) || 0,
    owner,
    vre,
    siteIncharge,
    coordinator,
    tasks: initialTasks
  };

  sitesData.push(newSite);
  saveData();
  populateSiteDropdown();
  renderSites();
  closeAddSiteModal();
  openSiteTasks(newSite.id);

  // Real-time Google Sheets Logging
  sendGoogleSheetsLog({
    uniqueId: newSite.id,
    projectName: newSite.name,
    action: 'New Project Created',
    poNumber: newSite.poNumber || '',
    client: newSite.client || '',
    stakeholders: `${newSite.owner || ''}, ${newSite.siteIncharge || ''}`,
    status: 'Created',
    updatedBy: newSite.deo || 'Data Entry Operator'
  });
}

// ================= MODAL: ADD NEW TASK =================
function openAddTaskModal() {
  const site = sitesData.find(s => s.id === activeSiteId);
  if (!site) return;

  document.getElementById('addTaskSiteLabel').textContent = `Adding to: ${site.name}`;
  // Suggest next ID
  const nextNum = site.tasks.length + 1;
  document.getElementById('newTaskUID').value = `PMS${String(nextNum).padStart(5, '0')}`;
  document.getElementById('newTaskWBS').value = '';
  document.getElementById('newTaskTitle').value = '';
  document.getElementById('newTaskTotalQty').value = '';
  document.getElementById('newTaskCompletedQty').value = '0';
  document.getElementById('newTaskUOM').value = 'Mtr';
  document.getElementById('newTaskDoer').value = site.siteIncharge || '';
  document.getElementById('newTaskDuration').value = '7';
  document.getElementById('newTaskStartDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('newTaskEndDate').value = '';

  // Populate sections dropdown
  const secSelect = document.getElementById('newTaskParentSection');
  secSelect.innerHTML = '<option value="">(At End of List)</option>';
  site.tasks.forEach((t, index) => {
    if (t.isHeader) {
      const opt = document.createElement('option');
      opt.value = index;
      opt.textContent = `${t.wbs ? '[' + t.wbs + '] ' : ''}${t.title.substring(0, 45)}`;
      secSelect.appendChild(opt);
    }
  });

  document.getElementById('modalAddTask').classList.add('open');
}

function closeAddTaskModal() {
  document.getElementById('modalAddTask').classList.remove('open');
}

function submitNewTask() {
  const site = sitesData.find(s => s.id === activeSiteId);
  if (!site) return;

  const uid = document.getElementById('newTaskUID').value.trim();
  const title = document.getElementById('newTaskTitle').value.trim();
  const taskType = document.getElementById('newTaskType').value;

  if (!uid || !title) {
    alert('Please enter Task UID and Title');
    return;
  }

  const isHeader = taskType === 'header';
  const totalQty = isHeader ? null : parseFloat(document.getElementById('newTaskTotalQty').value) || 1;
  const completedQty = isHeader ? 0 : parseFloat(document.getElementById('newTaskCompletedQty').value) || 0;
  const uom = isHeader ? '' : document.getElementById('newTaskUOM').value.trim();
  const pct = isHeader ? 0 : Math.min(Math.round((completedQty / totalQty) * 100), 100);

  const startDate = document.getElementById('newTaskStartDate').value || new Date().toISOString().split('T')[0];
  const endDate = document.getElementById('newTaskEndDate').value || '';
  let durDays = parseInt(document.getElementById('newTaskDuration').value) || 0;
  if (!durDays && startDate && endDate) {
    try {
      const d1 = new Date(startDate);
      const d2 = new Date(endDate);
      durDays = Math.max(1, Math.round((d2 - d1) / (1000 * 60 * 60 * 24)));
    } catch (e) {
      durDays = 1;
    }
  }

  const newTask = {
    id: uid,
    wbs: document.getElementById('newTaskWBS').value.trim(),
    title: title,
    totalQty: totalQty,
    completedQty: completedQty,
    uom: uom,
    doer: document.getElementById('newTaskDoer').value.trim() || site.siteIncharge,
    manpower: '',
    startDate: startDate,
    endDate: endDate,
    duration: durDays || 1,
    progressPct: pct,
    remark: '',
    isHeader: isHeader
  };

  // Check if adding under a specific section
  const parentSecIdxStr = document.getElementById('newTaskParentSection').value;
  if (parentSecIdxStr !== '' && !isHeader) {
    const parentIdx = parseInt(parentSecIdxStr);
    // Find where this section ends (either next header or end of tasks)
    let insertIdx = parentIdx + 1;
    while (insertIdx < site.tasks.length && !site.tasks[insertIdx].isHeader) {
      insertIdx++;
    }
    site.tasks.splice(insertIdx, 0, newTask);
  } else {
    site.tasks.push(newTask);
  }

  saveData();
  renderSiteTasks();
  closeAddTaskModal();

  // Real-time Google Sheets Logging
  sendGoogleSheetsLog({
    uniqueId: newTask.id,
    projectName: site.name,
    action: `New Task Added: ${newTask.title}`,
    poNumber: site.poNumber || '',
    client: site.client || '',
    stakeholders: `${site.owner || ''}, ${newTask.doer || site.siteIncharge || ''}`,
    status: newTask.isHeader ? 'Section' : 'Pending',
    updatedBy: site.deo || 'Data Entry Operator'
  });
}

// Site management actions (Hide, Rename, Delete)
function toggleHideSite(siteId, event) {
  event.stopPropagation();
  const site = sitesData.find(s => s.id === siteId);
  if (site) {
    site.hidden = !site.hidden;
    saveData();
    renderSites();
  }
}

function editSite(siteId, event) {
  if (event) event.stopPropagation();
  const site = sitesData.find(s => s.id === siteId);
  if (site) {
    openAddSiteModal(site);
  }
}

function deleteSite(siteId, event) {
  event.stopPropagation();
  if (confirm('Are you sure you want to delete this site and all its tasks?')) {
    sitesData = sitesData.filter(s => s.id !== siteId);
    if (activeSiteId === siteId) {
      activeSiteId = sitesData.length > 0 ? sitesData[0].id : null;
    }
    saveData();
    populateSiteDropdown();
    renderSites();
  }
}

// Switch between Table View and Gantt View
function switchTaskSubView(subView) {
  const btnTable = document.getElementById('btnViewTable');
  const btnGantt = document.getElementById('btnViewGantt');
  const cardTable = document.getElementById('cardTableView');
  const cardGantt = document.getElementById('cardGanttView');

  if (subView === 'gantt') {
    btnTable.classList.remove('active');
    btnGantt.classList.add('active');
    cardTable.style.display = 'none';
    cardGantt.style.display = 'block';
  } else {
    btnTable.classList.add('active');
    btnGantt.classList.remove('active');
    cardTable.style.display = 'block';
    cardGantt.style.display = 'none';
  }
}

// Event Listeners setup
function setupEventListeners() {
  // Navigation dock buttons
  document.getElementById('dockBtnSites')?.addEventListener('click', () => switchView('sites'));
  document.getElementById('dockBtnTasks')?.addEventListener('click', () => switchView('tasks'));
  document.getElementById('btnBackToSites')?.addEventListener('click', () => switchView('sites'));

  // Table vs Gantt view buttons
  document.getElementById('btnViewTable')?.addEventListener('click', () => switchTaskSubView('table'));
  document.getElementById('btnViewGantt')?.addEventListener('click', () => switchTaskSubView('gantt'));

  // Edit current site meta (from banner)
  document.getElementById('btnEditCurrentSiteMeta')?.addEventListener('click', () => {
    if (activeSiteId) {
      editSite(activeSiteId);
    }
  });

  // Filter & Search
  document.getElementById('chkShowHidden')?.addEventListener('change', renderSites);
  document.getElementById('selectActiveSiteDropdown')?.addEventListener('change', (e) => {
    openSiteTasks(e.target.value);
  });
  document.getElementById('selectStatusFilter')?.addEventListener('change', renderSiteTasks);
  document.getElementById('taskSearchInput')?.addEventListener('input', renderSiteTasks);
  document.getElementById('btnRefreshTasks')?.addEventListener('click', renderSiteTasks);

  // Update Task Modal
  document.getElementById('btnCloseUpdateModal')?.addEventListener('click', closeUpdateModal);
  document.getElementById('btnCancelUpdateModal')?.addEventListener('click', closeUpdateModal);
  document.getElementById('btnSaveTaskProgress')?.addEventListener('click', saveTaskProgress);
  document.getElementById('inputNewCompletedQty')?.addEventListener('input', updateModalLivePreview);

  // Add Site Modal
  document.getElementById('btnOpenNewSiteModal')?.addEventListener('click', openAddSiteModal);
  document.getElementById('btnCloseAddSiteModal')?.addEventListener('click', closeAddSiteModal);
  document.getElementById('btnCancelAddSiteModal')?.addEventListener('click', closeAddSiteModal);
  document.getElementById('btnSubmitAddSite')?.addEventListener('click', submitNewSite);

  // Add Task Modal
  document.getElementById('btnOpenAddTaskModal')?.addEventListener('click', openAddTaskModal);
  document.getElementById('btnDirectBulkAdd')?.addEventListener('click', openBulkAddTasksModal);
  document.getElementById('btnCloseAddTaskModal')?.addEventListener('click', closeAddTaskModal);
  document.getElementById('btnCancelAddTaskModal')?.addEventListener('click', closeAddTaskModal);
  document.getElementById('btnSubmitAddTask')?.addEventListener('click', submitNewTask);

  // Bulk Add Tasks Modal
  const btnOpenBulk = document.getElementById('btnOpenBulkAddTasksModal');
  if (btnOpenBulk) btnOpenBulk.addEventListener('click', openBulkAddTasksModal);
  const btnCloseBulk = document.getElementById('btnCloseBulkAddModal');
  if (btnCloseBulk) btnCloseBulk.addEventListener('click', closeBulkAddTasksModal);
  const btnCancelBulk = document.getElementById('btnCancelBulkAddModal');
  if (btnCancelBulk) btnCancelBulk.addEventListener('click', closeBulkAddTasksModal);

  // Bulk Tabs
  document.getElementById('tabBtnBulkPaste')?.addEventListener('click', () => switchBulkTab('paste'));
  document.getElementById('tabBtnBulkTable')?.addEventListener('click', () => switchBulkTab('table'));
  document.getElementById('tabBtnBulkFile')?.addEventListener('click', () => switchBulkTab('file'));

  // Paste Tab actions
  document.getElementById('btnParsePastedRows')?.addEventListener('click', parsePastedRows);
  document.getElementById('btnLoadSamplePaste')?.addEventListener('click', loadSamplePasteData);
  document.getElementById('btnSubmitBulkTasks')?.addEventListener('click', submitBulkTasks);
  document.getElementById('btnDiscardPreview')?.addEventListener('click', discardBulkPreview);

  // Grid Tab actions
  document.getElementById('btnAddGridRow')?.addEventListener('click', () => addGridRow());
  document.getElementById('btnAddGrid5Rows')?.addEventListener('click', () => { for (let i = 0; i < 5; i++) addGridRow(); });
  document.getElementById('btnClearGridRows')?.addEventListener('click', clearGridRows);

  // File Tab actions
  const fileDrop = document.getElementById('bulkFileDropzone');
  const fileInput = document.getElementById('bulkFileInput');
  const btnBrowse = document.getElementById('btnBrowseBulkFile');
  if (btnBrowse && fileInput) {
    btnBrowse.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleBulkFileSelect);
  }
  if (fileDrop) {
    fileDrop.addEventListener('dragover', (e) => { e.preventDefault(); fileDrop.classList.add('dragover'); });
    fileDrop.addEventListener('dragleave', () => fileDrop.classList.remove('dragover'));
    fileDrop.addEventListener('drop', (e) => {
      e.preventDefault();
      fileDrop.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleBulkFile(e.dataTransfer.files[0]);
      }
    });
  }

  // Hide/Show Qty fields if header is selected
  document.getElementById('newTaskType')?.addEventListener('change', (e) => {
    const isHeader = e.target.value === 'header';
    document.getElementById('qtyUomSection').style.display = isHeader ? 'none' : 'flex';
  });

  // Excel Export Buttons
  const btnExcelTop = document.getElementById('btnExportExcelTop');
  if (btnExcelTop) btnExcelTop.addEventListener('click', exportSiteToExcel);

  const btnExcelBanner = document.getElementById('btnExportCurrentSiteExcel');
  if (btnExcelBanner) btnExcelBanner.addEventListener('click', exportSiteToExcel);

  // Backup & Restore
  document.getElementById('btnExportData')?.addEventListener('click', exportBackup);
  document.getElementById('btnImportData')?.addEventListener('click', () => {
    document.getElementById('fileImporter')?.click();
  });
  document.getElementById('fileImporter')?.addEventListener('change', importBackup);

  // Google Sheets Auto-Sync Modal & Testing
  const btnOpenSheets = document.getElementById('btnOpenSheetsConfigModal');
  if (btnOpenSheets) btnOpenSheets.addEventListener('click', openSheetsConfigModal);
  const btnCloseSheets = document.getElementById('btnCloseSheetsModal');
  if (btnCloseSheets) btnCloseSheets.addEventListener('click', closeSheetsConfigModal);
  const btnCancelSheets = document.getElementById('btnCancelSheetsModal');
  if (btnCancelSheets) btnCancelSheets.addEventListener('click', closeSheetsConfigModal);
  const btnSaveSheets = document.getElementById('btnSaveSheetsConfig');
  if (btnSaveSheets) btnSaveSheets.addEventListener('click', saveSheetsConfig);
  const btnTestSheets = document.getElementById('btnTestSheetsSync');
  if (btnTestSheets) btnTestSheets.addEventListener('click', testGoogleSheetsSync);

  // Actions Dropdown Toggle & Items
  const actionsWrap = document.getElementById('actionsDropdownWrap');
  const actionsBtn = document.getElementById('actionsBtn');
  if (actionsBtn && actionsWrap) {
    actionsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      actionsWrap.classList.toggle('open');
    });

    document.addEventListener('click', (e) => {
      if (!actionsWrap.contains(e.target)) {
        actionsWrap.classList.remove('open');
      }
    });
  }

  // Dropdown Items actions
  const itemBulkAdd = document.getElementById('menuItemBulkAdd');
  if (itemBulkAdd) {
    itemBulkAdd.addEventListener('click', (e) => {
      e.preventDefault();
      actionsWrap.classList.remove('open');
      openBulkAddTasksModal();
    });
  }

  const itemProjectDetails = document.getElementById('menuItemProjectDetails');
  if (itemProjectDetails) {
    itemProjectDetails.addEventListener('click', (e) => {
      e.preventDefault();
      actionsWrap.classList.remove('open');
      if (activeSiteId) editSite(activeSiteId);
    });
  }

  const itemExportExcel = document.getElementById('menuItemExportExcel');
  if (itemExportExcel) {
    itemExportExcel.addEventListener('click', (e) => {
      e.preventDefault();
      actionsWrap.classList.remove('open');
      exportSiteToExcel();
    });
  }

  const itemSheetsSync = document.getElementById('menuItemSheetsSync');
  if (itemSheetsSync) {
    itemSheetsSync.addEventListener('click', (e) => {
      e.preventDefault();
      actionsWrap.classList.remove('open');
      openSheetsConfigModal();
    });
  }

  // Edit Task Modal
  document.getElementById('btnCloseEditTaskModal')?.addEventListener('click', closeEditTaskModal);
  document.getElementById('btnCancelEditTaskModal')?.addEventListener('click', closeEditTaskModal);
  document.getElementById('btnSaveEditTask')?.addEventListener('click', saveEditTask);
  document.getElementById('editTaskType')?.addEventListener('change', (e) => {
    const qtySection = document.getElementById('editQtySection');
    if (qtySection) qtySection.style.display = e.target.value === 'header' ? 'none' : 'flex';
  });

  // Initialize Sheets sync indicator
  updateSheetsIndicator();
}

// ================= GOOGLE SHEETS REAL-TIME SYNC LOGIC =================
const SHEETS_CONFIG_KEY = 'SERVICE_PMS_SHEETS_WEBHOOK_URL';

function getSheetsWebhookUrl() {
  return localStorage.getItem(SHEETS_CONFIG_KEY) || '';
}

function updateSheetsIndicator() {
  const url = getSheetsWebhookUrl();
  const dot = document.getElementById('sheetsSyncDot');
  if (dot) {
    if (url && url.trim()) {
      dot.classList.add('active');
      dot.title = 'Google Sheets Auto-Sync is Active';
    } else {
      dot.classList.remove('active');
      dot.title = 'Click to configure Google Sheets Webhook';
    }
  }
}

function openSheetsConfigModal() {
  const modal = document.getElementById('modalSheetsSync');
  const input = document.getElementById('inputSheetsWebhookUrl');
  const badge = document.getElementById('syncStatusBadge');
  const currentUrl = getSheetsWebhookUrl();

  input.value = currentUrl;
  if (currentUrl) {
    badge.textContent = 'Active (Connected)';
    badge.className = 'sync-status-badge connected';
  } else {
    badge.textContent = 'Not Configured';
    badge.className = 'sync-status-badge';
  }

  modal.classList.add('open');
}

function closeSheetsConfigModal() {
  document.getElementById('modalSheetsSync').classList.remove('open');
}

function saveSheetsConfig() {
  const url = document.getElementById('inputSheetsWebhookUrl').value.trim();
  if (url) {
    localStorage.setItem(SHEETS_CONFIG_KEY, url);
    updateSheetsIndicator();
    closeSheetsConfigModal();
    alert('✅ Google Sheets Auto-Sync Webhook saved! All future updates will be sent in real-time.');
  } else {
    localStorage.removeItem(SHEETS_CONFIG_KEY);
    updateSheetsIndicator();
    closeSheetsConfigModal();
    alert('Google Sheets Auto-Sync disabled.');
  }
}

// Send real-time log payload to Google Sheets Apps Script Webhook
async function sendGoogleSheetsLog(payload) {
  const webhookUrl = getSheetsWebhookUrl();
  if (!webhookUrl) return; // Silent if not configured

  try {
    // Send via POST (mode: no-cors is standard for Google Apps Script redirects)
    await fetch(webhookUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    console.log('Google Sheets entry posted:', payload);
  } catch (err) {
    console.warn('Google Sheets auto-sync notification failed:', err);
  }
}

// Test webhook function with instant feedback
async function testGoogleSheetsSync() {
  const url = document.getElementById('inputSheetsWebhookUrl').value.trim();
  const badge = document.getElementById('syncStatusBadge');

  if (!url) {
    alert('Please enter your Google Apps Script Web App URL first.');
    return;
  }

  badge.textContent = 'Sending...';
  badge.className = 'sync-status-badge';

  const site = sitesData.find(s => s.id === activeSiteId) || sitesData[0] || {};
  const testPayload = {
    uniqueId: 'PMS-TEST-' + Math.floor(1000 + Math.random() * 9000),
    projectName: site.name || 'Test Project',
    action: 'Connection Test Entry',
    poNumber: site.poNumber || '5100033887',
    client: site.client || 'MAHESHWARI DISTRIBUTORS',
    stakeholders: `${site.owner || 'DK Shriwal'}, ${site.siteIncharge || 'Dinesh Purohit'}`,
    status: 'Connected',
    updatedBy: site.deo || 'Service PMS User'
  };

  try {
    await fetch(url, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testPayload)
    });

    badge.textContent = 'Success (Row Appended)';
    badge.className = 'sync-status-badge connected';
    alert('🎉 Test entry sent to Google Sheets! Please check Row 2 in your "Service PMS DB" sheet.');
  } catch (err) {
    badge.textContent = 'Error';
    badge.className = 'sync-status-badge';
    alert('Failed to send test entry: ' + err.message);
  }
}

// ================= BULK ADD / IMPORT TASKS LOGIC =================
let bulkParsedTasks = [];
let activeBulkTab = 'paste';

function openBulkAddTasksModal() {
  const site = sitesData.find(s => s.id === activeSiteId);
  if (!site) {
    alert('Please select or open a site first.');
    return;
  }

  document.getElementById('bulkAddSiteLabel').textContent = `Adding multiple tasks to: ${site.name}`;
  document.getElementById('bulkDefaultDoer').value = site.siteIncharge || 'Ashok Menariya';
  document.getElementById('bulkDefaultQty').value = '1';
  document.getElementById('bulkDefaultUOM').value = 'Mtr';

  // Reset inputs
  document.getElementById('bulkPasteInput').value = '';
  document.getElementById('parsedCountBadge').style.display = 'none';
  bulkParsedTasks = [];
  renderBulkPreview();

  // Initialize table rows if empty
  const tbody = document.getElementById('bulkGridTableBody');
  if (tbody.children.length === 0) {
    clearGridRows();
    for (let i = 0; i < 5; i++) addGridRow();
  }

  switchBulkTab('paste');
  document.getElementById('modalBulkAddTasks').classList.add('open');
}

function closeBulkAddTasksModal() {
  document.getElementById('modalBulkAddTasks').classList.remove('open');
  bulkParsedTasks = [];
}

function switchBulkTab(tabName) {
  activeBulkTab = tabName;
  const tabs = ['paste', 'table', 'file'];
  tabs.forEach(t => {
    const btn = document.getElementById('tabBtnBulk' + t.charAt(0).toUpperCase() + t.slice(1));
    const content = document.getElementById('bulkTabContent' + t.charAt(0).toUpperCase() + t.slice(1));
    if (t === tabName) {
      if (btn) btn.classList.add('active');
      if (content) content.style.display = 'flex';
    } else {
      if (btn) btn.classList.remove('active');
      if (content) content.style.display = 'none';
    }
  });

  const submitBtnText = document.getElementById('btnSubmitBulkText');
  if (tabName === 'table') {
    submitBtnText.textContent = 'Add All Table Rows';
  } else {
    submitBtnText.textContent = 'Add All Tasks to Site';
  }
}

// Sample Leaky Feeder Rows from user's Google Sheet
function loadSamplePasteData() {
  const sample = `6\tShifting of OFC cable and LAN cable in underground (6000 MTR)\tAshok Menariya\t10\t2025-04-21\t2026-03-30
7\tLaying of OFC cable and LAN cable in underground at proper height (6000 MTR)\tAshok Menariya\t11\t2025-04-25\t2026-03-30
8\tSplicing of OFC cable\tAshok Menariya\t12\t2025-04-29\t2026-03-30
9\tCrimping of LAN cable\tAshok Menariya\t13\t2025-05-03\t2026-03-30
10\tInstallation of CCTV camera, Power supply, junction box, power cable & LAN cable\tAshok Menariya\t14\t2025-05-07\t2026-03-30
11\tShifting of cable 3Cx2.5sqmm in underground\tAshok Menariya\t15\t2025-05-11\t2026-03-30
12\tLaying of cable 3Cx2.5sqmm in underground\tAshok Menariya\t16\t2025-05-15\t2026-03-30
13\tInstallation of lights 70W to 165W with junction box, glands, bracket\tAshok Menariya\t17\t2025-05-19\t2026-03-30
14\tInstallation of lighting transformer 5kVA at proper place in underground\tAshok Menariya\t18\t2025-05-23\t2026-03-30
15\tShifting and Laying of Telephone cable in underground at proper height\tAshok Menariya\t19\t2025-05-27\t2026-03-30`;

  document.getElementById('bulkPasteInput').value = sample;
  parsePastedRows();
}

// Parse pasted data from Google Sheet / Excel (Tab or Comma or Semicolon separated)
function parsePastedRows() {
  try {
    const textEl = document.getElementById('bulkPasteInput');
    if (!textEl) {
      alert('Error: Paste input area not found');
      return;
    }
    const text = textEl.value.trim();
    if (!text) {
      alert('Please paste rows into the text area first.');
      return;
    }

    const site = sitesData.find(s => s.id === activeSiteId);
    const defaultDoerEl = document.getElementById('bulkDefaultDoer');
    const defaultQtyEl = document.getElementById('bulkDefaultQty');
    const defaultUOMEl = document.getElementById('bulkDefaultUOM');

    const defaultDoer = (defaultDoerEl ? defaultDoerEl.value.trim() : '') || (site ? site.siteIncharge : 'Site Incharge');
    const defaultQty = defaultQtyEl ? (parseFloat(defaultQtyEl.value) || 1) : 1;
    const defaultUOM = (defaultUOMEl ? defaultUOMEl.value.trim() : '') || 'LS';

    const rawLines = text.split(/\r?\n/);
    const parsed = [];
    let currentNum = site && site.tasks ? site.tasks.length + 1 : 1;

    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i].trim();
      if (!line) continue;

      // Detect separator: Tab, Pipe, 2+ consecutive spaces (Excel text paste), or Comma
      let tokens = [];
      if (line.includes('\t')) {
        tokens = line.split('\t');
      } else if (line.includes('|')) {
        tokens = line.split('|');
      } else if (/\s{2,}/.test(line)) {
        tokens = line.split(/\s{2,}/);
      } else if (line.includes(',')) {
        tokens = line.split(',');
      } else {
        tokens = [line];
      }
      tokens = tokens.map(t => (t || '').trim()).filter(t => t.length > 0);
      if (tokens.length === 0) continue;

      // Skip header rows
      const lowerLine = line.toLowerCase();
      if (lowerLine.includes('task title') && lowerLine.includes('date')) continue;
      if (lowerLine.includes('wbs') && lowerLine.includes('description')) continue;
      if (lowerLine.startsWith('company name') || lowerLine.startsWith('project title')) continue;

      let wbs = '';
      let title = '';
      let doer = defaultDoer;
      let manpower = '6';
      let duration = 7;
      let startDate = '';
      let endDate = '';
      let qty = defaultQty;
      let uom = defaultUOM;

      // Extract all dates present anywhere in the line
      const datesFound = [];
      // Also look for inline dates in the line like DD/MM/YYYY or DD-MM-YYYY
      const dateRegex = /\b(\d{1,2}[-/.]\d{1,2}[-/.]\d{4}|\d{4}[-/.]\d{1,2}[-/.]\d{1,2})\b/g;
      let dateMatch;
      while ((dateMatch = dateRegex.exec(line)) !== null) {
        const parsedD = parseAnyDate(dateMatch[1]);
        if (parsedD && !datesFound.includes(parsedD)) {
          datesFound.push(parsedD);
        }
      }
      if (datesFound.length >= 1) startDate = datesFound[0];
      if (datesFound.length >= 2) endDate = datesFound[1];

      // If token 0 is numeric or short like "1", "1.0", "A1", treat as WBS
      let titleIndex = 0;
      if (tokens.length > 1 && /^([0-9]+(\.[0-9]+)*|[a-zA-Z][0-9]*)$/.test(tokens[0])) {
        wbs = tokens[0];
        titleIndex = 1;
      }

      // Title is the main text token
      title = tokens[titleIndex] || tokens[0];

      // Remove date tokens from tokens to find doer & manpower
      for (let j = titleIndex + 1; j < tokens.length; j++) {
        const tok = tokens[j];
        if (parseAnyDate(tok)) continue; // Date already collected

        // Check if numeric (duration or manpower)
        if (!isNaN(tok)) {
          const numVal = parseInt(tok, 10);
          if (numVal <= 100 && manpower === '6' && j === titleIndex + 1) {
            manpower = String(numVal);
          } else if (numVal > 0 && numVal <= 500) {
            duration = numVal;
          }
        } else if (/[a-zA-Z]/.test(tok) && doer === defaultDoer) {
          // If token looks like a person's name (e.g. Indra Dev, Dinesh Purohit, Ashish)
          if (!tok.includes('/') && !tok.includes('-') && tok.length < 35) {
            doer = tok;
          }
        }
      }

      // If title accidentally captured the doer at the end (e.g. "...in system Indra Dev")
      const commonNames = ['Indra Dev', 'Gopal Choubisa', 'Ashish', 'Dinesh Purohit', 'Ramesh Patel', 'Tulsi Sen', 'Ashok Menariya', 'Mahender Kumar'];
      for (const name of commonNames) {
        if (title.endsWith(name)) {
          title = title.substring(0, title.length - name.length).trim();
          doer = name;
          break;
        }
      }

      // If duration is missing but we have start and end date, calculate duration
      if (startDate && endDate) {
        try {
          const d1 = new Date(startDate);
          const d2 = new Date(endDate);
          const diffDays = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
          if (diffDays > 0) duration = diffDays;
        } catch(e) {}
      }

      // Check if title has Qty hint like (Scope of work) or (-4000 M3)
      const qtyMatch = title.match(/[- (](\d+(?:\.\d+)?)\s*(M3|MTR|NOS|LS|KG|MT|SET|RMT)\b/i);
      if (qtyMatch) {
        qty = parseFloat(qtyMatch[1]);
        uom = qtyMatch[2].toUpperCase();
      }

      if (!title) continue;

      parsed.push({
        id: `PMS${String(currentNum++).padStart(5, '0')}`,
        wbs: wbs || String(parsed.length + 1),
        title: title,
        totalQty: qty,
        completedQty: 0,
        uom: uom,
        doer: doer,
        manpower: manpower,
        duration: duration,
        startDate: startDate || new Date().toISOString().split('T')[0],
        endDate: endDate || '',
        progressPct: 0,
        remark: '',
        isHeader: false
      });
    }

    bulkParsedTasks = parsed;
    renderBulkPreview();

    const countBadge = document.getElementById('parsedCountBadge');
    if (countBadge) {
      countBadge.textContent = `${parsed.length} tasks ready`;
      countBadge.style.display = 'inline-block';
    }

    // Scroll to preview smoothly
    const previewContainer = document.getElementById('bulkPreviewContainer');
    if (previewContainer && parsed.length > 0) {
      previewContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    if (parsed.length === 0) {
      alert('Could not detect any valid tasks. Please make sure you have copied rows from your sheet.');
    }
  } catch (err) {
    console.error('Error parsing rows:', err);
    alert('Parse Error: ' + err.message);
  }
}

function renderBulkPreview() {
  const container = document.getElementById('bulkPreviewContainer');
  const countSpan = document.getElementById('bulkTasksReadyCount');
  const list = document.getElementById('bulkPreviewItemsList');

  if (bulkParsedTasks.length === 0) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'flex';
  countSpan.textContent = bulkParsedTasks.length;
  list.innerHTML = '';

  bulkParsedTasks.slice(0, 8).forEach((task, idx) => {
    const item = document.createElement('div');
    item.className = 'preview-item-row';
    item.innerHTML = `
      <span style="font-weight:700; color:#4f46e5; min-width:65px;">${task.id}</span>
      <span style="color:#64748b; font-weight:600; min-width:40px;">${task.wbs || '-'}</span>
      <span class="preview-item-title">${task.title}</span>
      <div class="preview-item-meta">
        <span><i class="fa-regular fa-user"></i> ${task.doer}</span>
        <span><i class="fa-regular fa-calendar"></i> ${task.duration}d</span>
        <span><strong>${task.totalQty} ${task.uom}</strong></span>
      </div>
    `;
    list.appendChild(item);
  });

  if (bulkParsedTasks.length > 8) {
    const more = document.createElement('div');
    more.style.textAlign = 'center';
    more.style.fontSize = '0.76rem';
    more.style.color = '#64748b';
    more.style.padding = '4px 0';
    more.textContent = `+ and ${bulkParsedTasks.length - 8} more tasks...`;
    list.appendChild(more);
  }
}

function discardBulkPreview() {
  bulkParsedTasks = [];
  renderBulkPreview();
  document.getElementById('parsedCountBadge').style.display = 'none';
}

// Interactive Multi-Row Spreadsheet Table Methods
function addGridRow(data = {}) {
  const tbody = document.getElementById('bulkGridTableBody');
  const rowCount = tbody.children.length + 1;
  const tr = document.createElement('tr');

  const defaultDoer = document.getElementById('bulkDefaultDoer').value || 'Ashok Menariya';
  const defaultQty = document.getElementById('bulkDefaultQty').value || 1;
  const defaultUOM = document.getElementById('bulkDefaultUOM').value || 'Mtr';
  const today = new Date().toISOString().split('T')[0];

  tr.innerHTML = `
    <td style="text-align:center; color:#94a3b8; font-weight:600;">${rowCount}</td>
    <td><input type="text" class="grid-wbs" placeholder="e.g. ${rowCount}" value="${data.wbs || ''}"></td>
    <td><input type="text" class="grid-title" placeholder="Work description / task title" value="${data.title || ''}" required></td>
    <td><input type="text" class="grid-doer" placeholder="Doer" value="${data.doer || defaultDoer}"></td>
    <td><input type="number" step="any" min="0" class="grid-qty" value="${data.totalQty || defaultQty}"></td>
    <td><input type="text" class="grid-uom" value="${data.uom || defaultUOM}"></td>
    <td><input type="number" min="1" class="grid-dur" value="${data.duration || 7}"></td>
    <td><input type="date" class="grid-start" value="${data.startDate || today}"></td>
    <td><input type="date" class="grid-end" value="${data.endDate || ''}"></td>
    <td style="text-align:center;">
      <button type="button" class="bulk-row-del-btn" title="Remove row" onclick="this.closest('tr').remove(); updateGridCounter();">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </td>
  `;

  tbody.appendChild(tr);
  updateGridCounter();
}

function clearGridRows() {
  document.getElementById('bulkGridTableBody').innerHTML = '';
  updateGridCounter();
}

function updateGridCounter() {
  const count = document.getElementById('bulkGridTableBody').children.length;
  document.getElementById('gridRowCountText').textContent = `Total rows: ${count}`;
}

// File Upload Handler (via SheetJS)
function handleBulkFileSelect(e) {
  const file = e.target.files[0];
  if (file) handleBulkFile(file);
}

function handleBulkFile(file) {
  document.getElementById('bulkFileNameIndicator').textContent = `Selected: ${file.name}`;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      if (!json || json.length === 0) {
        alert('Excel sheet is empty.');
        return;
      }

      // Convert sheet data to text string and parse
      const textLines = json.map(row => row.join('\t')).join('\n');
      document.getElementById('bulkPasteInput').value = textLines;
      switchBulkTab('paste');
      parsePastedRows();
      alert(`Excel sheet read successfully! Detected ${bulkParsedTasks.length} tasks.`);
    } catch (err) {
      console.error(err);
      alert('Error reading Excel file. Please ensure it is a valid .xlsx or .xls file.');
    }
  };
  reader.readAsArrayBuffer(file);
}

// Final Submission: Add all tasks to active site
function submitBulkTasks() {
  const site = sitesData.find(s => s.id === activeSiteId);
  if (!site) return;

  let tasksToAdd = [];

  if (activeBulkTab === 'table') {
    // Collect from interactive table
    const rows = document.querySelectorAll('#bulkGridTableBody tr');
    let currentNum = site.tasks.length + 1;

    rows.forEach(tr => {
      const title = tr.querySelector('.grid-title').value.trim();
      if (!title) return; // Skip blank rows

      const wbs = tr.querySelector('.grid-wbs').value.trim();
      const doer = tr.querySelector('.grid-doer').value.trim() || site.siteIncharge;
      const qty = parseFloat(tr.querySelector('.grid-qty').value) || 1;
      const uom = tr.querySelector('.grid-uom').value.trim() || 'Mtr';
      const dur = parseInt(tr.querySelector('.grid-dur').value) || 7;
      const start = tr.querySelector('.grid-start').value || new Date().toISOString().split('T')[0];
      const end = tr.querySelector('.grid-end').value || '';

      tasksToAdd.push({
        id: `PMS${String(currentNum++).padStart(5, '0')}`,
        wbs: wbs,
        title: title,
        totalQty: qty,
        completedQty: 0,
        uom: uom,
        doer: doer,
        duration: dur,
        startDate: start,
        endDate: end,
        progressPct: 0,
        remark: '',
        isHeader: false
      });
    });
  } else {
    // If user clicked submit from Paste/File tab without pressing "Parse", parse now
    if (bulkParsedTasks.length === 0) {
      parsePastedRows();
    }
    tasksToAdd = bulkParsedTasks;
  }

  if (tasksToAdd.length === 0) {
    alert('Please provide at least one valid task to add.');
    return;
  }

  // Append all tasks to site
  tasksToAdd.forEach(t => {
    site.tasks.push(t);
  });

  saveData();
  renderSiteTasks();
  closeBulkAddTasksModal();

  // Real-time Google Sheets Logging
  sendGoogleSheetsLog({
    uniqueId: `PMS-BULK-${tasksToAdd.length}`,
    projectName: site.name,
    action: `Bulk Added ${tasksToAdd.length} Tasks`,
    poNumber: site.poNumber || '',
    client: site.client || '',
    stakeholders: `${site.owner || ''}, ${site.siteIncharge || ''}`,
    status: 'Bulk Imported',
    updatedBy: site.deo || 'Data Entry Operator'
  });

  alert(`✅ Successfully added ${tasksToAdd.length} tasks to ${site.name}!`);
}

// ================= EXPORT LIVE EXCEL SHEET (PLAN VS ACTUAL) =================
function exportSiteToExcel() {
  const site = sitesData.find(s => s.id === activeSiteId) || sitesData[0];
  if (!site) {
    alert('No active project found to export.');
    return;
  }

  if (typeof XLSX === 'undefined') {
    alert('Excel exporter library is loading, please try again in a second.');
    return;
  }

  // Header metadata block matching your original Excel format
  const rows = [
    ["MAHESHWARI DISTRIBUTORS - SERVICE PMS"],
    ["PROJECT TITLE:", site.name],
    ["PO NUMBER:", site.poNumber || "-"],
    ["DATA ENTRY OPERATOR:", site.deo || "-"],
    ["PROJECT START DATE:", site.startDate || "-", "PROJECT END DATE:", site.endDate || "-"],
    ["OWNER:", site.owner || "-", "VRE:", site.vre || "-"],
    ["SITE INCHARGE:", site.siteIncharge || "-", "PROCESS COORDINATOR:", site.coordinator || "-"],
    [], // Blank separator row
    [
      "Unique ID",
      "WBS NUMBER",
      "TASK TITLE / WORK DESCRIPTION",
      "Total Scope Qty",
      "UOM",
      "Assigned Doer",
      "Manpower",
      "PLAN START DATE",
      "PLAN END DATE",
      "DURATION (Days)",
      "COMPLETED QTY",
      "PROGRESS %",
      "STATUS",
      "REMARKS"
    ]
  ];

  // Task rows
  site.tasks.forEach(t => {
    let statusText = "Pending";
    if (t.progressPct >= 100) statusText = "Completed";
    else if (t.progressPct > 0) statusText = "In Progress";

    rows.push([
      t.id || "",
      t.wbs || "",
      t.title || "",
      t.isHeader ? "" : (t.totalQty !== null ? t.totalQty : ""),
      t.uom || "",
      t.doer || "",
      t.manpower || "",
      t.startDate || "",
      t.endDate || "",
      t.duration || "",
      t.isHeader ? "" : (t.completedQty || 0),
      t.isHeader ? "" : `${t.progressPct || 0}%`,
      t.isHeader ? "SECTION" : statusText,
      t.remark || ""
    ]);
  });

  // Create workbook and worksheet
  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Set column widths for clean look
  ws['!cols'] = [
    { wch: 14 }, // Unique ID
    { wch: 12 }, // WBS
    { wch: 45 }, // Title
    { wch: 15 }, // Scope Qty
    { wch: 8 },  // UOM
    { wch: 20 }, // Doer
    { wch: 10 }, // Manpower
    { wch: 14 }, // Start Date
    { wch: 14 }, // End Date
    { wch: 14 }, // Duration
    { wch: 15 }, // Completed Qty
    { wch: 12 }, // Progress %
    { wch: 14 }, // Status
    { wch: 30 }  // Remarks
  ];

  const wb = XLSX.utils.book_new();
  const sheetName = (site.name || "Service PMS").substring(0, 31).replace(/[:\\\/\?\*\[\]]/g, "_");
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  // Trigger download
  const safeFilename = `${site.name.replace(/[^a-zA-Z0-9_\-]/g, '_')}_PMS_${new Date().toISOString().split('T')[0]}.xlsx`;
  XLSX.writeFile(wb, safeFilename);
}

// Backup / Export
function exportBackup() {
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(sitesData, null, 2));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute("href", dataStr);
  downloadAnchor.setAttribute("download", `service_pms_backup_${new Date().toISOString().split('T')[0]}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
}

// Restore / Import
function importBackup(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const imported = JSON.parse(e.target.result);
      if (Array.isArray(imported)) {
        sitesData = imported;
        saveData();
        populateSiteDropdown();
        renderSites();
        if (sitesData.length > 0) activeSiteId = sitesData[0].id;
        alert('Data successfully imported and restored!');
      } else {
        alert('Invalid data format in JSON backup.');
      }
    } catch (err) {
      alert('Error parsing JSON file.');
    }
  };
  reader.readAsText(file);
}

// =====================================================
// BULK TASK DELETE — SUPER ADMIN ONLY
// =====================================================

// Track selected task IDs
const selectedTaskIds = new Set();

/** Called when any row checkbox changes */
function onRowCheckboxChange(chk) {
  const taskId = chk.dataset.id;
  if (chk.checked) {
    selectedTaskIds.add(taskId);
  } else {
    selectedTaskIds.delete(taskId);
  }
  updateBulkActionBar();
  syncSelectAllCheckbox();
}

/** Select All / Deselect All */
function toggleSelectAll(checked) {
  const checkboxes = document.querySelectorAll('#tasksTableBody .row-checkbox');
  checkboxes.forEach(chk => {
    chk.checked = checked;
    if (checked) {
      selectedTaskIds.add(chk.dataset.id);
    } else {
      selectedTaskIds.delete(chk.dataset.id);
    }
  });
  updateBulkActionBar();
}

/** Keep Select All checkbox in sync */
function syncSelectAllCheckbox() {
  const selectAll = document.getElementById('chkSelectAll');
  if (!selectAll) return;
  const all = document.querySelectorAll('#tasksTableBody .row-checkbox');
  const checked = document.querySelectorAll('#tasksTableBody .row-checkbox:checked');
  if (all.length === 0) {
    selectAll.indeterminate = false;
    selectAll.checked = false;
  } else if (checked.length === all.length) {
    selectAll.indeterminate = false;
    selectAll.checked = true;
  } else if (checked.length === 0) {
    selectAll.indeterminate = false;
    selectAll.checked = false;
  } else {
    selectAll.indeterminate = true;
  }
}

/** Update the bulk action bar count and button state */
function updateBulkActionBar() {
  const countEl = document.getElementById('bulkSelectedCount');
  const btn = document.getElementById('btnDeleteSelected');
  const count = selectedTaskIds.size;
  if (countEl) countEl.textContent = count;
  if (btn) {
    btn.disabled = count === 0;
    btn.classList.toggle('active', count > 0);
  }
}

/** Bulk delete confirmation and execution */
function bulkDeleteSelected() {
  if (currentUserRole !== 'Super Admin') {
    alert('Access Denied: Only Super Admin can bulk delete tasks.');
    return;
  }

  const site = sitesData.find(s => s.id === activeSiteId);
  if (!site) return;

  const count = selectedTaskIds.size;
  if (count === 0) return;

  // Build list of selected tasks
  const selectedTasks = site.tasks.filter(t => selectedTaskIds.has(t.id));
  const selectedHeaders = selectedTasks.filter(t => t.isHeader);

  // Safety check: warn if a WBS/header is selected while some of its children are NOT selected
  let safetyWarnings = [];
  selectedHeaders.forEach(header => {
    // Find children: tasks that are NOT headers and appear after this header before next header
    const headerIdx = site.tasks.findIndex(t => t.id === header.id);
    let childTasks = [];
    for (let i = headerIdx + 1; i < site.tasks.length; i++) {
      if (site.tasks[i].isHeader) break;
      childTasks.push(site.tasks[i]);
    }
    const unselectedChildren = childTasks.filter(c => !selectedTaskIds.has(c.id));
    if (unselectedChildren.length > 0) {
      safetyWarnings.push(
        `WBS "${header.wbs || header.title}" has ${unselectedChildren.length} unselected child task(s) that will remain.`
      );
    }
  });

  // Build confirmation message
  let confirmMsg = `Are you sure you want to delete ${count} selected task${count > 1 ? 's' : ''}?\nThis action cannot be undone.`;
  if (safetyWarnings.length > 0) {
    confirmMsg += '\n\n⚠️ Safety Warning:\n' + safetyWarnings.join('\n') + '\n\nOnly explicitly selected rows will be deleted. Unselected child tasks will remain unchanged.';
  }

  if (!confirm(confirmMsg)) return;

  // Perform deletion — only explicitly selected IDs
  const idsToDelete = new Set(selectedTaskIds);
  site.tasks = site.tasks.filter(t => !idsToDelete.has(t.id));

  // Reset selection
  selectedTaskIds.clear();

  saveData();
  renderSiteTasks();

  // Log to Sheets
  sendGoogleSheetsLog({
    uniqueId: `PMS-BULK-DEL-${count}`,
    projectName: site.name,
    action: `Bulk Deleted ${count} Task(s)`,
    poNumber: site.poNumber || '',
    client: site.client || '',
    stakeholders: `${site.owner || ''}, ${site.siteIncharge || ''}`,
    status: 'Deleted',
    updatedBy: 'Super Admin'
  });

  // Show a brief success toast in page
  showBulkDeleteToast(count);
}

/** Minimal non-blocking toast for bulk delete success */
function showBulkDeleteToast(count) {
  let toast = document.getElementById('bulkDeleteToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'bulkDeleteToast';
    toast.className = 'bulk-delete-toast';
    document.body.appendChild(toast);
  }
  toast.innerHTML = `<i class="fa-solid fa-trash-can"></i> ${count} task${count > 1 ? 's' : ''} deleted successfully.`;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}


// Global window attachments for guaranteed HTML onclick access
window.parsePastedRows = parsePastedRows;
window.submitBulkTasks = submitBulkTasks;
window.closeBulkAddTasksModal = closeBulkAddTasksModal;
window.openBulkAddTasksModal = openBulkAddTasksModal;
window.switchBulkTab = switchBulkTab;
window.openEditTaskModal = openEditTaskModal;
window.closeEditTaskModal = closeEditTaskModal;
window.openUpdateModal = openUpdateModal;
window.closeUpdateModal = closeUpdateModal;
