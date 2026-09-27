// ====================================================================
// APP INIT & AUTH STATE
// ====================================================================
document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupModalHandlers();

  // Render calendar immediately from DOM
  renderCalendar();

  // Initialize Supabase & load user session
  initApp();
});

// State Variables
let currentUser = null;
let activeInventory = [];
let activeRecipes = [];
let activeCalendar = [];
let activeManualBuyItems = []; // Stores custom Need to Buy entries
let activeFilterTag = 'ALL';
let confirmCallback = null;
let isSignUpMode = false;
let activeTargetQtyInput = null;

// Supabase Configuration
const SUPABASE_URL = 'https://mxkawqbvtckdfffddeey.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im14a2F3cWJ2dGNrZGZmZmRkZWV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1Mzc5NjQsImV4cCI6MjEwNDExMzk2NH0.39RyTqPylHgSq0J_aqbzxqvyL_eM9KWkLKkwtSsSFrc';

function getSupabaseClient() {
  if (window.supabase && typeof window.supabase.createClient === 'function') {
    return window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  }
  console.warn('Supabase CDN not ready or blocked by CORS.');
  return null;
}

// ====================================================================
// RULE 1: UNIT STANDARDIZATION & CONVERSION LOGIC (Base: fl_oz)
// ====================================================================
const VOLUME_CONVERSIONS_FL_OZ = {
  'tsp': 0.1666667,
  'teaspoon': 0.1666667,
  'tbsp': 0.5,
  'tablespoon': 0.5,
  'cup': 8.0,
  'cups': 8.0,
  'oz': 1.0,
  'fl_oz': 1.0,
  'fl oz': 1.0,
  'gallon': 128.0,
  'gallons': 128.0,
  'l': 33.814,
  'liter': 33.814,
  'piece': 1.0,
  'count': 1.0,
  'can': 1.0,
  'pack': 1.0
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

  const totalFlOz = amount * fromBase;
  return totalFlOz / toBase;
}

function decimalToFractionStr(val, isTspScale = false) {
  if (val === 0) return '0';

  const isNegative = val < 0;
  const absVal = Math.abs(val);

  const wholePart = Math.floor(absVal);
  const fracPart = absVal - wholePart;

  if (fracPart < 0.005) {
    const sign = isNegative ? '-' : '';
    return `${sign}${wholePart}`;
  }

  const denominatorScale = (isTspScale || absVal < 0.25) ? 32 : 16;
  const roundedSteps = Math.round(fracPart * denominatorScale);

  if (roundedSteps === 0) {
    const sign = isNegative ? '-' : '';
    return `${sign}${wholePart}`;
  }
  if (roundedSteps === denominatorScale) {
    const sign = isNegative ? '-' : '';
    return `${sign}${wholePart + 1}`;
  }

  function gcd(a, b) {
    return b ? gcd(b, a % b) : a;
  }

  let num = roundedSteps;
  let den = denominatorScale;
  let common = gcd(num, den);

  num /= common;
  den /= common;

  const sign = isNegative ? '-' : '';
  if (wholePart > 0) {
    return `${sign}${wholePart} ${num}/${den}`;
  }
  return `${sign}${num}/${den}`;
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
  const unitMatch = str.replace(/[\d\.\s\/]/g, '').trim();
  return normalizeUnitKey(unitMatch);
}

async function initApp() {
  const client = getSupabaseClient();
  if (!client) return;

  client.auth.onAuthStateChange(async (event, session) => {
    if (session && session.user) {
      currentUser = session.user;
      document.getElementById('user-display-email').innerText = currentUser.email;
      document.getElementById('btn-auth-action').innerText = 'Sign Out';

      await purgeOldMeals(client);
      await refreshAllData(client);
    } else {
      currentUser = null;
      document.getElementById('user-display-email').innerText = 'Not Signed In';
      document.getElementById('btn-auth-action').innerText = 'Sign In';
      activeCalendar = [];
      activeInventory = [];
      activeRecipes = [];
      activeManualBuyItems = [];
      renderCalendar();
      renderInventory();
      renderRecipes();
      renderNeedToBuy();
    }
  });

  const { data: { session } } = await client.auth.getSession();
  if (session && session.user) {
    currentUser = session.user;
    document.getElementById('user-display-email').innerText = currentUser.email;
    document.getElementById('btn-auth-action').innerText = 'Sign Out';
    await purgeOldMeals(client);
    await refreshAllData(client);
  }
}

async function refreshAllData(client) {
  if (!client || !currentUser) return;
  await Promise.all([
    fetchInventory(client),
    fetchRecipes(client),
    fetchCalendarMeals(client)
  ]);
  renderCalendar();
  renderNeedToBuy();
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

  let requiredIngredients = [];
  if (meal.ingredients && meal.ingredients.length > 0) {
    requiredIngredients = meal.ingredients;
  } else if (meal.recipe_id) {
    const recipe = activeRecipes.find(r => r.id === meal.recipe_id);
    if (recipe && recipe.recipe_ingredients) {
      requiredIngredients = recipe.recipe_ingredients;
    }
  }

  if (requiredIngredients.length === 0) return false;

  for (const req of requiredIngredients) {
    const invItem = activeInventory.find(i => i.name.toLowerCase() === req.ingredient_name.toLowerCase());
    
    if (!invItem) return true;

    const itemUnit = invItem.unit;
    const reqQty = parseQuantity(req.required_quantity);
    const convertedReqQty = convertQuantityUnit(reqQty, req.unit, itemUnit);

    const grossStock = invItem.quantity + convertedReqQty;

    if (grossStock < convertedReqQty || invItem.quantity < -0.0001) {
      return true;
    }
  }

  return false;
}

function getActive14DayDates() {
  const dates = [];
  const sunday = getCurrentWeekSunday();
  for (let i = 0; i < 14; i++) {
    const d = new Date(sunday);
    d.setDate(sunday.getDate() + i);
    dates.push(formatLocalDate(d));
  }
  return dates;
}

function updateSavePresetButtonVisibility() {
  const recipeSelect = document.getElementById('meal-recipe-select');
  const savePresetBtn = document.getElementById('btn-save-as-preset');

  if (!recipeSelect || !savePresetBtn) return;

  if (recipeSelect.value && recipeSelect.value.trim() !== '') {
    savePresetBtn.classList.add('hidden');
    savePresetBtn.disabled = true;
  } else {
    savePresetBtn.classList.remove('hidden');
    savePresetBtn.disabled = false;
  }
}

// ====================================================================
// NAVIGATION & TABS
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
      if (targetSection) {
        targetSection.classList.add('active');
      }
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
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      renderInventory();
    });
  }
}

function getCurrentWeekSunday() {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const sunday = new Date(now);
  sunday.setDate(now.getDate() - dayOfWeek);
  sunday.setHours(0, 0, 0, 0);
  return sunday;
}

// ====================================================================
// CALENDAR MODULE
// ====================================================================
async function fetchCalendarMeals(client) {
  try {
    const { data, error } = await client
      .from('calendar_meals')
      .select('*')
      .or(`user_id.eq.${currentUser.id},user_id.is.null`);

    if (!error && data) {
      activeCalendar = data;
    }
  } catch (err) {
    console.error('Calendar fetch error:', err);
  }
}

function renderCalendar() {
  const grid = document.getElementById('calendar-grid');
  if (!grid) return;

  grid.innerHTML = '';
  const sunday = getCurrentWeekSunday();
  const todayStr = formatLocalDate(new Date());

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
        <div class="meal-name ${!meal ? 'empty-meal' : ''}" style="font-size: ${fontSize};">
          ${titleText}
        </div>
      </div>
      ${hasDeficit ? '<div><span class="warning-badge">⚠️ Partial Shortage</span></div>' : ''}
    `;

    card.onclick = () => openMealModal(dateStr, meal);
    grid.appendChild(card);
  }
}

async function purgeOldMeals(client) {
  if (!currentUser) return;
  try {
    const sundayStr = formatLocalDate(getCurrentWeekSunday());
    await client
      .from('calendar_meals')
      .delete()
      .eq('user_id', currentUser.id)
      .lt('meal_date', sundayStr);
  } catch (err) {
    console.warn('Purge notice:', err);
  }
}

// ====================================================================
// INVENTORY MODULE
// ====================================================================
async function fetchInventory(client) {
  try {
    const { data, error } = await client
      .from('inventory')
      .select('*')
      .or(`user_id.eq.${currentUser.id},user_id.is.null`)
      .order('name');

    if (!error && data) {
      activeInventory = data;
      renderInventory();
      renderNeedToBuy();
    }
  } catch (err) {
    console.error('Inventory fetch error:', err);
  }
}

function renderInventory() {
  const list = document.getElementById('inventory-list');
  const expiredList = document.getElementById('expired-list');
  const searchInput = document.getElementById('inventory-search');
  const searchVal = searchInput ? searchInput.value.toLowerCase() : '';

  if (!list || !expiredList) return;

  list.innerHTML = '';
  expiredList.innerHTML = '';

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = formatLocalDate(today);

  const soonThreshold = new Date(today);
  soonThreshold.setDate(today.getDate() + 3);
  const soonThresholdStr = formatLocalDate(soonThreshold);

  activeInventory.forEach(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchVal);
    const matchesTag = activeFilterTag === 'ALL' || item.category === activeFilterTag;
    const isExpired = item.expiration_date && normalizeDateStr(item.expiration_date) < todayStr;
    const isSoonToExpire = item.expiration_date && normalizeDateStr(item.expiration_date) >= todayStr && normalizeDateStr(item.expiration_date) <= soonThresholdStr;

    const isNegative = item.quantity < -0.0001;

    if (isExpired) {
      const card = document.createElement('div');
      card.className = 'polaroid-card expired-item';
      card.innerHTML = `
        <div>
          <h3>${item.name}</h3>
          <p><strong>Expired:</strong> ${item.expiration_date}</p>
          <p><strong>Category:</strong> ${item.category}</p>
        </div>
        <div class="card-actions">
          <button class="btn btn-secondary" onclick="openRestockModal('${item.id}', '${item.name}', '${item.category}')">Restock</button>
          <button class="btn btn-danger" onclick="confirmDeleteInventory('${item.id}')">Discard</button>
        </div>
      `;
      expiredList.appendChild(card);
    } else if (matchesSearch && matchesTag) {
      const card = document.createElement('div');
      card.className = `polaroid-card ${isSoonToExpire ? 'soon-to-expire' : ''} ${isNegative ? 'negative-stock' : ''}`;

      const isTsp = item.unit === 'tsp';
      const formattedStock = decimalToFractionStr(item.quantity, isTsp);

      card.innerHTML = `
        <div>
          <h3>${item.name}</h3>
          <p><strong>Stock:</strong> ${formattedStock} ${item.unit}</p>
          <p><strong>Category:</strong> ${item.category}</p>
          ${item.expiration_date ? `<p><strong>Exp:</strong> ${item.expiration_date}</p>` : ''}
          ${isNegative ? '<span class="audit-badge">📌 Pending Meal Deductions</span>' : ''}
          ${isSoonToExpire ? '<span class="soon-badge">⚠️ Soon to Expire</span>' : ''}
        </div>
        <div class="card-actions">
          <button class="btn btn-secondary" onclick="openEditInventory('${item.id}')">Edit</button>
          <button class="btn btn-danger" onclick="confirmDeleteInventory('${item.id}')">Delete</button>
        </div>
      `;
      list.appendChild(card);
    }
  });
}

async function updateMealIngredientsInStock(oldIngredients, newIngredients) {
  const client = getSupabaseClient();
  if (!client || !currentUser) return;

  const inventoryMap = new Map();
  activeInventory.forEach(item => {
    inventoryMap.set(item.name.toLowerCase(), { ...item });
  });

  if (oldIngredients && oldIngredients.length > 0) {
    oldIngredients.forEach(ing => {
      const key = ing.ingredient_name.toLowerCase();
      if (inventoryMap.has(key)) {
        const item = inventoryMap.get(key);
        const reqQty = parseQuantity(ing.required_quantity);
        const converted = convertQuantityUnit(reqQty, ing.unit, item.unit);
        item.quantity += converted;
      }
    });
  }

  if (newIngredients && newIngredients.length > 0) {
    newIngredients.forEach(ing => {
      const key = ing.ingredient_name.toLowerCase();
      if (inventoryMap.has(key)) {
        const item = inventoryMap.get(key);
        const reqQty = parseQuantity(ing.required_quantity);
        const converted = convertQuantityUnit(reqQty, ing.unit, item.unit);
        item.quantity -= converted;
      }
    });
  }

  for (const [key, item] of inventoryMap.entries()) {
    const original = activeInventory.find(i => i.id === item.id);
    if (original && original.quantity !== item.quantity) {
      await client
        .from('inventory')
        .update({ quantity: item.quantity })
        .eq('id', item.id)
        .eq('user_id', currentUser.id);
    }
  }
}

async function adjustMealIngredientsStock(ingredients, mode = 'subtract') {
  if (mode === 'subtract') {
    await updateMealIngredientsInStock([], ingredients);
  } else if (mode === 'add') {
    await updateMealIngredientsInStock(ingredients, []);
  }
}

// ====================================================================
// RULE 3: INVENTORY STOCK, DEFICITS & SHOPPING LIST
// ====================================================================
function renderNeedToBuy() {
  const shoppingContainer = document.getElementById('shopping-list');
  if (!shoppingContainer) return;

  shoppingContainer.innerHTML = '';

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = formatLocalDate(today);

  const soonThreshold = new Date(today);
  soonThreshold.setDate(today.getDate() + 3);
  const soonThresholdStr = formatLocalDate(soonThreshold);

  const active14Days = getActive14DayDates();
  const mealRequirements = new Map();

  activeCalendar.forEach(meal => {
    const mealDateClean = normalizeDateStr(meal.meal_date);
    if (!active14Days.includes(mealDateClean)) return;

    let reqIngs = [];
    if (meal.ingredients && meal.ingredients.length > 0) {
      reqIngs = meal.ingredients;
    } else if (meal.recipe_id) {
      const recipe = activeRecipes.find(r => r.id === meal.recipe_id);
      if (recipe && recipe.recipe_ingredients) reqIngs = recipe.recipe_ingredients;
    }

    reqIngs.forEach(req => {
      const nameKey = req.ingredient_name.toLowerCase();
      const invItem = activeInventory.find(i => i.name.toLowerCase() === nameKey);
      const itemUnit = invItem ? invItem.unit : req.unit;

      const rawQty = parseQuantity(req.required_quantity);
      const convertedReq = convertQuantityUnit(rawQty, req.unit || itemUnit, itemUnit);

      const currentReq = mealRequirements.get(nameKey) || { totalReq: 0, unit: itemUnit, mealTitles: [] };
      currentReq.totalReq += convertedReq;
      currentReq.unit = itemUnit;
      if (meal.custom_title) currentReq.mealTitles.push(meal.custom_title);
      mealRequirements.set(nameKey, currentReq);
    });
  });

  const shoppingMap = new Map();

  activeInventory.forEach(item => {
    const nameKey = item.name.toLowerCase();
    const itemExpClean = normalizeDateStr(item.expiration_date);

    const isExpired = item.expiration_date && itemExpClean < todayStr;
    const isSoonToExpire = item.expiration_date && itemExpClean >= todayStr && itemExpClean <= soonThresholdStr;

    const reqData = mealRequirements.get(nameKey);
    const totalNeededForMeals = reqData ? reqData.totalReq : 0;

    const availableStock = isExpired ? 0 : Math.max(0, item.quantity);
    const deficit = totalNeededForMeals - availableStock;

    if (isExpired || isSoonToExpire || item.quantity < 0 || deficit > 0) {
      let statusText = '';
      let displayDeficit = 0;

      if (deficit > 0) {
        displayDeficit = deficit;
        statusText = `Meal Requirement (${reqData.mealTitles.join(', ') || 'Planned Meal'})`;
      } else if (item.quantity < 0) {
        displayDeficit = Math.abs(item.quantity);
        statusText = 'Pending Deficit';
      } else if (isExpired) {
        displayDeficit = 1;
        statusText = 'Expired';
      } else if (isSoonToExpire) {
        displayDeficit = 1;
        statusText = `Soon to Expire (${item.expiration_date})`;
      }

      shoppingMap.set(nameKey, {
        id: item.id,
        name: item.name,
        category: item.category || 'General',
        neededQty: decimalToFractionStr(displayDeficit, item.unit === 'tsp'),
        unit: item.unit,
        status: statusText
      });
    }
  });

  mealRequirements.forEach((reqData, nameKey) => {
    if (!shoppingMap.has(nameKey)) {
      const invItem = activeInventory.find(i => i.name.toLowerCase() === nameKey);
      if (!invItem) {
        shoppingMap.set(nameKey, {
          id: '',
          name: nameKey.charAt(0).toUpperCase() + nameKey.slice(1),
          category: 'General',
          neededQty: decimalToFractionStr(reqData.totalReq, reqData.unit === 'tsp'),
          unit: reqData.unit,
          status: `Meal Requirement (${reqData.mealTitles.join(', ') || 'Planned Meal'})`
        });
      }
    }
  });

  // Render Custom Manual Need-To-Buy Items
  activeManualBuyItems.forEach(manualItem => {
    const key = manualItem.name.toLowerCase();
    if (!shoppingMap.has(key)) {
      shoppingMap.set(key, {
        id: manualItem.invId || '',
        name: manualItem.name,
        category: manualItem.category || 'General',
        neededQty: manualItem.amount,
        unit: manualItem.unit || 'count',
        status: 'Manually Added Shopping Item',
        isManual: true,
        indexKey: manualItem.id
      });
    }
  });

  if (shoppingMap.size === 0) {
    shoppingContainer.innerHTML = '<p style="color: var(--text-muted);">Your shopping list is currently clear!</p>';
    return;
  }

  shoppingMap.forEach(item => {
    const div = document.createElement('div');
    div.className = 'shopping-item urgent';
    div.innerHTML = `
      <div class="shopping-info">
        <h4>${item.name}</h4>
        <div class="shopping-meta">
          <span>Deficit / Need to Buy: <strong>${item.neededQty} ${item.unit}</strong></span> | 
          <span>Category: <strong>${item.category}</strong></span> | 
          <span>Reason: <strong>${item.status}</strong></span>
        </div>
      </div>
      <div style="display: flex; gap: 8px;">
        <button class="btn btn-primary" onclick="openRestockModal('${item.id || ''}', '${item.name}', '${item.category}')">✓ Restock</button>
        ${item.isManual ? `<button class="btn btn-danger" onclick="removeManualBuyItem('${item.indexKey}')">✕ Remove</button>` : ''}
      </div>
    `;
    shoppingContainer.appendChild(div);
  });
}

function removeManualBuyItem(manualId) {
  activeManualBuyItems = activeManualBuyItems.filter(i => i.id !== manualId);
  renderNeedToBuy();
}

// ====================================================================
// RECIPE MODULE (PRESET LIBRARY)
// ====================================================================
async function fetchRecipes(client) {
  try {
    const { data: recipesData, error: recipeErr } = await client
      .from('recipes')
      .select('*')
      .or(`user_id.eq.${currentUser.id},user_id.is.null`);

    if (recipeErr || !recipesData) {
      console.error('Recipe fetch error:', recipeErr);
      return;
    }

    const { data: ingredientsData } = await client
      .from('recipe_ingredients')
      .select('*');

    activeRecipes = recipesData.map(recipe => {
      const recipeIngs = ingredientsData
        ? ingredientsData.filter(i => i.recipe_id === recipe.id)
        : [];
      return { ...recipe, recipe_ingredients: recipeIngs };
    });

    renderRecipes();
  } catch (err) {
    console.error('Recipe fetch exception:', err);
  }
}

function renderRecipes() {
  const container = document.getElementById('recipe-list');
  if (!container) return;

  container.innerHTML = '';

  activeRecipes.forEach(recipe => {
    const card = document.createElement('div');
    card.className = 'polaroid-card';

    const ingredientsList = recipe.recipe_ingredients && recipe.recipe_ingredients.length > 0
      ? recipe.recipe_ingredients.map(i => {
          const displayLabel = i.display_label || `${decimalToFractionStr(parseQuantity(i.required_quantity), i.unit === 'tsp')} ${i.unit}`;
          return `• ${i.ingredient_name}: ${displayLabel}`;
        }).join('<br>')
      : '<em>No detailed ingredients listed</em>';

    card.innerHTML = `
      <div>
        <h3>${recipe.title}</h3>
        <p><strong>Prep Notes:</strong> ${recipe.prep_notes || 'None'}</p>
        <br>
        <p><strong>Ingredients:</strong></p>
        <p style="font-size:0.85rem;">${ingredientsList}</p>
      </div>
      <div class="card-actions" style="margin-top:15px;">
        <button class="btn btn-primary" onclick="openAssignRecipeModal('${recipe.id}')">Assign to Date</button>
        <button class="btn btn-secondary" onclick="openEditRecipeModal('${recipe.id}')">Edit</button>
        <button class="btn btn-danger" onclick="confirmDeleteRecipe('${recipe.id}')">Delete</button>
      </div>
    `;
    container.appendChild(card);
  });
}

// ====================================================================
// RULE 5: UI BEHAVIORS & FORM INPUT LIFECYCLE
// ====================================================================
function createIngredientRowHTML(selectedName = '', selectedQty = 1, displayLabel = '', selectedUnit = '') {
  let options = '<option value="">-- Select Item --</option>';

  const targetInv = activeInventory.find(i => i.name.toLowerCase() === selectedName.toLowerCase());
  const actualTargetUnit = selectedUnit || (targetInv ? targetInv.unit : 'count');

  activeInventory.forEach(inv => {
    const isSelected = inv.name.toLowerCase() === selectedName.toLowerCase() ? 'selected' : '';
    options += `<option value="${inv.name}" data-unit="${inv.unit}" ${isSelected}>${inv.name} (${inv.unit})</option>`;
  });

  const rawNum = parseQuantity(selectedQty);
  const targetQtyConverted = targetInv ? convertQuantityUnit(rawNum, actualTargetUnit, targetInv.unit) : rawNum;

  const valueStr = displayLabel || `${decimalToFractionStr(rawNum, actualTargetUnit === 'tsp')} ${actualTargetUnit}`;
  const isDisabled = !selectedName ? 'disabled style="flex: 1; min-width: 0; cursor: not-allowed; opacity: 0.6;"' : 'style="flex: 1; min-width: 0; cursor: pointer;"';

  return `
    <div class="ingredient-row" style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px;">
      <select class="input-field ingredient-item-select" style="flex: 2; min-width: 0;" onchange="handleIngredientSelection(this)">
        ${options}
      </select>
      <input type="text" class="input-field ingredient-qty-input" placeholder="${selectedName ? 'Qty (Click to convert)' : 'Select item first'}" value="${selectedName ? valueStr : ''}" data-converted-qty="${targetQtyConverted}" data-unit="${targetInv ? targetInv.unit : actualTargetUnit}" ${isDisabled} readonly onclick="openConverterModal(this)">
      <button type="button" class="btn-remove-row btn btn-danger" onclick="this.parentElement.remove()" style="padding: 6px 12px; flex: 0 0 auto;">✕</button>
    </div>
  `;
}

function handleIngredientSelection(selectElement) {
  const row = selectElement.parentElement;
  const qtyInput = row.querySelector('.ingredient-qty-input');
  const itemName = selectElement.value;

  if (itemName) {
    const invItem = activeInventory.find(i => i.name.toLowerCase() === itemName.toLowerCase());
    const targetUnit = invItem ? invItem.unit : 'piece';

    qtyInput.removeAttribute('disabled');
    qtyInput.style.cursor = 'pointer';
    qtyInput.style.opacity = '1';
    qtyInput.placeholder = 'Qty (Click to convert)';
    qtyInput.setAttribute('data-unit', targetUnit);
  } else {
    qtyInput.setAttribute('disabled', 'true');
    qtyInput.style.cursor = 'not-allowed';
    qtyInput.style.opacity = '0.6';
    qtyInput.value = '';
    qtyInput.placeholder = 'Select item first';
    qtyInput.removeAttribute('data-unit');
    qtyInput.removeAttribute('data-converted-qty');
  }
}

function openConverterModal(inputElement) {
  if (inputElement.hasAttribute('disabled')) return;

  activeTargetQtyInput = inputElement;
  const row = inputElement.parentElement;
  const select = row.querySelector('.ingredient-item-select');
  const itemName = select ? select.value : '';

  const invItem = activeInventory.find(i => i.name.toLowerCase() === itemName.toLowerCase());
  const targetUnit = invItem ? invItem.unit : 'piece';

  document.getElementById('converter-target-unit').innerText = targetUnit;

  document.getElementById('converter-whole-select').value = "0";
  document.getElementById('converter-fraction-select').value = "0";
  document.getElementById('converter-unit-select').value = targetUnit;

  document.getElementById('converter-modal').classList.remove('hidden');
}

function collectIngredientsFromContainer(containerId) {
  const container = document.getElementById(containerId);
  const rows = container.querySelectorAll('.ingredient-row');
  const ingredients = [];

  rows.forEach(row => {
    const select = row.querySelector('.ingredient-item-select');
    const qtyInput = row.querySelector('.ingredient-qty-input');

    const name = select.value;
    if (!name) return;

    const invItem = activeInventory.find(i => i.name.toLowerCase() === name.toLowerCase());
    const targetUnit = invItem ? invItem.unit : 'piece';

    const userLabel = qtyInput.value;
    const rawValAttr = qtyInput.getAttribute('data-converted-qty');

    let finalQtyInTargetUnit = 0;

    if (rawValAttr && !isNaN(parseFloat(rawValAttr))) {
      finalQtyInTargetUnit = parseFloat(rawValAttr);
    } else {
      const parsedNum = parseQuantity(userLabel);
      const parsedUnitFromText = parseUnitFromLabel(userLabel);
      const fromUnit = parsedUnitFromText || targetUnit;
      finalQtyInTargetUnit = convertQuantityUnit(parsedNum, fromUnit, targetUnit);
    }

    ingredients.push({
      ingredient_name: name,
      required_quantity: finalQtyInTargetUnit,
      unit: targetUnit,
      display_label: userLabel
    });
  });

  return ingredients;
}

function clearMealFormFields() {
  document.getElementById('meal-recipe-select').value = '';
  document.getElementById('meal-title').value = '';
  document.getElementById('meal-notes').value = '';
  document.getElementById('meal-ingredients-list').innerHTML = '';
  updateSavePresetButtonVisibility();
}

// ====================================================================
// MODAL & HANDLERS
// ====================================================================
function setupModalHandlers() {
  document.querySelectorAll('.close-modal').forEach(btn => {
    btn.onclick = () => document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden'));
  });

  const recipeSelect = document.getElementById('meal-recipe-select');
  if (recipeSelect) {
    recipeSelect.addEventListener('change', () => {
      updateSavePresetButtonVisibility();
    });
  }

  document.getElementById('btn-clear-day-fields').onclick = () => {
    clearMealFormFields();
  };

  document.getElementById('btn-calculate-unit').onclick = () => {
    if (!activeTargetQtyInput) return;

    const selectedUnit = document.getElementById('converter-unit-select').value;
    const wholeVal = parseFloat(document.getElementById('converter-whole-select').value) || 0;
    const fracVal = parseFloat(document.getElementById('converter-fraction-select').value) || 0;
    const totalInputQty = wholeVal + fracVal;

    const targetUnit = document.getElementById('converter-target-unit').innerText;

    const convertedQty = convertQuantityUnit(totalInputQty, selectedUnit, targetUnit);

    const fracOptionText = document.getElementById('converter-fraction-select').options[document.getElementById('converter-fraction-select').selectedIndex].text;
    const fracClean = fracOptionText.includes('(') ? fracOptionText.split('(')[0].trim() : '';

    let userLabel = '';
    if (wholeVal > 0 && fracVal > 0) {
      userLabel = `${wholeVal} ${fracClean} ${selectedUnit}`;
    } else if (wholeVal > 0) {
      userLabel = `${wholeVal} ${selectedUnit}`;
    } else {
      userLabel = `${fracClean || '0'} ${selectedUnit}`;
    }

    activeTargetQtyInput.value = userLabel;
    activeTargetQtyInput.setAttribute('data-converted-qty', convertedQty);
    activeTargetQtyInput.setAttribute('data-unit', targetUnit);

    document.getElementById('converter-modal').classList.add('hidden');
  };

  // Add Item To Need To Buy Modal Trigger Handler
  const addBuyItemBtn = document.getElementById('btn-add-need-to-buy');
  if (addBuyItemBtn) {
    addBuyItemBtn.onclick = () => {
      if (!currentUser) return checkAuthGuard();
      const buyForm = document.getElementById('add-buy-item-form');
      if (buyForm) buyForm.reset();
      
      const modal = document.getElementById('add-buy-item-modal');
      if (modal) modal.classList.remove('hidden');
    };
  }

  // Handle Form Submission for Adding to Need To Buy
  const buyForm = document.getElementById('add-buy-item-form');
  if (buyForm) {
    buyForm.onsubmit = (e) => {
      e.preventDefault();
      
      const name = document.getElementById('buy-item-name').value.trim();
      const amountStr = document.getElementById('buy-item-amount').value.trim();
      const category = document.getElementById('buy-item-category').value;
      const unit = document.getElementById('buy-item-unit').value;

      if (!name) {
        alert('Please specify an item name.');
        return;
      }

      const invItem = activeInventory.find(i => i.name.toLowerCase() === name.toLowerCase());

      activeManualBuyItems.push({
        id: 'manual_' + Date.now(),
        invId: invItem ? invItem.id : '',
        name: name,
        amount: amountStr || '1',
        category: category || 'Pantry',
        unit: unit || (invItem ? invItem.unit : 'count')
      });

      document.getElementById('add-buy-item-modal').classList.add('hidden');
      renderNeedToBuy();
    };
  }

  document.getElementById('btn-auth-action').onclick = async () => {
    const client = getSupabaseClient();
    if (currentUser && client) {
      await client.auth.signOut();
    } else {
      document.getElementById('auth-status-msg').innerText = '';
      document.getElementById('auth-modal').classList.remove('hidden');
    }
  };

  document.getElementById('toggle-auth-mode').onclick = (e) => {
    e.preventDefault();
    isSignUpMode = !isSignUpMode;
    document.getElementById('auth-modal-title').innerText = isSignUpMode ? 'Sign Up' : 'Sign In';
    document.getElementById('btn-auth-submit').innerText = isSignUpMode ? 'Sign Up' : 'Sign In';
    document.getElementById('toggle-auth-mode').innerText = isSignUpMode ? 'Already have an account? Sign In' : 'Need an account? Sign Up';
  };

  document.getElementById('auth-form').onsubmit = async (e) => {
    e.preventDefault();
    const client = getSupabaseClient();
    if (!client) return;

    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    const statusMsg = document.getElementById('auth-status-msg');

    statusMsg.innerText = 'Processing...';

    if (isSignUpMode) {
      const { data, error } = await client.auth.signUp({ email, password });
      if (error) {
        statusMsg.innerText = error.message;
      } else {
        statusMsg.innerText = 'Account created! Please sign in.';
        isSignUpMode = false;
        document.getElementById('auth-modal-title').innerText = 'Sign In';
        document.getElementById('btn-auth-submit').innerText = 'Sign In';
      }
    } else {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) {
        statusMsg.innerText = error.message;
      } else {
        document.getElementById('auth-modal').classList.add('hidden');
      }
    }
  };

  document.getElementById('confirm-btn-proceed').onclick = () => {
    if (confirmCallback) confirmCallback();
    document.getElementById('confirm-modal').classList.add('hidden');
  };
  document.getElementById('confirm-btn-cancel').onclick = () => {
    document.getElementById('confirm-modal').classList.add('hidden');
  };

  document.getElementById('btn-add-inventory').onclick = () => {
    if (!currentUser) return checkAuthGuard();
    document.getElementById('inventory-form').reset();
    document.getElementById('inv-id').value = '';
    document.getElementById('inventory-modal-title').innerText = 'Add Inventory Item';
    document.getElementById('inventory-modal').classList.remove('hidden');
  };

  document.getElementById('btn-add-meal-ingredient').onclick = () => {
    const list = document.getElementById('meal-ingredients-list');
    list.insertAdjacentHTML('beforeend', createIngredientRowHTML());
  };

  document.getElementById('btn-add-recipe-ingredient').onclick = () => {
    const list = document.getElementById('recipe-ingredients-list');
    list.insertAdjacentHTML('beforeend', createIngredientRowHTML());
  };

  const addRecipeBtn = document.getElementById('btn-add-recipe');
  if (addRecipeBtn) {
    addRecipeBtn.onclick = () => {
      if (!currentUser) return checkAuthGuard();
      document.getElementById('recipe-form').reset();
      document.getElementById('recipe-id').value = '';
      document.getElementById('recipe-ingredients-list').innerHTML = '';
      document.getElementById('recipe-modal-title').innerText = 'Create Recipe Preset';
      document.getElementById('recipe-modal').classList.remove('hidden');
    };
  }

  document.getElementById('btn-save-as-preset').onclick = async () => {
    if (!currentUser) return checkAuthGuard();
    const client = getSupabaseClient();
    if (!client) return;

    const title = document.getElementById('meal-title').value.trim();
    const notes = document.getElementById('meal-notes').value.trim();
    const ingredients = collectIngredientsFromContainer('meal-ingredients-list');

    if (!title) {
      alert('Please enter a Meal Title first to create a recipe preset.');
      return;
    }

    const payload = {
      title: title,
      prep_notes: notes,
      user_id: currentUser.id
    };

    const { data, error } = await client.from('recipes').insert([payload]).select().single();
    if (!error && data) {
      if (ingredients.length > 0) {
        const recipeIngs = ingredients.map(i => ({
          recipe_id: data.id,
          ingredient_name: i.ingredient_name,
          required_quantity: i.required_quantity,
          unit: i.unit,
          display_label: i.display_label
        }));
        await client.from('recipe_ingredients').insert(recipeIngs);
      }

      alert(`Saved "${title}" as a new Recipe Preset!`);
      await fetchRecipes(client);

      const recipeSelect = document.getElementById('meal-recipe-select');
      recipeSelect.innerHTML = '<option value="">-- Custom Meal --</option>';
      activeRecipes.forEach(r => {
        const isSelected = r.id === data.id ? 'selected' : '';
        recipeSelect.innerHTML += `<option value="${r.id}" ${isSelected}>${r.title}</option>`;
      });
      updateSavePresetButtonVisibility();
    } else {
      alert('Error creating recipe preset: ' + (error ? error.message : 'Unknown error'));
    }
  };

  document.getElementById('recipe-form').onsubmit = async (e) => {
    e.preventDefault();
    const client = getSupabaseClient();
    if (!client || !currentUser) return;

    const recipeId = document.getElementById('recipe-id').value;
    const title = document.getElementById('recipe-title-input').value;
    const notes = document.getElementById('recipe-notes-input').value;
    const ingredients = collectIngredientsFromContainer('recipe-ingredients-list');

    const payload = {
      title,
      prep_notes: notes,
      user_id: currentUser.id
    };

    let targetRecipeId = recipeId;

    if (recipeId) {
      await client.from('recipes').update(payload).eq('id', recipeId).eq('user_id', currentUser.id);
      await client.from('recipe_ingredients').delete().eq('recipe_id', recipeId);
    } else {
      const { data } = await client.from('recipes').insert([payload]).select().single();
      if (data) targetRecipeId = data.id;
    }

    if (targetRecipeId && ingredients.length > 0) {
      const recipeIngs = ingredients.map(i => ({
        recipe_id: targetRecipeId,
        ingredient_name: i.ingredient_name,
        required_quantity: i.required_quantity,
        unit: i.unit,
        display_label: i.display_label
      }));
      await client.from('recipe_ingredients').insert(recipeIngs);
    }

    document.getElementById('recipe-modal').classList.add('hidden');
    await refreshAllData(client);
  };

  document.getElementById('inventory-form').onsubmit = async (e) => {
    e.preventDefault();
    const client = getSupabaseClient();
    if (!client || !currentUser) return;

    const id = document.getElementById('inv-id').value;
    const parsedQty = parseQuantity(document.getElementById('inv-qty').value);

    const payload = {
      name: document.getElementById('inv-name').value,
      category: document.getElementById('inv-category').value,
      quantity: parsedQty,
      unit: document.getElementById('inv-unit').value,
      expiration_date: document.getElementById('inv-exp').value || null,
      user_id: currentUser.id
    };

    let error;
    if (id) {
      ({ error } = await client.from('inventory').update(payload).eq('id', id).eq('user_id', currentUser.id));
    } else {
      ({ error } = await client.from('inventory').insert([payload]));
    }

    if (error) {
      alert('Error saving inventory item: ' + error.message);
      return;
    }

    document.getElementById('inventory-modal').classList.add('hidden');
    await refreshAllData(client);
  };

  document.getElementById('restock-form').onsubmit = async (e) => {
    e.preventDefault();
    const client = getSupabaseClient();
    if (!client || !currentUser) return;

    const invId = document.getElementById('restock-inv-id').value;
    const preservedCategory = document.getElementById('restock-category').value || 'General';
    const itemName = document.getElementById('restock-item-name').innerText;
    const addedQty = parseQuantity(document.getElementById('restock-qty').value);
    const expDate = document.getElementById('restock-exp').value;

    let targetItem = activeInventory.find(i => i.id === invId || i.name.toLowerCase() === itemName.toLowerCase());
    let error;

    if (targetItem) {
      const newQty = (targetItem.quantity || 0) + addedQty;
      const updatePayload = {
        quantity: newQty,
        category: targetItem.category || preservedCategory
      };
      if (expDate) updatePayload.expiration_date = expDate;

      ({ error } = await client.from('inventory').update(updatePayload).eq('id', targetItem.id).eq('user_id', currentUser.id));
    } else {
      const insertPayload = {
        name: itemName,
        category: preservedCategory,
        quantity: addedQty,
        unit: 'count',
        expiration_date: expDate || null,
        user_id: currentUser.id
      };

      ({ error } = await client.from('inventory').insert([insertPayload]));
    }

    if (error) {
      alert('Error restocking item: ' + error.message);
      return;
    }

    // Clean up from manual list if fulfilled
    activeManualBuyItems = activeManualBuyItems.filter(i => i.name.toLowerCase() !== itemName.toLowerCase());

    document.getElementById('restock-modal').classList.add('hidden');
    await refreshAllData(client);
  };

  document.getElementById('meal-form').onsubmit = async (e) => {
    e.preventDefault();
    const client = getSupabaseClient();
    if (!client || !currentUser) return;

    const mealId = document.getElementById('meal-id').value;
    const dateVal = document.getElementById('meal-date-val').value;
    const rawRecipeId = document.getElementById('meal-recipe-select').value;
    const recipeId = rawRecipeId && rawRecipeId.trim() !== '' ? rawRecipeId : null;
    const title = document.getElementById('meal-title').value;
    const notes = document.getElementById('meal-notes').value;

    const newIngredients = collectIngredientsFromContainer('meal-ingredients-list');

    const existingMeal = activeCalendar.find(m => (mealId && m.id === mealId) || normalizeDateStr(m.meal_date) === dateVal);
    const oldIngredients = existingMeal ? (existingMeal.ingredients || []) : [];

    await updateMealIngredientsInStock(oldIngredients, newIngredients);

    const payload = {
      meal_date: dateVal,
      recipe_id: recipeId,
      custom_title: title,
      prep_notes: notes,
      ingredients: newIngredients,
      user_id: currentUser.id
    };

    let error = null;

    if (existingMeal) {
      ({ error } = await client.from('calendar_meals').update(payload).eq('id', existingMeal.id).eq('user_id', currentUser.id));
    } else {
      ({ error } = await client.from('calendar_meals').insert([payload]));
    }

    if (error) {
      console.error('Supabase save error:', error);
      alert('Error saving meal: ' + error.message);
      return;
    }

    document.getElementById('meal-modal').classList.add('hidden');
    await refreshAllData(client);
  };

  document.getElementById('btn-confirm-assign-recipe').onclick = async () => {
    const client = getSupabaseClient();
    if (!client || !currentUser) return;

    const recipeId = document.getElementById('assign-recipe-id').value;
    const targetDate = document.getElementById('assign-date-select').value;
    const recipe = activeRecipes.find(r => r.id === recipeId);

    if (recipe && targetDate) {
      const existingMeal = activeCalendar.find(m => normalizeDateStr(m.meal_date) === targetDate);
      const oldIngredients = existingMeal ? (existingMeal.ingredients || []) : [];
      const newIngredients = recipe.recipe_ingredients || [];

      await updateMealIngredientsInStock(oldIngredients, newIngredients);

      const payload = {
        meal_date: targetDate,
        recipe_id: recipeId,
        custom_title: recipe.title,
        prep_notes: recipe.prep_notes,
        ingredients: newIngredients,
        user_id: currentUser.id
      };

      if (existingMeal) {
        await client.from('calendar_meals').update(payload).eq('id', existingMeal.id).eq('user_id', currentUser.id);
      } else {
        await client.from('calendar_meals').insert([payload]);
      }

      await refreshAllData(client);
    }

    document.getElementById('assign-recipe-modal').classList.add('hidden');
  };
}

function checkAuthGuard() {
  if (!currentUser) {
    document.getElementById('auth-status-msg').innerText = 'Please sign in to make changes.';
    document.getElementById('auth-modal').classList.remove('hidden');
    return false;
  }
  return true;
}

function showConfirmation(title, message, callback) {
  document.getElementById('confirm-title').innerText = title;
  document.getElementById('confirm-message').innerText = message;
  confirmCallback = callback;
  document.getElementById('confirm-modal').classList.remove('hidden');
}

function openEditInventory(id) {
  if (!currentUser) return checkAuthGuard();
  const item = activeInventory.find(i => i.id === id);
  if (!item) return;

  document.getElementById('inv-id').value = item.id;
  document.getElementById('inv-name').value = item.name;
  document.getElementById('inv-category').value = item.category;
  document.getElementById('inv-qty').value = decimalToFractionStr(item.quantity, item.unit === 'tsp');
  document.getElementById('inv-unit').value = item.unit;
  document.getElementById('inv-exp').value = item.expiration_date || '';

  document.getElementById('inventory-modal-title').innerText = 'Edit Inventory Item';
  document.getElementById('inventory-modal').classList.remove('hidden');
}

function confirmDeleteInventory(id) {
  if (!currentUser) return checkAuthGuard();
  showConfirmation('Delete Inventory Item', 'Are you sure you want to remove this item from inventory?', async () => {
    const client = getSupabaseClient();
    if (client && currentUser) {
      await client.from('inventory').delete().eq('id', id).eq('user_id', currentUser.id);
      await refreshAllData(client);
    }
  });
}

function openRestockModal(invId, itemName, category = 'General') {
  if (!currentUser) return checkAuthGuard();
  document.getElementById('restock-inv-id').value = invId || '';
  document.getElementById('restock-category').value = category || 'General';
  document.getElementById('restock-item-name').innerText = itemName || 'Item';
  document.getElementById('restock-qty').value = '1';
  document.getElementById('restock-exp').value = '';
  document.getElementById('restock-modal').classList.remove('hidden');
}

function openMealModal(dateStr, existingMeal) {
  if (!currentUser) return checkAuthGuard();

  document.getElementById('meal-date-val').value = dateStr;

  const [year, month, day] = dateStr.split('-');
  const formattedDate = `${month}-${day}-${year}`;
  document.getElementById('meal-date-label').innerText = `Date: ${formattedDate}`;

  const recipeSelect = document.getElementById('meal-recipe-select');
  const mealIngsContainer = document.getElementById('meal-ingredients-list');
  mealIngsContainer.innerHTML = '';

  recipeSelect.innerHTML = '<option value="">-- Custom Meal --</option>';
  activeRecipes.forEach(r => {
    recipeSelect.innerHTML += `<option value="${r.id}">${r.title}</option>`;
  });

  recipeSelect.onchange = (e) => {
    const selectedRecipe = activeRecipes.find(r => r.id === e.target.value);
    if (selectedRecipe) {
      document.getElementById('meal-title').value = selectedRecipe.title;
      document.getElementById('meal-notes').value = selectedRecipe.prep_notes || '';

      mealIngsContainer.innerHTML = '';
      if (selectedRecipe.recipe_ingredients) {
        selectedRecipe.recipe_ingredients.forEach(ing => {
          mealIngsContainer.insertAdjacentHTML('beforeend', createIngredientRowHTML(ing.ingredient_name, ing.required_quantity, ing.display_label, ing.unit));
        });
      }
    }
    updateSavePresetButtonVisibility();
  };

  const deleteRestoreBtn = document.getElementById('btn-cancel-meal-restore');
  const consumedBtn = document.getElementById('btn-meal-consumed');

  if (existingMeal) {
    document.getElementById('meal-id').value = existingMeal.id;
    document.getElementById('meal-title').value = existingMeal.custom_title || '';
    document.getElementById('meal-notes').value = existingMeal.prep_notes || '';
    document.getElementById('meal-recipe-select').value = existingMeal.recipe_id || '';

    if (existingMeal.ingredients && existingMeal.ingredients.length > 0) {
      existingMeal.ingredients.forEach(ing => {
        mealIngsContainer.insertAdjacentHTML('beforeend', createIngredientRowHTML(ing.ingredient_name, ing.required_quantity, ing.display_label, ing.unit));
      });
    } else if (existingMeal.recipe_id) {
      const tiedRecipe = activeRecipes.find(r => r.id === existingMeal.recipe_id);
      if (tiedRecipe && tiedRecipe.recipe_ingredients) {
        tiedRecipe.recipe_ingredients.forEach(ing => {
          mealIngsContainer.insertAdjacentHTML('beforeend', createIngredientRowHTML(ing.ingredient_name, ing.required_quantity, ing.display_label, ing.unit));
        });
      }
    }

    deleteRestoreBtn.classList.remove('hidden');
    consumedBtn.classList.remove('hidden');

    deleteRestoreBtn.onclick = () => {
      showConfirmation('Delete & Restore Stock', `Delete planned meal for ${formattedDate} and restore ingredient stock to inventory?`, async () => {
        const client = getSupabaseClient();
        if (client && currentUser) {
          const ingredientsToRestore = collectIngredientsFromContainer('meal-ingredients-list');

          await client.from('calendar_meals').delete().eq('id', existingMeal.id).eq('user_id', currentUser.id);
          await adjustMealIngredientsStock(ingredientsToRestore, 'add');

          document.getElementById('meal-modal').classList.add('hidden');
          await refreshAllData(client);
        }
      });
    };

    consumedBtn.onclick = () => {
      showConfirmation('Mark as Consumed', `Remove planned meal for ${formattedDate}? (Ingredients will remain deducted from stock).`, async () => {
        const client = getSupabaseClient();
        if (client && currentUser) {
          await client.from('calendar_meals').delete().eq('id', existingMeal.id).eq('user_id', currentUser.id);

          document.getElementById('meal-modal').classList.add('hidden');
          await refreshAllData(client);
        }
      });
    };
  } else {
    document.getElementById('meal-id').value = '';
    document.getElementById('meal-title').value = '';
    document.getElementById('meal-notes').value = '';
    deleteRestoreBtn.classList.add('hidden');
    consumedBtn.classList.add('hidden');
  }

  updateSavePresetButtonVisibility();
  document.getElementById('meal-modal').classList.remove('hidden');
}

function openEditRecipeModal(recipeId) {
  if (!currentUser) return checkAuthGuard();

  const recipe = activeRecipes.find(r => r.id === recipeId);
  if (!recipe) return;

  document.getElementById('recipe-id').value = recipe.id;
  document.getElementById('recipe-title-input').value = recipe.title || '';
  document.getElementById('recipe-notes-input').value = recipe.prep_notes || '';
  document.getElementById('recipe-modal-title').innerText = 'Edit Recipe Preset';

  const list = document.getElementById('recipe-ingredients-list');
  list.innerHTML = '';

  if (recipe.recipe_ingredients && recipe.recipe_ingredients.length > 0) {
    recipe.recipe_ingredients.forEach(ing => {
      list.insertAdjacentHTML('beforeend', createIngredientRowHTML(ing.ingredient_name, ing.required_quantity, ing.display_label, ing.unit));
    });
  }

  document.getElementById('recipe-modal').classList.remove('hidden');
}

function openAssignRecipeModal(recipeId) {
  if (!currentUser) return checkAuthGuard();

  document.getElementById('assign-recipe-id').value = recipeId;
  const select = document.getElementById('assign-date-select');
  select.innerHTML = '';

  const sunday = getCurrentWeekSunday();
  for (let i = 0; i < 14; i++) {
    const current = new Date(sunday);
    current.setDate(sunday.getDate() + i);
    const dateStr = formatLocalDate(current);
    const [year, month, day] = dateStr.split('-');
    const formattedDate = `${month}-${day}-${year}`;
    const label = current.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

    select.innerHTML += `<option value="${dateStr}">${label} (${formattedDate})</option>`;
  }

  document.getElementById('assign-recipe-modal').classList.remove('hidden');
}

function confirmDeleteRecipe(id) {
  if (!currentUser) return checkAuthGuard();

  showConfirmation('Delete Recipe Preset', 'Are you sure you want to delete this recipe preset?', async () => {
    const client = getSupabaseClient();
    if (client && currentUser) {
      await client.from('recipes').delete().eq('id', id).eq('user_id', currentUser.id);
      await refreshAllData(client);
    }
  });
}
