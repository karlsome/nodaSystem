// Noda System - Tablet UI for Inventory and Picking
// Global variables
let currentScreen = 'login';
let pickingRequests = [];
let currentRequest = null;
let currentRequestNumber = null;
let currentFilter = 'all';
let currentWorker = null;
let socket = null;
let recentActivities = []; // Initialize empty array for activities
let todaysTasks = []; // Initialize empty array for tasks

// API base URL - change this to your server URL
//const API_BASE_URL = 'http://localhost:3001/api';
const API_BASE_URL = 'https://nodasystem.onrender.com/api';

// Debug localStorage on page load
console.log('🔄 Page loaded, checking localStorage availability...');
console.log('💾 localStorage supported:', typeof(Storage) !== "undefined");
if (typeof(Storage) !== "undefined") {
    const storedWorker = localStorage.getItem('currentWorker');
    console.log('💾 Initial localStorage check:', storedWorker);
}

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
});

function initializeApp() {
    console.log('🔄 Initializing app...');

    // Initialize language system
    if (typeof initializeLanguage === 'function') {
        initializeLanguage();
    }

    updateCurrentTime();
    setInterval(updateCurrentTime, 1000); // Update time every second

    // Check if already logged in
    const savedWorker = localStorage.getItem('currentWorker');
    console.log('💾 Checking localStorage for currentWorker:', savedWorker);
    console.log('💾 localStorage available:', typeof(Storage) !== "undefined");

    if (savedWorker) {
        console.log('✅ Found saved worker, auto-logging in:', savedWorker);
        currentWorker = savedWorker;
        showWorkerInfo();
        showScreen('home');
        initializeSocket();
    } else {
        console.log('❌ No saved worker found, showing login screen');
        showScreen('login');
    }
}

// Socket.IO initialization
function initializeSocket() {
    if (!socket) {
        // Extract the base URL from the API_BASE_URL
        const socketUrl = API_BASE_URL.replace('/api', '');
        console.log('🔌 Connecting to Socket.IO server:', socketUrl);
        socket = io(socketUrl);
        
        socket.on('connect', () => {
            console.log('✅ Connected to Socket.IO server:', socket.id);
            updateConnectionStatus(true);
            
            // Register as tablet
            socket.emit('device-register', {
                type: 'tablet'
            });
        });
        
        socket.on('disconnect', () => {
            console.log('Disconnected from server');
            updateConnectionStatus(false);
        });
        
        socket.on('item-completed', (data) => {
            console.log('🎯 Item completed event received:', data);
            showToast(`${data.deviceId} がアイテムを完了しました`, 'success');
            
            // Play a sound to alert the user
            try {
                const audio = new Audio('/alert.mp3');
                audio.play().catch(e => console.log('Audio play failed:', e));
            } catch (e) {
                console.log('Audio creation failed:', e);
            }
            
            // Refresh current view if viewing the same request
            if (currentRequestNumber === data.requestNumber) {
                console.log('🔄 Refreshing picking detail for request:', currentRequestNumber);
                refreshPickingDetail();
                
                // Force-update the specific line item without full refresh if possible
                updateLineItemStatus(data.requestNumber, data.lineNumber, 'completed');
            } else {
                console.log('ℹ️ Not refreshing - current request is:', currentRequestNumber, 'but completed request is:', data.requestNumber);
            }
        });
        
        // Add direct device status update handler
        socket.on('device-status-update', (data) => {
            console.log('📱 Device status update received:', data);
            
            // If this is a status update for our current request's device
            if (currentRequestNumber === data.requestNumber) {
                console.log('📊 Updating device status in UI for:', data.deviceId);
                updateDeviceStatusInUI(data);
            }
        });
        
        socket.on('lock-status-update', (lockStatus) => {
            console.log('Lock status update:', lockStatus);
            updateLockUI(lockStatus);
        });
        
        socket.on('error', (error) => {
            console.error('Socket error:', error);
            showToast(t('connection-error'), 'error');
        });
    }
}

// Login functionality
function handleLogin(event) {
    event.preventDefault();
    const workerName = document.getElementById('workerNameInput').value.trim();
    console.log('🔐 Attempting login with worker:', workerName);
    
    if (workerName) {
        console.log('💾 Saving worker to localStorage:', workerName);
        currentWorker = workerName;
        localStorage.setItem('currentWorker', workerName);
        
        // Verify it was saved
        const verified = localStorage.getItem('currentWorker');
        console.log('✅ Verified localStorage save:', verified);
        
        showWorkerInfo();
        showScreen('home');
        initializeSocket();
        showToast(`${workerName}さん、ようこそ！`, 'success');
    } else {
        console.log('❌ No worker name provided');
    }
}

function logout() {
    console.log('🚪 Logging out, removing localStorage...');
    currentWorker = null;
    localStorage.removeItem('currentWorker');
    
    // Verify it was removed
    const verified = localStorage.getItem('currentWorker');
    console.log('✅ Verified localStorage removal:', verified);
    
    if (socket) {
        socket.disconnect();
        socket = null;
    }
    hideWorkerInfo();
    showScreen('login');
    showToast('ログアウトしました', 'info');
}

function showWorkerInfo() {
    document.getElementById('workerName').textContent = currentWorker;
    document.getElementById('workerInfo').style.display = 'block';
    document.getElementById('logoutBtn').style.display = 'block';
}

function hideWorkerInfo() {
    document.getElementById('workerInfo').style.display = 'none';
    document.getElementById('logoutBtn').style.display = 'none';
}

function updateConnectionStatus(connected) {
    const statusElement = document.getElementById('connectionStatus');
    const textElement = document.getElementById('connectionText');
    const t = window.t || ((key) => key);

    if (statusElement && textElement) {
        if (connected) {
            statusElement.className = 'w-3 h-3 bg-green-400 rounded-full animate-pulse';
            textElement.textContent = t('connection-status-connected');
        } else {
            statusElement.className = 'w-3 h-3 bg-red-400 rounded-full';
            textElement.textContent = t('connection-status-disconnected');
        }
    }
}

// Global lock status handling
function updateLockUI(lockStatus) {
    const isLocked = lockStatus.isLocked;
    const activeRequestNumber = lockStatus.activeRequestNumber;
    const startedBy = lockStatus.startedBy;
    
    // Update all start buttons
    const startButtons = document.querySelectorAll('.start-picking-btn');
    startButtons.forEach(button => {
        if (isLocked) {
            button.disabled = true;
            button.classList.add('opacity-50', 'cursor-not-allowed');
            button.textContent = t('other-order-processing');
        } else {
            button.disabled = false;
            button.classList.remove('opacity-50', 'cursor-not-allowed');
            button.textContent = 'ピッキング開始';
        }
    });
    
    // Show lock notification if system is locked
    if (isLocked && activeRequestNumber) {
        showLockNotification(activeRequestNumber, startedBy);
    } else {
        hideLockNotification();
    }
}

function showLockNotification(activeRequestNumber, startedBy) {
    let notification = document.getElementById('lockNotification');
    if (!notification) {
        // Create notification element if it doesn't exist
        notification = document.createElement('div');
        notification.id = 'lockNotification';
        notification.className = 'fixed top-20 left-1/2 transform -translate-x-1/2 bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-4 rounded shadow-lg z-50';
        document.body.appendChild(notification);
    }
    
    notification.innerHTML = `
        <div class="flex">
            <div class="ml-3">
                <p class="text-sm">
                    <strong>${t('system-lock-strong')}</strong> ${t('system-lock-message')} ${activeRequestNumber} ${t('system-lock-by')} ${startedBy} ${t('system-lock-processing')}
                </p>
            </div>
        </div>
    `;
    notification.style.display = 'block';
}

function hideLockNotification() {
    const notification = document.getElementById('lockNotification');
    if (notification) {
        notification.style.display = 'none';
    }
}

// Check and update lock status from server
async function checkAndUpdateLockStatus() {
    try {
        const response = await fetch(`${API_BASE_URL}/picking-lock-status`);
        if (response.ok) {
            const lockStatus = await response.json();
            updateLockUI(lockStatus);
            
            // 🚨 NEW: If there's an active request that's locked, trigger ESP32 refresh
            if (lockStatus.isLocked && lockStatus.activeRequestNumber) {
                console.log(`🔄 Lock detected for ${lockStatus.activeRequestNumber}, triggering ESP32 refresh`);
                await refreshESP32Devices(lockStatus.activeRequestNumber);
            }
        }
    } catch (error) {
        console.error('Error checking lock status:', error);
    }
}

// Screen management functions
function showScreen(screenName) {
    // Hide all screens
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('homeScreen').classList.add('hidden');
    document.getElementById('pickingScreen').classList.add('hidden');
    document.getElementById('pickingDetailScreen').classList.add('hidden');
    document.getElementById('inventoryScreen').classList.add('hidden');
    
    // Show selected screen
    document.getElementById(screenName + 'Screen').classList.remove('hidden');
    currentScreen = screenName;
}

function openInventorySystem() {
    showScreen('inventory');
}

function openPickingSystem() {
    showScreen('picking');
    loadPickingRequests();
}

function backToHome() {
    showScreen('home');
}

function backToPickingList() {
    showScreen('picking');
    // Refresh the picking requests list to show latest data
    loadPickingRequests();
}

// Time display function
function updateCurrentTime() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('ja-JP', { 
        hour12: false,
        hour: '2-digit',
        minute: '2-digit'
    });
    const timeElement = document.getElementById('currentTime');
    if (timeElement) {
        timeElement.textContent = timeString;
    }
}

// Check and update global lock status
async function checkAndUpdateLockStatus() {
    try {
        const response = await fetch(`${API_BASE_URL}/picking-lock-status`);
        if (response.ok) {
            const lockStatus = await response.json();
            updateLockUI(lockStatus);
        }
    } catch (error) {
        console.error('Error checking lock status:', error);
    }
}

// Picking Requests Functions
async function loadPickingRequests() {
    try {
        showLoading(true);
        
        const response = await fetch(`${API_BASE_URL}/request-numbers`);
        if (!response.ok) {
            throw new Error('Failed to fetch picking requests');
        }
        
        pickingRequests = await response.json();
        displayPickingRequests();
        
        // Check lock status after loading requests
        await checkAndUpdateLockStatus();
        
    } catch (error) {
        console.error('Error loading picking requests:', error);
        showToast('ピッキング依頼の読み込みに失敗しました', 'error');
        displayNoRequests();
    } finally {
        showLoading(false);
    }
}

function displayPickingRequests() {
    const container = document.getElementById('pickingRequestsList');
    
    if (!pickingRequests || pickingRequests.length === 0) {
        displayNoRequests();
        return;
    }
    
    // Filter requests based on current filter
    const filteredRequests = currentFilter === 'all' 
        ? pickingRequests 
        : pickingRequests.filter(req => req.status === currentFilter);
    
    container.innerHTML = '';
    
    filteredRequests.forEach(request => {
        const requestCard = createPickingRequestCard(request);
        container.appendChild(requestCard);
    });
}

function createPickingRequestCard(request) {
    const card = document.createElement('div');
    card.className = 'picking-request-card';
    card.onclick = () => viewPickingDetail(request.requestNumber);

    const t = window.t || ((key) => key);
    const statusClass = getStatusClass(request.status);
    const statusText = getStatusText(request.status);
    const currentLang = window.currentLanguage || 'ja';
    const formattedDate = new Date(request.createdAt).toLocaleDateString(currentLang === 'ja' ? 'ja-JP' : 'en-US');

    card.innerHTML = `
        <div class="flex items-center justify-between">
            <div class="flex items-center space-x-3">
                <div class="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                    <i class="fas fa-box text-green-600 text-lg"></i>
                </div>
                <div>
                    <h3 class="text-lg font-bold text-gray-900">${request.requestNumber}</h3>
                    <p class="text-sm text-gray-600">
                        ${request.itemCount}${t('items-suffix')} • ${request.totalQuantity}${t('pieces')}
                    </p>
                </div>
            </div>
            <div class="text-right">
                <span class="status-badge ${statusClass} text-xs">
                    ${statusText}
                </span>
                <p class="text-xs text-gray-500 mt-1">${formattedDate}</p>
            </div>
        </div>
    `;

    return card;
}

async function viewPickingDetail(requestNumber) {
    try {
        currentRequestNumber = requestNumber;
        
        const response = await fetch(`${API_BASE_URL}/picking-requests/group/${requestNumber}`);
        if (!response.ok) {
            throw new Error('Failed to fetch picking request details');
        }
        
        const request = await response.json();
        currentRequest = request;
        displayPickingDetail(request);
        showScreen('pickingDetail');
        
    } catch (error) {
        console.error('Error loading picking request details:', error);
        showToast('ピッキング詳細の読み込みに失敗しました', 'error');
    }
}

async function displayPickingDetail(request) {
    if (!request) {
        console.error('No request provided to displayPickingDetail');
        return;
    }

    const t = window.t || ((key) => key);

    // Ensure lineItems exists
    if (!request.lineItems) {
        console.error('Request missing lineItems:', request);
        request.lineItems = [];
    }

    // Enrich line items with master data (収容数)
    await enrichLineItemsWithMasterData(request.lineItems);

    // Update header
    document.getElementById('pickingDetailTitle').textContent = `${t('picking-detail')}: ${request.requestNumber}`;
    document.getElementById('pickingDetailSubtitle').textContent = `${request.lineItems.length}${t('items-suffix')}${t('items-picking')}`;
    
    // Update request info
    const infoContainer = document.getElementById('pickingRequestInfo');
    const completedItems = request.lineItems.filter(item => item.status === 'completed').length;

    infoContainer.innerHTML = `
        <div>
            <p class="text-xs text-gray-500 mb-1">${t('request-number')}</p>
            <p class="text-sm font-semibold text-gray-900">${request.requestNumber}</p>
        </div>
        <div>
            <p class="text-xs text-gray-500 mb-1">${t('status-label')}</p>
            <span id="requestStatusBadge" class="status-badge ${getStatusClass(request.status)} text-xs">
                ${getStatusText(request.status)}
            </span>
        </div>
        <div>
            <p class="text-xs text-gray-500 mb-1">${t('progress-label')}</p>
            <p class="text-sm font-semibold text-gray-900 request-progress">${completedItems}/${request.lineItems.length}</p>
        </div>
        <div>
            <p class="text-xs text-gray-500 mb-1">${t('created-by')}</p>
            <p class="text-sm font-semibold text-gray-900">${request.createdBy}</p>
        </div>
    `;
    
    // Update items list
    const itemsContainer = document.getElementById('pickingItemsList');
    itemsContainer.innerHTML = '';
    
    request.lineItems.forEach((item, index) => {
        const itemElement = createPickingItemElement(item, index + 1);
        itemsContainer.appendChild(itemElement);
    });
    
    // Update start button state
    const startBtn = document.getElementById('startPickingBtn');
    startBtn.classList.add('start-picking-btn'); // Add class for lock handling
    
    if (request.status === 'pending') {
        startBtn.disabled = false;
        startBtn.onclick = startPickingProcess;
        startBtn.innerHTML = `<i class="fas fa-play mr-2"></i>${t('start-button')}`;
    } else if (request.status === 'in-progress') {
        startBtn.disabled = true;
        startBtn.onclick = null;
        startBtn.innerHTML = `<i class="fas fa-clock mr-2"></i>${t('in-progress-button')}`;
    } else if (request.status === 'completed') {
        startBtn.disabled = false;
        startBtn.onclick = completeAndBackToList;
        startBtn.innerHTML = `<i class="fas fa-check mr-2"></i>${t('completed-button')}`;
        startBtn.className = 'px-8 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors text-lg font-medium';
    }
}

// Enrich line items with master data to calculate box quantities
async function enrichLineItemsWithMasterData(lineItems) {
    try {
        for (const item of lineItems) {
            // Fetch master data for this item
            const masterData = await fetchMasterData(item.品番);
            
            if (masterData && masterData.収容数) {
                const 収容数 = parseInt(masterData.収容数);
                if (収容数 > 0) {
                    // Calculate box quantity (pieces ÷ capacity per box)
                    item.boxQuantity = Math.ceil(item.quantity / 収容数);
                    item.収容数 = 収容数;
                } else {
                    item.boxQuantity = item.quantity; // Fallback if 収容数 is 0
                    item.収容数 = 1;
                }
            } else {
                // If no master data found, show original quantity
                item.boxQuantity = item.quantity;
                item.収容数 = 1;
            }
        }
    } catch (error) {
        console.error('Error enriching line items with master data:', error);
    }
}

// Fetch master data from server
async function fetchMasterData(品番) {
    try {
        const response = await fetch(`${API_BASE_URL}/master-data/${encodeURIComponent(品番)}`);
        if (response.ok) {
            const data = await response.json();
            return data;
        }
        return null;
    } catch (error) {
        console.error(`Error fetching master data for ${品番}:`, error);
        return null;
    }
}

function createPickingItemElement(item, index) {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'picking-item p-4';
    const t = window.t || ((key) => key);

    // Add data attributes for real-time updates
    itemDiv.setAttribute('data-line', item.lineNumber);
    itemDiv.setAttribute('data-device-id', item.背番号);
    itemDiv.setAttribute('data-item-id', item.品番);
    itemDiv.setAttribute('data-status', item.status);

    // Status icon and text based on item status
    let statusIcon = '';
    let statusText = '';

    if (item.status === 'completed') {
        statusIcon = '<i class="fas fa-check-circle text-green-500 text-xl"></i>';
        statusText = t('status-completed');
    } else if (item.status === 'in-progress') {
        statusIcon = '<i class="fas fa-circle-notch fa-spin text-blue-500 text-xl"></i>';
        statusText = t('status-in-progress');
    } else {
        statusIcon = '<i class="far fa-circle text-gray-400 text-xl"></i>';
        statusText = t('status-pending');
    }

    const completedInfo = item.completedAt ?
        `<p class="text-xs text-gray-500 mt-1">${new Date(item.completedAt).toLocaleTimeString('ja-JP')}</p>` : '';

    // Use box quantity if available, otherwise use piece quantity
    const displayQuantity = item.boxQuantity !== undefined ? item.boxQuantity : item.quantity;
    const quantityUnit = item.boxQuantity !== undefined ? '個' : t('pieces');
    const quantityDetail = item.boxQuantity !== undefined && item.収容数 > 1 
        ? `<span class="text-xs text-gray-500">(${item.quantity}${t('pieces')} ÷ ${item.収容数})</span>` 
        : '';

    itemDiv.innerHTML = `
        <div class="flex items-center justify-between">
            <div class="flex items-center space-x-3">
                <div class="text-center status-icon">
                    ${statusIcon}
                </div>
                <div>
                    <h4 class="font-semibold text-gray-900">${item.品番}</h4>
                    <div class="flex items-center space-x-3 mt-1">
                        <p class="text-sm text-gray-600">${t('device-number')}: ${item.背番号}</p>
                        <span class="text-gray-400">•</span>
                        <p class="text-sm text-gray-600">${t('quantity')}: ${displayQuantity}${quantityUnit} ${quantityDetail}</p>
                    </div>
                    <div class="completion-info">${completedInfo}</div>
                </div>
            </div>
            <div class="text-right">
                <span class="status-badge ${item.status === 'completed' ? 'bg-green-100 text-green-800' : item.status === 'in-progress' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'} text-xs">
                    ${statusText}
                </span>
            </div>
        </div>
    `;

    return itemDiv;
}

// Start picking process
async function startPickingProcess() {
    if (!currentWorker) {
        showToast(t('login-required'), 'error');
        return;
    }
    
    if (!currentRequestNumber) {
        showToast(t('no-request-selected'), 'error');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/picking-requests/${currentRequestNumber}/start`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                startedBy: currentWorker
            })
        });
        
        if (response.status === 423) {
            // System is locked
            const lockData = await response.json();
            showToast(`他の注文が処理中です (注文番号: ${lockData.activeRequestNumber})`, 'error');
            return;
        }
        
        if (!response.ok) {
            throw new Error('Failed to start picking process');
        }
        
        const result = await response.json();
        showToast('ピッキングプロセスを開始しました！', 'success');
        
        // Refresh the detail view and notify ESP32 devices
        setTimeout(async () => {
            await refreshPickingDetail();
        }, 1000);
        
    } catch (error) {
        console.error('Error starting picking process:', error);
        showToast('ピッキング開始に失敗しました', 'error');
    }
}

// Start individual item picking
// Individual picking function removed - picking is now handled automatically by ESP32 devices
/*
async function startIndividualPicking(lineNumber, deviceId) {
    if (!currentWorker) {
        showToast(t('login-required'), 'error');
        return;
    }
    
    if (!currentRequestNumber) {
        showToast(t('no-request-selected'), 'error');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/picking-requests/${currentRequestNumber}/line/${lineNumber}/start`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                startedBy: currentWorker,
                deviceId: deviceId
            })
        });
        
        if (!response.ok) {
            throw new Error('Failed to start individual picking');
        }
        
        const result = await response.json();
        showToast(`背番号 ${deviceId} でピッキングを開始しました！`, 'success');
        
        // Refresh the detail view
        setTimeout(() => {
            refreshPickingDetail();
        }, 1000);
        
    } catch (error) {
        console.error('Error starting individual picking:', error);
        showToast('ピッキング開始に失敗しました', 'error');
    }
}
*/

// Refresh picking detail
async function refreshPickingDetail() {
    if (currentRequestNumber) {
        console.log('🔄 Refreshing picking detail for request:', currentRequestNumber);
        try {
            // Add cache-busting parameter to ensure we get fresh data
            const timestamp = new Date().getTime();
            const response = await fetch(`${API_BASE_URL}/picking-requests/group/${currentRequestNumber}?_=${timestamp}`);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch picking request details: ${response.status}`);
            }
            
            const request = await response.json();
            console.log('📄 Refreshed data received:', request);
            currentRequest = request;
            displayPickingDetail(request);
            
            // Check lock status after refreshing detail
            await checkAndUpdateLockStatus();
            
            // Also refresh ESP32 devices for this request
            await refreshESP32Devices(currentRequestNumber);
            
            console.log('✅ Refresh completed successfully');
        } catch (error) {
            console.error('❌ Error refreshing picking detail:', error);
            showToast('更新に失敗しました', 'error');
        }
    } else {
        console.warn('⚠️ Cannot refresh - no current request number');
    }
}

// Update line item status directly in the UI without full refresh
function updateLineItemStatus(requestNumber, lineNumber, newStatus) {
    if (currentRequestNumber !== requestNumber) {
        console.log('⚠️ Not updating UI - different request is active');
        return;
    }
    
    try {
        console.log(`🔄 Updating line item ${lineNumber} to ${newStatus} in UI`);
        
        // Find the line item in the DOM
        const lineItemSelector = `.picking-item[data-line="${lineNumber}"]`;
        const lineItemElement = document.querySelector(lineItemSelector);
        
        if (!lineItemElement) {
            console.warn(`❌ Could not find line item element with selector: ${lineItemSelector}`);
            return;
        }
        
        // Update the status badge
        const statusBadge = lineItemElement.querySelector('.status-badge');
        if (statusBadge) {
            // Remove old status classes
            statusBadge.classList.remove('bg-yellow-100', 'text-yellow-800', 'bg-gray-100', 'text-gray-800', 'bg-green-100', 'text-green-800');
            
            // Add appropriate class for new status
            if (newStatus === 'completed') {
                statusBadge.classList.add('bg-green-100', 'text-green-800');
                statusBadge.textContent = '完了';
                
                // Add completion timestamp and user
                const completionInfo = document.createElement('div');
                completionInfo.className = 'text-xs text-gray-500 mt-1';
                const now = new Date();
                completionInfo.innerHTML = `
                    <p>完了: ${now.toLocaleString('ja-JP')}</p>
                    <p>作業者: IoT Device</p>
                `;
                
                // Find or create a container for this info
                let infoContainer = lineItemElement.querySelector('.completion-info');
                if (!infoContainer) {
                    infoContainer = document.createElement('div');
                    infoContainer.className = 'completion-info mt-2';
                    lineItemElement.appendChild(infoContainer);
                }
                infoContainer.innerHTML = completionInfo.innerHTML;
            }
        }
        
        // Update the item's status icon
        const statusIcon = lineItemElement.querySelector('.status-icon');
        if (statusIcon) {
            if (newStatus === 'completed') {
                statusIcon.innerHTML = '<i class="fas fa-check-circle text-green-500"></i>';
            }
        }
        
        // Update progress counter at the top
        updateProgressCounter();
        
    } catch (error) {
        console.error('Error updating line item status in UI:', error);
    }
}

// Update device status in UI
function updateDeviceStatusInUI(deviceData) {
    try {
        const { deviceId, status, isPickingMode, currentQuantity } = deviceData;
        
        // Find all elements that show this device's status
        const deviceElements = document.querySelectorAll(`[data-device-id="${deviceId}"]`);
        
        deviceElements.forEach(element => {
            // Update status indicator if it exists
            const statusIndicator = element.querySelector('.device-status-indicator');
            if (statusIndicator) {
                statusIndicator.className = 'device-status-indicator w-3 h-3 rounded-full';
                
                if (status === 'picking') {
                    statusIndicator.classList.add('bg-green-500', 'animate-pulse');
                } else if (status === 'standby') {
                    statusIndicator.classList.add('bg-blue-400');
                } else {
                    statusIndicator.classList.add('bg-gray-400');
                }
            }
            
            // Update status text if it exists
            const statusText = element.querySelector('.device-status-text');
            if (statusText) {
                if (status === 'picking') {
                    statusText.textContent = 'ピッキング中';
                    statusText.className = 'device-status-text text-green-600 font-medium';
                } else if (status === 'standby') {
                    statusText.textContent = t('device-status-standby');
                    statusText.className = 'device-status-text text-blue-600';
                } else {
                    statusText.textContent = 'オフライン';
                    statusText.className = 'device-status-text text-gray-600';
                }
            }
        });
        
    } catch (error) {
        console.error('Error updating device status in UI:', error);
    }
}

// Update progress counter
function updateProgressCounter() {
    if (!currentRequest) return;
    
    const completedItems = document.querySelectorAll('.picking-item .status-badge:contains("完了")').length;
    const totalItems = currentRequest.lineItems.length;
    
    const progressElement = document.querySelector('.request-progress');
    if (progressElement) {
        progressElement.textContent = `${completedItems}/${totalItems}`;
    }
    
    // If all items are completed, update the request status
    if (completedItems === totalItems) {
        const statusBadge = document.querySelector('#requestStatusBadge');
        if (statusBadge) {
            statusBadge.textContent = '完了';
            statusBadge.className = 'status-badge bg-green-100 text-green-800 px-2 py-1 rounded-full text-xs font-medium';
        }
    }
}

// Function to refresh ESP32 devices for a specific request
async function refreshESP32Devices(requestNumber) {
    try {
        console.log(`🔄 Refreshing ESP32 devices for request: ${requestNumber}`);
        
        const response = await fetch(`${API_BASE_URL}/refresh-devices/${requestNumber}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                userName: currentWorker || 'Tablet'
            })
        });
        
        if (response.ok) {
            const result = await response.json();
            console.log(`✅ ESP32 refresh result:`, result);
            
            if (result.devicesNotified && result.devicesNotified.length > 0) {
                showToast(`デバイス更新: ${result.devicesNotified.join(', ')}`, 'success');
            }
        } else {
            console.warn('Failed to refresh ESP32 devices:', response.status);
        }
        
    } catch (error) {
        console.error('Error refreshing ESP32 devices:', error);
        // Don't show error toast to user as this is a background operation
    }
}

// Complete picking and back to list
function completeAndBackToList() {
    showToast('ピッキング完了！リストに戻ります', 'success');
    backToPickingList();
}

function displayNoRequests() {
    const container = document.getElementById('pickingRequestsList');
    const t = window.t || ((key) => key);

    container.innerHTML = `
        <div class="bg-white rounded-lg border border-gray-200 p-12 text-center">
            <div class="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <i class="fas fa-inbox text-2xl text-gray-400"></i>
            </div>
            <h3 class="text-lg font-bold text-gray-900 mb-2">${t('no-requests-title')}</h3>
            <p class="text-sm text-gray-600">${t('no-requests-desc')}</p>
        </div>
    `;
}

// Filter functions
function filterByStatus(status) {
    currentFilter = status;
    
    // Update filter buttons
    document.querySelectorAll('.status-filter').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');
    
    displayPickingRequests();
}

// Refresh function
async function refreshPickingRequests() {
    await loadPickingRequests();
    
    // If we're currently viewing a specific request, also refresh ESP32 devices
    if (currentRequestNumber) {
        await refreshESP32Devices(currentRequestNumber);
    }
    
    showToast(t('requests-refreshed'), 'success');
}

// Utility functions
function getStatusClass(status) {
    switch (status) {
        case 'pending': return 'status-pending';
        case 'in-progress': return 'status-in-progress';
        case 'completed': return 'status-completed';
        default: return 'status-pending';
    }
}

function getStatusText(status) {
    const t = window.t || ((key) => key); // Fallback if translation not loaded
    switch (status) {
        case 'pending': return t('status-pending');
        case 'in-progress': return t('status-in-progress');
        case 'completed': return t('status-completed');
        default: return t('status-unknown');
    }
}

function showLoading(show) {
    const loadingElement = document.getElementById('loadingState');
    if (loadingElement) {
        if (show) {
            loadingElement.classList.remove('hidden');
        } else {
            loadingElement.classList.add('hidden');
        }
    }
}

// Toast notification function
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    const icon = document.getElementById('toastIcon');
    const messageSpan = document.getElementById('toastMessage');
    
    if (!toast || !icon || !messageSpan) return;
    
    messageSpan.textContent = message;
    
    // Reset classes
    toast.className = 'fixed top-4 right-4 text-white px-6 py-3 rounded-lg shadow-lg z-50 transform transition-all duration-300';
    
    // Add type-specific classes
    switch(type) {
        case 'error':
            toast.classList.add('toast-error');
            icon.className = 'fas fa-exclamation-circle mr-2';
            break;
        case 'warning':
            toast.classList.add('toast-warning');
            icon.className = 'fas fa-exclamation-triangle mr-2';
            break;
        case 'info':
            toast.classList.add('toast-info');
            icon.className = 'fas fa-info-circle mr-2';
            break;
        default:
            toast.classList.add('toast-success');
            icon.className = 'fas fa-check-circle mr-2';
    }
    
    toast.classList.remove('hidden');
    
    // Auto hide after 3 seconds
    setTimeout(() => {
        toast.classList.add('hidden');
    }, 3000);
}

// Keyboard shortcuts
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        backToHome();
    }
    
    // Quick shortcuts
    if (e.ctrlKey || e.metaKey) {
        switch(e.key) {
            case '1':
                e.preventDefault();
                openInventorySystem();
                break;
            case '2':
                e.preventDefault();
                openPickingSystem();
                break;
            case 'r':
                e.preventDefault();
                if (currentScreen === 'picking') {
                    refreshPickingRequests();
                }
                break;
        }
    }
});

// ==================== INVENTORY COUNT SYSTEM ====================

// Global storage for scanned inventory items
let inventoryScannedItems = [];

// Initialize inventory screen when opened
function openInventorySystem() {
    showScreen('inventory');
    inventoryScannedItems = [];
    updateInventoryList();

    // Focus on scan input
    setTimeout(() => {
        const scanInput = document.getElementById('inventoryScanInput');
        if (scanInput) {
            scanInput.focus();
        }
    }, 300);

    // Set up keyboard listener for scanning
    setupInventoryScanListener();
}

// Set up keyboard listener for the scanner input
function setupInventoryScanListener() {
    const scanInput = document.getElementById('inventoryScanInput');
    if (!scanInput) return;

    // Remove any existing listeners
    scanInput.replaceWith(scanInput.cloneNode(true));
    const newScanInput = document.getElementById('inventoryScanInput');

    newScanInput.addEventListener('keypress', async function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            const scannedValue = newScanInput.value.trim();

            if (scannedValue) {
                await processInventoryScan(scannedValue);
                newScanInput.value = '';
            }
        }
    });
}

// Process a scanned QR code
async function processInventoryScan(scanValue) {
    try {
        // Parse the scanned value (format: "品番,数量")
        const parts = scanValue.split(',');

        if (parts.length !== 2) {
            showToast(t('invalid-qr-format'), 'error');
            return;
        }

        const 品番 = parts[0].trim();
        const scannedQuantity = parseInt(parts[1].trim());

        if (!品番 || isNaN(scannedQuantity) || scannedQuantity < 0) {
            showToast(t('invalid-product-quantity'), 'error');
            return;
        }

        // Validate that this product exists in inventory
        const isValid = await validateProductExists(品番);
        if (!isValid) {
            showToast(`品番 ${品番} は在庫に存在しません`, 'error');
            return;
        }

        // Get current inventory data
        const currentInventory = await getCurrentInventory(品番);

        // Check if already scanned
        const existingIndex = inventoryScannedItems.findIndex(item => item.品番 === 品番);

        if (existingIndex >= 0) {
            // Update existing item
            inventoryScannedItems[existingIndex].newQuantity = scannedQuantity;
            inventoryScannedItems[existingIndex].scannedAt = new Date();
            showToast(`${品番} の数量を更新しました`, 'info');
        } else {
            // Add new item to the list
            inventoryScannedItems.push({
                品番: 品番,
                背番号: currentInventory.背番号 || 'N/A',
                currentQuantity: currentInventory.physicalQuantity || 0,
                newQuantity: scannedQuantity,
                scannedAt: new Date()
            });
            showToast(`${品番} をリストに追加しました`, 'success');
        }

        updateInventoryList();

    } catch (error) {
        console.error('Error processing inventory scan:', error);
        showToast(t('scan-error'), 'error');
    }
}

// Validate that a product exists in inventory
async function validateProductExists(品番) {
    try {
        const response = await fetch(`${API_BASE_URL}/inventory/validate/${encodeURIComponent(品番)}`);
        if (!response.ok) {
            return false;
        }
        const data = await response.json();
        return data.exists;
    } catch (error) {
        console.error('Error validating product:', error);
        return false;
    }
}

// Get current inventory data for a product
async function getCurrentInventory(品番) {
    try {
        const response = await fetch(`${API_BASE_URL}/inventory/current/${encodeURIComponent(品番)}`);
        if (!response.ok) {
            throw new Error('Failed to get current inventory');
        }
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error getting current inventory:', error);
        return { physicalQuantity: 0, 背番号: 'N/A' };
    }
}

// Update the displayed list of scanned items
function updateInventoryList() {
    const listContainer = document.getElementById('inventoryItemsList');
    const emptyState = document.getElementById('inventoryEmptyState');
    const countDisplay = document.getElementById('inventoryItemCount');

    if (!listContainer || !countDisplay) return;

    // Update count
    countDisplay.textContent = `(${inventoryScannedItems.length})`;

    const t = window.t || ((key) => key);

    // Show/hide empty state
    if (inventoryScannedItems.length === 0) {
        if (emptyState) {
            emptyState.classList.remove('hidden');
        }
        listContainer.innerHTML = `
            <div id="inventoryEmptyState" class="p-12 text-center text-gray-500">
                <i class="fas fa-barcode text-6xl mb-4 text-gray-300"></i>
                <p class="text-lg">${t('scan-prompt')}</p>
                <p class="text-sm mt-2">${t('scan-prompt-desc')}</p>
            </div>
        `;
        return;
    }

    // Hide empty state and build list
    if (emptyState) {
        emptyState.classList.add('hidden');
    }

    listContainer.innerHTML = '';

    inventoryScannedItems.forEach((item, index) => {
        const itemElement = createInventoryItemElement(item, index);
        listContainer.appendChild(itemElement);
    });
}

// Create a single inventory item element
function createInventoryItemElement(item, index) {
    const div = document.createElement('div');
    div.className = 'p-6 hover:bg-gray-50 transition-colors';

    const t = window.t || ((key) => key);
    const currentLang = window.currentLanguage || 'ja';
    const difference = item.newQuantity - item.currentQuantity;
    const differenceClass = difference > 0 ? 'text-green-600' : difference < 0 ? 'text-red-600' : 'text-gray-600';
    const differenceIcon = difference > 0 ? 'fa-arrow-up' : difference < 0 ? 'fa-arrow-down' : 'fa-equals';

    div.innerHTML = `
        <div class="flex items-center justify-between">
            <div class="flex items-center space-x-4 flex-1">
                <div class="w-16 h-16 bg-blue-100 rounded-xl flex items-center justify-center">
                    <i class="fas fa-box text-blue-600 text-2xl"></i>
                </div>
                <div class="flex-1">
                    <h4 class="text-lg font-bold text-gray-900">${item.品番}</h4>
                    <p class="text-sm text-gray-600">${t('device-number')}: ${item.背番号}</p>
                    <p class="text-xs text-gray-500">${new Date(item.scannedAt).toLocaleString(currentLang === 'ja' ? 'ja-JP' : 'en-US')}</p>
                </div>
            </div>

            <div class="flex items-center space-x-6">
                <!-- Current Quantity -->
                <div class="text-center">
                    <p class="text-sm text-gray-500">${t('current-inventory')}</p>
                    <p class="text-2xl font-bold text-gray-900">${item.currentQuantity}</p>
                </div>

                <!-- Arrow -->
                <div class="text-center">
                    <i class="fas fa-arrow-right text-2xl text-gray-400"></i>
                </div>

                <!-- New Quantity (editable) -->
                <div class="text-center">
                    <p class="text-sm text-gray-500">${t('new-inventory')}</p>
                    <input
                        type="number"
                        value="${item.newQuantity}"
                        min="0"
                        class="w-24 text-2xl font-bold text-center border-2 border-blue-300 rounded-lg px-2 py-1 focus:ring-2 focus:ring-blue-500"
                        onchange="updateInventoryItemQuantity(${index}, this.value)"
                    />
                </div>

                <!-- Difference -->
                <div class="text-center min-w-[100px]">
                    <p class="text-sm text-gray-500">${t('difference')}</p>
                    <p class="text-xl font-bold ${differenceClass}">
                        <i class="fas ${differenceIcon} mr-1"></i>
                        ${Math.abs(difference)}
                    </p>
                </div>

                <!-- Remove button -->
                <button
                    onclick="removeInventoryItem(${index})"
                    class="w-10 h-10 bg-red-100 hover:bg-red-200 text-red-600 rounded-lg transition-colors"
                    title="${t('clear-button')}">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `;

    return div;
}

// Update quantity for a specific item
function updateInventoryItemQuantity(index, newValue) {
    const quantity = parseInt(newValue);

    if (isNaN(quantity) || quantity < 0) {
        showToast('数量は0以上の数値を入力してください', 'error');
        updateInventoryList();
        return;
    }

    inventoryScannedItems[index].newQuantity = quantity;
    updateInventoryList();
}

// Remove an item from the scanned list
function removeInventoryItem(index) {
    const item = inventoryScannedItems[index];
    inventoryScannedItems.splice(index, 1);
    showToast(`${item.品番} をリストから削除しました`, 'info');
    updateInventoryList();
}

// Clear all scanned items
function clearInventoryList() {
    if (inventoryScannedItems.length === 0) {
        showToast(t('list-already-empty'), 'info');
        return;
    }

    if (confirm(`${t('clear-confirm-prefix')} ${inventoryScannedItems.length} ${t('clear-confirm-suffix')}`)) {
        inventoryScannedItems = [];
        updateInventoryList();
        showToast(t('list-cleared'), 'success');
    }
}

// Submit the inventory count to the server
async function submitInventoryCount() {
    if (!currentWorker) {
        showToast(t('login-required'), 'error');
        return;
    }

    if (inventoryScannedItems.length === 0) {
        showToast(t('no-scanned-items'), 'error');
        return;
    }

    if (!confirm(`${t('submit-confirm-prefix')} ${inventoryScannedItems.length} ${t('submit-confirm-suffix')}`)) {
        return;
    }

    try {
        // Disable submit button
        const submitBtn = document.getElementById('submitInventoryBtn');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>送信中...';
        }

        const response = await fetch(`${API_BASE_URL}/inventory/count-submit`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                items: inventoryScannedItems,
                submittedBy: currentWorker,
                submittedAt: new Date().toISOString()
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || '送信に失敗しました');
        }

        const result = await response.json();

        showToast(`${result.processedCount}件のアイテムを更新しました！`, 'success');

        // Clear the list after successful submission
        inventoryScannedItems = [];
        updateInventoryList();

        // Re-enable submit button
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-check mr-2"></i>送信';
        }

    } catch (error) {
        console.error('Error submitting inventory count:', error);
        showToast(`送信エラー: ${error.message}`, 'error');

        // Re-enable submit button
        const submitBtn = document.getElementById('submitInventoryBtn');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-check mr-2"></i>送信';
        }
    }
}

// ==================== END INVENTORY COUNT SYSTEM ====================

// Export functions for global access
window.handleLogin = handleLogin;
window.logout = logout;
window.openInventorySystem = openInventorySystem;
window.openPickingSystem = openPickingSystem;
window.backToHome = backToHome;
window.backToPickingList = backToPickingList;
window.filterByStatus = filterByStatus;
window.refreshPickingRequests = refreshPickingRequests;
window.startPickingProcess = startPickingProcess;
// window.startIndividualPicking = startIndividualPicking; // Removed - ESP32 handles picking automatically
window.refreshPickingDetail = refreshPickingDetail;
window.completeAndBackToList = completeAndBackToList;
window.clearInventoryList = clearInventoryList;
window.submitInventoryCount = submitInventoryCount;
window.updateInventoryItemQuantity = updateInventoryItemQuantity;
window.removeInventoryItem = removeInventoryItem;

// Available tasks data
let availableTasks = [
    {
        id: 1,
        type: 'receiving',
        title: { ja: '入庫作業 #R001', en: 'Receiving #R001' },
        priority: 'high',
        items: 15,
        location: { ja: 'ドック2', en: 'Dock 2' },
        estimated: '30分'
    },
    {
        id: 2,
        type: 'picking',
        title: { ja: 'ピッキング #P002', en: 'Picking #P002' },
        priority: 'medium',
        items: 8,
        location: { ja: 'エリアA1-A3', en: 'Area A1-A3' },
        estimated: '45分'
    },
    {
        id: 3,
        type: 'putaway',
        title: { ja: '格納作業 #PA003', en: 'Putaway #PA003' },
        priority: 'low',
        items: 20,
        location: { ja: 'エリアB棟', en: 'Area B Wing' },
        estimated: '60分'
    },
    {
        id: 4,
        type: 'stockcheck',
        title: { ja: '在庫確認 #SC004', en: 'Stock Check #SC004' },
        priority: 'medium',
        items: 12,
        location: { ja: 'エリアC1', en: 'Area C1' },
        estimated: '25分'
    },
    {
        id: 5,
        type: 'transfer',
        title: { ja: '移動作業 #T005', en: 'Transfer #T005' },
        priority: 'high',
        items: 6,
        location: { ja: '複数エリア', en: 'Multiple Areas' },
        estimated: '20分'
    }
];

// Messages data
let messages = [
    {
        id: 1,
        from: { ja: '監督者', en: 'Supervisor' },
        text: { ja: 'お疲れ様です。優先度の高いタスクから開始してください。', en: 'Good work. Please start with high priority tasks.' },
        time: '10:30',
        unread: true
    },
    {
        id: 2,
        from: { ja: 'システム', en: 'System' },
        text: { ja: '新しいタスクが割り当てられました。', en: 'New task has been assigned.' },
        time: '09:45',
        unread: true
    },
    {
        id: 3,
        from: { ja: '田中さん', en: 'Tanaka-san' },
        text: { ja: 'エリアAの作業完了しました。', en: 'Area A work completed.' },
        time: '09:15',
        unread: false
    }
];

// Removed duplicate DOMContentLoaded listener that was causing conflicts

// Removed duplicate initializeApp function - DOM safety handled in main initializeApp

// Language toggle function
function toggleLanguage() {
    currentLanguage = currentLanguage === 'ja' ? 'en' : 'ja';
    document.getElementById('currentLang').textContent = currentLanguage === 'ja' ? '🇯🇵' : '🇺🇸';
    document.getElementById('langText').textContent = currentLanguage === 'ja' ? 'EN' : '日本語';
    document.getElementById('headerTitle').textContent = currentLanguage === 'ja' ? '倉庫システム' : 'Warehouse System';
    
    updateLanguage();
    loadAvailableTasks(); // Reload tasks with new language
    
    // Update voice recognition language
    if (recognition) {
        recognition.lang = currentLanguage === 'ja' ? 'ja-JP' : 'en-US';
    }
}

function updateLanguage() {
    document.querySelectorAll('[data-lang]').forEach(element => {
        const key = element.getAttribute('data-lang');
        if (translations[currentLanguage][key]) {
            element.textContent = translations[currentLanguage][key];
        }
    });
}

// Main scanner functions
function openMainScanner() {
    document.getElementById('mainScannerModal').classList.remove('hidden');
    setTimeout(() => {
        document.getElementById('mainScanInput').focus();
    }, 300);
}

function simulateScanInput() {
    const sampleCodes = [
        'ITEM-SP001-50',
        'LOC-A1-SHELF-3',
        'ORDER-PO001-URGENT',
        'PART-CB002-25'
    ];
    const randomCode = sampleCodes[Math.floor(Math.random() * sampleCodes.length)];
    document.getElementById('mainScanInput').value = randomCode;
}

function processScan() {
    const scanValue = document.getElementById('mainScanInput').value;
    if (!scanValue) {
        showToast(currentLanguage === 'ja' ? 'スキャンしてください' : 'Please scan something', 'error');
        return;
    }
    
    // Analyze scan and take action
    const action = analyzeScan(scanValue);
    
    showToast(
        currentLanguage === 'ja' ? 
        `${action.type}を処理しています: ${action.info}` : 
        `Processing ${action.type}: ${action.info}`, 
        'success'
    );
    
    playSound('success');
    
    // Simulate processing delay
    setTimeout(() => {
        closeAllModals();
        // Here you would normally trigger the appropriate workflow
    }, 1500);
}

function analyzeScan(scanValue) {
    if (scanValue.includes('ITEM-') || scanValue.includes('PART-')) {
        return { type: currentLanguage === 'ja' ? '商品' : 'Item', info: scanValue };
    } else if (scanValue.includes('LOC-')) {
        return { type: currentLanguage === 'ja' ? '場所' : 'Location', info: scanValue };
    } else if (scanValue.includes('ORDER-')) {
        return { type: currentLanguage === 'ja' ? '注文' : 'Order', info: scanValue };
    } else {
        return { type: currentLanguage === 'ja' ? '不明' : 'Unknown', info: scanValue };
    }
}

function manualEntry() {
    closeAllModals();
    // Open manual entry form (could be implemented as another modal)
    showToast(currentLanguage === 'ja' ? '手動入力モードを開きます' : 'Opening manual entry mode', 'info');
}

// Voice input functions
function startVoiceInput() {
    document.getElementById('voiceInputModal').classList.remove('hidden');
}

function startVoiceRecording() {
    if (!recognition) {
        showToast(t('voice-not-supported'), 'error');
        return;
    }
    
    if (isRecording) {
        recognition.stop();
        isRecording = false;
    } else {
        recognition.start();
        isRecording = true;
        document.getElementById('voiceResult').classList.add('hidden');
        document.getElementById('confirmVoiceButton').classList.add('hidden');
    }
    updateRecordButton();
}

function updateRecordButton() {
    const button = document.getElementById('recordButton');
    const buttonText = button.querySelector('span');
    
    if (isRecording) {
        button.className = 'w-full bg-red-600 hover:bg-red-700 text-white font-medium py-3 px-4 rounded-lg';
        buttonText.textContent = translations[currentLanguage]['stop-recording'];
    } else {
        button.className = 'w-full bg-red-500 hover:bg-red-600 text-white font-medium py-3 px-4 rounded-lg';
        buttonText.textContent = translations[currentLanguage]['start-recording'];
    }
}

function confirmVoiceInput() {
    const voiceText = document.getElementById('voiceText').textContent;
    if (voiceText) {
        showToast(
            currentLanguage === 'ja' ? 
            `音声入力を処理中: ${voiceText}` : 
            `Processing voice input: ${voiceText}`, 
            'success'
        );
        playSound('success');
        closeAllModals();
    }
}

// Task management functions
function loadAvailableTasks() {
    const tasksContainer = document.getElementById('availableTasks');
    tasksContainer.innerHTML = '';
    
    availableTasks.forEach(task => {
        const taskElement = createTaskElement(task);
        tasksContainer.appendChild(taskElement);
    });
    
    document.getElementById('taskCounter').textContent = 
        currentLanguage === 'ja' ? `${availableTasks.length}件` : `${availableTasks.length} tasks`;
}

function createTaskElement(task) {
    const div = document.createElement('div');
    div.className = 'p-4 hover:bg-gray-50 cursor-pointer transition-colors';
    div.onclick = () => viewTaskDetail(task);
    
    const priorityColors = {
        high: 'bg-red-100 text-red-800',
        medium: 'bg-yellow-100 text-yellow-800',
        low: 'bg-green-100 text-green-800'
    };
    
    const typeIcons = {
        receiving: 'fa-truck',
        picking: 'fa-hand-paper',
        putaway: 'fa-warehouse',
        stockcheck: 'fa-search',
        transfer: 'fa-exchange-alt'
    };
    
    div.innerHTML = `
        <div class="flex items-center justify-between">
            <div class="flex items-center space-x-3">
                <div class="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                    <i class="fas ${typeIcons[task.type]} text-blue-600"></i>
                </div>
                <div>
                    <h4 class="font-medium text-gray-900">${task.title[currentLanguage]}</h4>
                    <p class="text-sm text-gray-600">
                        ${task.items} ${currentLanguage === 'ja' ? '項目' : 'items'} • 
                        ${task.location[currentLanguage]} • 
                        ${task.estimated}
                    </p>
                </div>
            </div>
            <div class="text-right">
                <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${priorityColors[task.priority]}">
                    ${task.priority.toUpperCase()}
                </span>
            </div>
        </div>
    `;
    
    return div;
}

function viewTaskDetail(task) {
    selectedTask = task;
    document.getElementById('taskDetailModal').classList.remove('hidden');
    
    const content = document.getElementById('taskDetailContent');
    content.innerHTML = `
        <div class="space-y-4">
            <div>
                <h4 class="font-semibold text-gray-900">${task.title[currentLanguage]}</h4>
                <p class="text-gray-600">${t('type-label')}: ${task.type}</p>
            </div>
            <div class="grid grid-cols-2 gap-4">
                <div>
                    <p class="text-sm text-gray-500">${currentLanguage === 'ja' ? '項目数' : 'Items'}</p>
                    <p class="font-semibold">${task.items}</p>
                </div>
                <div>
                    <p class="text-sm text-gray-500">${currentLanguage === 'ja' ? '場所' : 'Location'}</p>
                    <p class="font-semibold">${task.location[currentLanguage]}</p>
                </div>
                <div>
                    <p class="text-sm text-gray-500">${currentLanguage === 'ja' ? '優先度' : 'Priority'}</p>
                    <p class="font-semibold">${task.priority.toUpperCase()}</p>
                </div>
                <div>
                    <p class="text-sm text-gray-500">${currentLanguage === 'ja' ? '予想時間' : 'Estimated'}</p>
                    <p class="font-semibold">${task.estimated}</p>
                </div>
            </div>
        </div>
    `;
}

function startSelectedTask() {
    if (selectedTask) {
        showToast(
            currentLanguage === 'ja' ? 
            `タスクを開始しました: ${selectedTask.title[currentLanguage]}` : 
            `Started task: ${selectedTask.title[currentLanguage]}`, 
            'success'
        );
        playSound('success');
        
        // Update task counter
        availableTasks = availableTasks.filter(t => t.id !== selectedTask.id);
        loadAvailableTasks();
        
        closeAllModals();
    }
}

// Communication functions
function openMessages() {
    document.getElementById('messagesModal').classList.remove('hidden');
    loadMessages();
    
    // Mark all messages as read
    messages.forEach(msg => msg.unread = false);
    document.getElementById('messageCount').classList.add('hidden');
    document.getElementById('messageNotification').classList.add('hidden');
}

function loadMessages() {
    const messagesList = document.getElementById('messagesList');
    messagesList.innerHTML = '';
    
    messages.forEach(message => {
        const messageDiv = document.createElement('div');
        messageDiv.className = `p-4 border-b border-gray-100 ${message.unread ? 'bg-blue-50' : ''}`;
        
        messageDiv.innerHTML = `
            <div class="flex justify-between items-start mb-2">
                <span class="font-medium text-gray-900">${message.from[currentLanguage]}</span>
                <span class="text-xs text-gray-500">${message.time}</span>
            </div>
            <p class="text-gray-700">${message.text[currentLanguage]}</p>
        `;
        
        messagesList.appendChild(messageDiv);
    });
}

function sendMessage() {
    const input = document.getElementById('messageInput');
    const messageText = input.value.trim();
    
    if (messageText) {
        const newMessage = {
            id: Date.now(),
            from: { ja: '私', en: 'Me' },
            text: { ja: messageText, en: messageText },
            time: new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }),
            unread: false
        };
        
        messages.unshift(newMessage);
        input.value = '';
        loadMessages();
        showToast(currentLanguage === 'ja' ? 'メッセージを送信しました' : 'Message sent', 'success');
    }
}

// Help and emergency functions
function openEmergencyHelp() {
    document.getElementById('helpModal').classList.remove('hidden');
}

function callSupervisor() {
    showToast(currentLanguage === 'ja' ? '監督者に連絡中...' : 'Contacting supervisor...', 'info');
    closeAllModals();
}

function reportProblem() {
    showToast(currentLanguage === 'ja' ? '問題報告を送信中...' : 'Sending problem report...', 'info');
    closeAllModals();
}

function requestMaintenance() {
    showToast(t('sending-maintenance-request'), 'info');
    closeAllModals();
}

function viewInstructions() {
    showToast(currentLanguage === 'ja' ? '操作手順を表示中...' : 'Showing instructions...', 'info');
    closeAllModals();
}

// Utility functions
function openLocationMap() {
    showToast(currentLanguage === 'ja' ? '倉庫マップを表示中...' : 'Showing warehouse map...', 'info');
}

function viewMyStats() {
    showToast(currentLanguage === 'ja' ? '個人統計を表示中...' : 'Showing personal stats...', 'info');
}

function closeAllModals() {
    document.querySelectorAll('.fixed.inset-0').forEach(modal => {
        if (modal.id !== 'toast') {
            modal.classList.add('hidden');
        }
    });
    selectedTask = null;
}

function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    const icon = document.getElementById('toastIcon');
    const messageSpan = document.getElementById('toastMessage');
    
    messageSpan.textContent = message;
    
    // Update icon and color based on type
    toast.className = 'fixed top-4 right-4 text-white px-6 py-3 rounded-lg shadow-lg z-50 transform transition-all duration-300';
    
    switch(type) {
        case 'error':
            toast.classList.add('bg-red-500');
            icon.className = 'fas fa-exclamation-circle mr-2';
            break;
        case 'warning':
            toast.classList.add('bg-yellow-500');
            icon.className = 'fas fa-exclamation-triangle mr-2';
            break;
        case 'info':
            toast.classList.add('bg-blue-500');
            icon.className = 'fas fa-info-circle mr-2';
            break;
        default:
            toast.classList.add('bg-green-500');
            icon.className = 'fas fa-check-circle mr-2';
    }
    
    toast.classList.remove('hidden');
    
    setTimeout(() => {
        toast.classList.add('hidden');
    }, 3000);
}

function playSound(type) {
    try {
        const audio = document.getElementById(type + 'Sound');
        if (audio) {
            audio.currentTime = 0;
            audio.play().catch(e => console.log('Audio play failed:', e));
        }
    } catch (e) {
        console.log('Audio not supported');
    }
}

// Keyboard shortcuts
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        closeAllModals();
    }
    
    // Quick shortcuts
    if (e.ctrlKey || e.metaKey) {
        switch(e.key) {
            case '1':
                e.preventDefault();
                openMainScanner();
                break;
            case '2':
                e.preventDefault();
                startVoiceInput();
                break;
            case 'm':
                e.preventDefault();
                openMessages();
                break;
            case 'h':
                e.preventDefault();
                openEmergencyHelp();
                break;
        }
    }
});

// Update current time
function updateCurrentTime() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('en-US', { 
        hour12: false,
        hour: '2-digit',
        minute: '2-digit'
    });
    document.getElementById('currentTime').textContent = timeString;
}

// Modal functions
function openModal(action) {
    currentAction = action;
    
    if (action.includes('scan')) {
        currentModal = 'scan';
        document.getElementById('scanModal').classList.remove('hidden');
        document.getElementById('scanModalTitle').textContent = 
            action.includes('incoming') ? 'Scan Incoming Material' : 'Scan Outgoing Material';
        document.getElementById('qrInput').value = '';
        document.getElementById('qrInput').focus();
    } else {
        currentModal = 'manual';
        document.getElementById('manualModal').classList.remove('hidden');
        document.getElementById('manualModalTitle').textContent = 
            action.includes('incoming') ? 'Manual Entry - Incoming' : 'Manual Entry - Outgoing';
        resetManualForm();
    }
}

function closeModal() {
    // Hide all modals
    document.getElementById('scanModal').classList.add('hidden');
    document.getElementById('manualModal').classList.add('hidden');
    document.getElementById('universalScanModal').classList.add('hidden');
    document.getElementById('taskListModal').classList.add('hidden');
    document.getElementById('receivingModal').classList.add('hidden');
    document.getElementById('quickActionsModal').classList.add('hidden');
    
    currentModal = null;
    currentAction = null;
}

// QR Code processing
function simulateQRScan() {
    // Simulate QR code data
    const qrData = generateSampleQRData();
    document.getElementById('qrInput').value = qrData;
}

function generateSampleQRData() {
    const items = [
        'SP001|Steel Pipes|50|A1',
        'CB002|Concrete Blocks|25|B2',
        'WP003|Wood Planks|100|C1',
        'AL004|Aluminum Sheets|30|A2',
        'BR005|Bricks|200|B1'
    ];
    return items[Math.floor(Math.random() * items.length)];
}

function processQRCode() {
    const qrData = document.getElementById('qrInput').value;
    if (!qrData) {
        showToast('Please scan a QR code first', 'error');
        return;
    }

    const [code, name, quantity, location] = qrData.split('|');
    
    const activity = {
        id: Date.now(),
        type: currentAction.includes('incoming') ? 'incoming' : 'outgoing',
        item: `${name} - ${code}`,
        quantity: parseInt(quantity),
        location: location,
        timestamp: new Date(),
        method: 'QR Scan'
    };

    addActivity(activity);
    updateStats();
    showToast(`${activity.type === 'incoming' ? 'Incoming' : 'Outgoing'} material processed successfully!`);
    playSound('success');
    closeModal();
}

// Manual form handling
function resetManualForm() {
    document.getElementById('manualForm').reset();
    document.getElementById('itemCode').focus();
}

document.addEventListener('DOMContentLoaded', function() {
    // Only attach event listener if the element exists
    const manualForm = document.getElementById('manualForm');
    if (manualForm) {
        manualForm.addEventListener('submit', function(e) {
            e.preventDefault();
            
            const itemCode = document.getElementById('itemCode').value;
            const itemName = document.getElementById('itemName').value;
            const quantity = parseInt(document.getElementById('quantity').value);
            const location = document.getElementById('location').value;

            if (!itemCode || !itemName || !quantity || !location) {
                showToast('Please fill in all fields', 'error');
                playSound('error');
                return;
            }

            const activity = {
                id: Date.now(),
                type: currentAction.includes('incoming') ? 'incoming' : 'outgoing',
                item: `${itemName} - ${itemCode}`,
                quantity: quantity,
                location: location,
                timestamp: new Date(),
                method: 'Manual'
            };

            addActivity(activity);
            updateStats();
            showToast(`${activity.type === 'incoming' ? 'Incoming' : 'Outgoing'} material processed successfully!`);
            playSound('success');
            closeModal();
        });
    }
});

// Activity management
function addActivity(activity) {
    recentActivities.unshift(activity);
    if (recentActivities.length > 10) {
        recentActivities.pop();
    }
    loadRecentActivity();
}

function loadRecentActivity() {
    const activityContainer = document.getElementById('recentActivity');
    activityContainer.innerHTML = '';

    if (recentActivities.length === 0) {
        activityContainer.innerHTML = `
            <div class="p-6 text-center text-gray-500">
                <i class="fas fa-inbox text-3xl mb-2"></i>
                <p>No recent activity</p>
            </div>
        `;
        return;
    }

    recentActivities.forEach(activity => {
        const activityItem = createActivityItem(activity);
        activityContainer.appendChild(activityItem);
    });
}

function createActivityItem(activity) {
    const div = document.createElement('div');
    div.className = 'p-4 hover:bg-gray-50 transition-colors';
    
    const timeAgo = getTimeAgo(activity.timestamp);
    const iconClass = activity.type === 'incoming' ? 'fa-arrow-down text-green-600' : 'fa-arrow-up text-blue-600';
    const bgClass = activity.type === 'incoming' ? 'bg-green-100' : 'bg-blue-100';
    
    div.innerHTML = `
        <div class="flex items-center justify-between">
            <div class="flex items-center">
                <div class="w-10 h-10 ${bgClass} rounded-full flex items-center justify-center mr-3">
                    <i class="fas ${iconClass}"></i>
                </div>
                <div>
                    <p class="text-sm font-medium text-gray-900">${activity.item}</p>
                    <p class="text-xs text-gray-500">
                        Qty: ${activity.quantity} | Location: ${activity.location} | ${activity.method}
                    </p>
                </div>
            </div>
            <div class="text-right">
                <p class="text-xs text-gray-500">${timeAgo}</p>
                <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    activity.type === 'incoming' 
                        ? 'bg-green-100 text-green-800' 
                        : 'bg-blue-100 text-blue-800'
                }">
                    ${activity.type === 'incoming' ? 'IN' : 'OUT'}
                </span>
            </div>
        </div>
    `;
    
    return div;
}

function getTimeAgo(timestamp) {
    const now = new Date();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes} min ago`;
    
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

// Update statistics
function updateStats() {
    const today = new Date().toDateString();
    const todayActivities = recentActivities.filter(activity => 
        activity.timestamp.toDateString() === today
    );
    
    const incoming = todayActivities.filter(a => a.type === 'incoming' || a.type === 'receiving').length;
    const outgoing = todayActivities.filter(a => a.type === 'outgoing' || a.type === 'picking').length;
    const pendingTasksCount = todaysTasks.filter(t => t.status === 'pending').length;
    
    // Only update elements if they exist
    const todayIncomingEl = document.getElementById('todayIncoming');
    const todayOutgoingEl = document.getElementById('todayOutgoing');
    const pendingTasksEl = document.getElementById('pendingTasks');
    
    if (todayIncomingEl) todayIncomingEl.textContent = incoming;
    if (todayOutgoingEl) todayOutgoingEl.textContent = outgoing;
    if (pendingTasksEl) pendingTasksEl.textContent = pendingTasksCount;
    
    // Update last activity
    if (recentActivities.length > 0) {
        const lastActivity = getTimeAgo(recentActivities[0].timestamp);
        document.getElementById('lastActivity').textContent = lastActivity;
    }
}

// Toast notifications
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    const messageElement = document.getElementById('toastMessage');
    const iconElement = document.getElementById('toastIcon');
    
    if (!toast || !messageElement || !iconElement) {
        console.error('Toast elements not found');
        return;
    }
    
    messageElement.textContent = message;
    
    // Reset classes
    toast.className = 'fixed top-4 right-4 text-white px-6 py-3 rounded-lg shadow-lg z-50 transform transition-all duration-300';
    
    // Update toast styling based on type
    switch(type) {
        case 'error':
            toast.classList.add('bg-red-500');
            iconElement.className = 'fas fa-times-circle mr-2';
            break;
        case 'warning':
            toast.classList.add('bg-yellow-500');
            iconElement.className = 'fas fa-exclamation-triangle mr-2';
            break;
        case 'info':
            toast.classList.add('bg-blue-500');
            iconElement.className = 'fas fa-info-circle mr-2';
            break;
        default: // success
            toast.classList.add('bg-green-500');
            iconElement.className = 'fas fa-check-circle mr-2';
            break;
    }
    
    // Show toast
    toast.classList.remove('hidden');
    toast.classList.add('translate-x-0');
    
    // Hide after 3 seconds
    setTimeout(() => {
        toast.classList.add('translate-x-full');
        setTimeout(() => {
            toast.classList.add('hidden');
        }, 300);
    }, 3000);
}

// Keyboard shortcuts
document.addEventListener('keydown', function(e) {
    if (e.ctrlKey || e.metaKey) {
        switch(e.key) {
            case '1':
                e.preventDefault();
                openModal('scanIncoming');
                break;
            case '2':
                e.preventDefault();
                openModal('scanOutgoing');
                break;
            case '3':
                e.preventDefault();
                openModal('manualIncoming');
                break;
            case '4':
                e.preventDefault();
                openModal('manualOutgoing');
                break;
        }
    }
    
    if (e.key === 'Escape' && currentModal) {
        closeModal();
    }
});

// Touch events for mobile/tablet
document.addEventListener('touchstart', function(e) {
    // Handle touch events for better mobile experience
}, { passive: true });

// Auto-refresh stats every 30 seconds
setInterval(updateStats, 30000);

// Receiving form handler - only attach if element exists
const receivingForm = document.getElementById('receivingForm');
if (receivingForm) {
    receivingForm.addEventListener('submit', function(e) {
        e.preventDefault();
        
        const itemScan = document.getElementById('receivingItemScan').value;
        const receivedQty = document.getElementById('receivedQuantity').value;
        const condition = document.getElementById('itemCondition').value;
        const location = document.getElementById('suggestedLocation').value;
        
        if (!itemScan || !receivedQty) {
            showToast('Please scan item and enter quantity', 'error');
            playSound('error');
            return;
        }
        
        const activity = {
            id: Date.now(),
            type: 'receiving',
            item: itemScan,
            quantity: parseInt(receivedQty),
            location: location || 'TBD',
            timestamp: new Date(),
            method: 'Receiving Process',
            condition: condition
        };
        
        addActivity(activity);
        updateStats();
        
        if (condition === 'damaged') {
            showToast('Item received - marked as damaged', 'warning');
        } else if (condition === 'missing') {
            showToast('Missing items reported', 'warning');
        } else {
            showToast('Item received successfully!', 'success');
        }
        
        playSound(condition === 'good' ? 'success' : 'error');
        closeModal();
    });
}

// Print label function
function printLabel() {
    showToast('Label sent to printer', 'success');
    playSound('success');
}

// Simulate location suggestions - only attach if element exists
const receivingItemScan = document.getElementById('receivingItemScan');
if (receivingItemScan) {
    receivingItemScan.addEventListener('input', function(e) {
        const value = e.target.value;
        if (value) {
            // Simulate expected quantity lookup
            const expectedQtyEl = document.getElementById('expectedQty');
            const expectedQuantityDisplayEl = document.getElementById('expectedQuantityDisplay');
            
            if (expectedQtyEl) {
                expectedQtyEl.textContent = Math.floor(Math.random() * 100) + 1;
            }
            if (expectedQuantityDisplayEl) {
                expectedQuantityDisplayEl.classList.remove('hidden');
            }
            
            // Simulate location suggestion
            const locations = ['A1', 'A2', 'B1', 'B2', 'C1'];
            const suggestedLocation = locations[Math.floor(Math.random() * locations.length)];
            
            const locationSelect = document.getElementById('suggestedLocation');
            if (locationSelect) {
                locationSelect.innerHTML = `<option value="${suggestedLocation}">Suggested: ${suggestedLocation}</option>`;
                locationSelect.value = suggestedLocation;
            }
        }
    });
}

// Auto-simulate universal scanner for demo - only attach if element exists
const universalScanInput = document.getElementById('universalScanInput');
if (universalScanInput) {
    universalScanInput.addEventListener('focus', function() {
        setTimeout(() => {
            if (this.value === '') {
                const sampleCodes = [
                    'LOC-A1-B3',
                    'ORDER-PO001-URGENT',
                    'SP001|Steel Pipes|50|A1',
                    'CB002|Concrete Blocks|25|B2'
                ];
                this.value = sampleCodes[Math.floor(Math.random() * sampleCodes.length)];
            }
        }, 1000);
    });
}
