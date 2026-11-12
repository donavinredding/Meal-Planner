// ====================================================================
// APP INIT & GITHUB CONFIG
// ====================================================================
const GH_CONFIG = {
  owner: "donavinredding",
  repo: "Meal-Planner",
  branch: "main",
  dataPath: "data.json",
  tokenKey: "gh_publish_token"
};

let currentUser = null; // Represents the admin state now
let activeInventory = [];
let activeRecipes = [];
let activeCalendar = [];
let activeManualBuyItems = [];
let activeFilterTag = 'ALL';
let confirmCallback = null;
let activeTargetQtyInput = null;
let saveTimeout = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupModalHandlers();
  
  // Initialize Admin State
  window.isAdminUnlocked = !!localStorage.getItem(GH_CONFIG.tokenKey);
  updateAdminUI();
  
  loadDataFromGitHub();
});

// ====================================================================
// GITHUB API HELPERS & ADMIN STATE
// ====================================================================
function isAdmin() {
  return window.isAdminUnlocked;
}

function updateAdminUI() {
  const hasToken = !!localStorage.getItem(GH_CONFIG.tokenKey);
  const statusEl = document.getElementById("admin-status");
  
  if (window.isAdminUnlocked) {
    if (statusEl) statusEl.textContent = "🔓 Unlocked on this browser";
    document.getElementById("btn-unlock").style.display = "none";
    document.getElementById("btn-lock").style.display = "block";
    document.getElementById("btn-forget").style.display = "block";
    document.body.classList.add("admin-unlocked");
  } else {
    if (statusEl) statusEl.textContent = hasToken ? "🔒 Locked (Token Saved)" : "🔒 Locked (No Token)";
    document.getElementById("btn-unlock").style.display = "block";
    document.getElementById("btn-lock").style.display = "none";
    document.getElementById("btn-forget").style.display = hasToken ? "block" : "none";
    document.body.classList.remove("admin-unlocked");
  }
}

function toggleAdminPanel() {
  const panel = document.getElementById("admin-panel");
  if (!panel) return;
  panel.classList.toggle("hidden");
  updateAdminUI();
}

function openTokenModal() {
  document.getElementById("token-input").value = "";
  document.getElementById("token-modal").classList.remove("hidden");
}

function saveToken() {
  const token = document.getElementById("token-input").value.trim();
  if (!token) return alert("Please enter a valid token.");
  
  localStorage.setItem(GH_CONFIG.tokenKey, token);
  window.isAdminUnlocked = true;
  document.getElementById("token-modal").classList.add("hidden");
  updateAdminUI();
}

function lockAdmin() {
  window.isAdminUnlocked = false;
  updateAdminUI();
}

function confirmForgetToken() {
  if (confirm("Are you sure you want to completely remove the GitHub token from this browser? You will have to paste it again next time.")) {
    localStorage.removeItem(GH_CONFIG.tokenKey);
    window.isAdminUnlocked = false;
    updateAdminUI();
  }
}

function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function loadDataFromGitHub() {
  try {
    const res = await fetch(`./${GH_CONFIG.dataPath}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error("data.json not found");
    const data = await res.json();
    
    activeInventory = data.inventory || [];
    activeRecipes = data.recipes || [];
    activeCalendar = data.calendar_meals || [];
    activeManualBuyItems = data.manualBuyItems || [];

    renderCalendar();
    renderInventory();
    renderRecipes();
    renderNeedToBuy();
  } catch (err) {
    console.error("Load error:", err);
    renderCalendar();
  }
}

function queueSave() {
  if (!isAdmin()) return;
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    const token = localStorage.getItem(GH_CONFIG.tokenKey);
    if (!token) return;

    const payload = {
      version: 1,
      updatedAt: new Date().toISOString(),
      inventory: activeInventory,
      recipes: activeRecipes,
      calendar_meals: activeCalendar,
      manualBuyItems: activeManualBuyItems
    };

    const apiUrl = `https://api.github.com/repos/${GH_CONFIG.owner}/${GH_CONFIG.repo}/contents/${GH_CONFIG.dataPath}`;
    const headers = {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json",
      "Content-Type": "application/json"
    };

    try {
      const getRes = await fetch(`${apiUrl}?ref=${GH_CONFIG.branch}`, { headers });
      let sha = null;
      if (getRes.ok) {
        const fileData = await getRes.json();
        sha = fileData.sha;
      }

      const putRes = await fetch(apiUrl, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          message: "Update app data",
          content: toBase64(JSON.stringify(payload, null, 2)),
          sha: sha,
          branch: GH_CONFIG.branch
        })
      });

      if (!putRes.ok) throw new Error("Failed to save");
      console.log("✅ Saved to GitHub");
    } catch (err) {
      console.error("❌ Save Error:", err);
      alert("Failed to save changes to GitHub. Check your token.");
    }
  }, 1000); // Wait 1 second before saving to prevent spam
}

// ====================================================================
// UTILS & UNIT CONVERSION (UNCHANGED)
// ====================================================================
const VOLUME_CONVERSIONS_FL_OZ = {
  'tsp': 0.1666667, 'teaspoon': 0.1666667, 'tbsp': 0.5, 'tablespoon': 0.5,
  'cup': 8.0, 'cups': 8.0, 'oz': 1.0, 'fl_oz': 1.0, 'fl oz': 1.0,
  'gallon': 128.0, 'gallons': 128.0, 'l': 33.814, 'liter': 33.814,
  'piece': 1.0, 'count': 1.0, 'can': 1.0, 'pack': 1.0
};

function normalizeUnitKey(unitStr) {
  if (!unitStr) return 'count';
  const clean = String(unitStr).toLowerCase().trim().replace(/_/g, ' ');
  if (clean === 'fl oz' || clean === 'floz' || clean === 'fl_oz' || clean === 'oz') return 'fl_oz';
  if (clean === 'cup' || clean === 'cups') return 'cup';
  if (clean === 'gallon' || clean === 'gallons') return 'gallon';
  if (clean === 'tsp' || clean === 'teaspoon') return 'tsp';
  if (clean === 'tbsp' || clean === 'tablespoon') return 'tbsp';
  if (clean === 'l' || clean === 'liter' || clean === 'liters') return 'l';
  return clean;
}

function convertQuantityUnit(amount, fromUnit, toUnit) {
  const normFrom = normalizeUnitKey(fromUnit);
  const normTo = normalizeUnitKey(toUnit);
  if (normFrom === normTo) return amount;
  const fromBase = VOLUME_CONVERSIONS_FL_OZ[normFrom] || 1.0;
  const toBase = VOLUME_CONVERSIONS_FL_OZ[normTo] || 1.0;
  return (amount * fromBase) / toBase;
}

function decimalToFractionStr(val, isTspScale = false) {
  if (val === 0) return '0';
  const isNegative = val < 0;
  const absVal = Math.abs(val);
  const wholePart = Math.floor(absVal);
  const fracPart = absVal - wholePart;

  if (fracPart < 0.005) return `${isNegative ? '-' : ''}${wholePart}`;

  const denominatorScale = (isTspScale || absVal < 0.25) ? 32 : 16;
  const roundedSteps = Math.round(fracPart * denominatorScale);

  if (roundedSteps === 0) return `${isNegative ? '-' : ''}${wholePart}`;
  if (roundedSteps === denominatorScale) return `${isNegative ? '-' : ''}${wholePart + 1}`;

  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  let num = roundedSteps, den = denominatorScale;
  let common = gcd(num, den);
  num /= common; den /= common;

  if (wholePart > 0) return `${isNegative ? '-' : ''}${wholePart} ${num}/${den}`;
  return `${isNegative ? '-' : ''}${num}/${den}`;
}

function parseQuantity(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  const str = String(value).trim();
  if (!str) return 0;

  const cleanNumStr = str.replace(/[^\d\.\s\/]/g, '').trim();
  if (cleanNumStr.includes('/')) {
    const parts = cleanNumStr.split(' ');
    if (parts.length === 2) {
      const whole = parseFloat(parts[0]) || 0;
      const [num, den] = parts[1].split('/').map(Number);
      return den ? whole + (num / den) : whole;
    } else if (parts.length === 1) {
      const [num, den] = parts[0].split('/').map(Number);
      return den ? num / den : 0;
    }
  }
  return parseFloat(cleanNumStr) || 0;
}

function parseUnitFromLabel(value) {
  if (!value) return '';
  const str = String(value).trim();
  return normalizeUnitKey(str.replace(/[\d\.\s\/]/g, '').trim());
}

function formatLocalDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function normalizeDateStr(dateVal) {
  if (!dateVal) return '';
  return dateVal.split('T')[0];
}

function getCurrentWeekSunday() {
  const now = new Date();
  const sunday = new Date(now);
  sunday.setDate(now.getDate() - now.getDay());
  sunday.setHours(0, 0, 0, 0);
  return sunday;
}

// ====================================================================
// UI & NAVIGATION
// ====================================================================
function setupNavigation() {
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      const button = e.target.closest('.tab-btn');
      if (!button) return;
      const targetTab = button.getAttribute('data-tab');
      tabs.forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      button.classList.add('active');
      const targetSection = document.getElementById(`${targetTab}-tab`);
      if (targetSection) targetSection.classList.add('active');
    });
  });

  const tagPills = document.querySelectorAll('.tag-pill');
  tagPills.forEach(pill => {
    pill.addEventListener('click', (e) => {
      tagPills.forEach(p => p.classList.remove('active'));
      const target = e.target.closest('.tag-pill');
      target.classList.add('active');
      activeFilterTag = target.getAttribute('data-tag');
      renderInventory();
    });
  });

  const searchInput = document.getElementById('inventory-search');
  if (searchInput) searchInput.addEventListener('input', renderInventory);
}

// ====================================================================
// CALENDAR MODULE
// ====================================================================
function calculateTitleFontSize(text) {
  const len = text ? text.length : 0;
  if (len === 0) return '0.95rem';
  if (len <= 6) return '1.85rem';
  if (len <= 12) return '1.45rem';
  if (len <= 18) return '1.15rem';
  if (len <= 26) return '0.95rem';
  return '0.8rem';
}

function checkMealIngredientDeficits(meal) {
  if (!meal) return false;
  let reqIngs = meal.ingredients || [];
  if (reqIngs.length === 0 && meal.recipe_id) {
    const recipe = activeRecipes.find(r => r.id === meal.recipe_id);
    if (recipe) reqIngs = recipe.recipe_ingredients || [];
  }

  for (const req of reqIngs) {
    const invItem = activeInventory.find(i => i.name.toLowerCase() === req.ingredient_name.toLowerCase());
    if (!invItem) return true;
    const convertedReqQty = convertQuantityUnit(parseQuantity(req.required_quantity), req.unit, invItem.unit);
    if (invItem.quantity < convertedReqQty || invItem.quantity < -0.0001) return true;
  }
  return false;
}

function renderCalendar() {
  const grid = document.getElementById('calendar-grid');
  if (!grid) return;
  grid.innerHTML = '';
  const sunday = getCurrentWeekSunday();
  const todayStr = formatLocalDate(new Date());

  // Optional: Automatically purge old meals locally
  activeCalendar = activeCalendar.filter(m => normalizeDateStr(m.meal_date) >= formatLocalDate(sunday));

  for (let i = 0; i < 14; i++) {
    const current = new Date(sunday);
    current.setDate(sunday.getDate() + i);
    const dateStr = formatLocalDate(current);
    const dayName = current.toLocaleDateString('en-US', { weekday: 'short' });
    const monthDay = current.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const isToday = dateStr === todayStr;
    const meal = activeCalendar.find(m => normalizeDateStr(m.meal_date) === dateStr);
    const hasDeficit = checkMealIngredientDeficits(meal);

    const titleText = meal ? (meal.custom_title || 'Scheduled Meal') : '+ Add Meal';
    const fontSize = meal ? calculateTitleFontSize(titleText) : '0.95rem';

    const card = document.createElement('div');
    card.className = `calendar-day-card ${isToday ? 'is-today' : ''} ${hasDeficit ? 'has-warning' : ''}`;
    card.innerHTML = `
      <div class="day-header">
        <span class="day-title">${dayName}${isToday ? ' <span class="today-badge">Today</span>' : ''}</span>
        <span>${monthDay}</span>
      </div>
      <div class="meal-name-container">
        <div class="meal-name ${!meal ? 'empty-meal' : ''}" style="font-size: ${fontSize};">${titleText}</div>
      </div>
      ${hasDeficit ? '<div><span class="warning-badge">⚠️ Partial Shortage</span></div>' : ''}
    `;
    card.onclick = () => openMealModal(dateStr, meal);
    grid.appendChild(card);
  }
}

// ====================================================================
// INVENTORY MODULE
// ====================================================================
function renderInventory() {
  const list = document.getElementById('inventory-list');
  const expiredList = document.getElementById('expired-list');
  const searchInput = document.getElementById('inventory-search');
  const searchVal = searchInput ? searchInput.value.toLowerCase() : '';

  if (!list || !expiredList) return;
  list.innerHTML = ''; expiredList.innerHTML = '';

  const today = new Date(); today.setHours(0,0,0,0);
  const todayStr = formatLocalDate(today);
  const soonStr = formatLocalDate(new Date(today.getTime() + 3 * 86400000));

  activeInventory.forEach((item, index) => {
    const matchesSearch = item.name.toLowerCase().includes(searchVal);
    const matchesTag = activeFilterTag === 'ALL' || item.category === activeFilterTag;
    const isExpired = item.expiration_date && normalizeDateStr(item.expiration_date) < todayStr;
    const isSoon = item.expiration_date && normalizeDateStr(item.expiration_date) >= todayStr && normalizeDateStr(item.expiration_date) <= soonStr;
    const isNeg = item.quantity < -0.0001;

    if (isExpired) {
      const card = document.createElement('div');
      card.className = 'polaroid-card expired-item';
      card.innerHTML = `
        <div>
          <h3>${item.name}</h3>
          <p><strong>Expired:</strong> ${item.expiration_date}</p>
          <p><strong>Category:</strong> ${item.category}</p>
        </div>
        <div class="card-actions admin-only">
          <button class="btn btn-secondary" onclick="openRestockModal('${item.id}', '${item.name}', '${item.category}')">Restock</button>
          <button class="btn btn-danger" onclick="confirmDeleteInventory('${item.id}')">Discard</button>
        </div>
      `;
      expiredList.appendChild(card);
    } else if (matchesSearch && matchesTag) {
      const card = document.createElement('div');
      card.className = `polaroid-card ${isSoon ? 'soon-to-expire' : ''} ${isNeg ? 'negative-stock' : ''}`;
      const formattedStock = decimalToFractionStr(item.quantity, item.unit === 'tsp');
      card.innerHTML = `
        <div>
          <h3>${item.name}</h3>
          <p><strong>Stock:</strong> ${formattedStock} ${item.unit}</p>
          <p><strong>Category:</strong> ${item.category}</p>
          ${item.expiration_date ? `<p><strong>Exp:</strong> ${item.expiration_date}</p>` : ''}
          ${isNeg ? '<span class="audit-badge">📌 Pending Meal Deductions</span>' : ''}
          ${isSoon ? '<span class="soon-badge">⚠️ Soon to Expire</span>' : ''}
        </div>
        <div class="card-actions admin-only">
          <button class="btn btn-secondary" onclick="openEditInventory('${item.id}')">Edit</button>
          <button class="btn btn-danger" onclick="confirmDeleteInventory('${item.id}')">Delete</button>
        </div>
      `;
      list.appendChild(card);
    }
  });
}

function updateMealIngredientsInStock(oldIngredients, newIngredients) {
  if (!isAdmin()) return;
  if (oldIngredients) {
    oldIngredients.forEach(ing => {
      const item = activeInventory.find(i => i.name.toLowerCase() === ing.ingredient_name.toLowerCase());
      if (item) item.quantity += convertQuantityUnit(parseQuantity(ing.required_quantity), ing.unit, item.unit);
    });
  }
  if (newIngredients) {
    newIngredients.forEach(ing => {
      const item = activeInventory.find(i => i.name.toLowerCase() === ing.ingredient_name.toLowerCase());
      if (item) item.quantity -= convertQuantityUnit(parseQuantity(ing.required_quantity), ing.unit, item.unit);
    });
  }
  queueSave();
}

// ====================================================================
// NEED TO BUY MODULE
// ====================================================================
function renderNeedToBuy() {
  const container = document.getElementById('shopping-list');
  if (!container) return;
  container.innerHTML = '';

  const today = new Date(); today.setHours(0,0,0,0);
  const todayStr = formatLocalDate(today);
  const soonStr = formatLocalDate(new Date(today.getTime() + 3 * 86400000));
  const active14Days = [];
  const sunday = getCurrentWeekSunday();
  for (let i = 0; i < 14; i++) active14Days.push(formatLocalDate(new Date(sunday.getTime() + i * 86400000)));

  const mealReqs = new Map();
  activeCalendar.forEach(meal => {
    if (!active14Days.includes(normalizeDateStr(meal.meal_date))) return;
    let reqIngs = meal.ingredients || [];
    if (reqIngs.length === 0 && meal.recipe_id) {
      const recipe = activeRecipes.find(r => r.id === meal.recipe_id);
      if (recipe) reqIngs = recipe.recipe_ingredients || [];
    }
    reqIngs.forEach(req => {
      const key = req.ingredient_name.toLowerCase();
      const invItem = activeInventory.find(i => i.name.toLowerCase() === key);
      const targetUnit = invItem ? invItem.unit : req.unit;
      const convQty = convertQuantityUnit(parseQuantity(req.required_quantity), req.unit || targetUnit, targetUnit);

      const curr = mealReqs.get(key) || { totalReq: 0, unit: targetUnit, titles: [] };
      curr.totalReq += convQty;
      curr.unit = targetUnit;
      if (meal.custom_title) curr.titles.push(meal.custom_title);
      mealReqs.set(key, curr);
    });
  });

  const shopMap = new Map();
  activeInventory.forEach(item => {
    const key = item.name.toLowerCase();
    const isExp = item.expiration_date && normalizeDateStr(item.expiration_date) < todayStr;
    const isSoon = item.expiration_date && normalizeDateStr(item.expiration_date) >= todayStr && normalizeDateStr(item.expiration_date) <= soonStr;
    const reqData = mealReqs.get(key);
    const needed = reqData ? reqData.totalReq : 0;
    const deficit = needed - (isExp ? 0 : Math.max(0, item.quantity));

    if (isExp || isSoon || item.quantity < 0 || deficit > 0) {
      let status = '', displayDeficit = 0;
      if (deficit > 0) { displayDeficit = deficit; status = `Meal Requirement (${reqData.titles.join(', ') || 'Planned Meal'})`; }
      else if (item.quantity < 0) { displayDeficit = Math.abs(item.quantity); status = 'Pending Deficit'; }
      else if (isExp) { displayDeficit = 1; status = 'Expired'; }
      else if (isSoon) { displayDeficit = 1; status = `Soon to Expire (${item.expiration_date})`; }

      shopMap.set(key, { id: item.id, name: item.name, category: item.category || 'General', neededQty: decimalToFractionStr(displayDeficit, item.unit === 'tsp'), unit: item.unit, status });
    }
  });

  activeManualBuyItems.forEach(man => {
    const key = man.name.toLowerCase();
    if (!shopMap.has(key)) {
      shopMap.set(key, { id: man.invId || '', name: man.name, category: man.category || 'General', neededQty: man.amount, unit: man.unit || 'count', status: 'Manually Added', isManual: true, indexKey: man.id });
    }
  });

  if (shopMap.size === 0) {
    container.innerHTML = '<p style="color: var(--text-muted);">Your shopping list is currently clear!</p>';
    return;
  }

  shopMap.forEach(item => {
    const div = document.createElement('div');
    div.className = 'shopping-item urgent';
    div.innerHTML = `
      <div class="shopping-info">
        <h4>${item.name}</h4>
        <div class="shopping-meta"><span>Deficit: <strong>${item.neededQty} ${item.unit}</strong></span> | <span>Reason: <strong>${item.status}</strong></span></div>
      </div>
      <div style="display: flex; gap: 8px;" class="admin-only">
        <button class="btn btn-primary" onclick="openRestockModal('${item.id || ''}', '${item.name}', '${item.category}')">✓ Restock</button>
        ${item.isManual ? `<button class="btn btn-danger" onclick="removeManualBuyItem('${item.indexKey}')">✕ Remove</button>` : ''}
      </div>
    `;
    container.appendChild(div);
  });
}

function removeManualBuyItem(id) {
  activeManualBuyItems = activeManualBuyItems.filter(i => i.id !== id);
  renderNeedToBuy();
  queueSave();
}

// ====================================================================
// RECIPE MODULE
// ====================================================================
function renderRecipes() {
  const container = document.getElementById('recipe-list');
  if (!container) return;
  container.innerHTML = '';

  activeRecipes.forEach(recipe => {
    const card = document.createElement('div');
    card.className = 'polaroid-card';
    const ings = recipe.recipe_ingredients?.map(i => {
      const lbl = i.display_label || `${decimalToFractionStr(parseQuantity(i.required_quantity), i.unit === 'tsp')} ${i.unit}`;
      return `• ${i.ingredient_name}: ${lbl}`;
    }).join('<br>') || '<em>No ingredients</em>';

    card.innerHTML = `
      <div>
        <h3>${recipe.title}</h3>
        <p><strong>Prep Notes:</strong> ${recipe.prep_notes || 'None'}</p>
        <p style="font-size:0.85rem; margin-top:8px;"><strong>Ingredients:</strong><br>${ings}</p>
      </div>
      <div class="card-actions admin-only" style="margin-top:15px;">
        <button class="btn btn-primary" onclick="openAssignRecipeModal('${recipe.id}')">Assign</button>
        <button class="btn btn-secondary" onclick="openEditRecipeModal('${recipe.id}')">Edit</button>
        <button class="btn btn-danger" onclick="confirmDeleteRecipe('${recipe.id}')">Delete</button>
      </div>
    `;
    container.appendChild(card);
  });
}

// ====================================================================
// INGREDIENT UI HELPERS
// ====================================================================
function createIngredientRowHTML(selectedName = '', selectedQty = 1, displayLabel = '', selectedUnit = '') {
  let options = '<option value="">-- Select Item --</option>';
  const targetInv = activeInventory.find(i => i.name.toLowerCase() === selectedName.toLowerCase());
  const actualTargetUnit = selectedUnit || (targetInv ? targetInv.unit : 'count');

  activeInventory.forEach(inv => {
    const isSel = inv.name.toLowerCase() === selectedName.toLowerCase() ? 'selected' : '';
    options += `<option value="${inv.name}" data-unit="${inv.unit}" ${isSel}>${inv.name} (${inv.unit})</option>`;
  });

  const rawNum = parseQuantity(selectedQty);
  const valueStr = displayLabel || `${decimalToFractionStr(rawNum, actualTargetUnit === 'tsp')} ${actualTargetUnit}`;
  const isDisabled = !selectedName ? 'disabled style="flex: 1; cursor: not-allowed; opacity: 0.6;"' : 'style="flex: 1; cursor: pointer;"';

  return `
    <div class="ingredient-row" style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px;">
      <select class="input-field ingredient-item-select" style="flex: 2;" onchange="handleIngredientSelection(this)">${options}</select>
      <input type="text" class="input-field ingredient-qty-input" placeholder="${selectedName ? 'Qty' : 'Select item'}" value="${selectedName ? valueStr : ''}" data-converted-qty="${rawNum}" data-unit="${actualTargetUnit}" ${isDisabled} readonly onclick="openConverterModal(this)">
      <button type="button" class="btn btn-danger" onclick="this.parentElement.remove()" style="padding: 6px 12px;">✕</button>
    </div>
  `;
}

function handleIngredientSelection(selectEl) {
  const row = selectEl.parentElement;
  const qtyInput = row.querySelector('.ingredient-qty-input');
  const name = selectEl.value;
  if (name) {
    const inv = activeInventory.find(i => i.name.toLowerCase() === name.toLowerCase());
    qtyInput.removeAttribute('disabled');
    qtyInput.style.cursor = 'pointer';
    qtyInput.style.opacity = '1';
    qtyInput.placeholder = 'Qty';
    qtyInput.setAttribute('data-unit', inv ? inv.unit : 'count');
  } else {
    qtyInput.setAttribute('disabled', 'true');
    qtyInput.style.cursor = 'not-allowed';
    qtyInput.style.opacity = '0.6';
    qtyInput.value = '';
    qtyInput.placeholder = 'Select item';
    qtyInput.removeAttribute('data-unit');
  }
}

function openConverterModal(inputEl) {
  if (inputEl.hasAttribute('disabled')) return;
  activeTargetQtyInput = inputEl;
  const row = inputEl.parentElement;
  const select = row.querySelector('.ingredient-item-select');
  const inv = activeInventory.find(i => i.name.toLowerCase() === select.value.toLowerCase());
  const targetUnit = inv ? inv.unit : 'piece';
  document.getElementById('converter-target-unit').innerText = targetUnit;
  document.getElementById('converter-whole-select').value = "0";
  document.getElementById('converter-fraction-select').value = "0";
  document.getElementById('converter-unit-select').value = targetUnit;
  document.getElementById('converter-modal').classList.remove('hidden');
}

function collectIngredientsFromContainer(containerId) {
  const rows = document.getElementById(containerId).querySelectorAll('.ingredient-row');
  const ings = [];
  rows.forEach(row => {
    const select = row.querySelector('.ingredient-item-select');
    const qtyInput = row.querySelector('.ingredient-qty-input');
    if (!select.value) return;
    const inv = activeInventory.find(i => i.name.toLowerCase() === select.value.toLowerCase());
    const targetUnit = inv ? inv.unit : 'piece';
    const rawVal = qtyInput.getAttribute('data-converted-qty');
    ings.push({
      ingredient_name: select.value,
      required_quantity: rawVal ? parseFloat(rawVal) : parseQuantity(qtyInput.value),
      unit: targetUnit,
      display_label: qtyInput.value
    });
  });
  return ings;
}

// ====================================================================
// MODAL & EVENT HANDLERS
// ====================================================================
function setupModalHandlers() {
  document.querySelectorAll('.close-modal').forEach(btn => btn.onclick = () => document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden')));

  document.getElementById('btn-calculate-unit').onclick = () => {
    if (!activeTargetQtyInput) return;
    const selUnit = document.getElementById('converter-unit-select').value;
    const whole = parseFloat(document.getElementById('converter-whole-select').value) || 0;
    const frac = parseFloat(document.getElementById('converter-fraction-select').value) || 0;
    const total = whole + frac;
    const targetUnit = document.getElementById('converter-target-unit').innerText;
    const converted = convertQuantityUnit(total, selUnit, targetUnit);

    const fracText = document.getElementById('converter-fraction-select').options[document.getElementById('converter-fraction-select').selectedIndex].text.split('(')[0].trim();
    let label = whole > 0 && frac > 0 ? `${whole} ${fracText} ${selUnit}` : (whole > 0 ? `${whole} ${selUnit}` : `${fracText || '0'} ${selUnit}`);

    activeTargetQtyInput.value = label;
    activeTargetQtyInput.setAttribute('data-converted-qty', converted);
    activeTargetQtyInput.setAttribute('data-unit', targetUnit);
    document.getElementById('converter-modal').classList.add('hidden');
  };

  document.getElementById('btn-add-need-to-buy').onclick = () => {
    if (!isAdmin()) return alert("Unlock Admin first");
    document.getElementById('add-buy-item-form').reset();
    document.getElementById('add-buy-item-modal').classList.remove('hidden');
  };

  document.getElementById('add-buy-item-form').onsubmit = (e) => {
    e.preventDefault();
    const name = document.getElementById('buy-item-name').value.trim();
    const inv = activeInventory.find(i => i.name.toLowerCase() === name.toLowerCase());
    activeManualBuyItems.push({
      id: 'manual_' + Date.now(),
      invId: inv ? inv.id : '',
      name: name,
      amount: document.getElementById('buy-item-amount').value.trim() || '1',
      category: document.getElementById('buy-item-category').value,
      unit: document.getElementById('buy-item-unit').value || (inv ? inv.unit : 'count')
    });
    document.getElementById('add-buy-item-modal').classList.add('hidden');
    renderNeedToBuy();
    queueSave();
  };

  document.getElementById('btn-add-inventory').onclick = () => {
    if (!isAdmin()) return alert("Unlock Admin first");
    document.getElementById('inventory-form').reset();
    document.getElementById('inv-id').value = '';
    document.getElementById('inventory-modal-title').innerText = 'Add Inventory Item';
    document.getElementById('inventory-modal').classList.remove('hidden');
  };

  document.getElementById('btn-add-meal-ingredient').onclick = () => document.getElementById('meal-ingredients-list').insertAdjacentHTML('beforeend', createIngredientRowHTML());
  document.getElementById('btn-add-recipe-ingredient').onclick = () => document.getElementById('recipe-ingredients-list').insertAdjacentHTML('beforeend', createIngredientRowHTML());

  document.getElementById('btn-add-recipe').onclick = () => {
    if (!isAdmin()) return alert("Unlock Admin first");
    document.getElementById('recipe-form').reset();
    document.getElementById('recipe-id').value = '';
    document.getElementById('recipe-ingredients-list').innerHTML = '';
    document.getElementById('recipe-modal-title').innerText = 'Create Recipe';
    document.getElementById('recipe-modal').classList.remove('hidden');
  };

  document.getElementById('btn-clear-day-fields').onclick = () => {
    document.getElementById('meal-title').value = '';
    document.getElementById('meal-notes').value = '';
    document.getElementById('meal-ingredients-list').innerHTML = '';
    document.getElementById('meal-recipe-select').value = '';
  };

  document.getElementById('confirm-btn-proceed').onclick = () => { if (confirmCallback) confirmCallback(); document.getElementById('confirm-modal').classList.add('hidden'); };
  document.getElementById('confirm-btn-cancel').onclick = () => document.getElementById('confirm-modal').classList.add('hidden');

  // Forms
  document.getElementById('inventory-form').onsubmit = (e) => {
    e.preventDefault();
    const id = document.getElementById('inv-id').value;
    const payload = {
      id: id || Date.now().toString(),
      name: document.getElementById('inv-name').value,
      category: document.getElementById('inv-category').value,
      quantity: parseQuantity(document.getElementById('inv-qty').value),
      unit: document.getElementById('inv-unit').value,
      expiration_date: document.getElementById('inv-exp').value || null
    };
    if (id) {
      const idx = activeInventory.findIndex(i => i.id === id);
      if (idx > -1) activeInventory[idx] = payload;
    } else activeInventory.push(payload);
    document.getElementById('inventory-modal').classList.add('hidden');
    renderInventory(); renderCalendar(); renderNeedToBuy(); queueSave();
  };

  document.getElementById('restock-form').onsubmit = (e) => {
    e.preventDefault();
    const invId = document.getElementById('restock-inv-id').value;
    const name = document.getElementById('restock-item-name').innerText;
    const qty = parseQuantity(document.getElementById('restock-qty').value);
    const exp = document.getElementById('restock-exp').value;

    let item = activeInventory.find(i => i.id === invId || i.name.toLowerCase() === name.toLowerCase());
    if (item) {
      item.quantity += qty;
      if (exp) item.expiration_date = exp;
    } else {
      activeInventory.push({ id: Date.now().toString(), name, category: document.getElementById('restock-category').value, quantity: qty, unit: 'count', expiration_date: exp || null });
    }
    activeManualBuyItems = activeManualBuyItems.filter(i => i.name.toLowerCase() !== name.toLowerCase());
    document.getElementById('restock-modal').classList.add('hidden');
    renderInventory(); renderNeedToBuy(); queueSave();
  };

  document.getElementById('recipe-form').onsubmit = (e) => {
    e.preventDefault();
    const id = document.getElementById('recipe-id').value;
    const payload = {
      id: id || Date.now().toString(),
      title: document.getElementById('recipe-title-input').value,
      prep_notes: document.getElementById('recipe-notes-input').value,
      recipe_ingredients: collectIngredientsFromContainer('recipe-ingredients-list')
    };
    if (id) {
      const idx = activeRecipes.findIndex(r => r.id === id);
      if (idx > -1) activeRecipes[idx] = payload;
    } else activeRecipes.push(payload);
    document.getElementById('recipe-modal').classList.add('hidden');
    renderRecipes(); queueSave();
  };

  document.getElementById('btn-save-as-preset').onclick = () => {
    const title = document.getElementById('meal-title').value.trim();
    if (!title) return alert('Enter a Meal Title first');
    activeRecipes.push({
      id: Date.now().toString(),
      title,
      prep_notes: document.getElementById('meal-notes').value,
      recipe_ingredients: collectIngredientsFromContainer('meal-ingredients-list')
    });
    alert(`Saved "${title}" as a Recipe Preset!`);
    renderRecipes(); queueSave();
  };

  document.getElementById('meal-form').onsubmit = (e) => {
    e.preventDefault();
    const id = document.getElementById('meal-id').value;
    const date = document.getElementById('meal-date-val').value;
    const newIngs = collectIngredientsFromContainer('meal-ingredients-list');
    const existing = activeCalendar.find(m => (id && m.id === id) || normalizeDateStr(m.meal_date) === date);

    updateMealIngredientsInStock(existing ? existing.ingredients : [], newIngs);

    const payload = {
      id: id || Date.now().toString(),
      meal_date: date,
      recipe_id: document.getElementById('meal-recipe-select').value || null,
      custom_title: document.getElementById('meal-title').value,
      prep_notes: document.getElementById('meal-notes').value,
      ingredients: newIngs
    };

    if (existing) {
      const idx = activeCalendar.findIndex(m => m.id === existing.id);
      activeCalendar[idx] = payload;
    } else activeCalendar.push(payload);

    document.getElementById('meal-modal').classList.add('hidden');
    renderCalendar(); renderInventory(); renderNeedToBuy(); queueSave();
  };

  document.getElementById('btn-confirm-assign-recipe').onclick = () => {
    const recId = document.getElementById('assign-recipe-id').value;
    const date = document.getElementById('assign-date-select').value;
    const rec = activeRecipes.find(r => r.id === recId);
    if (rec && date) {
      const existing = activeCalendar.find(m => normalizeDateStr(m.meal_date) === date);
      updateMealIngredientsInStock(existing ? existing.ingredients : [], rec.recipe_ingredients || []);
      const payload = { id: existing ? existing.id : Date.now().toString(), meal_date: date, recipe_id: rec.id, custom_title: rec.title, prep_notes: rec.prep_notes, ingredients: rec.recipe_ingredients || [] };
      if (existing) activeCalendar[activeCalendar.findIndex(m => m.id === existing.id)] = payload;
      else activeCalendar.push(payload);
      document.getElementById('assign-recipe-modal').classList.add('hidden');
      renderCalendar(); renderInventory(); renderNeedToBuy(); queueSave();
    }
  };
}

// ====================================================================
// HELPERS FOR MODALS
// ====================================================================
function showConfirmation(title, msg, cb) {
  document.getElementById('confirm-title').innerText = title;
  document.getElementById('confirm-message').innerText = msg;
  confirmCallback = cb;
  document.getElementById('confirm-modal').classList.remove('hidden');
}

function openEditInventory(id) {
  const item = activeInventory.find(i => i.id === id);
  if (!item) return;
  document.getElementById('inv-id').value = item.id;
  document.getElementById('inv-name').value = item.name;
  document.getElementById('inv-category').value = item.category;
  document.getElementById('inv-qty').value = decimalToFractionStr(item.quantity, item.unit === 'tsp');
  document.getElementById('inv-unit').value = item.unit;
  document.getElementById('inv-exp').value = item.expiration_date || '';
  document.getElementById('inventory-modal-title').innerText = 'Edit Item';
  document.getElementById('inventory-modal').classList.remove('hidden');
}

function confirmDeleteInventory(id) {
  showConfirmation('Delete Item', 'Remove this from inventory?', () => {
    activeInventory = activeInventory.filter(i => i.id !== id);
    renderInventory(); renderCalendar(); renderNeedToBuy(); queueSave();
  });
}

function openRestockModal(invId, name, cat) {
  document.getElementById('restock-inv-id').value = invId || '';
  document.getElementById('restock-category').value = cat || 'General';
  document.getElementById('restock-item-name').innerText = name;
  document.getElementById('restock-qty').value = '1';
  document.getElementById('restock-exp').value = '';
  document.getElementById('restock-modal').classList.remove('hidden');
}

function openMealModal(dateStr, existing) {
  document.getElementById('meal-date-val').value = dateStr;
  const [y, m, d] = dateStr.split('-');
  document.getElementById('meal-date-label').innerText = `Date: ${m}-${d}-${y}`;
  const recSel = document.getElementById('meal-recipe-select');
  const ingsList = document.getElementById('meal-ingredients-list');
  ingsList.innerHTML = '';
  
  recSel.innerHTML = '<option value="">-- Custom Meal --</option>';
  activeRecipes.forEach(r => recSel.innerHTML += `<option value="${r.id}">${r.title}</option>`);
  recSel.onchange = (e) => {
    const rec = activeRecipes.find(r => r.id === e.target.value);
    if (rec) {
      document.getElementById('meal-title').value = rec.title;
      document.getElementById('meal-notes').value = rec.prep_notes || '';
      ingsList.innerHTML = '';
      (rec.recipe_ingredients || []).forEach(i => ingsList.insertAdjacentHTML('beforeend', createIngredientRowHTML(i.ingredient_name, i.required_quantity, i.display_label, i.unit)));
    }
  };

  const delBtn = document.getElementById('btn-cancel-meal-restore');
  const consBtn = document.getElementById('btn-meal-consumed');

  if (existing) {
    document.getElementById('meal-id').value = existing.id;
    document.getElementById('meal-title').value = existing.custom_title || '';
    document.getElementById('meal-notes').value = existing.prep_notes || '';
    recSel.value = existing.recipe_id || '';
    (existing.ingredients || []).forEach(i => ingsList.insertAdjacentHTML('beforeend', createIngredientRowHTML(i.ingredient_name, i.required_quantity, i.display_label, i.unit)));
    delBtn.classList.remove('hidden'); consBtn.classList.remove('hidden');

    delBtn.onclick = () => showConfirmation('Delete & Restore', 'Restore ingredients to stock?', () => {
      updateMealIngredientsInStock(existing.ingredients || [], []);
      activeCalendar = activeCalendar.filter(m => m.id !== existing.id);
      document.getElementById('meal-modal').classList.add('hidden');
      renderCalendar(); renderInventory(); renderNeedToBuy(); queueSave();
    });

    consBtn.onclick = () => showConfirmation('Consume', 'Remove meal but keep deductions?', () => {
      activeCalendar = activeCalendar.filter(m => m.id !== existing.id);
      document.getElementById('meal-modal').classList.add('hidden');
      renderCalendar(); renderInventory(); renderNeedToBuy(); queueSave();
    });
  } else {
    document.getElementById('meal-id').value = '';
    document.getElementById('meal-title').value = '';
    document.getElementById('meal-notes').value = '';
    delBtn.classList.add('hidden'); consBtn.classList.add('hidden');
  }
  document.getElementById('meal-modal').classList.remove('hidden');
}

function openEditRecipeModal(id) {
  const rec = activeRecipes.find(r => r.id === id);
  if (!rec) return;
  document.getElementById('recipe-id').value = rec.id;
  document.getElementById('recipe-title-input').value = rec.title;
  document.getElementById('recipe-notes-input').value = rec.prep_notes || '';
  const list = document.getElementById('recipe-ingredients-list');
  list.innerHTML = '';
  (rec.recipe_ingredients || []).forEach(i => list.insertAdjacentHTML('beforeend', createIngredientRowHTML(i.ingredient_name, i.required_quantity, i.display_label, i.unit)));
  document.getElementById('recipe-modal-title').innerText = 'Edit Recipe';
  document.getElementById('recipe-modal').classList.remove('hidden');
}

function confirmDeleteRecipe(id) {
  showConfirmation('Delete Recipe', 'Remove this recipe?', () => {
    activeRecipes = activeRecipes.filter(r => r.id !== id);
    renderRecipes(); queueSave();
  });
}

function openAssignRecipeModal(id) {
  document.getElementById('assign-recipe-id').value = id;
  const sel = document.getElementById('assign-date-select');
  sel.innerHTML = '';
  const sunday = getCurrentWeekSunday();
  for (let i = 0; i < 14; i++) {
    const curr = new Date(sunday.getTime() + i * 86400000);
    const dateStr = formatLocalDate(curr);
    const [y, m, d] = dateStr.split('-');
    sel.innerHTML += `<option value="${dateStr}">${curr.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</option>`;
  }
  document.getElementById('assign-recipe-modal').classList.remove('hidden');
}