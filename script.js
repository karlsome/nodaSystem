// Noda System - Tablet UI for Inventory and Picking
// Global variables
let currentScreen = 'login';
let pickingRequests = [];
let currentRequest = null;
let currentRequestNumber = null;
let currentFilter = 'all';
let currentDateFilter = null; // Date filter for picking requests
let currentWorker = null;
let socket = null;
let recentActivities = []; // Initialize empty array for activities
let todaysTasks = []; // Initialize empty array for tasks
let factory = null; // Factory location from URL parameter

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

    // Extract factory from URL parameter
    extractFactoryFromURL();

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

// Extract factory location from URL parameter
function extractFactoryFromURL() {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const selectedFactory = urlParams.get('selected');
        
        if (selectedFactory) {
            factory = decodeURIComponent(selectedFactory);
            console.log('🏭 Factory location set from URL:', factory);
        } else {
            // Default to 野田倉庫 if no parameter provided
            factory = '野田倉庫';
            console.log('🏭 No factory parameter found, using default:', factory);
        }
        
        // Display factory name in header
        const factoryDisplay = document.getElementById('factoryDisplay');
        const factoryName = document.getElementById('factoryName');
        if (factoryDisplay && factoryName) {
            factoryName.textContent = factory;
            factoryDisplay.style.display = 'block';
        }
    } catch (error) {
        console.error('❌ Error extracting factory from URL:', error);
        factory = '野田倉庫'; // Use default on error
    }
}

// Open factory selector modal
function openFactorySelector() {
    const modal = document.getElementById('factorySelectorModal');
    if (modal) {
        modal.classList.remove('hidden');
        loadFactoryList();
    }
}

// Close factory selector modal
function closeFactorySelector() {
    const modal = document.getElementById('factorySelectorModal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

// Load factory list from API
async function loadFactoryList() {
    const loadingState = document.getElementById('factoryLoadingState');
    const listContainer = document.getElementById('factoryListContainer');
    const errorState = document.getElementById('factoryErrorState');
    
    // Show loading state
    loadingState.classList.remove('hidden');
    listContainer.classList.add('hidden');
    errorState.classList.add('hidden');
    
    try {
        console.log('📋 Fetching factory list from API...');
        
        const response = await fetch(`${API_BASE_URL}/factories/batch`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error('Failed to fetch factory list');
        }
        
        const data = await response.json();
        console.log('✅ Factory list received:', data);
        
        // Collect all unique factories from all collections
        const factorySet = new Set();
        
        // Add default factory
        factorySet.add('野田倉庫');
        
        // Add factories from each collection
        Object.values(data.results).forEach(result => {
            if (result.factories && Array.isArray(result.factories)) {
                result.factories.forEach(f => factorySet.add(f));
            }
        });
        
        // Convert to sorted array
        const factories = Array.from(factorySet).sort();
        
        console.log('🏭 Unique factories:', factories);
        
        // Display factory list
        displayFactoryList(factories);
        
    } catch (error) {
        console.error('❌ Error loading factory list:', error);
        loadingState.classList.add('hidden');
        errorState.classList.remove('hidden');
    }
}

// Display factory list in modal
function displayFactoryList(factories) {
    const loadingState = document.getElementById('factoryLoadingState');
    const listContainer = document.getElementById('factoryListContainer');
    
    loadingState.classList.add('hidden');
    listContainer.classList.remove('hidden');
    listContainer.innerHTML = '';
    
    factories.forEach(factoryName => {
        const button = document.createElement('button');
        button.className = 'w-full px-4 py-3 text-left rounded-lg border-2 transition-all';
        
        // Highlight current factory
        if (factoryName === factory) {
            button.className += ' border-green-500 bg-green-50 text-green-800 font-semibold';
            button.innerHTML = `
                <div class="flex items-center justify-between">
                    <span>
                        <i class="fas fa-industry mr-2"></i>
                        ${factoryName}
                    </span>
                    <i class="fas fa-check text-green-600"></i>
                </div>
            `;
        } else {
            button.className += ' border-gray-200 hover:border-green-300 hover:bg-green-50 text-gray-700';
            button.innerHTML = `
                <i class="fas fa-industry mr-2 text-gray-400"></i>
                ${factoryName}
            `;
            button.onclick = () => selectFactory(factoryName);
        }
        
        listContainer.appendChild(button);
    });
}

// Select a factory and redirect with new parameter
function selectFactory(factoryName) {
    console.log('🏭 Factory selected:', factoryName);
    
    // Build new URL with factory parameter
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.set('selected', encodeURIComponent(factoryName));
    
    // Redirect to new URL (this will reload the page)
    window.location.href = currentUrl.toString();
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
            
            // No sound plays for individual row completion
            // Sound only plays when ALL rows are complete (see updateProgressCounter)
            
            // Update only the specific line item - NO FULL REFRESH to prevent race conditions
            if (currentRequestNumber === data.requestNumber) {
                console.log('✅ Updating line item without full refresh to prevent race conditions');
                
                // Incrementally update the specific line item
                updateLineItemStatus(data.requestNumber, data.lineNumber, 'completed');
                
                // Update progress counter
                updateProgressCounter();
                
                console.log('✅ Incremental update completed - no refresh triggered');
            } else {
                console.log('ℹ️ Not updating - current request is:', currentRequestNumber, 'but completed request is:', data.requestNumber);
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
        
        // Gentan image processing complete
        socket.on('gentan-processing-complete', (data) => {
            console.log('✅ Gentan processing complete:', data);
            
            // Find the item by jobId
            const itemIndex = gentanItems.findIndex(item => item.jobId === data.jobId);
            if (itemIndex >= 0) {
                gentanItems[itemIndex].data = data.data;
                gentanItems[itemIndex].processed = true;
                gentanItems[itemIndex].processing = false;
                saveGentanToStorage(); // Persist processed data
                updateGentanLists();
                showToast('画像データを抽出しました！', 'success');
            }
        });
        
        // Gentan image processing error
        socket.on('gentan-processing-error', (data) => {
            console.error('❌ Gentan processing error:', data);
            
            // Find the item by jobId
            const itemIndex = gentanItems.findIndex(item => item.jobId === data.jobId);
            if (itemIndex >= 0) {
                gentanItems[itemIndex].processing = false;
                saveGentanToStorage(); // Persist error state
                updateGentanLists();
            }
            showToast('画像処理エラー: ' + data.error, 'error');
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
    document.getElementById('nyukoScreen').classList.add('hidden');
    document.getElementById('gentanScreen').classList.add('hidden');
    
    // Show selected screen
    document.getElementById(screenName + 'Screen').classList.remove('hidden');
    currentScreen = screenName;
}

function openInventorySystem() {
    // Activate audio for inventory mode (beep + alert sounds)
    if (window.audioManager) {
        audioManager.activateForMode('inventory');
    }
    showScreen('inventory');
}

function openPickingSystem() {
    // Activate audio for picking mode (alert + success sounds)
    if (window.audioManager) {
        audioManager.activateForMode('picking');
    }
    
    // Set date picker to today's date
    const today = new Date();
    const dateString = today.toISOString().split('T')[0]; // Format: YYYY-MM-DD
    const dateInput = document.getElementById('pickingDateFilter');
    if (dateInput) {
        dateInput.value = dateString;
        currentDateFilter = dateString;
    }
    
    showScreen('picking');
    loadPickingRequests();
}

// ==================== GENTAN (原単) SYSTEM ====================

// Global storage for gentan items
let gentanItems = [];
let gentanScanBuffer = '';
const N8N_WEBHOOK_URL = 'https://karlsome.app.n8n.cloud/webhook/7081d838-c11e-42f5-8c17-94c5ee557cf6';
const GENTAN_STORAGE_KEY = 'nodaSystem_gentanItems';

// Load saved gentan data from localStorage
function loadGentanFromStorage() {
    try {
        const saved = localStorage.getItem(GENTAN_STORAGE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            // Filter out items with blob URLs (they won't work after refresh)
            gentanItems = parsed.filter(item => {
                if (item.type === 'image' && item.source.startsWith('blob:')) {
                    return false; // Skip blob URLs
                }
                return true;
            });
            console.log(`📂 Loaded ${gentanItems.length} items from storage`);
        }
    } catch (error) {
        console.error('Error loading gentan data from storage:', error);
        gentanItems = [];
    }
}

// Save gentan data to localStorage
function saveGentanToStorage() {
    try {
        // Save items with base64 data for images (not blob URLs)
        localStorage.setItem(GENTAN_STORAGE_KEY, JSON.stringify(gentanItems));
        console.log(`💾 Saved ${gentanItems.length} items to storage`);
    } catch (error) {
        console.error('Error saving gentan data to storage:', error);
        // If storage is full, try to clear old data
        if (error.name === 'QuotaExceededError') {
            showToast('ストレージ容量不足です', 'error');
        }
    }
}

// Reset all gentan data
function resetGentanData() {
    if (gentanItems.length === 0) {
        showToast('データがありません', 'info');
        return;
    }
    
    if (confirm('すべてのデータをリセットしますか？\n写真とバーコードデータが削除されます。')) {
        gentanItems = [];
        saveGentanToStorage();
        updateGentanLists();
        showToast('データをリセットしました', 'info');
    }
}

// Track which item is being edited in modal
let currentEditingIndex = -1;

// Image preview modal functions with edit form
function openImagePreview(imageSrc, itemIndex) {
    const modal = document.getElementById('imagePreviewModal');
    const img = document.getElementById('imagePreviewImg');
    
    img.src = imageSrc;
    currentEditingIndex = itemIndex;
    
    // Populate form with current data
    if (itemIndex >= 0 && gentanItems[itemIndex]) {
        const item = gentanItems[itemIndex];
        document.getElementById('modalEdit_品番').value = item.data.品番 || '';
        document.getElementById('modalEdit_品名').value = item.data.品名 || '';
        document.getElementById('modalEdit_納入数').value = item.data.納入数 || '';
        document.getElementById('modalEdit_納入日').value = item.data.納入日 || '';
        document.getElementById('modalEdit_色番').value = item.data.色番 || '';
    }
    
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden'; // Prevent background scroll
}

function closeImagePreview() {
    const modal = document.getElementById('imagePreviewModal');
    modal.classList.add('hidden');
    document.body.style.overflow = ''; // Restore scroll
    currentEditingIndex = -1;
}

// Save data from modal edit form
function saveModalEditData() {
    if (currentEditingIndex >= 0 && gentanItems[currentEditingIndex]) {
        gentanItems[currentEditingIndex].data.品番 = document.getElementById('modalEdit_品番').value;
        gentanItems[currentEditingIndex].data.品名 = document.getElementById('modalEdit_品名').value;
        gentanItems[currentEditingIndex].data.納入数 = document.getElementById('modalEdit_納入数').value;
        gentanItems[currentEditingIndex].data.納入日 = document.getElementById('modalEdit_納入日').value;
        gentanItems[currentEditingIndex].data.色番 = document.getElementById('modalEdit_色番').value;
        
        saveGentanToStorage();
        updateGentanLists();
        showToast('データを保存しました', 'success');
    }
    closeImagePreview();
}

function openGentanSystem() {
    showScreen('gentan');
    loadGentanFromStorage(); // Load saved data
    updateGentanLists();
    setupGentanScanListener();
}

// Set up keyboard listener for barcode scanning
function setupGentanScanListener() {
    console.log('🎧 Setting up Gentan barcode scanner');
    
    // Remove any existing listener
    document.removeEventListener('keydown', handleGentanBarcodeScan);
    
    // Add new listener
    document.addEventListener('keydown', handleGentanBarcodeScan);
    
    console.log('✅ Gentan scanner ready');
}

// Handle barcode scanning
async function handleGentanBarcodeScan(e) {
    // Only process when on gentan screen
    if (currentScreen !== 'gentan') return;
    
    // Ignore if user is typing in an input field
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
    }
    
    // Check if Enter key (delimiter)
    if (e.key === 'Enter') {
        e.preventDefault();
        console.log('✅ Enter key pressed - Processing barcode:', gentanScanBuffer);
        
        if (gentanScanBuffer.trim()) {
            await processGentanBarcode(gentanScanBuffer.trim());
            gentanScanBuffer = '';
        }
        return;
    }
    
    // Ignore special keys
    if (e.key.length > 1 && e.key !== 'Enter') {
        return;
    }
    
    // Add character to buffer
    gentanScanBuffer += e.key;
}

// Process barcode data
async function processGentanBarcode(barcodeValue) {
    try {
        console.log('Processing barcode:', barcodeValue);
        
        // Extract data from barcode
        // Format: 4451 0N4D52M6HF ... 000000040.000000041.000000001.000000040.000 15D73 601002 2668452560102
        
        // Extract 品番 (starts after first space, 10 characters)
        const parts = barcodeValue.trim().split(/\s+/);
        let 品番 = '';
        let 納入数 = '';
        let 納入日 = '';
        
        // Find 品番 (10 character alphanumeric after first number)
        for (let i = 0; i < parts.length; i++) {
            if (parts[i].length === 10 && /^[A-Z0-9]+$/.test(parts[i])) {
                品番 = parts[i];
                break;
            }
        }
        
        // Extract 納入数 from the numeric section (Net Length)
        const numericMatch = barcodeValue.match(/(\d{9}\.\d{9}\.\d{9}\.(\d{9})\.\d{3})/);
        if (numericMatch) {
            const netLength = parseFloat(numericMatch[2]);
            納入数 = netLength.toFixed(1) + 'm';
        }
        
        // Extract 納入日 from the end (remove last 2 digits)
        const lastPart = parts[parts.length - 1];
        if (lastPart && lastPart.length >= 7) {
            // Remove last 2 digits
            const dateCode = lastPart.slice(0, -2);
            // Format: YYMMDD -> YY-MM-DD
            if (dateCode.length >= 5) {
                const yy = dateCode.slice(0, 2);
                const mm = dateCode.slice(2, 4);
                const dd = dateCode.slice(4, 6);
                納入日 = `${yy}-${mm}-${dd}`;
            }
        }
        
        const item = {
            id: Date.now(),
            type: 'barcode',
            source: barcodeValue,
            data: {
                品番: 品番,
                品名: '',
                納入数: 納入数,
                納入日: 納入日,
                色番: ''
            }
        };
        
        gentanItems.push(item);
        saveGentanToStorage(); // Persist data
        updateGentanLists();
        showToast('バーコードをスキャンしました', 'success');
        
    } catch (error) {
        console.error('Error processing barcode:', error);
        showToast('バーコード処理エラー', 'error');
    }
}

// Handle camera image capture - AUTO PROCESS
async function handleGentanImageCapture(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    try {
        // Convert to base64 for persistence (instead of blob URL)
        const base64Image = await fileToBase64(file);
        
        const itemIndex = gentanItems.length;
        
        // Store the file temporarily for processing
        const item = {
            id: Date.now(),
            type: 'image',
            source: base64Image, // Use base64 for persistence
            file: file,
            processed: false,
            processing: true, // Flag for currently processing
            data: {
                品番: '',
                品名: '',
                納入数: '',
                納入日: '',
                色番: ''
            }
        };
        
        gentanItems.push(item);
        saveGentanToStorage(); // Persist data
        updateGentanLists();
        showToast('画像を処理中...', 'info');
        
        // AUTO PROCESS - Send to server immediately
        await processGentanImageAuto(itemIndex);
        
        // Reset file input
        event.target.value = '';
        
    } catch (error) {
        console.error('Error capturing image:', error);
        showToast('写真撮影エラー: ' + error.message, 'error');
        event.target.value = '';
    }
}

// Convert file to base64 for persistence
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}

// Compress image to reduce payload size
function compressImage(file, maxWidth = 1024, quality = 0.8) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        
        reader.onload = (e) => {
            const img = new Image();
            img.src = e.target.result;
            
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                
                // Resize if wider than maxWidth
                if (width > maxWidth) {
                    height = (height * maxWidth) / width;
                    width = maxWidth;
                }
                
                canvas.width = width;
                canvas.height = height;
                
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                
                // Convert to blob with compression
                canvas.toBlob((blob) => {
                    resolve(new File([blob], file.name, {
                        type: 'image/jpeg',
                        lastModified: Date.now()
                    }));
                }, 'image/jpeg', quality);
            };
            
            img.onerror = reject;
        };
        
        reader.onerror = reject;
    });
}

// Auto-process image through server and n8n
async function processGentanImageAuto(index) {
    const item = gentanItems[index];
    
    if (!item || item.type !== 'image' || !item.file) {
        showToast('画像ファイルが見つかりません', 'error');
        return;
    }
    
    try {
        // Compress image before upload
        const compressedFile = await compressImage(item.file, 1024, 0.8); // Max 1024px, 80% quality
        
        // Convert compressed file to base64
        const reader = new FileReader();
        reader.readAsDataURL(compressedFile);
        
        reader.onload = async () => {
            const base64Image = reader.result.split(',')[1]; // Remove data:image/jpeg;base64, prefix
            
            // Send to server with socket ID for callback
            const response = await fetch(`${API_BASE_URL}/gentan/process-image`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Socket-Id': socket ? socket.id : null
                },
                body: JSON.stringify({
                    image: base64Image,
                    socketId: socket ? socket.id : null
                })
            });
            
            if (!response.ok) {
                throw new Error('画像処理リクエストに失敗しました');
            }
            
            const result = await response.json();
            console.log(`✅ Job created: ${result.jobId}. Waiting for n8n callback via Socket.IO...`);
            
            // Store job ID with item
            gentanItems[index].jobId = result.jobId;
            gentanItems[index].processing = true;
            updateGentanLists();
        };
        
        reader.onerror = (error) => {
            console.error('Error reading file:', error);
            showToast('ファイル読み込みエラー', 'error');
            gentanItems[index].processing = false;
            updateGentanLists();
        };
        
    } catch (error) {
        console.error('Error processing image:', error);
        showToast('画像処理エラー: ' + error.message, 'error');
        gentanItems[index].processing = false;
        updateGentanLists();
    }
}

// Update both lists
function updateGentanLists() {
    const container = document.getElementById('gentanCombinedList');
    
    if (gentanItems.length === 0) {
        container.innerHTML = `
            <div class="p-12 text-center text-gray-400">
                <i class="fas fa-inbox text-6xl mb-4"></i>
                <p>スキャンまたは写真をアップロードしてください</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = '';
    
    gentanItems.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = 'grid grid-cols-1 lg:grid-cols-2 border-b border-gray-200 last:border-b-0';
        
        // Status badge - compact for tablet
        let statusBadge;
        if (item.type === 'barcode') {
            statusBadge = '<span class="text-[10px] px-1.5 py-0.5 bg-orange-100 text-orange-800 rounded-full">バーコード</span>';
        } else if (item.processing) {
            statusBadge = '<span class="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-800 rounded-full"><i class="fas fa-spinner fa-spin mr-1"></i>処理中</span>';
        } else if (item.processed) {
            statusBadge = '<span class="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-800 rounded-full"><i class="fas fa-check mr-1"></i>処理済み</span>';
        } else {
            statusBadge = '<span class="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded-full"><i class="fas fa-clock mr-1"></i>待機中</span>';
        }
        
        // Left side - Input source
        let leftContent;
        if (item.type === 'barcode') {
            leftContent = `
                <div class="p-3 lg:border-r border-gray-200 hover:bg-gray-50">
                    <div class="flex items-start justify-between">
                        <div class="flex-1">
                            <div class="flex items-center mb-1">
                                <i class="fas fa-barcode text-orange-600 mr-2 text-sm"></i>
                                <span class="text-xs font-semibold text-gray-700">バーコード #${index + 1}</span>
                            </div>
                            <div class="bg-gray-100 p-1.5 rounded text-xs font-mono break-all">${item.source}</div>
                        </div>
                        <button onclick="removeGentanItem(${index})" class="ml-2 w-7 h-7 bg-red-100 hover:bg-red-200 text-red-600 rounded-lg flex-shrink-0 flex items-center justify-center">
                            <i class="fas fa-trash text-xs"></i>
                        </button>
                    </div>
                </div>
            `;
        } else {
            leftContent = `
                <div class="p-3 lg:border-r border-gray-200 hover:bg-gray-50">
                    <div class="flex items-start justify-between">
                        <div class="flex-1">
                            <div class="flex items-center justify-between mb-1">
                                <div class="flex items-center">
                                    <i class="fas fa-image text-blue-600 mr-1 text-sm"></i>
                                    <span class="text-xs font-semibold text-gray-700">写真 #${index + 1}</span>
                                </div>
                                ${statusBadge}
                            </div>
                            <img src="${item.source}" alt="Captured" 
                                 class="w-full h-28 lg:h-32 object-cover rounded border border-gray-200 cursor-pointer hover:opacity-90 transition-opacity"
                                 onclick="openImagePreview('${item.source.replace(/'/g, "\\'")}', ${index})">
                            <p class="text-[10px] text-gray-400 mt-1 text-center"><i class="fas fa-search-plus mr-1"></i>タップで拡大</p>
                        </div>
                        <button onclick="removeGentanItem(${index})" class="ml-2 w-7 h-7 bg-red-100 hover:bg-red-200 text-red-600 rounded-lg flex-shrink-0 flex items-center justify-center">
                            <i class="fas fa-trash text-xs"></i>
                        </button>
                    </div>
                </div>
            `;
        }
        
        // Right side - Extracted data
        const rightContent = `
            <div class="p-3 hover:bg-gray-50">
                <div class="space-y-2">
                    <div class="flex items-center justify-between lg:hidden">
                        <span class="text-xs font-bold text-gray-700">${item.type === 'barcode' ? 'バーコード' : '写真'} #${index + 1} データ</span>
                        ${statusBadge}
                    </div>
                    <div class="hidden lg:flex items-center justify-between">
                        <span class="text-xs font-bold text-gray-700">写真 #${index + 1}</span>
                        ${statusBadge}
                    </div>
                    
                    <div class="grid grid-cols-2 gap-1.5">
                        <div>
                            <label class="text-[10px] text-gray-500">品番</label>
                            <input type="text" value="${item.data.品番}" onchange="updateGentanItemData(${index}, '品番', this.value)"
                                   class="w-full px-1.5 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-orange-500">
                        </div>
                        <div>
                            <label class="text-[10px] text-gray-500">品名</label>
                            <input type="text" value="${item.data.品名}" onchange="updateGentanItemData(${index}, '品名', this.value)"
                                   class="w-full px-1.5 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-orange-500">
                        </div>
                        <div>
                            <label class="text-[10px] text-gray-500">納入数</label>
                            <input type="text" value="${item.data.納入数}" onchange="updateGentanItemData(${index}, '納入数', this.value)"
                                   class="w-full px-1.5 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-orange-500">
                        </div>
                        <div>
                            <label class="text-[10px] text-gray-500">納入日</label>
                            <input type="text" value="${item.data.納入日}" onchange="updateGentanItemData(${index}, '納入日', this.value)"
                                   class="w-full px-1.5 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-orange-500">
                        </div>
                        <div class="col-span-2">
                            <label class="text-[10px] text-gray-500">色番</label>
                            <input type="text" value="${item.data.色番}" onchange="updateGentanItemData(${index}, '色番', this.value)"
                                   class="w-full px-1.5 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-orange-500">
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        row.innerHTML = leftContent + rightContent;
        container.appendChild(row);
    });
}

// Update item data
function updateGentanItemData(index, field, value) {
    if (gentanItems[index]) {
        gentanItems[index].data[field] = value;
        saveGentanToStorage(); // Persist changes
    }
}

// Remove item
function removeGentanItem(index) {
    gentanItems.splice(index, 1);
    saveGentanToStorage(); // Persist changes
    updateGentanLists();
    showToast('アイテムを削除しました', 'info');
}

// Submit all data to MongoDB
async function submitGentanData() {
    if (!currentWorker) {
        showToast('ログインが必要です', 'error');
        return;
    }
    
    if (gentanItems.length === 0) {
        showToast('送信するデータがありません', 'error');
        return;
    }
    
    if (!confirm(`${gentanItems.length}件のデータを送信しますか？`)) {
        return;
    }
    
    try {
        const submitBtn = document.getElementById('submitGentanBtn');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>送信中...';
        }
        
        // Prepare data for MongoDB (include imageSource for image types)
        const documentsToSubmit = gentanItems.map(item => {
            const doc = {
                ...item.data,
                submittedBy: currentWorker,
                submittedAt: new Date().toISOString(),
                sourceType: item.type
            };
            
            // Include base64 image source for image types (will be uploaded to Firebase)
            if (item.type === 'image' && item.source) {
                doc.imageSource = item.source;
            }
            
            return doc;
        });
        
        const response = await fetch(`${API_BASE_URL}/gentan/submit`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                documents: documentsToSubmit,
                factory: factory // Send factory value from dropdown
            })
        });
        
        if (!response.ok) {
            throw new Error('データ送信に失敗しました');
        }
        
        const result = await response.json();
        
        showToast(`${result.insertedCount || gentanItems.length}件のデータを送信しました！`, 'success');
        
        // Clear the lists and storage
        gentanItems = [];
        saveGentanToStorage(); // Clear persisted data after successful submit
        updateGentanLists();
        
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-check mr-2"></i>データ送信';
        }
        
    } catch (error) {
        console.error('Error submitting gentan data:', error);
        showToast(`送信エラー: ${error.message}`, 'error');
        
        const submitBtn = document.getElementById('submitGentanBtn');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-check mr-2"></i>データ送信';
        }
    }
}

// ==================== END GENTAN SYSTEM ====================

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
    
    // Filter requests based on current filter and date
    let filteredRequests = pickingRequests;
    
    // Apply status filter
    if (currentFilter !== 'all') {
        filteredRequests = filteredRequests.filter(req => req.status === currentFilter);
    }
    
    // Apply date filter
    if (currentDateFilter) {
        filteredRequests = filteredRequests.filter(req => {
            if (!req.createdAt) return false;
            
            // Extract date part from createdAt (YYYY-MM-DD)
            const requestDate = new Date(req.createdAt).toISOString().split('T')[0];
            return requestDate === currentDateFilter;
        });
    }
    
    // Sort requests: oldest first (ascending by createdAt)
    filteredRequests.sort((a, b) => {
        const dateA = new Date(a.createdAt || 0);
        const dateB = new Date(b.createdAt || 0);
        return dateA - dateB; // Ascending order (oldest first)
    });
    
    container.innerHTML = '';
    
    if (filteredRequests.length === 0) {
        displayNoRequests();
        return;
    }
    
    filteredRequests.forEach(request => {
        const requestCard = createPickingRequestCard(request);
        container.appendChild(requestCard);
    });
}

function createPickingRequestCard(request) {
    const card = document.createElement('div');
    card.className = 'picking-request-card';
    card.onclick = () => viewPickingDetail(request.requestNumber);
    
    const statusClass = getStatusClass(request.status);
    const statusText = getStatusText(request.status);
    const formattedDate = new Date(request.createdAt).toLocaleDateString('ja-JP');
    
    // Color the suffix based on order number
    const coloredRequestNumber = colorizeRequestNumber(request.requestNumber);
    
    card.innerHTML = `
        <div class="flex items-center justify-between">
            <div class="flex items-center space-x-4">
                <div class="w-16 h-16 bg-green-100 rounded-xl flex items-center justify-center">
                    <i class="fas fa-hand-paper text-green-600 text-2xl"></i>
                </div>
                <div>
                    <h3 class="text-xl font-bold text-gray-900">${coloredRequestNumber}</h3>
                    <p class="text-gray-600">
                        ${request.itemCount}項目 • 合計数量: ${request.totalQuantity}
                    </p>
                    <p class="text-sm text-gray-500">${formattedDate}</p>
                </div>
            </div>
            <div class="text-right">
                <span class="status-badge ${statusClass}">
                    ${statusText}
                </span>
            </div>
        </div>
    `;
    
    return card;
}

// Helper function to colorize request number suffix
function colorizeRequestNumber(requestNumber) {
    // Extract the last part (e.g., -001, -002, -003)
    const match = requestNumber.match(/^(.+)(-)(\d+)$/);
    
    if (!match) return requestNumber; // Return as-is if pattern doesn't match
    
    const prefix = match[1]; // e.g., "NODAPO-20251104"
    const dash = match[2];   // "-"
    const suffix = match[3]; // e.g., "001"
    const suffixNum = parseInt(suffix);
    
    let colorClass = '';
    if (suffixNum === 1) {
        colorClass = 'text-blue-600 blink-suffix'; // -001 is blue and blinks
    } else if (suffixNum === 2) {
        colorClass = 'text-green-700 blink-suffix'; // -002 is dark green and blinks
    } else {
        colorClass = 'text-red-600 blink-suffix'; // -003 and above is red and blinks
    }
    
    return `${prefix}<span class="${colorClass}">${dash}${suffix}</span>`;
}

// Enrich line items with master data (収容数) and calculate box quantities
async function enrichLineItemsWithMasterData(lineItems) {
    for (const item of lineItems) {
        try {
            const masterData = await fetchMasterData(item.品番);
            if (masterData && masterData.収容数) {
                const 収容数 = parseInt(masterData.収容数);
                item.収容数 = 収容数;
                item.boxQuantity = Math.ceil(item.quantity / 収容数);
            } else {
                // If no master data, assume 1:1 (no box conversion)
                item.収容数 = 1;
                item.boxQuantity = item.quantity;
            }
        } catch (error) {
            console.error(`Error fetching master data for ${item.品番}:`, error);
            // Fallback: no box conversion
            item.収容数 = 1;
            item.boxQuantity = item.quantity;
        }
    }
}

// Fetch master data for a specific product
async function fetchMasterData(品番) {
    try {
        const response = await fetch(`${API_BASE_URL}/master-data/${品番}`);
        if (!response.ok) {
            throw new Error('Master data not found');
        }
        return await response.json();
    } catch (error) {
        console.error(`Error fetching master data for ${品番}:`, error);
        return null;
    }
}

async function viewPickingDetail(requestNumber) {
    try {
        currentRequestNumber = requestNumber;
        
        // Show loading state immediately to prevent stale data display
        showPickingDetailLoadingState(requestNumber);
        showScreen('pickingDetail');
        
        const response = await fetch(`${API_BASE_URL}/picking-requests/group/${requestNumber}`);
        if (!response.ok) {
            throw new Error('Failed to fetch picking request details');
        }
        
        const request = await response.json();
        currentRequest = request;
        displayPickingDetail(request);
        
    } catch (error) {
        console.error('Error loading picking request details:', error);
        showToast('ピッキング詳細の読み込みに失敗しました', 'error');
        hidePickingDetailLoadingState();
    }
}

async function displayPickingDetail(request) {
    if (!request) {
        console.error('No request provided to displayPickingDetail');
        hidePickingDetailLoadingState();
        return;
    }

    const t = window.t || ((key) => key);

    // Ensure lineItems exists
    if (!request.lineItems) {
        console.error('Request missing lineItems:', request);
        request.lineItems = [];
    }
    
    // Enrich line items with master data and box quantities
    await enrichLineItemsWithMasterData(request.lineItems);
    
    // Hide loading state and show actual content
    hidePickingDetailLoadingState();
    
    // Update header
    document.getElementById('pickingDetailTitle').textContent = `${t('picking-detail')}: ${request.requestNumber}`;
    document.getElementById('pickingDetailSubtitle').textContent = `${request.lineItems.length}${t('items-suffix')}${t('items-picking')}`;
    
    // Update request info
    const infoContainer = document.getElementById('pickingRequestInfo');
    const completedItems = request.lineItems.filter(item => item.status === 'completed').length;
    
    infoContainer.innerHTML = `
        <div class="text-center">
            <p class="text-sm text-gray-500">依頼番号</p>
            <p class="text-lg font-semibold text-gray-900">${request.requestNumber}</p>
        </div>
        <div class="text-center">
            <p class="text-sm text-gray-500">ステータス</p>
            <span id="requestStatusBadge" class="status-badge ${getStatusClass(request.status)}">
                ${getStatusText(request.status)}
            </span>
        </div>
        <div class="text-center">
            <p class="text-sm text-gray-500">進捗</p>
            <p class="text-lg font-semibold text-gray-900 request-progress">${completedItems}/${request.lineItems.length}</p>
        </div>
        <div class="text-center">
            <p class="text-sm text-gray-500">作成者</p>
            <p class="text-lg font-semibold text-gray-900">${request.createdBy}</p>
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
    itemDiv.className = 'picking-item border rounded-lg p-4 mb-3';
    // Add data attributes for real-time updates
    itemDiv.setAttribute('data-line', item.lineNumber);
    itemDiv.setAttribute('data-device-id', item.背番号);
    itemDiv.setAttribute('data-item-id', item.品番);
    itemDiv.setAttribute('data-status', item.status);
    
    // Status icon and text based on item status
    let statusIcon = '';
    let statusText = '';
    let statusClass = '';
    
    if (item.status === 'completed') {
        statusIcon = '<i class="fas fa-check-circle text-green-500"></i>';
        statusText = '完了';
        statusClass = 'text-green-600';
    } else if (item.status === 'in-progress') {
        statusIcon = '<i class="fas fa-clock text-yellow-500"></i>';
        statusText = '進行中';
        statusClass = 'text-yellow-600';
    } else {
        statusIcon = '<i class="fas fa-clock text-gray-500"></i>';
        statusText = '待機中';
        statusClass = 'text-gray-600';
    }
    
    const completedInfo = item.completedAt ? 
        `<p class="text-xs text-gray-500">完了: ${new Date(item.completedAt).toLocaleString('ja-JP')}</p>
         <p class="text-xs text-gray-500">作業者: ${item.completedBy || 'N/A'}</p>` : '';

    // Use box quantity if available, otherwise use piece quantity
    const displayQuantity = item.boxQuantity !== undefined ? item.boxQuantity : item.quantity;
    const quantityUnit = item.boxQuantity !== undefined ? '個' : '個';
    const quantityDetail = item.boxQuantity !== undefined && item.収容数 > 1 
        ? `<span class="text-xs text-gray-500">(${item.quantity}個 ÷ ${item.収容数})</span>` 
        : '';

    itemDiv.innerHTML = `
        <div class="flex items-center justify-between">
            <div class="flex items-center space-x-4">
                <div class="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                    <span class="text-blue-600 font-bold">${item.lineNumber}</span>
                </div>
                <div>
                    <h4 class="text-lg font-semibold text-gray-900">品番: ${item.品番}</h4>
                    <div class="flex items-center">
                        <div class="device-status-indicator w-3 h-3 rounded-full ${item.status === 'in-progress' ? 'bg-yellow-400' : item.status === 'completed' ? 'bg-green-500' : 'bg-gray-400'} mr-2"></div>
                        <p class="text-gray-600">背番号: <span class="font-medium">${item.背番号}</span></p>
                    </div>
                    <p class="text-sm text-gray-500">
                        数量: ${displayQuantity}${quantityUnit} ${quantityDetail}
                    </p>
                    <div class="completion-info mt-1">${completedInfo}</div>
                </div>
            </div>
            <div class="text-right flex items-center space-x-4">
                <div>
                    <div class="text-2xl font-bold text-gray-900">${displayQuantity}</div>
                    <div class="text-sm text-gray-500">${quantityUnit}</div>
                    ${quantityDetail ? `<div class="text-xs text-gray-400 mt-1">${item.quantity}個</div>` : ''}
                </div>
                <div class="flex flex-col items-center space-y-2">
                    <div class="text-2xl status-icon">
                        ${statusIcon}
                    </div>
                    <div class="status-badge ${item.status === 'completed' ? 'bg-green-100 text-green-800' : item.status === 'in-progress' ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-800'} px-2 py-1 rounded-full text-xs font-medium">
                        ${statusText}
                    </div>
                </div>
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
                startedBy: currentWorker,
                factory: factory  // Include factory from dropdown selection
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
            // Show loading state during refresh
            showPickingDetailLoadingState(currentRequestNumber);
            
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
            hidePickingDetailLoadingState();
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
    
    // Count completed items by checking text content (can't use :contains in querySelectorAll)
    const allStatusBadges = document.querySelectorAll('.picking-item .status-badge');
    let completedItems = 0;
    allStatusBadges.forEach(badge => {
        if (badge.textContent.trim() === '完了') {
            completedItems++;
        }
    });
    
    const totalItems = currentRequest.lineItems.length;
    
    const progressElement = document.querySelector('.request-progress');
    if (progressElement) {
        progressElement.textContent = `${completedItems}/${totalItems}`;
    }
    
    // If all items are completed, update the request status and button
    if (completedItems === totalItems) {
        console.log('✅ All items completed! Activating 完了 button...');
        
        const statusBadge = document.querySelector('#requestStatusBadge');
        if (statusBadge) {
            statusBadge.textContent = '完了';
            statusBadge.className = 'status-badge bg-green-100 text-green-800 px-2 py-1 rounded-full text-xs font-medium';
        }
        
        // Update the start button to 完了 button
        const startBtn = document.getElementById('startPickingBtn');
        if (startBtn) {
            const t = window.t || ((key) => key);
            startBtn.disabled = false;
            startBtn.onclick = completeAndBackToList;
            startBtn.innerHTML = `<i class="fas fa-check mr-2"></i>${t('completed-button')}`;
            startBtn.className = 'px-8 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors text-lg font-medium';
            console.log('✅ 完了 button activated - no refresh needed!');
        }
        
        // Update currentRequest status in memory
        if (currentRequest) {
            currentRequest.status = 'completed';
        }
        
        // Play success sound when picking request is completed
        if (window.audioManager) {
            audioManager.playSuccess();
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
        <div class="text-center py-12">
            <div class="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <i class="fas fa-inbox text-4xl text-gray-400"></i>
            </div>
            <h3 class="text-xl font-bold text-gray-900 mb-2">ピッキング依頼がありません</h3>
            <p class="text-gray-600">現在処理可能なピッキング依頼はありません。</p>
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

function filterByDate() {
    const dateInput = document.getElementById('pickingDateFilter');
    if (dateInput) {
        currentDateFilter = dateInput.value;
        console.log('📅 Date filter changed to:', currentDateFilter);
        displayPickingRequests();
    }
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

// Show loading state for picking detail screen
function showPickingDetailLoadingState(requestNumber) {
    // Update header with loading state
    document.getElementById('pickingDetailTitle').textContent = `ピッキング詳細: ${requestNumber}`;
    document.getElementById('pickingDetailSubtitle').textContent = '読み込み中...';
    
    // Show loading in request info area
    const infoContainer = document.getElementById('pickingRequestInfo');
    infoContainer.innerHTML = `
        <div class="col-span-4 text-center py-8">
            <div class="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
            <p class="text-gray-600">データを読み込んでいます...</p>
        </div>
    `;
    
    // Show loading in items list
    const itemsContainer = document.getElementById('pickingItemsList');
    itemsContainer.innerHTML = `
        <div class="p-12 text-center">
            <div class="animate-spin w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-6"></div>
            <p class="text-lg text-gray-600">ピッキング項目を読み込んでいます...</p>
            <p class="text-sm text-gray-500 mt-2">しばらくお待ちください</p>
        </div>
    `;
    
    // Disable start button during loading
    const startBtn = document.getElementById('startPickingBtn');
    if (startBtn) {
        startBtn.disabled = true;
        startBtn.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i>読み込み中...`;
    }
}

// Hide loading state for picking detail screen
function hidePickingDetailLoadingState() {
    // Loading state will be replaced by actual content in displayPickingDetail
    // This function ensures the start button is re-enabled if there's an error
    const startBtn = document.getElementById('startPickingBtn');
    if (startBtn) {
        startBtn.disabled = false;
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
let scanBuffer = ''; // Buffer to accumulate scanned characters

// Initialize inventory screen when opened
function openInventorySystem() {
    showScreen('inventory');
    inventoryScannedItems = [];
    updateInventoryList();

    // Set up keyboard listener for scanning
    setupInventoryScanListener();
}

// Set up keyboard listener for the entire page
function setupInventoryScanListener() {
    console.log('🎧 Setting up page-wide keyboard listener for inventory scanning');
    
    // Remove any existing listener
    document.removeEventListener('keydown', handleInventoryScan);
    
    // Add new listener to the entire document
    document.addEventListener('keydown', handleInventoryScan);
    
    console.log('✅ Keyboard listener active - waiting for scans (Enter key is delimiter)');
}

// Handle keyboard input for scanning
async function handleInventoryScan(e) {
    // Only process when on inventory screen
    if (currentScreen !== 'inventory') return;
    
    // Ignore if user is typing in an input field (except our hidden scanner input)
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        if (e.target.id !== 'inventoryScanInput') return;
    }
    
    // Check if Enter key (delimiter)
    if (e.key === 'Enter') {
        e.preventDefault();
        console.log('✅ Enter key pressed - Processing scan buffer:', scanBuffer);
        
        if (scanBuffer.trim()) {
            console.log('📦 Processing scanned value:', scanBuffer.trim());
            await processInventoryScan(scanBuffer.trim());
            scanBuffer = ''; // Clear buffer after processing
            console.log('🧹 Buffer cleared');
        } else {
            console.log('⚠️ Buffer is empty, nothing to process');
        }
        return;
    }
    
    // Ignore special keys
    if (e.key.length > 1 && e.key !== 'Enter') {
        console.log('⏭️ Ignoring special key:', e.key);
        return;
    }
    
    // Add character to buffer
    scanBuffer += e.key;
    console.log('⌨️ Key captured:', e.key, '| Current buffer:', scanBuffer);
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
window.openGentanSystem = openGentanSystem;
window.resetGentanData = resetGentanData;
window.openImagePreview = openImagePreview;
window.closeImagePreview = closeImagePreview;
window.saveModalEditData = saveModalEditData;
window.backToHome = backToHome;
window.backToPickingList = backToPickingList;
window.filterByStatus = filterByStatus;
window.filterByDate = filterByDate;
window.refreshPickingRequests = refreshPickingRequests;
window.startPickingProcess = startPickingProcess;
// window.startIndividualPicking = startIndividualPicking; // Removed - ESP32 handles picking automatically
window.refreshPickingDetail = refreshPickingDetail;
window.completeAndBackToList = completeAndBackToList;
window.clearInventoryList = clearInventoryList;
window.submitInventoryCount = submitInventoryCount;
window.updateInventoryItemQuantity = updateInventoryItemQuantity;
window.removeInventoryItem = removeInventoryItem;

// Factory selector functions
window.openFactorySelector = openFactorySelector;
window.closeFactorySelector = closeFactorySelector;
window.loadFactoryList = loadFactoryList;
window.selectFactory = selectFactory;

// Tanaoroshi (棚卸し) system functions
window.adjustTanaoroshiCount = adjustTanaoroshiCount;
window.completeTanaoroshiCount = completeTanaoroshiCount;
window.closeTanaoroshiModal = closeTanaoroshiModal;
window.editTanaoroshiProduct = editTanaoroshiProduct;
window.deleteTanaoroshiProduct = deleteTanaoroshiProduct;
window.submitTanaoroshiCount = submitTanaoroshiCount;

// Nyuko (入庫) system functions
window.openNyukoSystem = openNyukoSystem;
window.adjustNyukoCount = adjustNyukoCount;
window.completeNyukoInput = completeNyukoInput;
window.closeNyukoModal = closeNyukoModal;
window.editNyukoProduct = editNyukoProduct;
window.deleteNyukoProduct = deleteNyukoProduct;
window.submitNyukoInput = submitNyukoInput;

// Gentan (原単) system functions
window.handleGentanImageCapture = handleGentanImageCapture;
window.updateGentanItemData = updateGentanItemData;
window.removeGentanItem = removeGentanItem;
window.submitGentanData = submitGentanData;

// Note: Language translations are defined in language.js which is loaded first in index.html
// The translations object is already available globally from language.js

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

// ==================== TANAOROSHI (棚卸し) SYSTEM ====================

// Global variables for tanaoroshi
let tanaoroshiCountedProducts = []; // Array to store counted products
let currentTanaoroshiProduct = null; // Currently counting product
let tanaoroshiScanBuffer = ''; // Buffer for QR scan input
let isTanaoroshiModalOpen = false; // Track if modal is open

// Initialize tanaoroshi when inventory screen is shown
function openInventorySystem() {
    showScreen('inventory');
    initializeTanaoroshi();
}

function initializeTanaoroshi() {
    console.log('🔄 Initializing Tanaoroshi system...');
    
    // Reset state
    tanaoroshiCountedProducts = [];
    currentTanaoroshiProduct = null;
    tanaoroshiScanBuffer = '';
    isTanaoroshiModalOpen = false;
    
    // Show scanner area, hide summary list
    document.getElementById('tanaoroshiScannerArea').classList.remove('hidden');
    document.getElementById('tanaoroshiSummaryList').classList.add('hidden');
    
    // Close modal if open
    document.getElementById('tanaoroshiCountingModal').classList.add('hidden');
    
    // Setup keyboard listener for HID mode QR scanner
    setupTanaoroshiKeyboardListener();
    
    console.log('✅ Tanaoroshi system ready');
}

// Setup keyboard listener for QR scanner (HID mode)
function setupTanaoroshiKeyboardListener() {
    // Remove existing listener if any
    document.removeEventListener('keydown', tanaoroshiKeyHandler);
    
    // Add new listener
    document.addEventListener('keydown', tanaoroshiKeyHandler);
    
    console.log('⌨️ Tanaoroshi keyboard listener active');
}

// Keyboard handler for QR scanning
function tanaoroshiKeyHandler(event) {
    // Only process if on inventory screen and modal is open or waiting for initial scan
    if (currentScreen !== 'inventory') {
        return;
    }
    
    // Ignore if user is typing in an input field (except our modal state)
    if (event.target.tagName === 'INPUT' && !isTanaoroshiModalOpen) {
        return;
    }
    
    // Enter key - process the scanned data
    if (event.key === 'Enter') {
        event.preventDefault();
        
        if (tanaoroshiScanBuffer.trim() !== '') {
            processTanaoroshiScan(tanaoroshiScanBuffer.trim());
            tanaoroshiScanBuffer = ''; // Clear buffer
        }
        
        return;
    }
    
    // Ignore special keys
    if (event.key.length > 1 && event.key !== 'Enter') {
        return;
    }
    
    // Add character to buffer
    tanaoroshiScanBuffer += event.key;
}

// Process scanned QR code
async function processTanaoroshiScan(scanData) {
    console.log('📦 Tanaoroshi scan received:', scanData);

    // Parse QR code format: "GN519-10200,20"
    const parts = scanData.split(',');
    if (parts.length !== 2) {
        showToast('❌ ' + t('qr-format-invalid'), 'error');
        return;
    }

    const scannedProductNumber = parts[0].trim();
    const scannedBoxQuantity = parseInt(parts[1].trim());

    if (!scannedProductNumber || isNaN(scannedBoxQuantity)) {
        showToast('❌ ' + t('qr-data-invalid'), 'error');
        return;
    }
    
    // If no modal is open, this is the initial product scan
    if (!isTanaoroshiModalOpen) {
        await startCountingProduct(scannedProductNumber, scannedBoxQuantity);
    } else {
        // Modal is open, this is a box scan
        await processBoxScan(scannedProductNumber, scannedBoxQuantity);
    }
}

// Start counting a new product
async function startCountingProduct(productNumber, referenceQuantity) {
    try {
        console.log(`🆕 Starting count for product: ${productNumber}`);

        // Fetch product data from API
        showToast('🔍 ' + t('fetching-product-info'), 'info');

        const response = await fetch(`${API_BASE_URL}/tanaoroshi/${productNumber}`);

        if (!response.ok) {
            if (response.status === 404) {
                showToast('❌ ' + t('product-not-found-error'), 'error');
            } else {
                showToast('❌ ' + t('product-fetch-failed'), 'error');
            }
            return;
        }

        const productData = await response.json();
        console.log('✅ Product data fetched:', productData);

        // Check if this is a new product (not in inventory)
        if (productData.isNewProduct) {
            const confirmAdd = confirm(
                `⚠️ ${t('item-not-in-inventory')}\n` +
                `${t('product-number-label')}: ${productData.品番}\n` +
                `${t('product-name') || '品名'}: ${productData.品名 || '-'}\n\n` +
                `${t('item-not-in-inventory-detail').split('\n').pop()}`
            );

            if (!confirmAdd) {
                showToast(t('cancelled'), 'info');
                return;
            }

            showToast('📦 ' + t('adding-new-product'), 'info');
        }
        
        // Initialize current product object
        currentTanaoroshiProduct = {
            品番: productData.品番,
            品名: productData.品名,
            背番号: productData.背番号,
            収容数: productData.収容数,
            imageURL: productData.imageURL,
            isNewProduct: productData.isNewProduct || false,
            currentPhysicalQuantity: productData.currentPhysicalQuantity,
            currentReservedQuantity: productData.currentReservedQuantity,
            currentAvailableQuantity: productData.currentAvailableQuantity,
            countedBoxes: 0,
            countedPieces: 0
        };
        
        // Open counting modal
        openTanaoroshiCountingModal();

        showToast('✅ ' + t('count-start'), 'success');

    } catch (error) {
        console.error('Error starting product count:', error);
        showToast('❌ ' + t('error-occurred'), 'error');
    }
}

// Open the counting modal
function openTanaoroshiCountingModal() {
    if (!currentTanaoroshiProduct) return;
    
    const modal = document.getElementById('tanaoroshiCountingModal');
    const product = currentTanaoroshiProduct;
    
    // Set product info
    document.getElementById('modalProductNumber').textContent = product.品番;
    document.getElementById('modalSebangou').textContent = product.背番号 || '-';
    document.getElementById('modalProductName').textContent = product.品名 || '-';
    
    // Set product image
    const imgElement = document.getElementById('modalProductImage');
    if (product.imageURL) {
        imgElement.src = product.imageURL;
        imgElement.style.display = 'block';
    } else {
        imgElement.style.display = 'none';
    }
    
    // Calculate expected boxes
    const expectedBoxes = Math.ceil(product.currentPhysicalQuantity / product.収容数);
    
    // Set expected count with special styling for new products
    if (product.isNewProduct) {
        document.getElementById('modalExpectedPieces').innerHTML = `<span class="text-gray-400">0 個</span> <span class="text-xs text-orange-600 ml-2">(在庫なし)</span>`;
        document.getElementById('modalExpectedBoxes').innerHTML = `<span class="text-gray-400">= 0 箱</span>`;
    } else {
        document.getElementById('modalExpectedPieces').textContent = `${product.currentPhysicalQuantity} 個`;
        document.getElementById('modalExpectedBoxes').textContent = `= ${expectedBoxes} 箱`;
    }
    document.getElementById('modalBoxInfo').textContent = `1箱 = ${product.収容数}個`;
    
    // Reset counter
    updateTanaoroshiCounter();
    
    // Show modal
    modal.classList.remove('hidden');
    isTanaoroshiModalOpen = true;
    
    console.log('📋 Counting modal opened');
}

// Process box scan (when modal is open)
async function processBoxScan(scannedProductNumber, scannedBoxQuantity) {
    if (!currentTanaoroshiProduct) {
        showToast('❌ ' + t('error-no-product'), 'error');
        return;
    }

    // Validate product number matches
    if (scannedProductNumber !== currentTanaoroshiProduct.品番) {
        showToast(`❌ ${t('product-number-mismatch')} ${currentTanaoroshiProduct.品番}`, 'error');
        
        // Play alert sound on error
        if (window.audioManager) {
            audioManager.playAlert();
        }
        
        // Flash red
        const counterArea = document.getElementById('modalCounterArea');
        counterArea.classList.add('bg-red-100', 'border-red-500');
        setTimeout(() => {
            counterArea.classList.remove('bg-red-100', 'border-red-500');
            counterArea.classList.add('bg-gradient-to-br', 'from-green-50', 'to-emerald-50', 'border-green-200');
        }, 1000);
        
        return;
    }
    
    // Validate box quantity matches 収容数
    if (scannedBoxQuantity !== currentTanaoroshiProduct.収容数) {
        showToast(`❌ ${t('box-quantity-mismatch')} ${currentTanaoroshiProduct.収容数}${t('box-quantity-suffix')}`, 'error');
        
        // Play alert sound on error
        if (window.audioManager) {
            audioManager.playAlert();
        }
        
        return;
    }
    
    // Increment count
    currentTanaoroshiProduct.countedBoxes += 1;
    currentTanaoroshiProduct.countedPieces += scannedBoxQuantity;
    
    // Update display
    updateTanaoroshiCounter();
    
    // Play beep sound on successful scan
    if (window.audioManager) {
        audioManager.playBeep();
    }
    
    // Flash green
    const counterArea = document.getElementById('modalCounterArea');
    counterArea.classList.add('bg-green-200', 'border-green-500');
    setTimeout(() => {
        counterArea.classList.remove('bg-green-200', 'border-green-500');
        counterArea.classList.add('bg-gradient-to-br', 'from-green-50', 'to-emerald-50', 'border-green-200');
    }, 300);
    
    console.log(`✅ Box scanned: ${currentTanaoroshiProduct.countedBoxes} boxes (${currentTanaoroshiProduct.countedPieces} pieces)`);
}

// Update counter display
function updateTanaoroshiCounter() {
    if (!currentTanaoroshiProduct) return;
    
    const countedBoxes = currentTanaoroshiProduct.countedBoxes;
    const countedPieces = currentTanaoroshiProduct.countedPieces;
    const expectedPieces = currentTanaoroshiProduct.currentPhysicalQuantity;
    const expectedBoxes = Math.ceil(expectedPieces / currentTanaoroshiProduct.収容数);
    
    // Update counter text
    document.getElementById('modalCountedBoxes').textContent = `${countedBoxes} 箱`;
    document.getElementById('modalCountedPieces').textContent = `(${countedPieces} 個)`;
    
    // Update status indicator
    const statusIndicator = document.getElementById('modalStatusIndicator');
    const statusText = document.getElementById('modalStatusText');
    
    if (countedPieces === 0) {
        statusIndicator.className = 'inline-flex items-center px-4 py-2 rounded-full text-sm font-medium bg-gray-100 text-gray-700';
        statusText.textContent = 'スキャン待機中';
    } else if (countedPieces < expectedPieces) {
        statusIndicator.className = 'inline-flex items-center px-4 py-2 rounded-full text-sm font-medium bg-yellow-100 text-yellow-700';
        statusText.textContent = `不足 (${expectedPieces - countedPieces}個)`;
    } else if (countedPieces > expectedPieces) {
        statusIndicator.className = 'inline-flex items-center px-4 py-2 rounded-full text-sm font-medium bg-red-100 text-red-700';
        statusText.textContent = `超過 (+${countedPieces - expectedPieces}個)`;
    } else {
        statusIndicator.className = 'inline-flex items-center px-4 py-2 rounded-full text-sm font-medium bg-green-100 text-green-700';
        statusText.textContent = '✓ 一致';
    }
}

// Manual adjustment (+/- buttons)
function adjustTanaoroshiCount(delta) {
    if (!currentTanaoroshiProduct) return;

    const newBoxCount = currentTanaoroshiProduct.countedBoxes + delta;

    // Prevent negative count
    if (newBoxCount < 0) {
        showToast('❌ ' + t('box-count-negative'), 'error');
        return;
    }
    
    currentTanaoroshiProduct.countedBoxes = newBoxCount;
    currentTanaoroshiProduct.countedPieces = newBoxCount * currentTanaoroshiProduct.収容数;
    
    updateTanaoroshiCounter();
    
    console.log(`🔧 Manual adjustment: ${newBoxCount} boxes (${currentTanaoroshiProduct.countedPieces} pieces)`);
}

// Complete counting for current product
async function completeTanaoroshiCount() {
    if (!currentTanaoroshiProduct) return;

    const countedPieces = currentTanaoroshiProduct.countedPieces;
    const expectedPieces = currentTanaoroshiProduct.currentPhysicalQuantity;
    const difference = countedPieces - expectedPieces;
    const isNewProduct = currentTanaoroshiProduct.isNewProduct || false;

    // For new products, show special confirmation
    if (isNewProduct) {
        if (countedPieces === 0) {
            showToast('❌ ' + t('enter-count-quantity'), 'error');
            return;
        }

        const message = `${t('add-new-product-confirm')
            .replace('{0}', currentTanaoroshiProduct.品番)
            .replace('{1}', countedPieces)
            .replace('{2}', currentTanaoroshiProduct.countedBoxes)}`;

        if (!confirm(message)) {
            return;
        }
    } else {
        // If there's a discrepancy, show confirmation
        if (difference !== 0) {
            const boxDifference = Math.ceil(Math.abs(difference) / currentTanaoroshiProduct.収容数);
            const action = difference > 0 ? t('adjustment-add') : t('adjustment-reduce');
            const message = `${t('inventory-adjustment-confirm')
                .replace('{0}', Math.abs(difference))
                .replace('{1}', boxDifference)
                .replace('{2}', action)}`;

            if (!confirm(message)) {
                return;
            }
        }
    }
    
    // Add to counted products list
    tanaoroshiCountedProducts.push({
        品番: currentTanaoroshiProduct.品番,
        品名: currentTanaoroshiProduct.品名,
        背番号: currentTanaoroshiProduct.背番号,
        収容数: currentTanaoroshiProduct.収容数,
        imageURL: currentTanaoroshiProduct.imageURL,
        isNewProduct: isNewProduct,
        oldPhysicalQuantity: expectedPieces,
        newPhysicalQuantity: countedPieces,
        oldReservedQuantity: currentTanaoroshiProduct.currentReservedQuantity,
        countedBoxes: currentTanaoroshiProduct.countedBoxes,
        difference: difference
    });
    
    // Close modal
    closeTanaoroshiModal();

    // Update summary list
    updateTanaoroshiSummaryList();

    showToast('✅ ' + t('count-complete'), 'success');
}

// Close counting modal
function closeTanaoroshiModal() {
    document.getElementById('tanaoroshiCountingModal').classList.add('hidden');
    isTanaoroshiModalOpen = false;
    currentTanaoroshiProduct = null;
    
    // Stop any playing alert sounds when modal closes
    if (window.audioManager) {
        audioManager.stopAlert();
    }
    
    console.log('📋 Counting modal closed');
}

// Update summary list display
function updateTanaoroshiSummaryList() {
    const summaryList = document.getElementById('tanaoroshiSummaryList');
    const itemsList = document.getElementById('tanaoroshiItemsList');
    const itemCount = document.getElementById('tanaoroshiItemCount');
    
    // Show summary list
    summaryList.classList.remove('hidden');
    document.getElementById('tanaoroshiScannerArea').classList.add('hidden');
    
    // Update count
    itemCount.textContent = `(${tanaoroshiCountedProducts.length})`;
    
    // Clear and rebuild list
    itemsList.innerHTML = '';
    
    tanaoroshiCountedProducts.forEach((product, index) => {
        const row = createTanaoroshiSummaryRow(product, index);
        itemsList.appendChild(row);
    });
}

// Create summary row element
function createTanaoroshiSummaryRow(product, index) {
    const row = document.createElement('div');
    row.className = 'p-4 hover:bg-gray-50 transition-colors';
    
    const oldBoxes = Math.ceil(product.oldPhysicalQuantity / product.収容数);
    const newBoxes = product.countedBoxes;
    const diffClass = product.difference > 0 ? 'text-green-600' : product.difference < 0 ? 'text-red-600' : 'text-gray-600';
    const diffSymbol = product.difference > 0 ? '+' : '';
    const isNewProduct = product.isNewProduct || false;
    
    row.innerHTML = `
        <div class="flex items-center justify-between">
            <div class="flex items-center space-x-4 flex-1">
                ${product.imageURL ? `
                    <img src="${product.imageURL}" alt="${product.品番}" class="w-16 h-16 object-contain rounded border border-gray-200">
                ` : `
                    <div class="w-16 h-16 bg-gray-100 rounded border border-gray-200 flex items-center justify-center">
                        <i class="fas fa-box text-gray-400"></i>
                    </div>
                `}
                <div class="flex-1">
                    <div class="flex items-center space-x-2">
                        <h4 class="font-bold text-gray-900">${product.品番}</h4>
                        ${isNewProduct ? `
                            <span class="px-2 py-1 bg-orange-100 text-orange-700 text-xs font-bold rounded">NEW</span>
                        ` : ''}
                    </div>
                    <p class="text-sm text-gray-600">${product.品名 || '-'}</p>
                    <div class="flex items-center space-x-4 mt-2">
                        <span class="text-sm">
                            <span class="text-red-600 ${isNewProduct ? '' : 'line-through'}">${product.oldPhysicalQuantity}個 (${oldBoxes}箱)</span>
                        </span>
                        <i class="fas fa-arrow-right text-gray-400 text-xs"></i>
                        <span class="text-sm">
                            <span class="${diffClass} font-bold">${product.newPhysicalQuantity}個 (${newBoxes}箱)</span>
                        </span>
                        ${product.difference !== 0 ? `
                            <span class="text-xs ${diffClass} font-medium">
                                (${diffSymbol}${product.difference}個)
                            </span>
                        ` : ''}
                    </div>
                </div>
            </div>
            <div class="flex items-center space-x-2">
                <button onclick="editTanaoroshiProduct(${index})" class="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors">
                    <i class="fas fa-edit mr-1"></i>編集
                </button>
                <button onclick="deleteTanaoroshiProduct(${index})" class="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors">
                    <i class="fas fa-trash mr-1"></i>削除
                </button>
            </div>
        </div>
    `;
    
    return row;
}

// Edit counted product
function editTanaoroshiProduct(index) {
    const product = tanaoroshiCountedProducts[index];
    
    // Remove from list
    tanaoroshiCountedProducts.splice(index, 1);
    
    // Set as current product and reopen modal
    currentTanaoroshiProduct = {
        品番: product.品番,
        品名: product.品名,
        背番号: product.背番号,
        収容数: product.収容数,
        imageURL: product.imageURL,
        isNewProduct: product.isNewProduct || false,
        currentPhysicalQuantity: product.oldPhysicalQuantity,
        currentReservedQuantity: product.oldReservedQuantity,
        currentAvailableQuantity: product.oldPhysicalQuantity - product.oldReservedQuantity,
        countedBoxes: product.countedBoxes,
        countedPieces: product.newPhysicalQuantity
    };
    
    openTanaoroshiCountingModal();
    
    // Update summary list
    if (tanaoroshiCountedProducts.length === 0) {
        // Reset to scanner area if no more products
        document.getElementById('tanaoroshiSummaryList').classList.add('hidden');
        document.getElementById('tanaoroshiScannerArea').classList.remove('hidden');
    } else {
        updateTanaoroshiSummaryList();
    }
}

// Delete counted product
function deleteTanaoroshiProduct(index) {
    const product = tanaoroshiCountedProducts[index];

    if (!confirm(t('delete-product-confirm').replace('{0}', product.品番))) {
        return;
    }

    tanaoroshiCountedProducts.splice(index, 1);

    if (tanaoroshiCountedProducts.length === 0) {
        // Reset to scanner area
        document.getElementById('tanaoroshiSummaryList').classList.add('hidden');
        document.getElementById('tanaoroshiScannerArea').classList.remove('hidden');
    } else {
        updateTanaoroshiSummaryList();
    }

    showToast(t('deleted'), 'info');
}

// Submit all counted products
async function submitTanaoroshiCount() {
    if (tanaoroshiCountedProducts.length === 0) {
        showToast('❌ ' + t('no-counted-products'), 'error');
        return;
    }

    if (!confirm(t('submit-count-confirm').replace('{0}', tanaoroshiCountedProducts.length))) {
        return;
    }

    try {
        // Show loading toast
        showToast('📤 ' + t('submitting'), 'info');
        
        // Prepare data
        const submissionData = {
            countedProducts: tanaoroshiCountedProducts,
            submittedBy: currentWorker || 'Tablet User',
            factory: factory // Include factory location
        };
        
        console.log('📤 Submitting tanaoroshi:', submissionData);
        console.log('🏭 Factory location:', factory);
        
        // Submit to API
        const response = await fetch(`${API_BASE_URL}/tanaoroshi/submit`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(submissionData)
        });
        
        if (!response.ok) {
            throw new Error('Submission failed');
        }
        
        const result = await response.json();
        console.log('✅ Submission result:', result);

        showToast(`✅ ${result.processedCount}${t('products-updated')}`, 'success');

        // Reset system
        setTimeout(() => {
            initializeTanaoroshi();
        }, 2000);

    } catch (error) {
        console.error('Error submitting tanaoroshi:', error);
        showToast('❌ ' + t('submit-failed'), 'error');
    }
}

// ==================== END TANAOROSHI SYSTEM ====================

// ==================== NYUKO (入庫) SYSTEM ====================

// Global variables for nyuko
let nyukoInputProducts = []; // Array to store input products
let currentNyukoProduct = null; // Currently inputting product
let nyukoScanBuffer = ''; // Buffer for QR scan input
let isNyukoModalOpen = false; // Track if modal is open

// Initialize nyuko when screen is shown
function openNyukoSystem() {
    // Activate audio for nyuko mode (beep + alert sounds)
    if (window.audioManager) {
        audioManager.activateForMode('nyuko');
    }
    showScreen('nyuko');
    initializeNyuko();
}

function initializeNyuko() {
    console.log('🔄 Initializing Nyuko system...');
    
    // Reset state
    nyukoInputProducts = [];
    currentNyukoProduct = null;
    nyukoScanBuffer = '';
    isNyukoModalOpen = false;
    
    // Show scanner area, hide summary list
    document.getElementById('nyukoScannerArea').classList.remove('hidden');
    document.getElementById('nyukoSummaryList').classList.add('hidden');
    
    // Close modal if open
    document.getElementById('nyukoInputModal').classList.add('hidden');
    
    // Setup keyboard listener for HID mode QR scanner
    setupNyukoKeyboardListener();
    
    console.log('✅ Nyuko system ready');
}

// Setup keyboard listener for QR scanner (HID mode)
function setupNyukoKeyboardListener() {
    // Remove existing listener if any
    document.removeEventListener('keydown', nyukoKeyHandler);
    
    // Add new listener
    document.addEventListener('keydown', nyukoKeyHandler);
    
    console.log('⌨️ Nyuko keyboard listener active');
}

// Keyboard handler for QR scanning
function nyukoKeyHandler(event) {
    // Only process if on nyuko screen
    if (currentScreen !== 'nyuko') {
        return;
    }
    
    // Ignore if user is typing in an input field (except our modal state)
    if (event.target.tagName === 'INPUT' && !isNyukoModalOpen) {
        return;
    }
    
    // Enter key - process the scanned data
    if (event.key === 'Enter') {
        event.preventDefault();
        
        if (nyukoScanBuffer.trim() !== '') {
            processNyukoScan(nyukoScanBuffer.trim());
            nyukoScanBuffer = ''; // Clear buffer
        }
        
        return;
    }
    
    // Ignore special keys
    if (event.key.length > 1 && event.key !== 'Enter') {
        return;
    }
    
    // Add character to buffer
    nyukoScanBuffer += event.key;
}

// Process scanned QR code
async function processNyukoScan(scanData) {
    console.log('📦 Nyuko scan received:', scanData);

    // Parse QR code format: "GN519-10200,20"
    const parts = scanData.split(',');
    if (parts.length !== 2) {
        showToast('❌ ' + t('qr-format-invalid'), 'error');
        return;
    }

    const scannedProductNumber = parts[0].trim();
    const scannedBoxQuantity = parseInt(parts[1].trim());

    if (!scannedProductNumber || isNaN(scannedBoxQuantity)) {
        showToast('❌ ' + t('qr-data-invalid'), 'error');
        return;
    }
    
    // If no modal is open, this is the initial product scan
    if (!isNyukoModalOpen) {
        await startInputtingProduct(scannedProductNumber, scannedBoxQuantity);
    } else {
        // Modal is open, this is a box scan
        await processNyukoBoxScan(scannedProductNumber, scannedBoxQuantity);
    }
}

// Start inputting a new product
async function startInputtingProduct(productNumber, referenceQuantity) {
    try {
        console.log(`🆕 Starting input for product: ${productNumber}`);

        // Fetch product data from API
        showToast('🔍 ' + t('fetching-product-info'), 'info');

        const response = await fetch(`${API_BASE_URL}/nyuko/${productNumber}`);

        if (!response.ok) {
            if (response.status === 404) {
                showToast('❌ ' + t('product-not-found-error'), 'error');
            } else {
                showToast('❌ ' + t('product-fetch-failed'), 'error');
            }
            return;
        }
        
        const productData = await response.json();
        console.log('✅ Product data fetched:', productData);
        
        // Initialize current product object
        currentNyukoProduct = {
            品番: productData.品番,
            品名: productData.品名,
            背番号: productData.背番号,
            収容数: productData.収容数,
            imageURL: productData.imageURL,
            inventoryExists: productData.inventoryExists,
            currentPhysicalQuantity: productData.currentPhysicalQuantity,
            currentReservedQuantity: productData.currentReservedQuantity,
            countedBoxes: 0,
            countedPieces: 0
        };
        
        // Open input modal
        openNyukoInputModal();

        showToast('✅ ' + t('nyuko-start'), 'success');

    } catch (error) {
        console.error('Error starting product input:', error);
        showToast('❌ ' + t('error-occurred'), 'error');
    }
}

// Open the input modal
function openNyukoInputModal() {
    if (!currentNyukoProduct) return;
    
    const modal = document.getElementById('nyukoInputModal');
    const product = currentNyukoProduct;
    
    // Set product info
    document.getElementById('nyukoModalProductNumber').textContent = product.品番;
    document.getElementById('nyukoModalSebangou').textContent = product.背番号 || '-';
    document.getElementById('nyukoModalProductName').textContent = product.品名 || '-';
    
    // Set product image
    const imgElement = document.getElementById('nyukoModalProductImage');
    if (product.imageURL) {
        imgElement.src = product.imageURL;
        imgElement.style.display = 'block';
    } else {
        imgElement.style.display = 'none';
    }
    
    // Show current inventory if exists
    const currentInventoryDiv = document.getElementById('nyukoCurrentInventory');
    if (product.inventoryExists && product.currentPhysicalQuantity > 0) {
        const currentBoxes = Math.ceil(product.currentPhysicalQuantity / product.収容数);
        document.getElementById('nyukoCurrentPieces').textContent = `${product.currentPhysicalQuantity} 個`;
        document.getElementById('nyukoCurrentBoxes').textContent = `= ${currentBoxes} 箱`;
        currentInventoryDiv.classList.remove('hidden');
    } else {
        currentInventoryDiv.classList.add('hidden');
    }
    
    // Set box info
    document.getElementById('nyukoModalBoxInfo').textContent = `1箱 = ${product.収容数}個`;
    
    // Reset counter
    updateNyukoCounter();
    
    // Show modal
    modal.classList.remove('hidden');
    isNyukoModalOpen = true;
    
    console.log('📋 Input modal opened');
}

// Process box scan (when modal is open)
async function processNyukoBoxScan(scannedProductNumber, scannedBoxQuantity) {
    if (!currentNyukoProduct) {
        showToast('❌ ' + t('error-no-product'), 'error');
        return;
    }

    // Validate product number matches
    if (scannedProductNumber !== currentNyukoProduct.品番) {
        showToast(`❌ ${t('product-number-mismatch')} ${currentNyukoProduct.品番}`, 'error');
        
        // Play alert sound on error
        if (window.audioManager) {
            audioManager.playAlert();
        }
        
        // Flash red
        const counterArea = document.getElementById('nyukoModalCounterArea');
        counterArea.classList.add('bg-red-100', 'border-red-500');
        setTimeout(() => {
            counterArea.classList.remove('bg-red-100', 'border-red-500');
            counterArea.classList.add('bg-gradient-to-br', 'from-purple-50', 'to-indigo-50', 'border-purple-200');
        }, 1000);
        
        return;
    }
    
    // Validate box quantity matches 収容数
    if (scannedBoxQuantity !== currentNyukoProduct.収容数) {
        showToast(`❌ ${t('box-quantity-mismatch')} ${currentNyukoProduct.収容数}${t('box-quantity-suffix')}`, 'error');
        
        // Play alert sound on error
        if (window.audioManager) {
            audioManager.playAlert();
        }
        
        return;
    }
    
    // Increment count
    currentNyukoProduct.countedBoxes += 1;
    currentNyukoProduct.countedPieces += scannedBoxQuantity;
    
    // Update display
    updateNyukoCounter();
    
    // Play beep sound on successful scan
    if (window.audioManager) {
        audioManager.playBeep();
    }
    
    // Flash purple
    const counterArea = document.getElementById('nyukoModalCounterArea');
    counterArea.classList.add('bg-purple-200', 'border-purple-500');
    setTimeout(() => {
        counterArea.classList.remove('bg-purple-200', 'border-purple-500');
        counterArea.classList.add('bg-gradient-to-br', 'from-purple-50', 'to-indigo-50', 'border-purple-200');
    }, 300);
    
    console.log(`✅ Box scanned: ${currentNyukoProduct.countedBoxes} boxes (${currentNyukoProduct.countedPieces} pieces)`);
}

// Update counter display
function updateNyukoCounter() {
    if (!currentNyukoProduct) return;
    
    const countedBoxes = currentNyukoProduct.countedBoxes;
    const countedPieces = currentNyukoProduct.countedPieces;
    
    // Update counter text
    document.getElementById('nyukoModalCountedBoxes').textContent = `${countedBoxes} 箱`;
    document.getElementById('nyukoModalCountedPieces').textContent = `(${countedPieces} 個)`;
}

// Manual adjustment (+/- buttons)
function adjustNyukoCount(delta) {
    if (!currentNyukoProduct) return;

    const newBoxCount = currentNyukoProduct.countedBoxes + delta;

    // Prevent negative count
    if (newBoxCount < 0) {
        showToast('❌ ' + t('box-count-negative'), 'error');
        return;
    }
    
    currentNyukoProduct.countedBoxes = newBoxCount;
    currentNyukoProduct.countedPieces = newBoxCount * currentNyukoProduct.収容数;
    
    updateNyukoCounter();
    
    console.log(`🔧 Manual adjustment: ${newBoxCount} boxes (${currentNyukoProduct.countedPieces} pieces)`);
}

// Complete input for current product
async function completeNyukoInput() {
    if (!currentNyukoProduct) return;

    const inputPieces = currentNyukoProduct.countedPieces;

    if (inputPieces === 0) {
        showToast('❌ ' + t('enter-nyuko-quantity'), 'error');
        return;
    }

    const message = t('nyuko-confirm')
        .replace('{0}', inputPieces)
        .replace('{1}', currentNyukoProduct.countedBoxes);

    if (!confirm(message)) {
        return;
    }
    
    // Add to input products list
    nyukoInputProducts.push({
        品番: currentNyukoProduct.品番,
        品名: currentNyukoProduct.品名,
        背番号: currentNyukoProduct.背番号,
        収容数: currentNyukoProduct.収容数,
        imageURL: currentNyukoProduct.imageURL,
        inventoryExists: currentNyukoProduct.inventoryExists,
        oldPhysicalQuantity: currentNyukoProduct.currentPhysicalQuantity,
        oldReservedQuantity: currentNyukoProduct.currentReservedQuantity,
        inputQuantity: inputPieces,
        inputBoxes: currentNyukoProduct.countedBoxes
    });
    
    // Close modal
    closeNyukoModal();

    // Update summary list
    updateNyukoSummaryList();

    showToast('✅ ' + t('nyuko-complete'), 'success');
}

// Close input modal
function closeNyukoModal() {
    document.getElementById('nyukoInputModal').classList.add('hidden');
    isNyukoModalOpen = false;
    currentNyukoProduct = null;
    
    // Stop any playing alert sounds when modal closes
    if (window.audioManager) {
        audioManager.stopAlert();
    }
    
    console.log('📋 Input modal closed');
}

// Update summary list display
function updateNyukoSummaryList() {
    const summaryList = document.getElementById('nyukoSummaryList');
    const itemsList = document.getElementById('nyukoItemsList');
    const itemCount = document.getElementById('nyukoItemCount');
    
    // Show summary list
    summaryList.classList.remove('hidden');
    document.getElementById('nyukoScannerArea').classList.add('hidden');
    
    // Update count
    itemCount.textContent = `(${nyukoInputProducts.length})`;
    
    // Clear and rebuild list
    itemsList.innerHTML = '';
    
    nyukoInputProducts.forEach((product, index) => {
        const row = createNyukoSummaryRow(product, index);
        itemsList.appendChild(row);
    });
}

// Create summary row element
function createNyukoSummaryRow(product, index) {
    const row = document.createElement('div');
    row.className = 'p-4 hover:bg-gray-50 transition-colors';
    
    const oldBoxes = product.inventoryExists ? Math.ceil(product.oldPhysicalQuantity / product.収容数) : 0;
    const newTotalPieces = product.oldPhysicalQuantity + product.inputQuantity;
    const newTotalBoxes = Math.ceil(newTotalPieces / product.収容数);
    
    row.innerHTML = `
        <div class="flex items-center justify-between">
            <div class="flex items-center space-x-4 flex-1">
                ${product.imageURL ? `
                    <img src="${product.imageURL}" alt="${product.品番}" class="w-16 h-16 object-contain rounded border border-gray-200">
                ` : `
                    <div class="w-16 h-16 bg-gray-100 rounded border border-gray-200 flex items-center justify-center">
                        <i class="fas fa-box text-gray-400"></i>
                    </div>
                `}
                <div class="flex-1">
                    <div class="flex items-center space-x-2">
                        <h4 class="font-bold text-gray-900">${product.品番}</h4>
                        ${!product.inventoryExists ? `
                            <span class="px-2 py-1 bg-purple-100 text-purple-700 text-xs font-bold rounded">NEW</span>
                        ` : ''}
                    </div>
                    <p class="text-sm text-gray-600">${product.品名 || '-'}</p>
                    <div class="flex items-center space-x-4 mt-2">
                        ${product.inventoryExists ? `
                            <span class="text-sm">
                                <span class="text-gray-600">${product.oldPhysicalQuantity}個 (${oldBoxes}箱)</span>
                            </span>
                            <i class="fas fa-arrow-right text-gray-400 text-xs"></i>
                        ` : ''}
                        <span class="text-sm">
                            <span class="text-purple-600 font-bold">${newTotalPieces}個 (${newTotalBoxes}箱)</span>
                        </span>
                        <span class="text-xs text-green-600 font-medium">
                            (+${product.inputQuantity}個)
                        </span>
                    </div>
                </div>
            </div>
            <div class="flex items-center space-x-2">
                <button onclick="editNyukoProduct(${index})" class="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors">
                    <i class="fas fa-edit mr-1"></i>編集
                </button>
                <button onclick="deleteNyukoProduct(${index})" class="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors">
                    <i class="fas fa-trash mr-1"></i>削除
                </button>
            </div>
        </div>
    `;
    
    return row;
}

// Edit input product
function editNyukoProduct(index) {
    const product = nyukoInputProducts[index];
    
    // Remove from list
    nyukoInputProducts.splice(index, 1);
    
    // Set as current product and reopen modal
    currentNyukoProduct = {
        品番: product.品番,
        品名: product.品名,
        背番号: product.背番号,
        収容数: product.収容数,
        imageURL: product.imageURL,
        inventoryExists: product.inventoryExists,
        currentPhysicalQuantity: product.oldPhysicalQuantity,
        currentReservedQuantity: product.oldReservedQuantity,
        countedBoxes: product.inputBoxes,
        countedPieces: product.inputQuantity
    };
    
    openNyukoInputModal();
    
    // Update summary list
    if (nyukoInputProducts.length === 0) {
        // Reset to scanner area if no more products
        document.getElementById('nyukoSummaryList').classList.add('hidden');
        document.getElementById('nyukoScannerArea').classList.remove('hidden');
    } else {
        updateNyukoSummaryList();
    }
}

// Delete input product
function deleteNyukoProduct(index) {
    const product = nyukoInputProducts[index];

    if (!confirm(t('delete-product-confirm').replace('{0}', product.品番))) {
        return;
    }

    nyukoInputProducts.splice(index, 1);

    if (nyukoInputProducts.length === 0) {
        // Reset to scanner area
        document.getElementById('nyukoSummaryList').classList.add('hidden');
        document.getElementById('nyukoScannerArea').classList.remove('hidden');
    } else {
        updateNyukoSummaryList();
    }

    showToast(t('deleted'), 'info');
}

// Submit all input products
async function submitNyukoInput() {
    if (nyukoInputProducts.length === 0) {
        showToast('❌ ' + t('no-input-products'), 'error');
        return;
    }

    if (!confirm(t('submit-nyuko-confirm').replace('{0}', nyukoInputProducts.length))) {
        return;
    }

    try {
        // Show loading toast
        showToast('📤 ' + t('submitting'), 'info');
        
        // Prepare data
        const submissionData = {
            inputProducts: nyukoInputProducts,
            submittedBy: currentWorker || 'Tablet User',
            factory: factory // Include factory location
        };
        
        console.log('📤 Submitting nyuko:', submissionData);
        console.log('🏭 Factory location:', factory);
        
        // Submit to API
        const response = await fetch(`${API_BASE_URL}/nyuko/submit`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(submissionData)
        });
        
        if (!response.ok) {
            throw new Error('Submission failed');
        }
        
        const result = await response.json();
        console.log('✅ Submission result:', result);

        showToast(`✅ ${result.processedCount}${t('products-received')}`, 'success');

        // Reset system
        setTimeout(() => {
            initializeNyuko();
        }, 2000);

    } catch (error) {
        console.error('Error submitting nyuko:', error);
        showToast('❌ ' + t('submit-failed'), 'error');
    }
}

// ==================== END NYUKO SYSTEM ====================
