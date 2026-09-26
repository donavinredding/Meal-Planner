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
let activeFilterTag = 'ALL';
let confirmCallback = null;
let isSignUpMode = false;

const SUPABASE_URL = 'https://mxkawqbvtckdfffddeey.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im14a2F3cWJ2dGNrZGZmZmRkZWV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1Mzc5NjQsImV4cCI6MjEwNDExMzk2NH0.39RyTqPylHgSq0J_aqbzxqvyL_eM9KWkLKkwtSsSFrc';

function getSupabaseClient() {
  if (window.supabase && typeof window.supabase.createClient === 'function') {
    return window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  }
  console.warn('Supabase CDN not ready or blocked by CORS.');
  return null;
}

async function initApp() {
  const client = getSupabaseClient();
  if (!client) return;

  // Listen for user auth state changes
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
      renderCalendar();
      renderInventory();
      renderRecipes();
      renderNeedToBuy();
    }
  });

  // Check initial active session
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

// Helper to safely format local Date to YYYY-MM-DD
function formatLocalDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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
      .eq('user_id', currentUser.id);

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

  for (let i = 0; i < 14; i++) {
    const current = new Date(sunday);
    current.setDate(sunday.getDate() + i);

    const dateStr = formatLocalDate(current);
    const dayName = current.toLocaleDateString('en-US', { weekday: 'short' });
    const monthDay = current.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    const meal = activeCalendar.find(m => m.meal_date === dateStr);

    const card = document.createElement('div');
    card.className = 'calendar-day-card';
    
    card.innerHTML = `
      <div>
        <div class="day-header">
          <span class="day-title">${dayName}</span>
          <span>${monthDay}</span>
        </div>
        ${meal ? `<div class="meal-name">${meal.custom_title || 'Scheduled Meal'}</div>` : '<div class="meal-name" style="color: #aaa;">+ Add Meal</div>'}
      </div>
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
      .eq('user_id', currentUser.id)
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

  // Date threshold for "Soon to Expire" (3 days)
  const soonThreshold = new Date(today);
  soonThreshold.setDate(today.getDate() + 3);
  const soonThresholdStr = formatLocalDate(soonThreshold);

  activeInventory.forEach(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchVal);
    const matchesTag = activeFilterTag === 'ALL' || item.category === activeFilterTag;
    const isExpired = item.expiration_date && item.expiration_date < todayStr;
    const isSoonToExpire = item.expiration_date && item.expiration_date >= todayStr && item.expiration_date <= soonThresholdStr;

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
          <button class="btn btn-secondary" onclick="openRestockModal('${item.id}', '${item.name}')">Restock</button>
          <button class="btn btn-danger" onclick="confirmDeleteInventory('${item.id}')">Discard</button>
        </div>
      `;
      expiredList.appendChild(card);
    } else if (matchesSearch && matchesTag) {
      const card = document.createElement('div');
      card.className = `polaroid-card ${isSoonToExpire ? 'soon-to-expire' : ''}`;
      card.innerHTML = `
        <div>
          <h3>${item.name}</h3>
          <p><strong>Stock:</strong> ${item.quantity} ${item.unit}</p>
          <p><strong>Category:</strong> ${item.category}</p>
          ${item.expiration_date ? `<p><strong>Exp:</strong> ${item.expiration_date}</p>` : ''}
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

// ====================================================================
// SHOPPING LIST MODULE
// ====================================================================
function renderNeedToBuy() {
  const shoppingContainer = document.getElementById('shopping-list');
  if (!shoppingContainer) return;

  shoppingContainer.innerHTML = '';

  const todayStr = formatLocalDate(new Date());

  // Filter items that have <= 0 stock or are expired
  const outOfStockOrExpiredItems = activeInventory.filter(item => {
    const isOut = item.quantity <= 0;
    const isExpired = item.expiration_date && item.expiration_date < todayStr;
    return isOut || isExpired;
  });

  if (outOfStockOrExpiredItems.length === 0) {
    shoppingContainer.innerHTML = '<p style="color: var(--text-muted);">Your shopping list is currently clear!</p>';
    return;
  }

  outOfStockOrExpiredItems.forEach(item => {
    const isOut = item.quantity <= 0;
    const isExpired = item.expiration_date && item.expiration_date < todayStr;

    let reasonLabel = 'Out of Stock';
    if (isOut && isExpired) reasonLabel = 'Out of Stock & Expired';
    else if (isExpired) reasonLabel = 'Expired';

    const div = document.createElement('div');
    div.className = 'shopping-item urgent';
    div.innerHTML = `
      <div class="shopping-info">
        <h4>${item.name}</h4>
        <div class="shopping-meta">
          <span>Current Stock: ${item.quantity} ${item.unit}</span> | 
          <span>Status: <strong>${reasonLabel}</strong></span>
        </div>
      </div>
      <button class="btn btn-primary" onclick="openRestockModal('${item.id}', '${item.name}')">✓ Restock</button>
    `;
    shoppingContainer.appendChild(div);
  });
}

// ====================================================================
// RECIPE MODULE
// ====================================================================
async function fetchRecipes(client) {
  try {
    const { data, error } = await client
      .from('recipes')
      .select('*, recipe_ingredients(*)')
      .eq('user_id', currentUser.id);

    if (!error && data) {
      activeRecipes = data;
      renderRecipes();
    }
  } catch (err) {
    console.error('Recipe fetch error:', err);
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
      ? recipe.recipe_ingredients.map(i => `• ${i.ingredient_name}: ${i.required_quantity} ${i.unit}`).join('<br>')
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
        <button class="btn btn-danger" onclick="confirmDeleteRecipe('${recipe.id}')">Delete</button>
      </div>
    `;
    container.appendChild(card);
  });
}

// ====================================================================
// MODAL & HANDLERS
// ====================================================================
function setupModalHandlers() {
  document.querySelectorAll('.close-modal').forEach(btn => {
    btn.onclick = () => document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden'));
  });

  // Header Sign In / Sign Out Button
  document.getElementById('btn-auth-action').onclick = async () => {
    const client = getSupabaseClient();
    if (currentUser && client) {
      await client.auth.signOut();
    } else {
      document.getElementById('auth-status-msg').innerText = '';
      document.getElementById('auth-modal').classList.remove('hidden');
    }
  };

  // Toggle Auth Mode (Sign In / Sign Up)
  document.getElementById('toggle-auth-mode').onclick = (e) => {
    e.preventDefault();
    isSignUpMode = !isSignUpMode;
    document.getElementById('auth-modal-title').innerText = isSignUpMode ? 'Sign Up' : 'Sign In';
    document.getElementById('btn-auth-submit').innerText = isSignUpMode ? 'Sign Up' : 'Sign In';
    document.getElementById('toggle-auth-mode').innerText = isSignUpMode ? 'Already have an account? Sign In' : 'Need an account? Sign Up';
  };

  // Auth Form Submit
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

  const addRecipeBtn = document.getElementById('btn-add-recipe');
  if (addRecipeBtn) {
    addRecipeBtn.onclick = () => {
      if (!currentUser) return checkAuthGuard();
      document.getElementById('recipe-form').reset();
      document.getElementById('recipe-id').value = '';
      document.getElementById('recipe-modal-title').innerText = 'Create Recipe Preset';
      document.getElementById('recipe-modal').classList.remove('hidden');
    };
  }

  // Save Meal Form inputs as a new Recipe Preset
  document.getElementById('btn-save-as-preset').onclick = async () => {
    if (!currentUser) return checkAuthGuard();
    const client = getSupabaseClient();
    if (!client) return;

    const title = document.getElementById('meal-title').value.trim();
    const notes = document.getElementById('meal-notes').value.trim();

    if (!title) {
      alert('Please enter a Meal Title first to create a recipe preset.');
      return;
    }

    const payload = {
      title: title,
      prep_notes: notes,
      user_id: currentUser.id
    };

    const { error } = await client.from('recipes').insert([payload]);
    if (!error) {
      alert(`Saved "${title}" as a new Recipe Preset!`);
      await fetchRecipes(client);
      
      // Select the newly created recipe in dropdown
      const recipeSelect = document.getElementById('meal-recipe-select');
      recipeSelect.innerHTML = '<option value="">-- Custom Meal --</option>';
      activeRecipes.forEach(r => {
        const isSelected = r.title === title ? 'selected' : '';
        recipeSelect.innerHTML += `<option value="${r.id}" ${isSelected}>${r.title}</option>`;
      });
    } else {
      alert('Error creating recipe preset: ' + error.message);
    }
  };

  document.getElementById('recipe-form').onsubmit = async (e) => {
    e.preventDefault();
    const client = getSupabaseClient();
    if (!client || !currentUser) return;

    const recipeId = document.getElementById('recipe-id').value;
    const title = document.getElementById('recipe-title-input').value;
    const notes = document.getElementById('recipe-notes-input').value;

    const payload = {
      title,
      prep_notes: notes,
      user_id: currentUser.id
    };

    if (recipeId) {
      await client.from('recipes').update(payload).eq('id', recipeId).eq('user_id', currentUser.id);
    } else {
      await client.from('recipes').insert([payload]);
    }

    document.getElementById('recipe-modal').classList.add('hidden');
    await refreshAllData(client);
  };

  document.getElementById('inventory-form').onsubmit = async (e) => {
    e.preventDefault();
    const client = getSupabaseClient();
    if (!client || !currentUser) return;

    const id = document.getElementById('inv-id').value;
    const payload = {
      name: document.getElementById('inv-name').value,
      category: document.getElementById('inv-category').value,
      quantity: parseFloat(document.getElementById('inv-qty').value),
      unit: document.getElementById('inv-unit').value,
      expiration_date: document.getElementById('inv-exp').value || null,
      user_id: currentUser.id
    };

    if (id) {
      await client.from('inventory').update(payload).eq('id', id).eq('user_id', currentUser.id);
    } else {
      await client.from('inventory').insert([payload]);
    }

    document.getElementById('inventory-modal').classList.add('hidden');
    await refreshAllData(client);
  };

  document.getElementById('restock-form').onsubmit = async (e) => {
    e.preventDefault();
    const client = getSupabaseClient();
    if (!client || !currentUser) return;

    const invId = document.getElementById('restock-inv-id').value;
    const addedQty = parseFloat(document.getElementById('restock-qty').value);
    const expDate = document.getElementById('restock-exp').value;

    if (invId) {
      const { data: current } = await client.from('inventory').select('quantity').eq('id', invId).single();
      const newQty = (current ? current.quantity : 0) + addedQty;

      const updatePayload = { quantity: newQty };
      if (expDate) updatePayload.expiration_date = expDate;

      await client.from('inventory').update(updatePayload).eq('id', invId).eq('user_id', currentUser.id);
      await refreshAllData(client);
    }

    document.getElementById('restock-modal').classList.add('hidden');
  };

  // MEAL FORM SUBMIT
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

    const payload = {
      meal_date: dateVal,
      recipe_id: recipeId,
      custom_title: title,
      prep_notes: notes,
      user_id: currentUser.id
    };

    if (mealId) {
      await client.from('calendar_meals').update(payload).eq('id', mealId).eq('user_id', currentUser.id);
    } else {
      const { data: existingRow } = await client
        .from('calendar_meals')
        .select('id')
        .eq('meal_date', dateVal)
        .eq('user_id', currentUser.id)
        .maybeSingle();

      if (existingRow) {
        await client.from('calendar_meals').update(payload).eq('id', existingRow.id).eq('user_id', currentUser.id);
      } else {
        await client.from('calendar_meals').insert([payload]);
      }
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
      const payload = {
        meal_date: targetDate,
        recipe_id: recipeId,
        custom_title: recipe.title,
        prep_notes: recipe.prep_notes,
        user_id: currentUser.id
      };

      const { data: existingRow } = await client
        .from('calendar_meals')
        .select('id')
        .eq('meal_date', targetDate)
        .eq('user_id', currentUser.id)
        .maybeSingle();

      if (existingRow) {
        await client.from('calendar_meals').update(payload).eq('id', existingRow.id).eq('user_id', currentUser.id);
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
  document.getElementById('inv-qty').value = item.quantity;
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

function openRestockModal(invId, itemName) {
  if (!currentUser) return checkAuthGuard();
  document.getElementById('restock-inv-id').value = invId || '';
  document.getElementById('restock-item-name').innerText = itemName || 'Item';
  document.getElementById('restock-qty').value = '1';
  document.getElementById('restock-exp').value = '';
  document.getElementById('restock-modal').classList.remove('hidden');
}

// FIXED CLEAR DAY FUNCTIONALITY
function openMealModal(dateStr, existingMeal) {
  if (!currentUser) return checkAuthGuard();
  
  document.getElementById('meal-date-val').value = dateStr;

  const [year, month, day] = dateStr.split('-');
  const formattedDate = `${month}-${day}-${year}`;
  document.getElementById('meal-date-label').innerText = `Date: ${formattedDate}`;

  const recipeSelect = document.getElementById('meal-recipe-select');
  recipeSelect.innerHTML = '<option value="">-- Custom Meal --</option>';
  activeRecipes.forEach(r => {
    recipeSelect.innerHTML += `<option value="${r.id}">${r.title}</option>`;
  });

  recipeSelect.onchange = (e) => {
    const selectedRecipe = activeRecipes.find(r => r.id === e.target.value);
    if (selectedRecipe) {
      document.getElementById('meal-title').value = selectedRecipe.title;
      document.getElementById('meal-notes').value = selectedRecipe.prep_notes || '';
    }
  };

  const deleteBtn = document.getElementById('btn-delete-meal');

  if (existingMeal) {
    document.getElementById('meal-id').value = existingMeal.id;
    document.getElementById('meal-title').value = existingMeal.custom_title || '';
    document.getElementById('meal-notes').value = existingMeal.prep_notes || '';
    document.getElementById('meal-recipe-select').value = existingMeal.recipe_id || '';
    
    deleteBtn.classList.remove('hidden');
    deleteBtn.onclick = () => {
      showConfirmation('Clear Calendar Day', `Clear meal planned for ${formattedDate}?`, async () => {
        const client = getSupabaseClient();
        if (client && currentUser) {
          // Delete by ID if available or by meal_date
          if (existingMeal.id) {
            await client.from('calendar_meals').delete().eq('id', existingMeal.id).eq('user_id', currentUser.id);
          } else {
            await client.from('calendar_meals').delete().eq('meal_date', dateStr).eq('user_id', currentUser.id);
          }
          
          document.getElementById('meal-modal').classList.add('hidden');
          await refreshAllData(client);
        }
      });
    };
  } else {
    document.getElementById('meal-id').value = '';
    document.getElementById('meal-title').value = '';
    document.getElementById('meal-notes').value = '';
    deleteBtn.classList.add('hidden');
  }

  document.getElementById('meal-modal').classList.remove('hidden');
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
