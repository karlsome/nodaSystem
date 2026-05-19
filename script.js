// Noda System - Tablet UI for Inventory and Picking
// Global variables
let currentScreen = 'login';
let pickingRequests = [];
let currentRequest = null;
let currentRequestNumber = null;
let currentFilter = 'today';
let currentDateFilter = null; // Date filter for picking requests
let currentWorker = null;
let socket = null;
let recentActivities = []; // Initialize empty array for activities
let todaysTasks = []; // Initialize empty array for tasks
let factory = null; // Factory location from URL parameter
const masterDataCache = new Map();
let pickingDetailLoadToken = 0;
let currentPickingDetailView = 'cards';
let latestPickingLockStatus = {
    isLocked: false,
    activeRequestNumber: null,
    startedBy: null,
    startedAt: null
};
let allRequestsPagination = {
    currentPage: 1,
    pageSize: 10,
    totalItems: 0,
    totalPages: 0,
    hasPreviousPage: false,
    hasNextPage: false
};
let pausedReminderIntervalId = null;
const PAUSED_REQUEST_REMINDER_INTERVAL_MS = 30000;
const HELP_TOPICS = [
    {
        id: 'barcode-scanner-not-connecting',
        sourceLanguage: 'en',
        title: 'Barcode scanner not connecting to tablet',
        description: 'How to fix: scan this barcode using the barcode scanner.',
        imageUrl: 'https://firebasestorage.googleapis.com/v0/b/imagestorage-e7ed3.firebasestorage.app/o/helpFiles%2F%E9%87%8E%E7%94%B0%2FnodaScanner.jpg?alt=media&token=96dd037e-760f-48de-80b7-4f06249a80a6'
    }
];
const HELP_TRANSLATION_STORAGE_KEY = 'nodaSystem_helpTranslationCache_v1';
const HELP_TRANSLATION_TARGET_LANGUAGES = ['ja', 'en'];
const helpTranslationCache = new Map();
let activeHelpTopicId = null;
let helpListRenderToken = 0;
let helpDetailRenderToken = 0;
let isPausedReminderSuppressedForHelp = false;

// API base URL - change this to your server URL
//const API_BASE_URL = 'http://localhost:3001/api';
//const API_BASE_URL = 'http://192.168.0.186:3001/api';
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

    updateScanAssistShortcutButtons();

    // Extract factory from URL parameter
    extractFactoryFromURL();

    // Initialize language system
    if (typeof initializeLanguage === 'function') {
        initializeLanguage();
    }

    initializeHelpTranslationCache();

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

    startPausedRequestsReminderTimer();
}

function syncHelpModalBodyScroll() {
    const helpTopicsModal = document.getElementById('helpTopicsModal');
    const helpDetailModal = document.getElementById('helpDetailModal');
    const isHelpModalOpen = Boolean(helpTopicsModal && !helpTopicsModal.classList.contains('hidden')) ||
        Boolean(helpDetailModal && !helpDetailModal.classList.contains('hidden'));

    if (!isHelpModalOpen) {
        document.body.style.overflow = '';
    } else {
        document.body.style.overflow = 'hidden';
    }
}

function setPausedReminderSuppressedForHelp(isSuppressed) {
    isPausedReminderSuppressedForHelp = isSuppressed;

    if (isSuppressed) {
        closePausedRequestsReminderModal();
    }
}

function resumePausedReminderAfterHelpIfNeeded() {
    const helpTopicsModal = document.getElementById('helpTopicsModal');
    const helpDetailModal = document.getElementById('helpDetailModal');
    const isAnyHelpModalOpen = Boolean(helpTopicsModal && !helpTopicsModal.classList.contains('hidden')) ||
        Boolean(helpDetailModal && !helpDetailModal.classList.contains('hidden'));

    if (isAnyHelpModalOpen) {
        return;
    }

    setPausedReminderSuppressedForHelp(false);
    void maybeShowPausedRequestsReminder();
}

function getCurrentAppLanguage() {
    return window.currentLanguage || document.getElementById('languageSelect')?.value || 'ja';
}

function getHelpText(key) {
    const translate = window.t || ((translationKey) => translationKey);
    return translate(key);
}

function buildHelpTranslationCacheKey(text, fromLang, toLang) {
    return `${fromLang}|${toLang}|${text}`;
}

function getExpectedHelpTranslationCacheKeys() {
    const validKeys = new Set();

    HELP_TOPICS.forEach(topic => {
        const sourceLanguage = topic.sourceLanguage || 'en';

        HELP_TRANSLATION_TARGET_LANGUAGES.forEach(targetLanguage => {
            if (targetLanguage === sourceLanguage) {
                return;
            }

            validKeys.add(buildHelpTranslationCacheKey(topic.title, sourceLanguage, targetLanguage));
            validKeys.add(buildHelpTranslationCacheKey(topic.description, sourceLanguage, targetLanguage));
        });
    });

    return validKeys;
}

function persistHelpTranslationCache() {
    if (typeof(Storage) === 'undefined') {
        return;
    }

    try {
        const persistedTranslations = {};

        helpTranslationCache.forEach((value, key) => {
            if (typeof value === 'string') {
                persistedTranslations[key] = value;
            }
        });

        localStorage.setItem(HELP_TRANSLATION_STORAGE_KEY, JSON.stringify({
            translations: persistedTranslations
        }));
    } catch (error) {
        console.error('Error persisting help translation cache:', error);
    }
}

function pruneHelpTranslationCache() {
    const validKeys = getExpectedHelpTranslationCacheKeys();
    let cacheChanged = false;

    helpTranslationCache.forEach((value, key) => {
        if (typeof value !== 'string') {
            return;
        }

        if (!validKeys.has(key)) {
            helpTranslationCache.delete(key);
            cacheChanged = true;
        }
    });

    if (cacheChanged) {
        persistHelpTranslationCache();
    }
}

function initializeHelpTranslationCache() {
    if (typeof(Storage) === 'undefined') {
        return;
    }

    try {
        const rawCache = localStorage.getItem(HELP_TRANSLATION_STORAGE_KEY);
        if (!rawCache) {
            return;
        }

        const parsedCache = JSON.parse(rawCache);
        const translations = parsedCache?.translations;

        if (!translations || typeof translations !== 'object') {
            return;
        }

        Object.entries(translations).forEach(([key, value]) => {
            if (typeof value === 'string') {
                helpTranslationCache.set(key, value);
            }
        });

        pruneHelpTranslationCache();
    } catch (error) {
        console.error('Error loading help translation cache:', error);
    }
}

async function translateHelpText(text, fromLang, toLang) {
    if (!text || !fromLang || !toLang || fromLang === toLang) {
        return text;
    }

    const cacheKey = buildHelpTranslationCacheKey(text, fromLang, toLang);
    if (helpTranslationCache.has(cacheKey)) {
        return await helpTranslationCache.get(cacheKey);
    }

    const requestPromise = (async () => {
        try {
            const response = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${fromLang}|${toLang}`);
            if (!response.ok) {
                throw new Error(`Translation request failed with status ${response.status}`);
            }

            const result = await response.json();
            const translatedText = result?.responseData?.translatedText;
            if (!translatedText) {
                throw new Error('Translation response missing translated text');
            }

            helpTranslationCache.set(cacheKey, translatedText);
            persistHelpTranslationCache();
            return translatedText;
        } catch (error) {
            helpTranslationCache.delete(cacheKey);
            console.error('Error translating help text:', error);
            return text;
        }
    })();

    helpTranslationCache.set(cacheKey, requestPromise);
    return await requestPromise;
}

async function getLocalizedHelpTopic(topic, targetLanguage) {
    const sourceLanguage = topic.sourceLanguage || 'en';
    const [localizedTitle, localizedDescription] = await Promise.all([
        translateHelpText(topic.title, sourceLanguage, targetLanguage),
        translateHelpText(topic.description, sourceLanguage, targetLanguage)
    ]);

    return {
        ...topic,
        localizedTitle,
        localizedDescription
    };
}

function renderHelpTopicsLoading() {
    const listContainer = document.getElementById('helpTopicsList');
    if (!listContainer) {
        return;
    }

    listContainer.innerHTML = `
        <div class="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-5 text-center text-sm text-gray-600">
            ${getHelpText('loading')}
        </div>
    `;
}

async function renderHelpTopics() {
    const listContainer = document.getElementById('helpTopicsList');
    if (!listContainer) {
        return;
    }

    const renderToken = ++helpListRenderToken;
    renderHelpTopicsLoading();

    const currentLanguage = getCurrentAppLanguage();
    const localizedTopics = await Promise.all(HELP_TOPICS.map(topic => getLocalizedHelpTopic(topic, currentLanguage)));

    if (renderToken !== helpListRenderToken) {
        return;
    }

    listContainer.innerHTML = '';

    localizedTopics.forEach(topic => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'w-full rounded-2xl border border-blue-100 bg-blue-50 px-4 py-4 text-left transition-colors hover:border-blue-300 hover:bg-blue-100';
        button.onclick = () => openHelpDetail(topic.id);
        button.innerHTML = `
            <div class="flex items-start justify-between gap-4">
                <div>
                    <p class="text-sm font-semibold uppercase tracking-wide text-blue-600">${getHelpText('help-problem-label')}</p>
                    <h4 class="mt-1 text-lg font-semibold text-gray-900">${topic.localizedTitle}</h4>
                </div>
                <i class="fas fa-chevron-right pt-1 text-blue-500"></i>
            </div>
        `;

        listContainer.appendChild(button);
    });
}

function openHelpMenu() {
    const modal = document.getElementById('helpTopicsModal');
    if (!modal) {
        return;
    }

    activeHelpTopicId = null;
    setPausedReminderSuppressedForHelp(true);
    modal.classList.remove('hidden');
    syncHelpModalBodyScroll();
    void renderHelpTopics();
}

function closeHelpMenu(options = {}) {
    const { resumePausedReminder = true } = options;
    const modal = document.getElementById('helpTopicsModal');
    if (!modal) {
        return;
    }

    helpListRenderToken += 1;
    modal.classList.add('hidden');
    syncHelpModalBodyScroll();

    if (resumePausedReminder) {
        resumePausedReminderAfterHelpIfNeeded();
    }
}

function renderHelpDetailLoading(topic) {
    const titleElement = document.getElementById('helpDetailTitle');
    const descriptionElement = document.getElementById('helpDetailDescription');
    const imageElement = document.getElementById('helpDetailImage');

    if (!titleElement || !descriptionElement || !imageElement || !topic) {
        return;
    }

    titleElement.textContent = topic.title;
    descriptionElement.textContent = getHelpText('help-translating');
    imageElement.src = topic.imageUrl;
    imageElement.alt = topic.title;
}

async function renderHelpDetail(topicId) {
    const topic = HELP_TOPICS.find(item => item.id === topicId);
    const titleElement = document.getElementById('helpDetailTitle');
    const descriptionElement = document.getElementById('helpDetailDescription');
    const imageElement = document.getElementById('helpDetailImage');

    if (!topic || !titleElement || !descriptionElement || !imageElement) {
        return;
    }

    const renderToken = ++helpDetailRenderToken;
    const currentLanguage = getCurrentAppLanguage();
    activeHelpTopicId = topicId;

    renderHelpDetailLoading(topic);

    const localizedTopic = await getLocalizedHelpTopic(topic, currentLanguage);
    if (renderToken !== helpDetailRenderToken || activeHelpTopicId !== topicId) {
        return;
    }

    titleElement.textContent = localizedTopic.localizedTitle;
    descriptionElement.textContent = localizedTopic.localizedDescription;
    imageElement.alt = localizedTopic.localizedTitle;
}

function openHelpDetail(topicId) {
    const modal = document.getElementById('helpDetailModal');
    if (!modal) {
        return;
    }

    setPausedReminderSuppressedForHelp(true);
    closeHelpMenu({ resumePausedReminder: false });
    modal.classList.remove('hidden');
    syncHelpModalBodyScroll();
    void renderHelpDetail(topicId);
}

function closeHelpDetail() {
    const modal = document.getElementById('helpDetailModal');
    const imageElement = document.getElementById('helpDetailImage');
    if (!modal) {
        return;
    }

    activeHelpTopicId = null;
    helpDetailRenderToken += 1;
    modal.classList.add('hidden');

    if (imageElement) {
        imageElement.src = '';
        imageElement.alt = '';
    }

    syncHelpModalBodyScroll();
    resumePausedReminderAfterHelpIfNeeded();
}

function handleHelpLanguageChange() {
    const helpTopicsModal = document.getElementById('helpTopicsModal');
    const helpDetailModal = document.getElementById('helpDetailModal');

    if (helpTopicsModal && !helpTopicsModal.classList.contains('hidden')) {
        void renderHelpTopics();
    }

    if (helpDetailModal && !helpDetailModal.classList.contains('hidden') && activeHelpTopicId) {
        void renderHelpDetail(activeHelpTopicId);
    }
}

window.addEventListener('languagechange', handleHelpLanguageChange);

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
                // Store original OCR data for learning (deep copy)
                gentanItems[itemIndex].originalOcrData = JSON.parse(JSON.stringify(data.data));
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
    latestPickingLockStatus = lockStatus;

    const isLocked = lockStatus.isLocked;
    const activeRequestNumber = lockStatus.activeRequestNumber;
    const startedBy = lockStatus.startedBy;
    
    // Update all start buttons
    const startButtons = document.querySelectorAll('.start-picking-btn');
    startButtons.forEach(button => {
        if (button.id === 'startPickingBtn') {
            return;
        }

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
        closePausedRequestsReminderModal();
        showLockNotification(activeRequestNumber, startedBy);
    } else {
        hideLockNotification();
    }

    updatePickingDetailActionButtons();
}

function updatePickingDetailActionButtons(requestStatus = currentRequest?.status) {
    const startBtn = document.getElementById('startPickingBtn');
    const pauseBtn = document.getElementById('pausePickingBtn');
    const t = window.t || ((key) => key);

    if (!startBtn || !requestStatus) {
        return;
    }

    startBtn.classList.add('start-picking-btn');

    if (pauseBtn) {
        pauseBtn.className = 'hidden px-6 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors font-medium';
        pauseBtn.disabled = false;
        pauseBtn.onclick = pausePickingProcess;
    }

    if (requestStatus === 'pending' || requestStatus === 'partial-inventory' || requestStatus === 'waiting-for-inventory') {
        startBtn.disabled = false;
        startBtn.onclick = startPickingProcess;
        startBtn.innerHTML = `<i class="fas fa-play mr-2"></i>${t('start-button')}`;
        startBtn.className = 'px-6 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors font-medium';
    } else if (requestStatus === 'paused') {
        startBtn.disabled = false;
        startBtn.onclick = startPickingProcess;
        startBtn.innerHTML = `<i class="fas fa-play mr-2"></i>${t('resume-button')}`;
        startBtn.className = 'px-6 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors font-medium';
    } else if (requestStatus === 'in-progress') {
        startBtn.disabled = true;
        startBtn.onclick = null;
        startBtn.innerHTML = `<i class="fas fa-clock mr-2"></i>${t('in-progress-button')}`;
        startBtn.className = 'px-6 py-2 bg-slate-200 text-slate-700 rounded-lg cursor-not-allowed font-medium';
        if (pauseBtn) {
            pauseBtn.classList.remove('hidden');
        }
    } else if (requestStatus === 'completed') {
        startBtn.disabled = false;
        startBtn.onclick = completeAndBackToList;
        startBtn.innerHTML = `<i class="fas fa-check mr-2"></i>${t('completed-button')}`;
        startBtn.className = 'px-8 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors text-lg font-medium';
    } else {
        startBtn.disabled = true;
        startBtn.onclick = null;
        startBtn.innerHTML = `<i class="fas fa-ban mr-2"></i>${getStatusText(requestStatus)}`;
        startBtn.className = 'px-6 py-2 bg-gray-300 text-gray-700 rounded-lg cursor-not-allowed font-medium';
    }

    const isLockedByAnotherRequest = latestPickingLockStatus?.isLocked &&
        latestPickingLockStatus.activeRequestNumber &&
        currentRequestNumber &&
        latestPickingLockStatus.activeRequestNumber !== currentRequestNumber;
    const canStartWhenUnlocked = requestStatus === 'pending' ||
        requestStatus === 'partial-inventory' ||
        requestStatus === 'waiting-for-inventory' ||
        requestStatus === 'paused';

    if (isLockedByAnotherRequest && canStartWhenUnlocked) {
        startBtn.disabled = true;
        startBtn.onclick = null;
        startBtn.innerHTML = `<i class="fas fa-lock mr-2"></i>${t('other-order-processing')}`;
        startBtn.className = 'px-6 py-2 bg-slate-200 text-slate-700 rounded-lg cursor-not-allowed font-medium';
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
async function checkAndUpdateLockStatus(options = {}) {
    const { refreshDevices = true } = options;

    try {
        const response = await fetch(`${API_BASE_URL}/picking-lock-status`);
        if (response.ok) {
            const lockStatus = await response.json();
            updateLockUI(lockStatus);
            
            // 🚨 NEW: If there's an active request that's locked, trigger ESP32 refresh
            if (refreshDevices && lockStatus.isLocked && lockStatus.activeRequestNumber) {
                console.log(`🔄 Lock detected for ${lockStatus.activeRequestNumber}, triggering ESP32 refresh`);
                await refreshESP32Devices(lockStatus.activeRequestNumber);
            }

            return lockStatus;
        }
    } catch (error) {
        console.error('Error checking lock status:', error);
    }

    return latestPickingLockStatus;
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

    if (currentScreen !== 'home' && currentScreen !== 'picking' && currentScreen !== 'pickingDetail') {
        closePausedRequestsReminderModal();
    }
}

function startPausedRequestsReminderTimer() {
    if (pausedReminderIntervalId) {
        return;
    }

    pausedReminderIntervalId = setInterval(() => {
        maybeShowPausedRequestsReminder();
    }, PAUSED_REQUEST_REMINDER_INTERVAL_MS);
}

function hasBlockingModalOpen() {
    return Array.from(document.querySelectorAll('.fixed.inset-0')).some(modal => {
        if (modal.classList.contains('hidden')) {
            return false;
        }

        return modal.id !== 'toast' && modal.id !== 'pausedRequestsReminderModal';
    });
}

function isPausedReminderEligible() {
    if (!currentWorker) {
        return false;
    }

    if (isPausedReminderSuppressedForHelp) {
        return false;
    }

    if (document.hidden) {
        return false;
    }

    if (currentScreen !== 'home' && currentScreen !== 'picking' && currentScreen !== 'pickingDetail') {
        return false;
    }

    if (hasBlockingModalOpen()) {
        return false;
    }

    if (latestPickingLockStatus.isLocked) {
        return false;
    }

    if (currentScreen === 'pickingDetail' && currentRequest && currentRequest.status === 'in-progress') {
        return false;
    }

    return true;
}

async function fetchPausedRequestsForReminder() {
    const response = await fetch(`${API_BASE_URL}/request-numbers`);
    if (!response.ok) {
        throw new Error('Failed to fetch paused requests');
    }

    const requests = await response.json();
    let pausedRequests = requests.filter(request => request.status === 'paused');

    if (currentScreen === 'pickingDetail' && currentRequestNumber) {
        pausedRequests = pausedRequests.filter(request => request.requestNumber !== currentRequestNumber);
    }

    pausedRequests.sort((a, b) => {
        const dateA = new Date(a.createdAt || 0);
        const dateB = new Date(b.createdAt || 0);
        return dateA - dateB;
    });

    return pausedRequests;
}

function closePausedRequestsReminderModal() {
    const modal = document.getElementById('pausedRequestsReminderModal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

function openPausedReminderRequest(requestNumber) {
    closePausedRequestsReminderModal();
    viewPickingDetail(requestNumber);
}

function renderPausedRequestsReminder(pausedRequests) {
    const modal = document.getElementById('pausedRequestsReminderModal');
    const listContainer = document.getElementById('pausedRequestsReminderList');
    const t = window.t || ((key) => key);

    if (!modal || !listContainer) {
        return;
    }

    listContainer.innerHTML = '';

    pausedRequests.forEach(request => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'w-full text-left bg-white border border-orange-200 hover:border-orange-300 hover:bg-orange-50 rounded-xl px-4 py-4 transition-colors';
        button.onclick = () => openPausedReminderRequest(request.requestNumber);

        const createdAt = request.createdAt
            ? new Date(request.createdAt).toLocaleDateString('ja-JP')
            : '--';

        button.innerHTML = `
            <div class="flex items-start justify-between gap-4">
                <div>
                    <div class="flex items-center gap-3 flex-wrap">
                        <h4 class="text-lg font-bold text-gray-900">${request.requestNumber}</h4>
                        <span class="status-badge status-paused">${t('status-paused')}</span>
                    </div>
                    <p class="text-sm text-gray-600 mt-1">${request.itemCount}項目 • 合計数量: ${request.totalQuantity}</p>
                    <p class="text-xs text-gray-500 mt-2">作成日: ${createdAt}</p>
                </div>
                <div class="text-orange-500 text-xl pt-1">
                    <i class="fas fa-chevron-right"></i>
                </div>
            </div>
        `;

        listContainer.appendChild(button);
    });

    modal.classList.remove('hidden');
}

async function maybeShowPausedRequestsReminder() {
    try {
        if (!isPausedReminderEligible()) {
            closePausedRequestsReminderModal();
            return;
        }

        const lockStatus = await checkAndUpdateLockStatus({ refreshDevices: false });
        if (lockStatus && lockStatus.isLocked) {
            closePausedRequestsReminderModal();
            return;
        }

        const pausedRequests = await fetchPausedRequestsForReminder();
        if (pausedRequests.length === 0) {
            closePausedRequestsReminderModal();
            return;
        }

        renderPausedRequestsReminder(pausedRequests);
    } catch (error) {
        console.error('Error showing paused requests reminder:', error);
    }
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

    currentFilter = 'today';
    updatePickingFilterButtons();
    
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
let currentOcrSuggestions = {}; // Store suggestions for current item

// Image preview modal functions with edit form
async function openImagePreview(imageSrc, itemIndex) {
    const modal = document.getElementById('imagePreviewModal');
    const img = document.getElementById('imagePreviewImg');
    
    img.src = imageSrc;
    currentEditingIndex = itemIndex;
    currentOcrSuggestions = {};
    
    // Clear any previous suggestions
    clearAllSuggestions();
    
    // Populate form with current data
    if (itemIndex >= 0 && gentanItems[itemIndex]) {
        const item = gentanItems[itemIndex];
        document.getElementById('modalEdit_品番').value = item.data.品番 || '';
        document.getElementById('modalEdit_品名').value = item.data.品名 || '';
        document.getElementById('modalEdit_納入数').value = item.data.納入数 || '';
        document.getElementById('modalEdit_納入日').value = item.data.納入日 || '';
        document.getElementById('modalEdit_色番').value = item.data.色番 || '';
        
        // Fetch OCR suggestions if this is an image type
        if (item.type === 'image' && item.originalOcrData) {
            await fetchOcrSuggestions(item.originalOcrData);
        }
    }
    
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden'; // Prevent background scroll
}

// Fetch OCR suggestions from server
async function fetchOcrSuggestions(ocrValues) {
    try {
        const response = await fetch(`${API_BASE_URL}/ocr-learning/suggest`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ocrValues })
        });
        
        if (response.ok) {
            const result = await response.json();
            currentOcrSuggestions = result.suggestions || {};
            
            // Display suggestions for each field
            for (const [field, suggestion] of Object.entries(currentOcrSuggestions)) {
                showFieldSuggestion(field, suggestion);
            }
        }
    } catch (error) {
        console.error('Error fetching OCR suggestions:', error);
    }
}

// Show suggestion for a specific field
function showFieldSuggestion(field, suggestion) {
    const inputId = `modalEdit_${field}`;
    const input = document.getElementById(inputId);
    if (!input) return;
    
    // Remove existing suggestion if any
    const existingSuggestion = input.parentElement.querySelector('.ocr-suggestion');
    if (existingSuggestion) existingSuggestion.remove();
    
    // Determine match type styling
    const isExact = suggestion.matchType === 'exact';
    const matchLabel = isExact ? '完全一致' : `類似 ${suggestion.similarity}%`;
    const matchColor = isExact ? 'text-green-600' : 'text-orange-500';
    const bgColor = isExact ? 'bg-green-50 border-green-300' : 'bg-yellow-50 border-yellow-300';
    const iconColor = isExact ? 'text-green-500' : 'text-yellow-500';
    
    // Create suggestion element
    const suggestionDiv = document.createElement('div');
    suggestionDiv.className = `ocr-suggestion flex items-center gap-2 mt-1 p-2 ${bgColor} rounded-lg text-sm`;
    suggestionDiv.innerHTML = `
        <i class="fas fa-lightbulb ${iconColor}"></i>
        <span class="text-gray-700">提案: <strong class="text-blue-600">${suggestion.suggested}</strong></span>
        <span class="${matchColor} text-xs">(${matchLabel})</span>
        <button onclick="applySuggestion('${field}', '${suggestion.suggested.replace(/'/g, "\\'")}')" 
                class="ml-auto px-2 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600 transition-colors">
            適用
        </button>
    `;
    
    input.parentElement.appendChild(suggestionDiv);
}

// Apply a suggestion to a field
function applySuggestion(field, value) {
    const inputId = `modalEdit_${field}`;
    const input = document.getElementById(inputId);
    if (input) {
        input.value = value;
        // Remove the suggestion after applying
        const suggestionDiv = input.parentElement.querySelector('.ocr-suggestion');
        if (suggestionDiv) suggestionDiv.remove();
        showToast(`${field}に提案を適用しました`, 'success');
    }
}

// Clear all suggestions
function clearAllSuggestions() {
    document.querySelectorAll('.ocr-suggestion').forEach(el => el.remove());
}

function closeImagePreview() {
    const modal = document.getElementById('imagePreviewModal');
    modal.classList.add('hidden');
    document.body.style.overflow = ''; // Restore scroll
    currentEditingIndex = -1;
    currentOcrSuggestions = {};
    clearAllSuggestions();
}

// Save data from modal edit form and learn from corrections
async function saveModalEditData() {
    if (currentEditingIndex >= 0 && gentanItems[currentEditingIndex]) {
        const item = gentanItems[currentEditingIndex];
        const newValues = {
            品番: document.getElementById('modalEdit_品番').value,
            品名: document.getElementById('modalEdit_品名').value,
            納入数: document.getElementById('modalEdit_納入数').value,
            納入日: document.getElementById('modalEdit_納入日').value,
            色番: document.getElementById('modalEdit_色番').value
        };
        
        // Check for corrections to learn (only for image types with original OCR data)
        if (item.type === 'image' && item.originalOcrData) {
            const corrections = [];
            for (const field of ['品番', '品名', '納入数', '納入日', '色番']) {
                const ocrValue = item.originalOcrData[field];
                const correctedValue = newValues[field];
                
                // Only learn if OCR value exists and user changed it
                if (ocrValue && correctedValue && ocrValue !== correctedValue) {
                    corrections.push({
                        field: field,
                        ocrValue: ocrValue,
                        correctedValue: correctedValue
                    });
                }
            }
            
            // Send corrections to server for learning
            if (corrections.length > 0) {
                try {
                    await fetch(`${API_BASE_URL}/ocr-learning/learn`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            corrections: corrections,
                            learnedBy: currentWorker || 'Unknown'
                        })
                    });
                    console.log(`🧠 Learned ${corrections.length} correction(s)`);
                } catch (error) {
                    console.error('Error sending corrections for learning:', error);
                }
            }
        }
        
        // Update the item data
        gentanItems[currentEditingIndex].data = { ...gentanItems[currentEditingIndex].data, ...newValues };
        
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

// Compress base64 image for Firebase upload (target: 400-700KB)
function compressBase64Image(base64String, maxWidth = 1024, quality = 0.7) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        
        // Handle both with and without data URI prefix
        const src = base64String.startsWith('data:') ? base64String : `data:image/jpeg;base64,${base64String}`;
        img.src = src;
        
        img.onload = () => {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;
            
            // Resize if wider than maxWidth
            if (width > maxWidth) {
                height = (height * maxWidth) / width;
                width = maxWidth;
            }
            
            // Also check height
            if (height > maxWidth) {
                width = (width * maxWidth) / height;
                height = maxWidth;
            }
            
            canvas.width = width;
            canvas.height = height;
            
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            
            // Convert to base64 with compression
            const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
            resolve(compressedBase64);
        };
        
        img.onerror = () => {
            console.error('Failed to load image for compression');
            resolve(base64String); // Return original if compression fails
        };
    });
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
        
        // Prepare data for MongoDB (include compressed imageSource for image types)
        const documentsToSubmit = await Promise.all(gentanItems.map(async (item) => {
            const doc = {
                ...item.data,
                submittedBy: currentWorker,
                submittedAt: new Date().toISOString(),
                sourceType: item.type
            };
            
            // Compress and include base64 image for Firebase upload (target: 150-250KB)
            if (item.type === 'image' && item.source) {
                console.log('📸 Compressing image for Firebase upload...');
                const compressedImage = await compressBase64Image(item.source, 800, 0.6);
                doc.imageSource = compressedImage;
                
                // Log size reduction
                const originalSize = (item.source.length * 0.75 / 1024).toFixed(0);
                const compressedSize = (compressedImage.length * 0.75 / 1024).toFixed(0);
                console.log(`📉 Image compressed: ${originalSize}KB → ${compressedSize}KB`);
            }
            
            return doc;
        }));
        
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

        const requestUrl = new URL(`${API_BASE_URL}/request-numbers`);
        if (currentFilter === 'all') {
            requestUrl.searchParams.set('paginate', 'true');
            requestUrl.searchParams.set('page', String(allRequestsPagination.currentPage));
            requestUrl.searchParams.set('limit', String(allRequestsPagination.pageSize));
        }

        const response = await fetch(requestUrl.toString());
        if (!response.ok) {
            throw new Error('Failed to fetch picking requests');
        }

        const responseData = await response.json();
        if (currentFilter === 'all') {
            pickingRequests = Array.isArray(responseData.requests) ? responseData.requests : [];
            allRequestsPagination = {
                ...allRequestsPagination,
                ...(responseData.pagination || {})
            };
        } else {
            pickingRequests = Array.isArray(responseData) ? responseData : [];
        }

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

    updatePickingFilterButtons();
    updatePickingPaginationControls();
    
    if (!pickingRequests || pickingRequests.length === 0) {
        displayNoRequests();
        return;
    }
    
    // Filter requests based on current filter (status-based only)
    let filteredRequests = pickingRequests;
    
    // Apply status filter
    if (currentFilter === 'today') {
        filteredRequests = filteredRequests.filter(isWithinTodayPickingWindow);
    } else if (currentFilter !== 'all') {
        filteredRequests = filteredRequests.filter(req => req.status === currentFilter);
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

    updatePickingPaginationControls(filteredRequests.length);
}

function updatePickingFilterButtons() {
    document.querySelectorAll('.status-filter').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filterStatus === currentFilter);
    });
}

function updatePickingPaginationControls(currentItemCount = pickingRequests.length) {
    const controls = document.getElementById('pickingPaginationControls');
    const pageSizeSelect = document.getElementById('pickingPageSizeSelect');
    const summary = document.getElementById('pickingPaginationSummary');
    const pageInfo = document.getElementById('pickingPaginationPageInfo');
    const prevBtn = document.getElementById('pickingPrevPageBtn');
    const nextBtn = document.getElementById('pickingNextPageBtn');

    if (!controls || !pageSizeSelect || !summary || !pageInfo || !prevBtn || !nextBtn) {
        return;
    }

    if (currentFilter !== 'all') {
        controls.classList.add('hidden');
        return;
    }

    controls.classList.remove('hidden');
    pageSizeSelect.value = String(allRequestsPagination.pageSize);

    const totalItems = allRequestsPagination.totalItems || 0;
    const totalPages = allRequestsPagination.totalPages || 0;
    const currentPage = allRequestsPagination.currentPage || 1;

    if (totalItems === 0 || currentItemCount === 0) {
        summary.textContent = '0 / 0';
    } else {
        const startItem = (currentPage - 1) * allRequestsPagination.pageSize + 1;
        const endItem = startItem + currentItemCount - 1;
        summary.textContent = `${startItem}-${endItem} / ${totalItems}`;
    }

    pageInfo.textContent = `${currentPage} / ${Math.max(totalPages, 1)}`;
    setPickingPaginationButtonState(prevBtn, !!allRequestsPagination.hasPreviousPage);
    setPickingPaginationButtonState(nextBtn, !!allRequestsPagination.hasNextPage);
}

function setPickingPaginationButtonState(button, isEnabled) {
    if (!button) {
        return;
    }

    button.disabled = !isEnabled;
    button.classList.toggle('opacity-50', !isEnabled);
    button.classList.toggle('cursor-not-allowed', !isEnabled);
}

async function changePickingPage(direction) {
    if (currentFilter !== 'all') {
        return;
    }

    const nextPage = allRequestsPagination.currentPage + Number(direction);
    if (nextPage < 1 || (allRequestsPagination.totalPages > 0 && nextPage > allRequestsPagination.totalPages)) {
        return;
    }

    allRequestsPagination.currentPage = nextPage;
    await loadPickingRequests();
}

async function changePickingPageSize(nextPageSize) {
    const parsedPageSize = Number.parseInt(nextPageSize, 10);
    if (![10, 50, 100].includes(parsedPageSize)) {
        return;
    }

    allRequestsPagination.pageSize = parsedPageSize;
    allRequestsPagination.currentPage = 1;
    await loadPickingRequests();
}

function getRequestDateFromRequestNumber(requestNumber) {
    const requestParts = String(requestNumber || '').split('-');
    const datePart = requestParts[1] || '';

    if (!/^\d{8}$/.test(datePart)) {
        return null;
    }

    const year = Number(datePart.slice(0, 4));
    const monthIndex = Number(datePart.slice(4, 6)) - 1;
    const day = Number(datePart.slice(6, 8));
    const parsedDate = new Date(year, monthIndex, day);

    if (
        parsedDate.getFullYear() !== year ||
        parsedDate.getMonth() !== monthIndex ||
        parsedDate.getDate() !== day
    ) {
        return null;
    }

    parsedDate.setHours(0, 0, 0, 0);
    return parsedDate;
}

function isWithinTodayPickingWindow(request) {
    const requestDate = getRequestDateFromRequestNumber(request?.requestNumber);
    if (!requestDate) {
        return false;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const rangeStart = new Date(today);
    rangeStart.setDate(rangeStart.getDate() - 5);

    return requestDate >= rangeStart;
}

function createPickingRequestCard(request) {
    const card = document.createElement('div');
    card.className = 'picking-request-card';
    card.onclick = () => viewPickingDetail(request.requestNumber);
    
    const statusClass = getStatusClass(request.status);
    const statusText = getStatusText(request.status);
    const formattedDate = new Date(request.createdAt).toLocaleDateString('ja-JP');
    
    card.innerHTML = `
        <div class="flex items-center justify-between">
            <div class="flex items-center space-x-4">
                <div class="w-16 h-16 bg-green-100 rounded-xl flex items-center justify-center">
                    <i class="fas fa-hand-paper text-green-600 text-2xl"></i>
                </div>
                <div>
                    <h3 class="text-xl font-bold text-gray-900">${request.requestNumber}</h3>
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
        currentPickingDetailView = 'cards';
        const loadToken = ++pickingDetailLoadToken;
        
        // Show loading state immediately to prevent stale data display
        showPickingDetailLoadingState(requestNumber);
        showScreen('pickingDetail');

        const request = await fetchBasePickingDetail(requestNumber);
        if (loadToken !== pickingDetailLoadToken) {
            return;
        }

        currentRequest = request;
        await displayPickingDetail(createPendingPickingDetail(request), {
            livePending: true,
            skipMasterData: true
        });

        await checkAndUpdateLockStatus();
        hydratePickingDetail(requestNumber, loadToken);
        
    } catch (error) {
        console.error('Error loading picking request details:', error);
        showToast('ピッキング詳細の読み込みに失敗しました', 'error');
        hidePickingDetailLoadingState();
    }
}

async function displayPickingDetail(request, options = {}) {
    const { livePending = false, skipMasterData = false } = options;

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

    const renderRequest = {
        ...request,
        lineItems: request.lineItems.map(item => ({
            ...item,
            isLivePending: livePending
        }))
    };
    
    // Enrich line items with master data and box quantities
    if (!skipMasterData) {
        await enrichLineItemsWithMasterData(renderRequest.lineItems);
        console.log('📊 Live request detail loaded:', renderRequest.lineItems);
    }
    
    // Hide loading state and show actual content
    hidePickingDetailLoadingState();
    
    // Update header
    document.getElementById('pickingDetailTitle').textContent = `${t('picking-detail')}: ${renderRequest.requestNumber}`;
    document.getElementById('pickingDetailSubtitle').textContent = livePending
        ? `${renderRequest.lineItems.length}${t('items-suffix')}${t('items-picking')} ・ 最新在庫を確認中...`
        : `${renderRequest.lineItems.length}${t('items-suffix')}${t('items-picking')}`;
    
    // Update request info
    const infoContainer = document.getElementById('pickingRequestInfo');
    const completedItems = renderRequest.lineItems.filter(item => item.status === 'completed').length;
    const isInventoryWaitingStatus = renderRequest.status === 'partial-inventory' || renderRequest.status === 'waiting-for-inventory';
    
    // Check if this is a partial-inventory request - ONLY count items that are NOT completed
    const insufficientItems = renderRequest.lineItems.filter(item => 
        item.status !== 'completed' && isItemInventoryShort(item)
    );
    
    // Add warning banner for partial-inventory status - ONLY if request is not completed
    let warningBanner = '';
    if (livePending) {
        warningBanner = `
            <div class="col-span-4 mb-4 bg-blue-50 border-l-4 border-blue-500 p-4 rounded-lg">
                <div class="flex items-center space-x-3">
                    <i class="fas fa-spinner fa-spin text-blue-600 text-2xl"></i>
                    <div>
                        <h4 class="text-lg font-bold text-blue-800">最新在庫を確認中</h4>
                        <p class="text-sm text-blue-700">依頼内容を表示しています。箱数と在庫不足はまもなく更新されます。</p>
                    </div>
                </div>
            </div>
        `;
    } else if (renderRequest.status !== 'completed' && (isInventoryWaitingStatus || renderRequest.status === 'paused') && insufficientItems.length > 0) {
        warningBanner = `
            <div class="col-span-4 mb-4 bg-red-50 border-l-4 border-red-500 p-4 rounded-lg">
                <div class="flex items-center space-x-3">
                    <i class="fas fa-exclamation-triangle text-red-600 text-2xl"></i>
                    <div>
                        <h4 class="text-lg font-bold text-red-800">在庫不足の警告</h4>
                        <p class="text-sm text-red-700">${insufficientItems.length}個の品番で在庫が不足しています。在庫補充が必要です。</p>
                    </div>
                </div>
            </div>
        `;
    }
    
    infoContainer.innerHTML = `
        ${warningBanner}
        <div class="text-center">
            <p class="text-sm text-gray-500">依頼番号</p>
            <p class="text-lg font-semibold text-gray-900">${renderRequest.requestNumber}</p>
        </div>
        <div class="text-center">
            <p class="text-sm text-gray-500">ステータス</p>
            <span id="requestStatusBadge" class="status-badge ${getStatusClass(renderRequest.status)}">
                ${getStatusText(renderRequest.status)}
            </span>
        </div>
        <div class="text-center">
            <p class="text-sm text-gray-500">進捗</p>
            <p class="text-lg font-semibold text-gray-900 request-progress">${completedItems}/${renderRequest.lineItems.length}</p>
        </div>
        <div class="text-center">
            <p class="text-sm text-gray-500">作成者</p>
            <p class="text-lg font-semibold text-gray-900">${renderRequest.createdBy}</p>
        </div>
    `;
    
    // Update items list
    renderPickingItemsViews(renderRequest.lineItems);
    
    updatePickingDetailActionButtons(renderRequest.status);
}

// Enrich line items with master data to calculate box quantities
async function enrichLineItemsWithMasterData(lineItems) {
    try {
        const uniquePartNumbers = [...new Set(lineItems.map(item => item.品番).filter(Boolean))];
        const masterEntries = await Promise.all(uniquePartNumbers.map(async partNumber => {
            const masterData = await fetchMasterData(partNumber);
            return [partNumber, masterData];
        }));
        const masterDataMap = new Map(masterEntries);

        for (const item of lineItems) {
            const masterData = masterDataMap.get(item.品番);

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
    if (!品番) {
        return null;
    }

    if (masterDataCache.has(品番)) {
        return masterDataCache.get(品番);
    }

    const requestPromise = (async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/master-data/${encodeURIComponent(品番)}`);
            if (response.ok) {
                const data = await response.json();
                return data;
            }
            return null;
        } catch (error) {
            console.error(`Error fetching master data for ${品番}:`, error);
            masterDataCache.delete(品番);
            return null;
        }
    })();

    masterDataCache.set(品番, requestPromise);

    try {
        return await requestPromise;
    } catch (error) {
        console.error(`Error resolving master data for ${品番}:`, error);
        masterDataCache.delete(品番);
        return null;
    }
}

async function fetchBasePickingDetail(requestNumber) {
    const timestamp = Date.now();
    const response = await fetch(`${API_BASE_URL}/picking-requests/${requestNumber}?_=${timestamp}`);
    if (!response.ok) {
        throw new Error('Failed to fetch base picking request details');
    }

    return await response.json();
}

async function fetchLivePickingDetail(requestNumber) {
    const timestamp = Date.now();
    const response = await fetch(`${API_BASE_URL}/picking-requests/group/${requestNumber}?_=${timestamp}`);
    if (!response.ok) {
        throw new Error(`Failed to fetch live picking request details: ${response.status}`);
    }

    return await response.json();
}

function createPendingPickingDetail(request) {
    return {
        ...request,
        lineItems: Array.isArray(request.lineItems)
            ? request.lineItems.map(item => ({
                ...item,
                isLivePending: true
            }))
            : []
    };
}

async function hydratePickingDetail(requestNumber, loadToken, options = {}) {
    const { refreshDevices = false, showFailureToast = true } = options;

    try {
        const liveRequest = await fetchLivePickingDetail(requestNumber);
        if (loadToken !== pickingDetailLoadToken || currentRequestNumber !== requestNumber) {
            return;
        }

        currentRequest = liveRequest;
        await displayPickingDetail(liveRequest, {
            livePending: false,
            skipMasterData: false
        });

        await checkAndUpdateLockStatus();

        if (refreshDevices) {
            await refreshESP32Devices(requestNumber);
        }
    } catch (error) {
        if (loadToken !== pickingDetailLoadToken || currentRequestNumber !== requestNumber) {
            return;
        }

        console.error('Error hydrating picking request details:', error);
        if (showFailureToast) {
            showToast('最新在庫の読み込みに失敗しました。依頼内容のみ表示しています', 'error');
        }
    }
}

function getDisplayInventoryStatus(item) {
    if (item.isLivePending) {
        return 'checking';
    }

    return item.liveInventoryStatus || item.inventoryStatus || 'sufficient';
}

function getDisplayShortfallQuantity(item) {
    if (item.isLivePending) {
        return 0;
    }

    if (typeof item.liveShortfallQuantity === 'number') {
        return item.liveShortfallQuantity;
    }

    if (typeof item.shortfallQuantity === 'number') {
        return item.shortfallQuantity;
    }

    return 0;
}

function getDisplayShortfallLabel(item) {
    const shortfallQuantity = Math.max(0, getDisplayShortfallQuantity(item));
    const boxCapacity = Number(item.収容数) || 0;

    if (boxCapacity > 1 && shortfallQuantity > 0) {
        const shortfallBoxes = Math.ceil(shortfallQuantity / boxCapacity);
        return `${shortfallQuantity}個 (${shortfallBoxes}箱)`;
    }

    return `${shortfallQuantity}個`;
}

function isItemInventoryShort(item) {
    if (item.isLivePending) {
        return false;
    }

    const inventoryStatus = getDisplayInventoryStatus(item);
    const shortfallQuantity = getDisplayShortfallQuantity(item);

    return inventoryStatus === 'none' || shortfallQuantity > 0;
}

function switchPickingDetailView(view) {
    currentPickingDetailView = view === 'table' ? 'table' : 'cards';
    updatePickingDetailViewTabs();
    updatePickingDetailViewContainers();
}

function updatePickingDetailViewTabs() {
    const cardTab = document.getElementById('pickingCardViewTab');
    const tableTab = document.getElementById('pickingTableViewTab');

    if (!cardTab || !tableTab) {
        return;
    }

    cardTab.classList.toggle('active', currentPickingDetailView === 'cards');
    cardTab.classList.toggle('text-gray-700', currentPickingDetailView === 'cards');
    cardTab.classList.toggle('text-gray-500', currentPickingDetailView !== 'cards');

    tableTab.classList.toggle('active', currentPickingDetailView === 'table');
    tableTab.classList.toggle('text-gray-700', currentPickingDetailView === 'table');
    tableTab.classList.toggle('text-gray-500', currentPickingDetailView !== 'table');
}

function updatePickingDetailViewContainers() {
    const cardContainer = document.getElementById('pickingItemsCardView');
    const tableContainer = document.getElementById('pickingItemsTableView');

    if (!cardContainer || !tableContainer) {
        return;
    }

    cardContainer.classList.toggle('hidden', currentPickingDetailView !== 'cards');
    tableContainer.classList.toggle('hidden', currentPickingDetailView !== 'table');
}

function renderPickingItemsViews(lineItems) {
    const cardContainer = document.getElementById('pickingItemsCardView');
    const tableContainer = document.getElementById('pickingItemsTableView');

    if (!cardContainer || !tableContainer) {
        return;
    }

    cardContainer.innerHTML = '';
    lineItems.forEach((item, index) => {
        const itemElement = createPickingItemElement(item, index + 1);
        cardContainer.appendChild(itemElement);
    });

    tableContainer.innerHTML = createPickingItemsTable(lineItems);
    updatePickingDetailViewTabs();
    updatePickingDetailViewContainers();
}

function getPickingItemStatusLabel(item) {
    if (item.status === 'completed') {
        return '完了';
    }

    if (item.status === 'paused') {
        return '一時停止';
    }

    if (item.status === 'in-progress') {
        return '進行中';
    }

    return '待機中';
}

function getPickingItemStatusBadgeClass(item) {
    if (item.status === 'completed') {
        return 'bg-green-100 text-green-800';
    }

    if (item.status === 'paused') {
        return 'bg-orange-100 text-orange-800';
    }

    if (item.status === 'in-progress') {
        return 'bg-yellow-100 text-yellow-800';
    }

    return 'bg-gray-100 text-gray-700';
}

function getPickingTableRowTone(item) {
    if (item.isLivePending) {
        return 'bg-blue-50';
    }

    if (item.status === 'completed') {
        return 'bg-green-50';
    }

    if (item.status === 'paused') {
        return 'bg-orange-50';
    }

    if (isItemInventoryShort(item)) {
        return 'bg-red-50';
    }

    if (item.status === 'in-progress') {
        return 'bg-yellow-50';
    }

    return 'bg-white';
}

function getPickingTableNote(item) {
    if (item.isLivePending) {
        return '最新在庫と箱数を確認中';
    }

    if (item.status === 'completed') {
        return item.completedAt
            ? `完了 ${new Date(item.completedAt).toLocaleString('ja-JP')}`
            : '完了済み';
    }

    if (item.status === 'paused') {
        if (item.pickedQuantity !== undefined && item.pickedQuantity > 0) {
            return `一時停止中 ${item.pickedQuantity}枚取得済み / 残り ${item.remainingQuantity || 0}枚`;
        }

        return '一時停止中';
    }

    if (item.status === 'in-progress' && item.pickedQuantity !== undefined && item.pickedQuantity > 0) {
        return `取得済み ${item.pickedQuantity}枚 / 残り ${item.remainingQuantity || 0}枚`;
    }

    if (isItemInventoryShort(item)) {
        return `不足 ${getDisplayShortfallLabel(item)}`;
    }

    return '準備完了';
}

function createPickingItemsTable(lineItems) {
    const rowsHtml = lineItems.map((item, index) => {
        const rowTone = getPickingTableRowTone(item);
        const cellClass = `${rowTone} border-b border-gray-100 px-4 py-3 align-top text-sm text-gray-700`;
        const stickyCellClass = `sticky left-0 z-10 ${rowTone} border-b border-gray-100 px-4 py-3 align-top text-sm font-semibold text-gray-900`;
        const boxCount = item.isLivePending
            ? '--'
            : (item.boxQuantity !== undefined ? item.boxQuantity : item.quantity);
        const physicalQuantity = item.isLivePending
            ? '--'
            : (typeof item.currentPhysicalQuantity === 'number' ? item.currentPhysicalQuantity : '--');
        const availableQuantity = item.isLivePending
            ? '--'
            : (typeof item.currentAvailableQuantity === 'number' ? item.currentAvailableQuantity : '--');
        const shortfallQuantity = item.isLivePending ? '--' : Math.max(0, getDisplayShortfallQuantity(item));
        const statusLabel = getPickingItemStatusLabel(item);
        const statusBadgeClass = getPickingItemStatusBadgeClass(item);
        const note = getPickingTableNote(item);

        return `
            <tr class="${rowTone}">
                <td class="${stickyCellClass}">
                    <div class="flex items-center justify-center h-10 w-10 rounded-xl bg-blue-100 text-lg font-bold text-blue-600 mx-auto">
                        ${index + 1}
                    </div>
                </td>
                <td class="${cellClass}">
                    <div class="font-semibold text-gray-900">${item.品番}</div>
                </td>
                <td class="${cellClass}">
                    <div class="font-medium text-gray-900">${item.背番号}</div>
                </td>
                <td class="${cellClass} text-right font-semibold text-gray-900">${item.quantity}</td>
                <td class="${cellClass} text-right font-semibold text-gray-900">${boxCount}</td>
                <td class="${cellClass} text-right">${physicalQuantity}</td>
                <td class="${cellClass} text-right">${availableQuantity}</td>
                <td class="${cellClass} text-right font-semibold ${item.isLivePending ? 'text-blue-600' : shortfallQuantity === 0 ? 'text-green-600' : 'text-red-600'}">${shortfallQuantity}</td>
                <td class="${cellClass}">
                    <span class="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${statusBadgeClass}">${statusLabel}</span>
                </td>
                <td class="${cellClass}">
                    <div class="min-w-[180px] whitespace-normal text-sm ${item.isLivePending ? 'text-blue-700' : 'text-gray-600'}">${note}</div>
                </td>
            </tr>
        `;
    }).join('');

    return `
        <div class="picking-table-scroll">
            <table class="w-full picking-detail-table">
                <thead>
                    <tr class="bg-slate-50 text-left text-sm font-semibold text-gray-700 shadow-sm">
                        <th class="sticky left-0 z-30 bg-slate-50 border-b border-gray-200 px-4 py-3 text-center">行</th>
                        <th class="bg-slate-50 border-b border-gray-200 px-4 py-3">品番</th>
                        <th class="bg-slate-50 border-b border-gray-200 px-4 py-3">背番号</th>
                        <th class="bg-slate-50 border-b border-gray-200 px-4 py-3 text-right">数量(PCS)</th>
                        <th class="bg-slate-50 border-b border-gray-200 px-4 py-3 text-right">箱数</th>
                        <th class="bg-slate-50 border-b border-gray-200 px-4 py-3 text-right">物理在庫</th>
                        <th class="bg-slate-50 border-b border-gray-200 px-4 py-3 text-right">利用可能在庫</th>
                        <th class="bg-slate-50 border-b border-gray-200 px-4 py-3 text-right">不足</th>
                        <th class="bg-slate-50 border-b border-gray-200 px-4 py-3">ステータス</th>
                        <th class="bg-slate-50 border-b border-gray-200 px-4 py-3">メモ</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                </tbody>
            </table>
        </div>
    `;
}

function createPickingItemElement(item, index) {
    const itemDiv = document.createElement('div');
    const isLivePending = !!item.isLivePending;
    
    // Check if item has insufficient inventory - BUT NOT if already completed
    const hasInsufficientInventory = !isLivePending && item.status !== 'completed' && isItemInventoryShort(item);
    
    // Apply red background for items with insufficient inventory (only if not completed)
    itemDiv.className = hasInsufficientInventory 
        ? 'picking-item border-2 border-red-500 rounded-lg p-4 mb-3 bg-red-50' 
        : 'picking-item border rounded-lg p-4 mb-3';
    
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
    } else if (item.status === 'paused') {
        statusIcon = '<i class="fas fa-pause-circle text-orange-500"></i>';
        statusText = '一時停止';
        statusClass = 'text-orange-600';
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
    const displayQuantity = isLivePending ? null : (item.boxQuantity !== undefined ? item.boxQuantity : item.quantity);
    const quantityUnit = isLivePending ? '確認中' : '個';
    const quantityDetail = !isLivePending && item.boxQuantity !== undefined && item.収容数 > 1 
        ? `<span class="text-xs text-gray-500">(${item.quantity}個 ÷ ${item.収容数})</span>` 
        : '';
    const quantitySummary = isLivePending
        ? `数量: ${item.quantity}個`
        : `数量: ${displayQuantity}${quantityUnit} ${quantityDetail}`;
    
    // ===== NEW: Show picking progress =====
    let pickingProgressHTML = '';
    if ((item.status === 'in-progress' || item.status === 'paused') && item.pickedQuantity !== undefined && item.pickedQuantity > 0) {
        const pickedBoxes = item.pickedBoxes || (item.収容数 > 1 ? Math.floor(item.pickedQuantity / item.収容数) : item.pickedQuantity);
        const remainingBoxes = item.remainingBoxes || (item.収容数 > 1 ? Math.ceil(item.remainingQuantity / item.収容数) : item.remainingQuantity);
        const remainingLabel = item.status === 'paused' ? '一時停止中' : '待機中';
        
        pickingProgressHTML = `
            <div class="mt-2 bg-blue-50 border border-blue-200 px-3 py-2 rounded-lg">
                <div class="flex items-center space-x-2">
                    <i class="fas fa-box text-blue-600"></i>
                    <span class="text-sm font-semibold text-blue-700">
                        ${pickedBoxes}個 (${item.pickedQuantity}枚) 取得済み
                    </span>
                </div>
                <div class="flex items-center space-x-2 mt-1">
                    <i class="fas fa-hourglass-half text-orange-500"></i>
                    <span class="text-sm font-semibold text-orange-600">
                        残り ${remainingBoxes}個 (${item.remainingQuantity}枚) ${remainingLabel}
                    </span>
                </div>
            </div>
        `;
    }
    
    // Add inventory warning for insufficient items - ONLY if not completed
    let inventoryWarning = '';
    if (isLivePending) {
        inventoryWarning = `
            <div class="mt-2 flex items-center space-x-2 bg-blue-50 px-3 py-2 rounded-lg">
                <i class="fas fa-spinner fa-spin text-blue-600"></i>
                <span class="text-sm font-semibold text-blue-700">最新在庫と箱数を確認中...</span>
            </div>
        `;
    } else if (hasInsufficientInventory) {
        const shortfallLabel = getDisplayShortfallLabel(item);
        inventoryWarning = `
            <div class="mt-2 flex items-center space-x-2 bg-red-100 px-3 py-2 rounded-lg">
                <i class="fas fa-exclamation-triangle text-red-600"></i>
                <span class="text-sm font-semibold text-red-700">在庫不足: ${shortfallLabel} 不足</span>
            </div>
        `;
    }

    itemDiv.innerHTML = `
        <div class="flex items-center justify-between">
            <div class="flex items-center space-x-4">
                <div class="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                    <span class="text-blue-600 font-bold">${item.lineNumber}</span>
                </div>
                <div>
                    <h4 class="text-lg font-semibold text-gray-900">品番: ${item.品番}</h4>
                    <div class="flex items-center ${statusClass}">
                        <div class="device-status-indicator w-3 h-3 rounded-full ${item.status === 'in-progress' ? 'bg-yellow-400' : item.status === 'paused' ? 'bg-orange-400' : item.status === 'completed' ? 'bg-green-500' : 'bg-gray-400'} mr-2"></div>
                        <p class="text-gray-600">背番号: <span class="font-medium">${item.背番号}</span></p>
                    </div>
                    <p class="text-sm text-gray-500">
                        ${quantitySummary}
                    </p>
                    <div class="completion-info mt-1">${completedInfo}</div>
                    ${pickingProgressHTML}
                    ${inventoryWarning}
                </div>
            </div>
            <div class="text-right flex items-center space-x-4">
                <div>
                    <div class="text-2xl font-bold text-gray-900">${isLivePending ? '--' : displayQuantity}</div>
                    <div class="text-sm text-gray-500">${quantityUnit}</div>
                    ${isLivePending || quantityDetail ? `<div class="text-xs text-gray-400 mt-1">${item.quantity}個</div>` : ''}
                </div>
                <div class="flex flex-col items-center space-y-2">
                    <div class="text-2xl status-icon">
                        ${statusIcon}
                    </div>
                    <div class="status-badge ${item.status === 'completed' ? 'bg-green-100 text-green-800' : item.status === 'paused' ? 'bg-orange-100 text-orange-800' : item.status === 'in-progress' ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-800'} px-2 py-1 rounded-full text-xs font-medium">
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
    const t = window.t || ((key) => key);

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
        showToast(result.resumed ? t('picking-resumed') : t('picking-started'), 'success');
        
        // Refresh the detail view and notify ESP32 devices
        setTimeout(async () => {
            await refreshPickingDetail();
            await loadPickingRequests();
        }, 1000);
        
    } catch (error) {
        console.error('Error starting picking process:', error);
        showToast(t('picking-start-failed'), 'error');
    }
}

async function pausePickingProcess() {
    const t = window.t || ((key) => key);

    if (!currentWorker) {
        showToast(t('login-required'), 'error');
        return;
    }

    if (!currentRequestNumber) {
        showToast(t('no-request-selected'), 'error');
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/picking-requests/${currentRequestNumber}/pause`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                pausedBy: currentWorker
            })
        });

        if (!response.ok) {
            const errorPayload = await response.json().catch(() => ({}));
            throw new Error(errorPayload.details || errorPayload.error || 'Failed to pause picking process');
        }

        await response.json();
        showToast(t('picking-paused'), 'success');
        await loadPickingRequests();
        await refreshPickingDetail();
        await checkAndUpdateLockStatus();
    } catch (error) {
        console.error('Error pausing picking process:', error);
        showToast(t('picking-pause-failed'), 'error');
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
        const loadToken = ++pickingDetailLoadToken;
        try {
            if (!currentRequest || currentRequest.requestNumber !== currentRequestNumber) {
                showPickingDetailLoadingState(currentRequestNumber);

                const request = await fetchBasePickingDetail(currentRequestNumber);
                if (loadToken !== pickingDetailLoadToken) {
                    return;
                }

                currentRequest = request;
                await displayPickingDetail(createPendingPickingDetail(request), {
                    livePending: true,
                    skipMasterData: true
                });
            }

            await hydratePickingDetail(currentRequestNumber, loadToken, {
                refreshDevices: true,
                showFailureToast: true
            });
            
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

        const pauseBtn = document.getElementById('pausePickingBtn');
        if (pauseBtn) {
            pauseBtn.classList.add('hidden');
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

    updatePickingPaginationControls(0);

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
async function filterByStatus(status) {
    const previousFilter = currentFilter;
    currentFilter = status;

    if (status === 'all' && previousFilter !== 'all') {
        allRequestsPagination.currentPage = 1;
    }

    updatePickingFilterButtons();
    await loadPickingRequests();
}

function filterByDate() {
    // Date filtering removed - function kept for compatibility
    return;
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
        case 'paused': return 'status-paused';
        case 'completed': return 'status-completed';
        case 'partial-inventory': return 'status-partial-inventory';
        case 'waiting-for-inventory': return 'status-partial-inventory';
        default: return 'status-pending';
    }
}

function getStatusText(status) {
    const t = window.t || ((key) => key); // Fallback if translation not loaded
    switch (status) {
        case 'pending': return t('status-pending');
        case 'in-progress': return t('status-in-progress');
        case 'paused': return t('status-paused');
        case 'completed': return t('status-completed');
        case 'partial-inventory': return '在庫不足';
        case 'waiting-for-inventory': return '在庫待ち';
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
    const cardContainer = document.getElementById('pickingItemsCardView');
    const tableContainer = document.getElementById('pickingItemsTableView');
    if (cardContainer) {
        cardContainer.innerHTML = `
        <div class="p-12 text-center">
            <div class="animate-spin w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-6"></div>
            <p class="text-lg text-gray-600">ピッキング項目を読み込んでいます...</p>
            <p class="text-sm text-gray-500 mt-2">しばらくお待ちください</p>
        </div>
    `;
    }

    if (tableContainer) {
        tableContainer.innerHTML = `
            <div class="p-12 text-center text-gray-500">
                <div class="animate-spin w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-6"></div>
                <p class="text-lg text-gray-600">テーブルを準備しています...</p>
            </div>
        `;
    }

    updatePickingDetailViewTabs();
    updatePickingDetailViewContainers();
    
    // Disable start button during loading
    const startBtn = document.getElementById('startPickingBtn');
    const pauseBtn = document.getElementById('pausePickingBtn');
    if (startBtn) {
        startBtn.disabled = true;
        startBtn.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i>読み込み中...`;
    }

    if (pauseBtn) {
        pauseBtn.classList.add('hidden');
        pauseBtn.disabled = true;
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

    const pauseBtn = document.getElementById('pausePickingBtn');
    if (pauseBtn) {
        pauseBtn.disabled = false;
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
window.applySuggestion = applySuggestion;
window.backToHome = backToHome;
window.backToPickingList = backToPickingList;
window.filterByStatus = filterByStatus;
window.filterByDate = filterByDate;
window.refreshPickingRequests = refreshPickingRequests;
window.changePickingPage = changePickingPage;
window.changePickingPageSize = changePickingPageSize;
window.startPickingProcess = startPickingProcess;
window.pausePickingProcess = pausePickingProcess;
// window.startIndividualPicking = startIndividualPicking; // Removed - ESP32 handles picking automatically
window.refreshPickingDetail = refreshPickingDetail;
window.switchPickingDetailView = switchPickingDetailView;
window.closePausedRequestsReminderModal = closePausedRequestsReminderModal;
window.openPausedReminderRequest = openPausedReminderRequest;
window.openHelpMenu = openHelpMenu;
window.closeHelpMenu = closeHelpMenu;
window.openHelpDetail = openHelpDetail;
window.closeHelpDetail = closeHelpDetail;
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
window.decrementCurrentTanaoroshi = decrementCurrentTanaoroshi;
window.completeTanaoroshiCount = completeTanaoroshiCount;
window.decrementTanaoroshiProduct = decrementTanaoroshiProduct;
window.deleteTanaoroshiProduct = deleteTanaoroshiProduct;
window.submitTanaoroshiCount = submitTanaoroshiCount;
window.resetAllTanaoroshiProducts = resetAllTanaoroshiProducts;

// Nyuko (入庫) system functions
window.openNyukoSystem = openNyukoSystem;
window.decrementCurrentNyuko = decrementCurrentNyuko;
window.decrementNyukoProduct = decrementNyukoProduct;
window.deleteNyukoProduct = deleteNyukoProduct;
window.submitNyukoInput = submitNyukoInput;
window.showProductInDisplay = showProductInDisplay;
window.resetAllNyukoProducts = resetAllNyukoProducts;
window.openScanAssistChoice = openScanAssistChoice;
window.openScanAssistCameraMode = openScanAssistCameraMode;
window.toggleScanAssistTorch = toggleScanAssistTorch;
window.openScanAssistManualMode = openScanAssistManualMode;
window.closeScanAssistSession = closeScanAssistSession;
window.handleScanAssistSearchInput = handleScanAssistSearchInput;
window.adjustScanAssistManualCount = adjustScanAssistManualCount;
window.openScanAssistSummary = openScanAssistSummary;
window.closeScanAssistSummary = closeScanAssistSummary;
window.confirmScanAssistSummary = confirmScanAssistSummary;

// Gentan (原単) system functions
window.handleGentanImageCapture = handleGentanImageCapture;
window.updateGentanItemData = updateGentanItemData;
window.removeGentanItem = removeGentanItem;
window.submitGentanData = submitGentanData;

// Note: Language translations are defined in language.js which is loaded first in index.html
// The translations object is already available globally from language.js

const SCAN_ASSIST_SCAN_COOLDOWN_MS = 1000;
const SCAN_ASSIST_SUCCESS_FLASH_MS = 180;

const scanAssistState = {
    context: null,
    manualItems: [],
    invalidItems: [],
    draftBoxCounts: {},
    initialBoxCounts: {},
    searchTerm: '',
    cameraStream: null,
    cameraTrack: null,
    cameraFrameRequestId: null,
    cameraResumeTimeoutId: null,
    cameraSuccessFlashTimeoutId: null,
    cameraTorchSupported: null,
    cameraTorchEnabled: false,
    cameraTorchPending: false,
    lastScanValue: '',
    lastScanTimestamp: 0
};

const scanAssistModeByContext = {
    inventory: null,
    nyuko: null
};

function getScanAssistLocale() {
    return getCurrentAppLanguage() === 'en' ? 'en' : 'ja';
}

function getScanAssistText(key, values = []) {
    const locale = getScanAssistLocale();
    const textMap = {
        choiceTitle: {
            ja: 'スキャン代替手段',
            en: 'Scan Alternatives'
        },
        choiceDescription: {
            ja: '物理スキャナーが使えない場合は、カメラ読取または手動入力を利用してください。',
            en: 'Use camera scan or manual entry when the physical scanner is unavailable.'
        },
        cameraOptionTitle: {
            ja: 'カメラスキャン',
            en: 'Camera Scan'
        },
        cameraOptionDescription: {
            ja: 'タブレットのカメラでQRコードを読み取り、通常スキャンと同じ処理を行います。',
            en: 'Use the tablet camera to read the QR code and process it exactly like the hardware scanner.'
        },
        manualOptionTitle: {
            ja: '手動入力',
            en: 'Manual Entry'
        },
        manualOptionDescriptionNyuko: {
            ja: 'masterDB一覧から背番号を検索し、必要な箱数を現在の一覧へ追加します。',
            en: 'Search the masterDB list by back number and add the required box counts into the current list.'
        },
        manualOptionDescriptionInventory: {
            ja: '現在庫一覧をもとに箱数を調整し、変更内容を現在の一覧へ追加します。',
            en: 'Adjust box counts from the current inventory list and add the changes into the current list.'
        },
        cameraDescription: {
            ja: 'QRコードをカメラ中央に合わせると自動で読み取ります。',
            en: 'Align the QR code inside the camera view and it will scan automatically.'
        },
        cameraStarting: {
            ja: 'カメラを起動しています...',
            en: 'Starting camera...'
        },
        cameraReady: {
            ja: 'QRコードをカメラにかざしてください',
            en: 'Point the QR code at the camera'
        },
        cameraUnsupported: {
            ja: 'このブラウザではカメラスキャンを利用できません。',
            en: 'Camera scanning is not supported in this browser.'
        },
        cameraUnavailable: {
            ja: 'カメラを起動できませんでした。権限設定を確認してください。',
            en: 'Unable to start the camera. Check the browser camera permission.'
        },
        flashlightChecking: {
            ja: 'ライト確認中',
            en: 'Checking light'
        },
        flashlightTurnOn: {
            ja: 'ライトを点灯',
            en: 'Turn Light On'
        },
        flashlightTurnOff: {
            ja: 'ライトを消灯',
            en: 'Turn Light Off'
        },
        flashlightUnavailable: {
            ja: 'ライト非対応',
            en: 'No Flash'
        },
        manualDescriptionNyuko: {
            ja: 'masterDB一覧を背番号順で表示します。必要な行だけ箱数を増減して、現在の一覧へ追加してください。',
            en: 'The masterDB list is shown in back-number order. Adjust only the required rows, then add them into the current list.'
        },
        manualDescriptionInventory: {
            ja: '現在庫一覧を背番号順で表示します。初期値は現在の箱数です。変更内容を現在の一覧へ追加してください。',
            en: 'The current inventory list is shown in back-number order. Rows start from the current box count. Add the changes into the current list.'
        },
        manualLoading: {
            ja: '一覧を読み込んでいます...',
            en: 'Loading list...'
        },
        manualSearchPlaceholder: {
            ja: '背番号・品番・品名で検索',
            en: 'Search by back number, product number, or product name'
        },
        manualEmpty: {
            ja: '表示できる項目がありません。',
            en: 'No items available to display.'
        },
        reviewButton: {
            ja: '一覧へ追加 ({0})',
            en: 'Add to List ({0})'
        },
        noNyukoChanges: {
            ja: '一覧へ追加する入庫変更がありません。',
            en: 'There are no receiving changes to add to the list.'
        },
        noInventoryChanges: {
            ja: '一覧へ追加する棚卸し変更がありません。',
            en: 'There are no inventory changes to add to the list.'
        },
        addedToListToast: {
            ja: '{0}件を一覧に追加しました。',
            en: 'Added {0} item(s) to the list.'
        },
        noNyukoSummary: {
            ja: '入力された箱数がありません。',
            en: 'There are no entered box counts.'
        },
        noInventorySummary: {
            ja: '在庫変更がありません。',
            en: 'There are no inventory changes.'
        },
        summaryTitleNyuko: {
            ja: '入庫内容の確認',
            en: 'Review Receiving Entries'
        },
        summaryTitleInventory: {
            ja: '棚卸し変更の確認',
            en: 'Review Inventory Changes'
        },
        summaryDescriptionNyuko: {
            ja: '送信前に、入庫する背番号と箱数を確認してください。',
            en: 'Confirm the back numbers and box counts to receive before sending.'
        },
        summaryDescriptionInventory: {
            ja: '送信前に、背番号ごとの変更内容を確認してください。',
            en: 'Confirm the per-back-number inventory changes before sending.'
        },
        summaryBack: {
            ja: '一覧に戻る',
            en: 'Back to List'
        },
        summaryConfirm: {
            ja: '確定送信',
            en: 'Confirm Submit'
        },
        invalidMasterNotice: {
            ja: '{0} のmasterDBが無効です。管理者へ連絡してください。',
            en: '{0} has invalid masterDB data. Please contact the administrator.'
        },
        inventoryCurrent: {
            ja: '現在在庫',
            en: 'Current Inventory'
        },
        piecesLabel: {
            ja: '個',
            en: 'pcs'
        },
        boxesLabel: {
            ja: '箱',
            en: 'boxes'
        },
        perBoxLabel: {
            ja: '1箱 = {0}個',
            en: '1 box = {0} pcs'
        },
        skippedInvalidToast: {
            ja: '無効なmasterDBの背番号は一覧に表示していません。管理者へ連絡してください。',
            en: 'Items with invalid masterDB data are excluded from the list. Please contact the administrator.'
        }
    };

    let output = textMap[key]?.[locale] || textMap[key]?.ja || key;
    values.forEach((value, index) => {
        output = output.split(`{${index}}`).join(String(value));
    });

    return output;
}

function getScanAssistContext(contextId = currentScreen) {
    if (contextId === 'inventory') {
        return {
            id: 'inventory',
            label: t('tanaoroshi-system'),
            manualEndpoint: '/manual-entry/tanaoroshi-items'
        };
    }

    if (contextId === 'nyuko') {
        return {
            id: 'nyuko',
            label: t('nyuko-system'),
            manualEndpoint: '/manual-entry/nyuko-items'
        };
    }

    return null;
}

function getScanAssistShortcutButtonIds(contextId) {
    if (contextId === 'inventory') {
        return {
            camera: 'inventoryScanShortcutBtn',
            manual: 'inventoryManualShortcutBtn'
        };
    }

    if (contextId === 'nyuko') {
        return {
            camera: 'nyukoScanShortcutBtn',
            manual: 'nyukoManualShortcutBtn'
        };
    }

    return null;
}

function updateScanAssistShortcutButtons() {
    ['inventory', 'nyuko'].forEach(contextId => {
        const buttonIds = getScanAssistShortcutButtonIds(contextId);
        const selectedMode = scanAssistModeByContext[contextId];

        ['camera', 'manual'].forEach(mode => {
            const buttonId = buttonIds?.[mode];
            const button = buttonId ? document.getElementById(buttonId) : null;
            if (!button) {
                return;
            }

            const shouldShow = selectedMode === mode;
            button.classList.toggle('hidden', !shouldShow);
            button.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
        });
    });
}

function setScanAssistMode(contextId, mode) {
    if (!contextId || !Object.prototype.hasOwnProperty.call(scanAssistModeByContext, contextId)) {
        return;
    }

    scanAssistModeByContext[contextId] = mode;
    updateScanAssistShortcutButtons();
}

function syncBlockingModalBodyScroll() {
    document.body.style.overflow = hasBlockingModalOpen() ? 'hidden' : '';
}

function resetScanAssistState() {
    scanAssistState.context = null;
    scanAssistState.manualItems = [];
    scanAssistState.invalidItems = [];
    scanAssistState.draftBoxCounts = {};
    scanAssistState.initialBoxCounts = {};
    scanAssistState.searchTerm = '';
    resetScanAssistTorchState();
    scanAssistState.lastScanValue = '';
    scanAssistState.lastScanTimestamp = 0;
}

function closeScanAssistCameraModal() {
    stopScanAssistCamera();
    const modal = document.getElementById('scanAssistCameraModal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

function closeScanAssistSummary(backToManual = false) {
    const summaryModal = document.getElementById('scanAssistSummaryModal');
    if (summaryModal) {
        summaryModal.classList.add('hidden');
    }

    if (backToManual) {
        document.getElementById('scanAssistManualModal').classList.remove('hidden');
    }

    syncBlockingModalBodyScroll();
}

function closeScanAssistSession() {
    closeScanAssistCameraModal();

    ['scanAssistChoiceModal', 'scanAssistManualModal', 'scanAssistSummaryModal'].forEach(modalId => {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('hidden');
        }
    });

    resetScanAssistState();
    syncBlockingModalBodyScroll();
}

function openScanAssistChoice(contextId = currentScreen) {
    const context = getScanAssistContext(contextId);
    if (!context) {
        return;
    }

    scanAssistState.context = context.id;
    document.getElementById('scanAssistChoiceLabel').textContent = context.label;
    document.getElementById('scanAssistChoiceTitle').textContent = getScanAssistText('choiceTitle');
    document.getElementById('scanAssistChoiceDescription').textContent = getScanAssistText('choiceDescription');
    document.getElementById('scanAssistCameraOptionTitle').textContent = getScanAssistText('cameraOptionTitle');
    document.getElementById('scanAssistCameraOptionDescription').textContent = getScanAssistText('cameraOptionDescription');
    document.getElementById('scanAssistManualOptionTitle').textContent = getScanAssistText('manualOptionTitle');
    document.getElementById('scanAssistManualOptionDescription').textContent = context.id === 'nyuko'
        ? getScanAssistText('manualOptionDescriptionNyuko')
        : getScanAssistText('manualOptionDescriptionInventory');

    document.getElementById('scanAssistChoiceModal').classList.remove('hidden');
    syncBlockingModalBodyScroll();
}

async function openScanAssistCameraMode(contextId = scanAssistState.context) {
    const context = getScanAssistContext(contextId);
    if (!context) {
        return;
    }

    scanAssistState.context = context.id;
    setScanAssistMode(context.id, 'camera');
    resetScanAssistTorchState();

    document.getElementById('scanAssistChoiceModal').classList.add('hidden');
    document.getElementById('scanAssistCameraLabel').textContent = context.label;
    document.getElementById('scanAssistCameraTitle').textContent = `${context.label} / ${getScanAssistText('cameraOptionTitle')}`;
    document.getElementById('scanAssistCameraDescription').textContent = getScanAssistText('cameraDescription');
    document.getElementById('scanAssistCameraStatus').textContent = getScanAssistText('cameraStarting');
    updateScanAssistTorchButton();
    document.getElementById('scanAssistCameraModal').classList.remove('hidden');
    syncBlockingModalBodyScroll();

    await startScanAssistCamera();
}

async function openScanAssistManualMode(contextId = scanAssistState.context) {
    const context = getScanAssistContext(contextId);
    if (!context) {
        return;
    }

    scanAssistState.context = context.id;
    setScanAssistMode(context.id, 'manual');

    document.getElementById('scanAssistChoiceModal').classList.add('hidden');
    document.getElementById('scanAssistSummaryModal').classList.add('hidden');
    document.getElementById('scanAssistManualLabel').textContent = context.label;
    document.getElementById('scanAssistManualTitle').textContent = `${context.label} / ${getScanAssistText('manualOptionTitle')}`;
    document.getElementById('scanAssistManualDescription').textContent = context.id === 'nyuko'
        ? getScanAssistText('manualDescriptionNyuko')
        : getScanAssistText('manualDescriptionInventory');
    document.getElementById('scanAssistManualLoadingText').textContent = getScanAssistText('manualLoading');
    document.getElementById('scanAssistManualEmptyText').textContent = getScanAssistText('manualEmpty');
    document.getElementById('scanAssistSearchInput').value = '';
    document.getElementById('scanAssistSearchInput').placeholder = getScanAssistText('manualSearchPlaceholder');
    document.getElementById('scanAssistManualModal').classList.remove('hidden');
    syncBlockingModalBodyScroll();

    await loadScanAssistManualItems();
}

function resetScanAssistTorchState() {
    scanAssistState.cameraTrack = null;
    scanAssistState.cameraTorchSupported = null;
    scanAssistState.cameraTorchEnabled = false;
    scanAssistState.cameraTorchPending = false;
}

function getScanAssistCameraTrack() {
    if (scanAssistState.cameraTrack && scanAssistState.cameraTrack.readyState === 'live') {
        return scanAssistState.cameraTrack;
    }

    const activeTrack = scanAssistState.cameraStream?.getVideoTracks?.()[0] || null;
    scanAssistState.cameraTrack = activeTrack;
    return activeTrack;
}

function isScanAssistTorchSupported(track = getScanAssistCameraTrack()) {
    if (!track || typeof track.applyConstraints !== 'function') {
        return false;
    }

    const capabilities = typeof track.getCapabilities === 'function' ? track.getCapabilities() : null;
    if (typeof capabilities?.torch === 'boolean') {
        return capabilities.torch;
    }

    const settings = typeof track.getSettings === 'function' ? track.getSettings() : null;
    return typeof settings?.torch === 'boolean';
}

function updateScanAssistTorchButton() {
    const button = document.getElementById('scanAssistTorchToggleBtn');
    const textElement = document.getElementById('scanAssistTorchToggleText');
    const iconElement = document.getElementById('scanAssistTorchToggleIcon');
    if (!button || !textElement || !iconElement) {
        return;
    }

    const isChecking = scanAssistState.cameraTorchSupported === null;
    const isSupported = scanAssistState.cameraTorchSupported === true;
    const isEnabled = scanAssistState.cameraTorchEnabled === true;
    const isPending = scanAssistState.cameraTorchPending === true;

    let buttonText = getScanAssistText('flashlightChecking');
    let buttonClass = 'absolute right-4 top-4 inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold shadow-lg backdrop-blur transition-colors';

    if (isChecking) {
        buttonClass += ' border-slate-700 bg-slate-950/75 text-slate-400';
    } else if (!isSupported) {
        buttonText = getScanAssistText('flashlightUnavailable');
        buttonClass += ' border-slate-800 bg-slate-950/80 text-slate-500';
    } else if (isEnabled) {
        buttonText = getScanAssistText('flashlightTurnOff');
        buttonClass += ' border-amber-200 bg-amber-300/95 text-slate-950 hover:bg-amber-200';
    } else {
        buttonText = getScanAssistText('flashlightTurnOn');
        buttonClass += ' border-slate-600 bg-slate-900/85 text-white hover:bg-slate-800';
    }

    if (isPending) {
        buttonClass += ' cursor-wait opacity-80';
    } else if (!isSupported || isChecking) {
        buttonClass += ' cursor-not-allowed opacity-65';
    }

    button.className = buttonClass;
    button.disabled = isPending || !isSupported;
    button.setAttribute('aria-pressed', isEnabled ? 'true' : 'false');
    button.title = buttonText;
    textElement.textContent = buttonText;
    iconElement.className = 'fas fa-bolt';
    iconElement.classList.toggle('animate-pulse', isEnabled && !isPending);
}

async function setScanAssistTorchState(nextEnabled) {
    const track = getScanAssistCameraTrack();
    if (!track || !isScanAssistTorchSupported(track)) {
        scanAssistState.cameraTorchSupported = false;
        scanAssistState.cameraTorchEnabled = false;
        updateScanAssistTorchButton();
        return false;
    }

    scanAssistState.cameraTorchPending = true;
    updateScanAssistTorchButton();

    try {
        await track.applyConstraints({
            advanced: [{ torch: !!nextEnabled }]
        });

        scanAssistState.cameraTorchSupported = true;
        scanAssistState.cameraTorchEnabled = !!nextEnabled;

        const settings = typeof track.getSettings === 'function' ? track.getSettings() : null;
        if (typeof settings?.torch === 'boolean') {
            scanAssistState.cameraTorchEnabled = settings.torch;
        }

        return true;
    } catch (error) {
        console.warn('Unable to update scan assist torch state:', error);
        scanAssistState.cameraTorchSupported = false;
        scanAssistState.cameraTorchEnabled = false;
        return false;
    } finally {
        scanAssistState.cameraTorchPending = false;
        updateScanAssistTorchButton();
    }
}

async function initializeScanAssistTorch() {
    const track = getScanAssistCameraTrack();
    scanAssistState.cameraTorchSupported = isScanAssistTorchSupported(track);
    scanAssistState.cameraTorchEnabled = false;
    scanAssistState.cameraTorchPending = false;
    updateScanAssistTorchButton();

    if (!scanAssistState.cameraTorchSupported) {
        return;
    }

    await setScanAssistTorchState(true);
}

async function toggleScanAssistTorch() {
    if (scanAssistState.cameraTorchPending || scanAssistState.cameraTorchSupported !== true) {
        return;
    }

    await setScanAssistTorchState(!scanAssistState.cameraTorchEnabled);
}

async function startScanAssistCamera() {
    const statusElement = document.getElementById('scanAssistCameraStatus');
    const videoElement = document.getElementById('scanAssistCameraVideo');

    if (!navigator.mediaDevices?.getUserMedia || typeof window.jsQR !== 'function') {
        if (statusElement) {
            statusElement.textContent = getScanAssistText('cameraUnsupported');
        }
        showToast(`❌ ${getScanAssistText('cameraUnsupported')}`, 'error');
        return;
    }

    stopScanAssistCamera();
    updateScanAssistTorchButton();

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: { ideal: 'environment' }
            },
            audio: false
        });

        scanAssistState.cameraStream = stream;
        scanAssistState.cameraTrack = stream.getVideoTracks()[0] || null;
        videoElement.srcObject = stream;
        await videoElement.play();
        await initializeScanAssistTorch();

        if (statusElement) {
            statusElement.textContent = getScanAssistText('cameraReady');
        }

        scheduleScanAssistCameraFrame();
    } catch (error) {
        console.error('Error starting scan assist camera:', error);
        scanAssistState.cameraTorchSupported = false;
        scanAssistState.cameraTorchEnabled = false;
        scanAssistState.cameraTorchPending = false;
        updateScanAssistTorchButton();
        if (statusElement) {
            statusElement.textContent = getScanAssistText('cameraUnavailable');
        }
        showToast(`❌ ${getScanAssistText('cameraUnavailable')}`, 'error');
    }
}

function stopScanAssistCamera() {
    if (scanAssistState.cameraFrameRequestId) {
        cancelAnimationFrame(scanAssistState.cameraFrameRequestId);
        scanAssistState.cameraFrameRequestId = null;
    }

    if (scanAssistState.cameraResumeTimeoutId) {
        clearTimeout(scanAssistState.cameraResumeTimeoutId);
        scanAssistState.cameraResumeTimeoutId = null;
    }

    if (scanAssistState.cameraSuccessFlashTimeoutId) {
        clearTimeout(scanAssistState.cameraSuccessFlashTimeoutId);
        scanAssistState.cameraSuccessFlashTimeoutId = null;
    }

    if (scanAssistState.cameraStream) {
        scanAssistState.cameraStream.getTracks().forEach(track => track.stop());
        scanAssistState.cameraStream = null;
    }

    resetScanAssistTorchState();

    const videoElement = document.getElementById('scanAssistCameraVideo');
    if (videoElement) {
        videoElement.srcObject = null;
    }

    const successFlash = document.getElementById('scanAssistCameraSuccessFlash');
    if (successFlash) {
        successFlash.style.opacity = '0';
    }

    updateScanAssistTorchButton();
}

function scheduleScanAssistCameraFrame(delayMs = 0, beforeResume = null) {
    if (scanAssistState.cameraFrameRequestId) {
        cancelAnimationFrame(scanAssistState.cameraFrameRequestId);
        scanAssistState.cameraFrameRequestId = null;
    }

    if (scanAssistState.cameraResumeTimeoutId) {
        clearTimeout(scanAssistState.cameraResumeTimeoutId);
        scanAssistState.cameraResumeTimeoutId = null;
    }

    const resumeFrameLoop = () => {
        if (typeof beforeResume === 'function') {
            beforeResume();
        }

        if (!scanAssistState.cameraStream) {
            return;
        }

        scanAssistState.cameraFrameRequestId = requestAnimationFrame(scanAssistCameraFrame);
    };

    if (delayMs > 0) {
        scanAssistState.cameraResumeTimeoutId = setTimeout(() => {
            scanAssistState.cameraResumeTimeoutId = null;
            resumeFrameLoop();
        }, delayMs);
        return;
    }

    resumeFrameLoop();
}

function triggerScanAssistCameraSuccessFeedback() {
    if (scanAssistState.cameraSuccessFlashTimeoutId) {
        clearTimeout(scanAssistState.cameraSuccessFlashTimeoutId);
        scanAssistState.cameraSuccessFlashTimeoutId = null;
    }

    const successFlash = document.getElementById('scanAssistCameraSuccessFlash');
    if (!successFlash) {
        return;
    }

    successFlash.style.opacity = '0.35';
    scanAssistState.cameraSuccessFlashTimeoutId = setTimeout(() => {
        successFlash.style.opacity = '0';
        scanAssistState.cameraSuccessFlashTimeoutId = null;
    }, SCAN_ASSIST_SUCCESS_FLASH_MS);
}

function scanAssistCameraFrame() {
    const videoElement = document.getElementById('scanAssistCameraVideo');
    const canvasElement = document.getElementById('scanAssistCameraCanvas');
    if (!videoElement || !canvasElement || !scanAssistState.cameraStream) {
        return;
    }

    if (!videoElement.videoWidth || !videoElement.videoHeight) {
        scheduleScanAssistCameraFrame();
        return;
    }

    canvasElement.width = videoElement.videoWidth;
    canvasElement.height = videoElement.videoHeight;

    const canvasContext = canvasElement.getContext('2d', { willReadFrequently: true });
    canvasContext.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);

    const imageData = canvasContext.getImageData(0, 0, canvasElement.width, canvasElement.height);
    const result = window.jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'attemptBoth'
    });

    if (result?.data) {
        const now = Date.now();
        if (scanAssistState.lastScanValue === result.data && (now - scanAssistState.lastScanTimestamp) < SCAN_ASSIST_SCAN_COOLDOWN_MS) {
            scheduleScanAssistCameraFrame();
            return;
        }

        scanAssistState.lastScanValue = result.data;
        scanAssistState.lastScanTimestamp = now;
        void handleScanAssistCameraResult(result.data);
        return;
    }

    scheduleScanAssistCameraFrame();
}

async function handleScanAssistCameraResult(scanValue) {
    const statusElement = document.getElementById('scanAssistCameraStatus');
    if (statusElement) {
        statusElement.textContent = scanValue;
    }

    let wasProcessed = false;
    if (scanAssistState.context === 'nyuko') {
        wasProcessed = await processNyukoScan(scanValue);
    } else if (scanAssistState.context === 'inventory') {
        wasProcessed = await processTanaoroshiScan(scanValue);
    }

    if (wasProcessed) {
        triggerScanAssistCameraSuccessFeedback();
        scheduleScanAssistCameraFrame(SCAN_ASSIST_SCAN_COOLDOWN_MS, () => {
            if (statusElement && scanAssistState.cameraStream) {
                statusElement.textContent = getScanAssistText('cameraReady');
            }
        });
        return;
    }

    if (statusElement) {
        statusElement.textContent = getScanAssistText('cameraReady');
    }
    scheduleScanAssistCameraFrame();
}

async function loadScanAssistManualItems() {
    const context = getScanAssistContext(scanAssistState.context);
    if (!context) {
        return;
    }

    const loadingState = document.getElementById('scanAssistManualLoadingState');
    const emptyState = document.getElementById('scanAssistManualEmptyState');
    const listContainer = document.getElementById('scanAssistManualList');
    const invalidNotice = document.getElementById('scanAssistInvalidNotice');

    loadingState.classList.remove('hidden');
    emptyState.classList.add('hidden');
    listContainer.innerHTML = '';
    invalidNotice.classList.add('hidden');
    invalidNotice.textContent = '';

    try {
        const response = await fetch(`${API_BASE_URL}${context.manualEndpoint}`);
        if (!response.ok) {
            throw new Error('Failed to fetch scan assist manual items');
        }

        const responseData = await response.json();
        scanAssistState.manualItems = Array.isArray(responseData.items) ? responseData.items : [];
        scanAssistState.invalidItems = Array.isArray(responseData.invalidItems) ? responseData.invalidItems : [];
        scanAssistState.searchTerm = '';
        initializeScanAssistDraftBoxCounts();
        renderScanAssistInvalidNotice();
        renderScanAssistManualList();

        if (scanAssistState.invalidItems.length > 0) {
            showToast(`⚠️ ${getScanAssistText('skippedInvalidToast')}`, 'error');
        }
    } catch (error) {
        console.error('Error loading scan assist manual items:', error);
        loadingState.classList.add('hidden');
        emptyState.classList.remove('hidden');
        listContainer.innerHTML = '';
        updateScanAssistReviewButton();
        showToast(`❌ ${t('load-failed')} manual-entry list`, 'error');
    }
}

function buildNyukoManualBaselineBoxMap() {
    return nyukoInputProducts.reduce((result, item) => {
        result[item.品番] = Math.max(0, Number(item.inputBoxes) || 0);
        return result;
    }, {});
}

function buildTanaoroshiManualBaselineBoxMap() {
    const baseline = tanaoroshiCountedProducts.reduce((result, item) => {
        result[item.品番] = Math.max(0, Number(item.countedBoxes) || 0);
        return result;
    }, {});

    if (currentTanaoroshiProduct?.品番) {
        baseline[currentTanaoroshiProduct.品番] = Math.max(0, Number(currentTanaoroshiProduct.countedBoxes) || 0);
    }

    return baseline;
}

function initializeScanAssistDraftBoxCounts() {
    const context = getScanAssistContext(scanAssistState.context);
    if (!context) {
        return;
    }

    const baselineBoxMap = context.id === 'nyuko'
        ? buildNyukoManualBaselineBoxMap()
        : buildTanaoroshiManualBaselineBoxMap();

    scanAssistState.initialBoxCounts = {};
    scanAssistState.draftBoxCounts = {};

    scanAssistState.manualItems.forEach(item => {
        const fallbackBoxes = context.id === 'nyuko'
            ? 0
            : Math.max(0, Number(item.currentBoxQuantity) || 0);
        const initialBoxes = baselineBoxMap[item.品番] !== undefined
            ? Math.max(0, Number(baselineBoxMap[item.品番]) || 0)
            : fallbackBoxes;

        scanAssistState.initialBoxCounts[item.品番] = initialBoxes;
        scanAssistState.draftBoxCounts[item.品番] = initialBoxes;
    });
}

function getScanAssistDraftBoxCount(productNumber, fallbackValue = 0) {
    if (scanAssistState.draftBoxCounts[productNumber] === undefined) {
        return Math.max(0, Number(fallbackValue) || 0);
    }

    return Math.max(0, Number(scanAssistState.draftBoxCounts[productNumber]) || 0);
}

function getScanAssistInitialBoxCount(productNumber, fallbackValue = 0) {
    if (scanAssistState.initialBoxCounts[productNumber] === undefined) {
        return Math.max(0, Number(fallbackValue) || 0);
    }

    return Math.max(0, Number(scanAssistState.initialBoxCounts[productNumber]) || 0);
}

function handleScanAssistSearchInput(value) {
    scanAssistState.searchTerm = String(value || '').trim().toLowerCase();
    renderScanAssistManualList();
}

function buildInvalidMasterNoticeText() {
    if (scanAssistState.invalidItems.length === 0) {
        return '';
    }

    const labels = scanAssistState.invalidItems
        .slice(0, 5)
        .map(item => item.背番号 || item.品番)
        .filter(Boolean)
        .join('、');
    const hiddenCount = Math.max(0, scanAssistState.invalidItems.length - 5);
    const displayLabel = hiddenCount > 0
        ? `${labels}${getScanAssistLocale() === 'en' ? ` and ${hiddenCount} more` : ` ほか${hiddenCount}件`}`
        : labels;

    return getScanAssistText('invalidMasterNotice', [displayLabel]);
}

function renderScanAssistInvalidNotice() {
    const invalidNotice = document.getElementById('scanAssistInvalidNotice');
    const noticeText = buildInvalidMasterNoticeText();

    if (!noticeText) {
        invalidNotice.classList.add('hidden');
        invalidNotice.textContent = '';
        return;
    }

    invalidNotice.textContent = noticeText;
    invalidNotice.classList.remove('hidden');
}

function getFilteredScanAssistItems() {
    if (!scanAssistState.searchTerm) {
        return scanAssistState.manualItems;
    }

    return scanAssistState.manualItems.filter(item => {
        return [item.背番号, item.品番, item.品名]
            .map(value => String(value || '').toLowerCase())
            .some(value => value.includes(scanAssistState.searchTerm));
    });
}

function createScanAssistManualRow(item) {
    const context = getScanAssistContext(scanAssistState.context);
    const encodedProductNumber = encodeURIComponent(item.品番);
    const draftBoxes = getScanAssistDraftBoxCount(item.品番, 0);
    const totalPieces = draftBoxes * item.収容数;

    if (context?.id === 'nyuko') {
        return `
            <div class='rounded-2xl border border-gray-200 bg-white p-4 shadow-sm'>
                <div class='flex items-center justify-between gap-4'>
                    <div class='min-w-0'>
                        <div class='flex flex-wrap items-center gap-2'>
                            <span class='rounded-full bg-purple-100 px-3 py-1 text-sm font-bold text-purple-700'>${item.背番号 || '-'}</span>
                            <span class='text-sm font-semibold text-gray-900'>${item.品番}</span>
                        </div>
                        <p class='mt-2 text-sm text-gray-700'>${item.品名 || '-'}</p>
                        <p class='mt-2 text-xs text-gray-500'>${getScanAssistText('perBoxLabel', [item.収容数])}</p>
                    </div>
                    <div class='flex items-center gap-3'>
                        <button type='button' onclick='adjustScanAssistManualCount("${encodedProductNumber}", -1)' class='flex h-11 w-11 items-center justify-center rounded-xl border border-gray-300 bg-white text-xl font-bold text-gray-700 transition-colors hover:bg-gray-100'>−</button>
                        <div class='min-w-[84px] text-center'>
                            <p class='text-2xl font-bold text-purple-700'>${draftBoxes}</p>
                            <p class='text-xs text-gray-500'>${totalPieces}${getScanAssistText('piecesLabel')}</p>
                        </div>
                        <button type='button' onclick='adjustScanAssistManualCount("${encodedProductNumber}", 1)' class='flex h-11 w-11 items-center justify-center rounded-xl border border-purple-300 bg-purple-50 text-xl font-bold text-purple-700 transition-colors hover:bg-purple-100'>+</button>
                    </div>
                </div>
            </div>
        `;
    }

    const currentBoxes = Math.max(0, Number(item.currentBoxQuantity) || 0);
    const currentPieces = Math.max(0, Number(item.currentPhysicalQuantity) || 0);
    const diffBoxes = draftBoxes - currentBoxes;
    const diffClass = diffBoxes > 0
        ? 'text-green-600'
        : diffBoxes < 0
            ? 'text-red-600'
            : 'text-gray-500';
    const diffLabel = diffBoxes === 0 ? '±0' : `${diffBoxes > 0 ? '+' : ''}${diffBoxes}${getScanAssistText('boxesLabel')}`;

    return `
        <div class='rounded-2xl border border-gray-200 bg-white p-4 shadow-sm'>
            <div class='flex items-center justify-between gap-4'>
                <div class='min-w-0'>
                    <div class='flex flex-wrap items-center gap-2'>
                        <span class='rounded-full bg-blue-100 px-3 py-1 text-sm font-bold text-blue-700'>${item.背番号 || '-'}</span>
                        <span class='text-sm font-semibold text-gray-900'>${item.品番}</span>
                    </div>
                    <p class='mt-2 text-sm text-gray-700'>${item.品名 || '-'}</p>
                    <div class='mt-2 flex flex-wrap items-center gap-3 text-xs'>
                        <span class='text-gray-500'>${getScanAssistText('inventoryCurrent')}: ${currentBoxes}${getScanAssistText('boxesLabel')} (${currentPieces}${getScanAssistText('piecesLabel')})</span>
                        <span class='${diffClass} font-semibold'>${diffLabel}</span>
                        <span class='text-gray-500'>${getScanAssistText('perBoxLabel', [item.収容数])}</span>
                    </div>
                </div>
                <div class='flex items-center gap-3'>
                    <button type='button' onclick='adjustScanAssistManualCount("${encodedProductNumber}", -1)' class='flex h-11 w-11 items-center justify-center rounded-xl border border-gray-300 bg-white text-xl font-bold text-gray-700 transition-colors hover:bg-gray-100'>−</button>
                    <div class='min-w-[84px] text-center'>
                        <p class='text-2xl font-bold text-blue-700'>${draftBoxes}</p>
                        <p class='text-xs text-gray-500'>${totalPieces}${getScanAssistText('piecesLabel')}</p>
                    </div>
                    <button type='button' onclick='adjustScanAssistManualCount("${encodedProductNumber}", 1)' class='flex h-11 w-11 items-center justify-center rounded-xl border border-blue-300 bg-blue-50 text-xl font-bold text-blue-700 transition-colors hover:bg-blue-100'>+</button>
                </div>
            </div>
        </div>
    `;
}

function renderScanAssistManualList() {
    const loadingState = document.getElementById('scanAssistManualLoadingState');
    const emptyState = document.getElementById('scanAssistManualEmptyState');
    const listContainer = document.getElementById('scanAssistManualList');
    const filteredItems = getFilteredScanAssistItems();

    loadingState.classList.add('hidden');

    if (filteredItems.length === 0) {
        listContainer.innerHTML = '';
        emptyState.classList.remove('hidden');
        updateScanAssistReviewButton();
        return;
    }

    emptyState.classList.add('hidden');
    listContainer.innerHTML = filteredItems.map(createScanAssistManualRow).join('');
    updateScanAssistReviewButton();
}

function adjustScanAssistManualCount(encodedProductNumber, delta) {
    const productNumber = decodeURIComponent(encodedProductNumber);
    const currentBoxes = getScanAssistDraftBoxCount(productNumber, 0);
    scanAssistState.draftBoxCounts[productNumber] = Math.max(0, currentBoxes + delta);
    renderScanAssistManualList();
}

function buildNyukoManualPendingItems() {
    return scanAssistState.manualItems.map(item => {
        const initialBoxes = getScanAssistInitialBoxCount(item.品番, 0);
        const targetBoxes = getScanAssistDraftBoxCount(item.品番, initialBoxes);

        if (targetBoxes === initialBoxes) {
            return null;
        }

        return {
            ...item,
            initialBoxes,
            targetBoxes,
            inputQuantity: targetBoxes * item.収容数
        };
    }).filter(Boolean);
}

function buildTanaoroshiManualPendingItems() {
    return scanAssistState.manualItems.map(item => {
        const initialBoxes = getScanAssistInitialBoxCount(item.品番, item.currentBoxQuantity);
        const targetBoxes = getScanAssistDraftBoxCount(item.品番, initialBoxes);

        if (targetBoxes === initialBoxes) {
            return null;
        }

        return {
            ...item,
            initialBoxes,
            targetBoxes,
            newPhysicalQuantity: targetBoxes * item.収容数,
            difference: (targetBoxes * item.収容数) - (Math.max(0, Number(item.currentPhysicalQuantity) || 0))
        };
    }).filter(Boolean);
}

function getScanAssistManualPendingItems() {
    if (scanAssistState.context === 'nyuko') {
        return buildNyukoManualPendingItems();
    }

    if (scanAssistState.context === 'inventory') {
        return buildTanaoroshiManualPendingItems();
    }

    return [];
}

function buildNyukoManualSummaryItems() {
    return scanAssistState.manualItems.map(item => {
        const inputBoxes = getScanAssistDraftBoxCount(item.品番, 0);
        if (inputBoxes <= 0) {
            return null;
        }

        return {
            ...item,
            inputBoxes,
            inputQuantity: inputBoxes * item.収容数
        };
    }).filter(Boolean);
}

function buildTanaoroshiManualSummaryItems() {
    const invalidProductNumbers = new Set(
        scanAssistState.invalidItems
            .map(item => item.品番)
            .filter(Boolean)
    );
    const manualProductNumbers = new Set(scanAssistState.manualItems.map(item => item.品番));

    const summaryItems = scanAssistState.manualItems.map(item => {
        const adjustedBoxes = getScanAssistDraftBoxCount(item.品番, item.currentBoxQuantity);
        const currentBoxes = Math.max(0, Number(item.currentBoxQuantity) || 0);
        if (adjustedBoxes === currentBoxes) {
            return null;
        }

        const oldPhysicalQuantity = Math.max(0, Number(item.currentPhysicalQuantity) || 0);
        const newPhysicalQuantity = adjustedBoxes * item.収容数;
        return {
            ...item,
            currentBoxQuantity: currentBoxes,
            countedBoxes: adjustedBoxes,
            oldPhysicalQuantity,
            newPhysicalQuantity,
            oldReservedQuantity: Math.max(0, Number(item.currentReservedQuantity) || 0),
            difference: newPhysicalQuantity - oldPhysicalQuantity,
            isNewProduct: false
        };
    }).filter(Boolean);

    tanaoroshiCountedProducts.forEach(item => {
        if (!item?.品番 || manualProductNumbers.has(item.品番) || invalidProductNumbers.has(item.品番)) {
            return;
        }

        if (item.isNewProduct) {
            summaryItems.push({ ...item });
        }
    });

    if (
        currentTanaoroshiProduct?.品番 &&
        !manualProductNumbers.has(currentTanaoroshiProduct.品番) &&
        !invalidProductNumbers.has(currentTanaoroshiProduct.品番) &&
        currentTanaoroshiProduct.isNewProduct
    ) {
        summaryItems.push({
            品番: currentTanaoroshiProduct.品番,
            品名: currentTanaoroshiProduct.品名,
            背番号: currentTanaoroshiProduct.背番号,
            収容数: currentTanaoroshiProduct.収容数,
            imageURL: currentTanaoroshiProduct.imageURL,
            isNewProduct: true,
            oldPhysicalQuantity: currentTanaoroshiProduct.currentPhysicalQuantity || 0,
            newPhysicalQuantity: currentTanaoroshiProduct.countedPieces || 0,
            oldReservedQuantity: currentTanaoroshiProduct.currentReservedQuantity || 0,
            countedBoxes: currentTanaoroshiProduct.countedBoxes || 0,
            difference: (currentTanaoroshiProduct.countedPieces || 0) - (currentTanaoroshiProduct.currentPhysicalQuantity || 0)
        });
    }

    return summaryItems;
}

function getScanAssistSummaryItems() {
    return scanAssistState.context === 'nyuko'
        ? buildNyukoManualSummaryItems()
        : buildTanaoroshiManualSummaryItems();
}

function updateScanAssistReviewButton() {
    const reviewButton = document.getElementById('scanAssistManualReviewBtn');
    const reviewText = document.getElementById('scanAssistManualReviewText');
    const pendingItems = getScanAssistManualPendingItems();

    reviewButton.disabled = pendingItems.length === 0;
    reviewText.textContent = getScanAssistText('reviewButton', [pendingItems.length]);
}

function buildNyukoManualAppliedProductData(item) {
    const cachedProductData = getNyukoCachedProductData(item.品番);

    return {
        品番: item.品番,
        品名: cachedProductData?.品名 || item.品名 || '',
        背番号: cachedProductData?.背番号 || item.背番号 || '',
        収容数: item.収容数 || cachedProductData?.収容数 || 0,
        imageURL: cachedProductData?.imageURL || item.imageURL || '',
        inventoryExists: Boolean(cachedProductData?.inventoryExists),
        currentPhysicalQuantity: Math.max(0, Number(cachedProductData?.currentPhysicalQuantity) || 0),
        currentReservedQuantity: Math.max(0, Number(cachedProductData?.currentReservedQuantity) || 0)
    };
}

function applyNyukoManualChanges(pendingItems) {
    let lastChangedProductNumber = null;

    pendingItems.forEach(item => {
        const existingIndex = nyukoInputProducts.findIndex(product => product.品番 === item.品番);

        if (item.targetBoxes <= 0) {
            if (existingIndex !== -1) {
                nyukoInputProducts.splice(existingIndex, 1);
                lastChangedProductNumber = item.品番;
            }
            return;
        }

        const productData = buildNyukoManualAppliedProductData(item);
        const nextProduct = {
            品番: productData.品番,
            品名: productData.品名,
            背番号: productData.背番号,
            収容数: productData.収容数,
            imageURL: productData.imageURL,
            inventoryExists: productData.inventoryExists,
            oldPhysicalQuantity: productData.currentPhysicalQuantity,
            oldReservedQuantity: productData.currentReservedQuantity,
            inputQuantity: item.targetBoxes * productData.収容数,
            inputBoxes: item.targetBoxes
        };

        if (existingIndex !== -1) {
            nyukoInputProducts[existingIndex] = {
                ...nyukoInputProducts[existingIndex],
                ...nextProduct
            };
        } else {
            nyukoInputProducts.push(nextProduct);
        }

        setNyukoCachedProductData(item.品番, productData, Date.now());
        lastChangedProductNumber = item.品番;
    });

    saveNyukoToStorage();
    updateNyukoSummaryList();

    if (nyukoInputProducts.length === 0) {
        currentDisplayedProduct = null;
        document.getElementById('nyukoInitialState').classList.remove('hidden');
        document.getElementById('nyukoActiveProduct').classList.add('hidden');
        return null;
    }

    const nextDisplayProductNumber = lastChangedProductNumber && nyukoInputProducts.some(product => product.品番 === lastChangedProductNumber)
        ? lastChangedProductNumber
        : nyukoInputProducts[0].品番;

    showProductInDisplay(nextDisplayProductNumber);
    flashCounterArea('success');
    return nextDisplayProductNumber;
}

function applyTanaoroshiManualChanges(pendingItems) {
    let clearedCurrentProduct = false;

    pendingItems.forEach(item => {
        const existingIndex = tanaoroshiCountedProducts.findIndex(product => product.品番 === item.品番);
        if (existingIndex !== -1) {
            tanaoroshiCountedProducts.splice(existingIndex, 1);
        }

        if (currentTanaoroshiProduct?.品番 === item.品番) {
            currentTanaoroshiProduct = null;
            clearedCurrentProduct = true;
        }

        tanaoroshiProductCache[item.品番] = {
            data: {
                品番: item.品番,
                品名: item.品名 || '',
                背番号: item.背番号 || '',
                収容数: item.収容数,
                imageURL: item.imageURL || '',
                inventoryExists: true,
                isNewProduct: false,
                currentPhysicalQuantity: Math.max(0, Number(item.currentPhysicalQuantity) || 0),
                currentReservedQuantity: Math.max(0, Number(item.currentReservedQuantity) || 0)
            },
            timestamp: Date.now()
        };

        if (item.targetBoxes === Math.max(0, Number(item.currentBoxQuantity) || 0)) {
            return;
        }

        tanaoroshiCountedProducts.push({
            品番: item.品番,
            品名: item.品名,
            背番号: item.背番号,
            収容数: item.収容数,
            imageURL: item.imageURL,
            isNewProduct: false,
            oldPhysicalQuantity: Math.max(0, Number(item.currentPhysicalQuantity) || 0),
            newPhysicalQuantity: item.targetBoxes * item.収容数,
            oldReservedQuantity: Math.max(0, Number(item.currentReservedQuantity) || 0),
            countedBoxes: item.targetBoxes,
            difference: (item.targetBoxes * item.収容数) - (Math.max(0, Number(item.currentPhysicalQuantity) || 0))
        });
    });

    saveTanaoroshiToStorage();
    updateTanaoroshiSummaryList();

    if (clearedCurrentProduct) {
        document.getElementById('tanaoroshiInitialState').classList.remove('hidden');
        document.getElementById('tanaoroshiActiveProduct').classList.add('hidden');
    }
}

async function applyScanAssistManualChanges() {
    const pendingItems = getScanAssistManualPendingItems();
    if (pendingItems.length === 0) {
        showToast(`❌ ${scanAssistState.context === 'nyuko' ? getScanAssistText('noNyukoChanges') : getScanAssistText('noInventoryChanges')}`, 'error');
        return;
    }

    const actionButton = document.getElementById('scanAssistManualReviewBtn');
    const actionLabel = document.getElementById('scanAssistManualReviewText');
    const originalLabel = actionLabel.textContent;

    actionButton.disabled = true;

    try {
        if (scanAssistState.context === 'nyuko') {
            applyNyukoManualChanges(pendingItems);
        } else {
            applyTanaoroshiManualChanges(pendingItems);
        }

        closeScanAssistSession();
        showToast(`✅ ${getScanAssistText('addedToListToast', [pendingItems.length])}`, 'success');
    } catch (error) {
        console.error('Error applying manual scan assist changes:', error);
        showToast(`❌ ${t('error-occurred')}`, 'error');
    } finally {
        actionButton.disabled = false;
        actionLabel.textContent = originalLabel;
    }
}

function createScanAssistSummaryRow(item) {
    if (scanAssistState.context === 'nyuko') {
        return `
            <div class='rounded-2xl border border-gray-200 bg-white p-4 shadow-sm'>
                <div class='flex items-start justify-between gap-4'>
                    <div>
                        <div class='flex flex-wrap items-center gap-2'>
                            <span class='rounded-full bg-purple-100 px-3 py-1 text-sm font-bold text-purple-700'>${item.背番号 || '-'}</span>
                            <span class='text-sm font-semibold text-gray-900'>${item.品番}</span>
                        </div>
                        <p class='mt-2 text-sm text-gray-700'>${item.品名 || '-'}</p>
                    </div>
                    <div class='text-right'>
                        <p class='text-xl font-bold text-purple-700'>${item.inputBoxes}${getScanAssistText('boxesLabel')}</p>
                        <p class='text-sm text-gray-500'>${item.inputQuantity}${getScanAssistText('piecesLabel')}</p>
                    </div>
                </div>
            </div>
        `;
    }

    const diffClass = item.difference > 0 ? 'text-green-600' : item.difference < 0 ? 'text-red-600' : 'text-gray-500';
    const diffLabel = `${item.difference > 0 ? '+' : ''}${item.difference}${getScanAssistText('piecesLabel')}`;

    return `
        <div class='rounded-2xl border border-gray-200 bg-white p-4 shadow-sm'>
            <div class='flex items-start justify-between gap-4'>
                <div>
                    <div class='flex flex-wrap items-center gap-2'>
                        <span class='rounded-full bg-blue-100 px-3 py-1 text-sm font-bold text-blue-700'>${item.背番号 || '-'}</span>
                        <span class='text-sm font-semibold text-gray-900'>${item.品番}</span>
                    </div>
                    <p class='mt-2 text-sm text-gray-700'>${item.品名 || '-'}</p>
                    <p class='mt-2 text-sm text-gray-500'>${item.currentBoxQuantity}${getScanAssistText('boxesLabel')} (${item.oldPhysicalQuantity}${getScanAssistText('piecesLabel')}) → ${item.countedBoxes}${getScanAssistText('boxesLabel')} (${item.newPhysicalQuantity}${getScanAssistText('piecesLabel')})</p>
                </div>
                <div class='text-right'>
                    <p class='text-sm font-semibold ${diffClass}'>${diffLabel}</p>
                </div>
            </div>
        </div>
    `;
}

function openScanAssistSummary() {
    const summaryItems = getScanAssistSummaryItems();
    if (summaryItems.length === 0) {
        showToast(`❌ ${scanAssistState.context === 'nyuko' ? getScanAssistText('noNyukoSummary') : getScanAssistText('noInventorySummary')}`, 'error');
        return;
    }

    const context = getScanAssistContext(scanAssistState.context);
    document.getElementById('scanAssistSummaryLabel').textContent = context.label;
    document.getElementById('scanAssistSummaryTitle').textContent = scanAssistState.context === 'nyuko'
        ? getScanAssistText('summaryTitleNyuko')
        : getScanAssistText('summaryTitleInventory');
    document.getElementById('scanAssistSummaryDescription').textContent = scanAssistState.context === 'nyuko'
        ? getScanAssistText('summaryDescriptionNyuko')
        : getScanAssistText('summaryDescriptionInventory');
    document.getElementById('scanAssistSummaryBackText').textContent = getScanAssistText('summaryBack');
    document.getElementById('scanAssistSummaryConfirmText').textContent = getScanAssistText('summaryConfirm');
    document.getElementById('scanAssistSummaryList').innerHTML = summaryItems.map(createScanAssistSummaryRow).join('');
    document.getElementById('scanAssistManualModal').classList.add('hidden');
    document.getElementById('scanAssistSummaryModal').classList.remove('hidden');
    syncBlockingModalBodyScroll();
}

function resetTanaoroshiStateAfterSuccessfulSubmission() {
    localStorage.removeItem(TANAOROSHI_STORAGE_KEY);
    localStorage.removeItem(TANAOROSHI_CACHE_KEY);
    tanaoroshiCountedProducts = [];
    tanaoroshiProductCache = {};
    currentTanaoroshiProduct = null;
    document.getElementById('tanaoroshiInitialState').classList.remove('hidden');
    document.getElementById('tanaoroshiActiveProduct').classList.add('hidden');
    updateTanaoroshiSummaryList();
}

function resetNyukoStateAfterSuccessfulSubmission() {
    localStorage.removeItem(NYUKO_STORAGE_KEY);
    localStorage.removeItem(NYUKO_CACHE_KEY);
    nyukoInputProducts = [];
    nyukoProductCache = {};
    currentDisplayedProduct = null;
    document.getElementById('nyukoInitialState').classList.remove('hidden');
    document.getElementById('nyukoActiveProduct').classList.add('hidden');
    updateNyukoSummaryList();
}

async function submitTanaoroshiProductsPayload(countedProducts) {
    const response = await fetch(`${API_BASE_URL}/tanaoroshi/submit`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            countedProducts,
            submittedBy: currentWorker || 'Tablet User',
            factory
        })
    });

    if (!response.ok) {
        throw new Error('Submission failed');
    }

    return response.json();
}

async function submitNyukoProductsPayload(inputProducts) {
    const response = await fetch(`${API_BASE_URL}/nyuko/submit`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            inputProducts,
            submittedBy: currentWorker || 'Tablet User',
            factory
        })
    });

    if (!response.ok) {
        throw new Error('Submission failed');
    }

    return response.json();
}

async function confirmScanAssistSummary() {
    const summaryItems = getScanAssistSummaryItems();
    if (summaryItems.length === 0) {
        return;
    }

    const confirmButton = document.getElementById('scanAssistSummaryConfirmBtn');
    const confirmLabel = document.getElementById('scanAssistSummaryConfirmText');
    const originalLabel = confirmLabel.textContent;
    const overlayId = scanAssistState.context === 'nyuko' ? 'nyukoUploadOverlay' : 'tanaoroshiUploadOverlay';

    confirmButton.disabled = true;
    confirmLabel.textContent = t('submitting');
    document.getElementById(overlayId).classList.remove('hidden');

    try {
        if (scanAssistState.context === 'nyuko') {
            const result = await submitNyukoProductsPayload(summaryItems);
            resetNyukoStateAfterSuccessfulSubmission();
            closeScanAssistSession();
            showToast(`✅ ${result.processedCount}${t('products-received')}`, 'success');
        } else {
            const result = await submitTanaoroshiProductsPayload(summaryItems);
            resetTanaoroshiStateAfterSuccessfulSubmission();
            closeScanAssistSession();
            showToast(`✅ ${result.processedCount}${t('products-updated')}`, 'success');
        }
    } catch (error) {
        console.error('Error submitting scan assist summary:', error);
        showToast(`❌ ${t('submit-failed')}`, 'error');
    } finally {
        document.getElementById(overlayId).classList.add('hidden');
        confirmButton.disabled = false;
        confirmLabel.textContent = originalLabel;
    }
}

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
let tanaoroshiProductCache = {}; // Cache for fetched product data
let currentTanaoroshiProduct = null; // Currently counting product (strict mode - locked until 完了)
let tanaoroshiScanBuffer = ''; // Buffer for QR scan input
const TANAOROSHI_STORAGE_KEY = 'nodaSystem_tanaoroshiCountedProducts';
const TANAOROSHI_CACHE_KEY = 'nodaSystem_tanaoroshiProductCache';
const TANAOROSHI_CACHE_EXPIRATION = 5 * 60 * 1000; // 5 minutes in milliseconds

// Initialize tanaoroshi when inventory screen is shown
function openInventorySystem() {
    // Activate audio for inventory mode (beep + alert sounds)
    if (window.audioManager) {
        audioManager.activateForMode('inventory');
    }
    showScreen('inventory');
    initializeTanaoroshi();
}

function initializeTanaoroshi() {
    console.log('🔄 Initializing Tanaoroshi system...');
    
    // Clear product cache to ensure fresh data
    console.log('🗑️ Clearing tanaoroshi product cache...');
    tanaoroshiProductCache = {};
    localStorage.removeItem(TANAOROSHI_CACHE_KEY);
    
    // Load from localStorage if available
    loadTanaoroshiFromStorage();
    
    // Reset current product (strict mode - no product locked initially)
    currentTanaoroshiProduct = null;
    tanaoroshiScanBuffer = '';
    
    // Show initial state
    document.getElementById('tanaoroshiInitialState').classList.remove('hidden');
    document.getElementById('tanaoroshiActiveProduct').classList.add('hidden');
    
    // Update summary list
    updateTanaoroshiSummaryList();
    
    // Setup keyboard listener for HID mode QR scanner
    setupTanaoroshiKeyboardListener();
    
    console.log('✅ Tanaoroshi system ready');
}

// Load tanaoroshi data from localStorage
function loadTanaoroshiFromStorage() {
    try {
        const savedProducts = localStorage.getItem(TANAOROSHI_STORAGE_KEY);
        const savedCache = localStorage.getItem(TANAOROSHI_CACHE_KEY);
        
        if (savedProducts) {
            tanaoroshiCountedProducts = JSON.parse(savedProducts);
            console.log('💾 Loaded', tanaoroshiCountedProducts.length, 'counted products from storage');
        } else {
            tanaoroshiCountedProducts = [];
        }
        
        if (savedCache) {
            tanaoroshiProductCache = JSON.parse(savedCache);
            console.log('💾 Loaded product cache from storage');
        } else {
            tanaoroshiProductCache = {};
        }
    } catch (error) {
        console.error('Error loading tanaoroshi from storage:', error);
        tanaoroshiCountedProducts = [];
        tanaoroshiProductCache = {};
    }
}

// Save tanaoroshi data to localStorage
function saveTanaoroshiToStorage() {
    try {
        localStorage.setItem(TANAOROSHI_STORAGE_KEY, JSON.stringify(tanaoroshiCountedProducts));
        localStorage.setItem(TANAOROSHI_CACHE_KEY, JSON.stringify(tanaoroshiProductCache));
        console.log('💾 Saved', tanaoroshiCountedProducts.length, 'counted products to storage');
    } catch (error) {
        console.error('Error saving tanaoroshi to storage:', error);
    }
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
    // Only process if on inventory screen
    if (currentScreen !== 'inventory') {
        return;
    }

    if (hasBlockingModalOpen()) {
        return;
    }
    
    // Ignore if user is typing in an input field
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
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
        return false;
    }

    const scannedProductNumber = parts[0].trim();
    const scannedBoxQuantity = parseInt(parts[1].trim());

    if (!scannedProductNumber || isNaN(scannedBoxQuantity)) {
        showToast('❌ ' + t('qr-data-invalid'), 'error');
        return false;
    }
    
    // STRICT MODE: If a product is already being counted, only allow same product
    if (currentTanaoroshiProduct) {
        // Check if scanned product matches current product
        if (scannedProductNumber !== currentTanaoroshiProduct.品番) {
            showToast(`❌ ${t('product-number-mismatch')} ${currentTanaoroshiProduct.品番}`, 'error');
            
            // Play alert sound on error, stop after 2 seconds
            if (window.audioManager) {
                audioManager.playAlert();
                setTimeout(() => {
                    audioManager.stopAlert();
                }, 2000);
            }
            
            // Flash red on counter area
            flashTanaoroshiCounterArea('error');
            
            return false;
        }
        
        // Validate box quantity matches 収容数
        if (scannedBoxQuantity !== currentTanaoroshiProduct.収容数) {
            showToast(`❌ ${t('box-quantity-mismatch')} ${currentTanaoroshiProduct.収容数}${t('box-quantity-suffix')}`, 'error');
            
            // Play alert sound on error, stop after 2 seconds
            if (window.audioManager) {
                audioManager.playAlert();
                setTimeout(() => {
                    audioManager.stopAlert();
                }, 2000);
            }
            
            return false;
        }
        
        // Increment count for same product
        currentTanaoroshiProduct.countedBoxes += 1;
        currentTanaoroshiProduct.countedPieces += scannedBoxQuantity;
        
        // Update display
        updateTanaoroshiCounterDisplay();
        
        // Play beep sound on successful scan
        if (window.audioManager) {
            audioManager.playBeep();
        }
        
        // Flash success
        flashTanaoroshiCounterArea('success');
        
        console.log(`✅ Box scanned: ${currentTanaoroshiProduct.countedBoxes} boxes (${currentTanaoroshiProduct.countedPieces} pieces)`);
        return true;
    } else {
        // No product locked - start counting a new product
        return startCountingProduct(scannedProductNumber, scannedBoxQuantity);
    }
}

// Start counting a new product (initial scan - count starts at 1)
async function startCountingProduct(productNumber, boxQuantity) {
    try {
        let productData;
        
        // Check if we have cached data for this product (with expiration check)
        const cachedEntry = tanaoroshiProductCache[productNumber];
        const now = Date.now();
        
        if (cachedEntry && cachedEntry.timestamp && (now - cachedEntry.timestamp) < TANAOROSHI_CACHE_EXPIRATION) {
            productData = cachedEntry.data;
            console.log('📋 Using cached product data:', productNumber);
            console.log('📦 Cache age:', Math.floor((now - cachedEntry.timestamp) / 1000), 'seconds');
            console.log('📦 Cached data details:', {
                currentPhysicalQuantity: productData.currentPhysicalQuantity,
                currentReservedQuantity: productData.currentReservedQuantity,
                inventoryExists: productData.inventoryExists
            });
        } else {
            if (cachedEntry && cachedEntry.timestamp) {
                console.log('⏰ Cache expired for:', productNumber, '- fetching fresh data');
            } else {
                console.log('🔍 No cache found for:', productNumber, '- fetching from API');
            }
            
            // Fetch product data from API
            console.log(`🔍 Fetching product data from API: ${productNumber}`);
            showToast('🔍 ' + t('fetching-product-info'), 'info');

            const response = await fetch(`${API_BASE_URL}/tanaoroshi/${productNumber}`);

            if (!response.ok) {
                if (response.status === 404) {
                    showToast('❌ ' + t('product-not-found-error'), 'error');
                } else {
                    showToast('❌ ' + t('product-fetch-failed'), 'error');
                }
                return false;
            }
            
            productData = await response.json();
            console.log('✅ Product data fetched from API:', productData);
            console.log('📦 API returned inventory:', {
                品番: productData.品番,
                currentPhysicalQuantity: productData.currentPhysicalQuantity,
                currentReservedQuantity: productData.currentReservedQuantity,
                inventoryExists: productData.inventoryExists
            });
            
            // Cache the product data with timestamp
            tanaoroshiProductCache[productNumber] = {
                data: productData,
                timestamp: Date.now()
            };
            console.log('💾 Cached product data for:', productNumber, 'at', new Date().toLocaleString());
            saveTanaoroshiToStorage();
        }
        
        // Validate box quantity matches 収容数
        if (boxQuantity !== productData.収容数) {
            showToast(`❌ ${t('box-quantity-mismatch')} ${productData.収容数}${t('box-quantity-suffix')}`, 'error');
            
            // Play alert sound on error, stop after 2 seconds
            if (window.audioManager) {
                audioManager.playAlert();
                setTimeout(() => {
                    audioManager.stopAlert();
                }, 2000);
            }
            
            return false;
        }
        
        // Check if this product already exists in the counted list
        const existingIndex = tanaoroshiCountedProducts.findIndex(p => p.品番 === productNumber);
        if (existingIndex !== -1) {
            const existingProduct = tanaoroshiCountedProducts[existingIndex];
            const confirmOverwrite = confirm(
                `⚠️ この製品は既にリストに存在します。\n\n` +
                `品番: ${existingProduct.品番}\n` +
                `現在のカウント: ${existingProduct.newPhysicalQuantity}個 (${existingProduct.countedBoxes}箱)\n\n` +
                `上書きしますか？`
            );
            
            // Restore keyboard focus after confirm dialog
            document.body.focus();
            
            if (!confirmOverwrite) {
                showToast('キャンセルしました', 'info');
                return false;
            }
            
            // Remove existing entry
            tanaoroshiCountedProducts.splice(existingIndex, 1);
            saveTanaoroshiToStorage();
            updateTanaoroshiSummaryList();
            showToast('📝 既存データを上書きします', 'info');
        }
        
        // Check if this is a new product (not in inventory)
        if (productData.isNewProduct) {
            const confirmAdd = confirm(
                `⚠️ ${t('item-not-in-inventory')}\n` +
                `${t('product-number-label')}: ${productData.品番}\n` +
                `${t('product-name') || '品名'}: ${productData.品名 || '-'}\n\n` +
                `${t('item-not-in-inventory-detail').split('\n').pop()}`
            );
            
            // Restore keyboard focus after confirm dialog
            document.body.focus();

            if (!confirmAdd) {
                showToast(t('cancelled'), 'info');
                return false;
            }

            showToast('📦 ' + t('adding-new-product'), 'info');
        }
        
        // Initialize current product object with count = 1 (initial scan counts)
        currentTanaoroshiProduct = {
            品番: productData.品番,
            品名: productData.品名,
            背番号: productData.背番号,
            収容数: productData.収容数,
            imageURL: productData.imageURL,
            isNewProduct: productData.isNewProduct || false,
            currentPhysicalQuantity: productData.currentPhysicalQuantity || 0,
            currentReservedQuantity: productData.currentReservedQuantity || 0,
            countedBoxes: 1, // Start at 1, not 0
            countedPieces: boxQuantity // Start with first box quantity
        };
        
        // Update product display
        updateTanaoroshiProductDisplay();
        
        // Play beep sound on successful scan
        if (window.audioManager) {
            audioManager.playBeep();
        }
        
        // Flash success
        flashTanaoroshiCounterArea('success');

        showToast('✅ ' + t('count-start'), 'success');
        return true;

    } catch (error) {
        console.error('Error starting product count:', error);
        showToast('❌ ' + t('error-occurred'), 'error');
        return false;
    }
}

// Update the product display area
function updateTanaoroshiProductDisplay() {
    if (!currentTanaoroshiProduct) return;
    
    const product = currentTanaoroshiProduct;
    
    // Hide initial state, show active product
    document.getElementById('tanaoroshiInitialState').classList.add('hidden');
    document.getElementById('tanaoroshiActiveProduct').classList.remove('hidden');
    
    // Update product info
    document.getElementById('tanaoroshiDisplayProductNumber').textContent = product.品番;
    document.getElementById('tanaoroshiDisplaySebangou').textContent = product.背番号 || '-';
    document.getElementById('tanaoroshiDisplayProductName').textContent = product.品名 || '-';
    document.getElementById('tanaoroshiDisplayBoxSize').textContent = product.収容数;
    
    // Show/hide NEW badge
    const newBadge = document.getElementById('tanaoroshiNewProductBadge');
    if (product.isNewProduct) {
        newBadge.classList.remove('hidden');
    } else {
        newBadge.classList.add('hidden');
    }
    
    // Update image
    const imgElement = document.getElementById('tanaoroshiDisplayImage');
    const noImageElement = document.getElementById('tanaoroshiNoImage');
    
    if (product.imageURL) {
        imgElement.src = product.imageURL;
        imgElement.classList.remove('hidden');
        noImageElement.classList.add('hidden');
    } else {
        imgElement.classList.add('hidden');
        noImageElement.classList.remove('hidden');
    }
    
    // Update expected inventory display
    const expectedPieces = product.currentPhysicalQuantity;
    const expectedBoxes = Math.ceil(expectedPieces / product.収容数);
    
    if (product.isNewProduct) {
        document.getElementById('tanaoroshiDisplayExpectedQty').innerHTML = 
            `<span class="text-gray-400">0個 (0箱)</span> <span class="text-xs text-orange-600 ml-2">(在庫なし)</span>`;
    } else {
        document.getElementById('tanaoroshiDisplayExpectedQty').textContent = 
            `${expectedPieces}個 (${expectedBoxes}箱)`;
    }
    
    // Update counter display
    updateTanaoroshiCounterDisplay();
}

// Update the counter display
function updateTanaoroshiCounterDisplay() {
    if (!currentTanaoroshiProduct) return;
    
    const product = currentTanaoroshiProduct;
    const countedBoxes = product.countedBoxes;
    const countedPieces = product.countedPieces;
    const expectedPieces = product.currentPhysicalQuantity;
    
    // Update counter text
    document.getElementById('tanaoroshiDisplayBoxCount').textContent = countedBoxes;
    document.getElementById('tanaoroshiDisplayPieceCount').textContent = `(${countedPieces} 個)`;
    
    // Update status indicator
    const statusIndicator = document.getElementById('tanaoroshiStatusIndicator');
    const statusText = document.getElementById('tanaoroshiStatusText');
    
    if (countedPieces < expectedPieces) {
        statusIndicator.className = 'inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700';
        statusText.textContent = `不足 (${expectedPieces - countedPieces}個)`;
    } else if (countedPieces > expectedPieces) {
        statusIndicator.className = 'inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700';
        statusText.textContent = `超過 (+${countedPieces - expectedPieces}個)`;
    } else {
        statusIndicator.className = 'inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700';
        statusText.textContent = '✓ 一致';
    }
}

// Decrement the currently active (in-progress) tanaoroshi product by 1 box
function decrementCurrentTanaoroshi() {
    if (!currentTanaoroshiProduct) return;

    if (currentTanaoroshiProduct.countedBoxes <= 1) {
        // Reset to 0 without removing — user may still be counting
        currentTanaoroshiProduct.countedBoxes = 0;
        currentTanaoroshiProduct.countedPieces = 0;
        updateTanaoroshiCounterDisplay();
        flashTanaoroshiCounterArea('error');
        showToast('カウントを0に戻しました', 'info');
        return;
    }

    currentTanaoroshiProduct.countedBoxes -= 1;
    currentTanaoroshiProduct.countedPieces -= currentTanaoroshiProduct.収容数;
    updateTanaoroshiCounterDisplay();
    flashTanaoroshiCounterArea('error');
    showToast(`1箱減らしました (${currentTanaoroshiProduct.countedBoxes}箱)`, 'info');
}

// Flash counter area for visual feedback
function flashTanaoroshiCounterArea(type) {
    const counterArea = document.getElementById('tanaoroshiCounterArea');
    if (!counterArea) return;
    
    if (type === 'success') {
        counterArea.classList.add('bg-green-100', 'border-green-500');
        setTimeout(() => {
            counterArea.classList.remove('bg-green-100', 'border-green-500');
        }, 300);
    } else if (type === 'error') {
        counterArea.classList.add('bg-red-100', 'border-red-500');
        setTimeout(() => {
            counterArea.classList.remove('bg-red-100', 'border-red-500');
        }, 1000);
    }
}

// Complete counting for current product
async function completeTanaoroshiCount() {
    if (!currentTanaoroshiProduct) {
        showToast('❌ カウント中の製品がありません', 'error');
        return;
    }

    const product = currentTanaoroshiProduct;
    const countedPieces = product.countedPieces;
    const expectedPieces = product.currentPhysicalQuantity;
    const difference = countedPieces - expectedPieces;
    const isNewProduct = product.isNewProduct || false;
    
    // Add to counted products list (no confirmation needed)
    tanaoroshiCountedProducts.push({
        品番: product.品番,
        品名: product.品名,
        背番号: product.背番号,
        収容数: product.収容数,
        imageURL: product.imageURL,
        isNewProduct: isNewProduct,
        oldPhysicalQuantity: expectedPieces,
        newPhysicalQuantity: countedPieces,
        oldReservedQuantity: product.currentReservedQuantity,
        countedBoxes: product.countedBoxes,
        difference: difference
    });
    
    // Save to localStorage
    saveTanaoroshiToStorage();
    
    // Clear current product (unlock for next product)
    currentTanaoroshiProduct = null;
    
    // Reset display to initial state
    document.getElementById('tanaoroshiInitialState').classList.remove('hidden');
    document.getElementById('tanaoroshiActiveProduct').classList.add('hidden');

    // Update summary list
    updateTanaoroshiSummaryList();

    showToast('✅ ' + t('count-complete'), 'success');
    
    // Restore keyboard focus for scanning
    document.body.focus();
}

// Update summary list display
function updateTanaoroshiSummaryList() {
    const itemsList = document.getElementById('tanaoroshiItemsList');
    const itemCount = document.getElementById('tanaoroshiItemCount');
    const emptyState = document.getElementById('tanaoroshiEmptyState');
    const submitBtn = document.getElementById('submitTanaoroshiBtn');
    const resetBtn = document.getElementById('resetTanaoroshiBtn');
    
    // Update count
    itemCount.textContent = `(${tanaoroshiCountedProducts.length})`;
    
    // Show/hide empty state and buttons
    if (tanaoroshiCountedProducts.length === 0) {
        emptyState.classList.remove('hidden');
        itemsList.classList.add('hidden');
        submitBtn.classList.add('hidden');
        if (resetBtn) resetBtn.classList.add('hidden');
    } else {
        emptyState.classList.add('hidden');
        itemsList.classList.remove('hidden');
        submitBtn.classList.remove('hidden');
        if (resetBtn) resetBtn.classList.remove('hidden');
        
        // Clear and rebuild list
        itemsList.innerHTML = '';
        
        tanaoroshiCountedProducts.forEach((product, index) => {
            const row = createTanaoroshiSummaryRow(product, index);
            itemsList.appendChild(row);
        });
    }
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
    
    // Row number (1-based)
    const rowNumber = index + 1;
    
    row.innerHTML = `
        <div class="flex items-center justify-between">
            <div class="flex items-center space-x-4 flex-1">
                <!-- Row Number -->
                <div class="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <span class="text-blue-700 font-bold text-lg">${rowNumber}</span>
                </div>
                ${product.imageURL ? `
                    <img src="${product.imageURL}" alt="${product.品番}" class="w-16 h-16 object-contain rounded border border-gray-200">
                ` : `
                    <div class="w-16 h-16 bg-gray-100 rounded border border-gray-200 flex items-center justify-center">
                        <i class="fas fa-box text-gray-400"></i>
                    </div>
                `}
                <div class="flex-1">
                    <div class="flex items-center space-x-2">
                        <h4 class="font-bold text-gray-900">${product.品番} <span class="text-blue-600">(${product.背番号 || '-'})</span></h4>
                        ${isNewProduct ? `
                            <span class="px-2 py-1 bg-orange-100 text-orange-700 text-xs font-bold rounded">NEW</span>
                        ` : ''}
                    </div>
                    <p class="text-sm text-gray-600">${product.品名 || '-'}</p>
                    <div class="flex items-center space-x-4 mt-2">
                        <span class="text-sm">
                            <span class="text-gray-500 ${isNewProduct ? '' : 'line-through'}">${product.oldPhysicalQuantity}個 (${oldBoxes}箱)</span>
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
                <button onclick="decrementTanaoroshiProduct(${index})" class="w-10 h-10 bg-orange-100 hover:bg-orange-200 text-orange-700 rounded-lg transition-colors flex items-center justify-center text-lg font-bold" title="1箱減らす">
                    −
                </button>
                <button onclick="deleteTanaoroshiProduct(${index})" class="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors">
                    <i class="fas fa-trash mr-1"></i>削除
                </button>
            </div>
        </div>
    `;
    
    return row;
}

// Decrement counted product by 1 box
function decrementTanaoroshiProduct(index) {
    const product = tanaoroshiCountedProducts[index];
    if (!product) return;

    if (product.countedBoxes <= 1) {
        if (!confirm(`${product.品番} の最後の1箱です。完全に削除しますか？`)) return;
        tanaoroshiCountedProducts.splice(index, 1);
        // If this was the active product, reset it
        if (currentTanaoroshiProduct && currentTanaoroshiProduct.品番 === product.品番) {
            currentTanaoroshiProduct = null;
            document.getElementById('tanaoroshiInitialState').classList.remove('hidden');
            document.getElementById('tanaoroshiActiveProduct').classList.add('hidden');
        }
        saveTanaoroshiToStorage();
        updateTanaoroshiSummaryList();
        showToast('削除しました', 'info');
        return;
    }

    // Decrement by 1 box
    product.countedBoxes -= 1;
    product.countedPieces -= product.収容数;
    product.newPhysicalQuantity -= product.収容数;
    product.difference = product.newPhysicalQuantity - product.oldPhysicalQuantity;
    saveTanaoroshiToStorage();

    // If this is the active product, refresh counter display
    if (currentTanaoroshiProduct && currentTanaoroshiProduct.品番 === product.品番) {
        currentTanaoroshiProduct.countedBoxes = product.countedBoxes;
        currentTanaoroshiProduct.countedPieces = product.countedPieces;
        updateTanaoroshiCounterDisplay();
        flashTanaoroshiCounterArea('error');
    }

    updateTanaoroshiSummaryList();
    showToast(`${product.品番} を1箱減らしました`, 'info');
}

// Delete counted product
function deleteTanaoroshiProduct(index) {
    const product = tanaoroshiCountedProducts[index];

    if (!confirm(t('delete-product-confirm').replace('{0}', product.品番))) {
        return;
    }

    tanaoroshiCountedProducts.splice(index, 1);
    
    // Save to localStorage
    saveTanaoroshiToStorage();
    
    updateTanaoroshiSummaryList();
    showToast(t('deleted'), 'info');
}

// Reset all tanaoroshi products
function resetAllTanaoroshiProducts() {
    if (tanaoroshiCountedProducts.length === 0 && !currentTanaoroshiProduct) {
        showToast('リストは空です', 'info');
        return;
    }
    
    if (!confirm(`${tanaoroshiCountedProducts.length}件のデータをすべて削除しますか？\nこの操作は取り消せません。`)) {
        return;
    }
    
    // Clear all data
    tanaoroshiCountedProducts = [];
    tanaoroshiProductCache = {};
    currentTanaoroshiProduct = null;
    
    // Clear localStorage
    localStorage.removeItem(TANAOROSHI_STORAGE_KEY);
    localStorage.removeItem(TANAOROSHI_CACHE_KEY);
    
    // Reset UI to initial state
    document.getElementById('tanaoroshiInitialState').classList.remove('hidden');
    document.getElementById('tanaoroshiActiveProduct').classList.add('hidden');
    
    updateTanaoroshiSummaryList();
    showToast('すべてのデータをリセットしました', 'info');
}

// Submit all counted products
async function submitTanaoroshiCount() {
    if (tanaoroshiCountedProducts.length === 0) {
        showToast('❌ ' + t('no-counted-products'), 'error');
        return;
    }
    
    // Check if there's an incomplete count
    if (currentTanaoroshiProduct) {
        showToast('❌ カウント中の製品があります。先に完了してください。', 'error');
        return;
    }

    if (!confirm(t('submit-count-confirm').replace('{0}', tanaoroshiCountedProducts.length))) {
        return;
    }

    // Get buttons and overlay
    const submitBtn = document.getElementById('submitTanaoroshiBtn');
    const resetBtn = document.getElementById('resetTanaoroshiBtn');
    const uploadOverlay = document.getElementById('tanaoroshiUploadOverlay');
    
    // Save original button content
    const originalSubmitContent = submitBtn.innerHTML;
    
    // Show upload overlay
    uploadOverlay.classList.remove('hidden');
    
    // Disable buttons and show loading state
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>送信中...';
    submitBtn.classList.add('opacity-75', 'cursor-not-allowed');
    if (resetBtn) {
        resetBtn.disabled = true;
        resetBtn.classList.add('opacity-50', 'cursor-not-allowed');
    }

    try {
        const result = await submitTanaoroshiProductsPayload(tanaoroshiCountedProducts);
        console.log('✅ Submission result:', result);

        // Hide overlay
        uploadOverlay.classList.add('hidden');
        resetTanaoroshiStateAfterSuccessfulSubmission();
        
        showToast(`✅ ${result.processedCount}${t('products-updated')}`, 'success');

    } catch (error) {
        console.error('Error submitting tanaoroshi:', error);
        
        // Hide overlay
        uploadOverlay.classList.add('hidden');
        
        showToast('❌ ' + t('submit-failed'), 'error');
        
        // Re-enable buttons on error
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalSubmitContent;
        submitBtn.classList.remove('opacity-75', 'cursor-not-allowed');
        if (resetBtn) {
            resetBtn.disabled = false;
            resetBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        }
    }
}

// ==================== END TANAOROSHI SYSTEM ====================

// ==================== NYUKO (入庫) SYSTEM ====================

// Global variables for nyuko
let nyukoInputProducts = []; // Array to store input products (accumulated)
let nyukoProductCache = {}; // Cache for fetched product data
const NYUKO_CACHE_EXPIRATION = 5 * 60 * 1000; // 5 minutes
let currentDisplayedProduct = null; // Currently displayed product number
let nyukoScanBuffer = ''; // Buffer for QR scan input
const NYUKO_STORAGE_KEY = 'nodaSystem_nyukoInputProducts';
const NYUKO_CACHE_KEY = 'nodaSystem_nyukoProductCache';

function getNyukoStoredProduct(productNumber) {
    return nyukoInputProducts.find(product => product.品番 === productNumber) || null;
}

function buildNyukoCachedProductDataFromStoredProduct(product) {
    if (!product) {
        return null;
    }

    return {
        品番: product.品番,
        品名: product.品名 || '',
        背番号: product.背番号 || '',
        収容数: product.収容数 || 0,
        imageURL: product.imageURL || '',
        inventoryExists: Boolean(product.inventoryExists),
        currentPhysicalQuantity: product.oldPhysicalQuantity || 0,
        currentReservedQuantity: product.oldReservedQuantity || 0
    };
}

function normalizeNyukoProductCacheEntry(productNumber, cacheEntry) {
    if (!cacheEntry || typeof cacheEntry !== 'object') {
        return null;
    }

    const storedProductData = buildNyukoCachedProductDataFromStoredProduct(getNyukoStoredProduct(productNumber)) || {};
    const rawData = cacheEntry.data && typeof cacheEntry.data === 'object'
        ? cacheEntry.data
        : cacheEntry;

    return {
        data: {
            ...storedProductData,
            ...rawData
        },
        timestamp: typeof cacheEntry.timestamp === 'number' ? cacheEntry.timestamp : Date.now()
    };
}

function normalizeNyukoProductCache() {
    const normalizedCache = {};

    Object.entries(nyukoProductCache).forEach(([productNumber, cacheEntry]) => {
        const normalizedEntry = normalizeNyukoProductCacheEntry(productNumber, cacheEntry);
        if (normalizedEntry) {
            normalizedCache[productNumber] = normalizedEntry;
        }
    });

    nyukoInputProducts.forEach(product => {
        if (!normalizedCache[product.品番]) {
            const storedProductData = buildNyukoCachedProductDataFromStoredProduct(product);
            if (storedProductData) {
                normalizedCache[product.品番] = {
                    data: storedProductData,
                    timestamp: Date.now()
                };
            }
        }
    });

    nyukoProductCache = normalizedCache;
}

function getNyukoCachedProductData(productNumber) {
    const normalizedEntry = normalizeNyukoProductCacheEntry(productNumber, nyukoProductCache[productNumber]);
    if (normalizedEntry) {
        nyukoProductCache[productNumber] = normalizedEntry;
        return normalizedEntry.data;
    }

    const storedProductData = buildNyukoCachedProductDataFromStoredProduct(getNyukoStoredProduct(productNumber));
    if (!storedProductData) {
        return null;
    }

    nyukoProductCache[productNumber] = {
        data: storedProductData,
        timestamp: Date.now()
    };

    return storedProductData;
}

function setNyukoCachedProductData(productNumber, productData, timestamp = Date.now()) {
    const storedProductData = buildNyukoCachedProductDataFromStoredProduct(getNyukoStoredProduct(productNumber)) || {};
    nyukoProductCache[productNumber] = {
        data: {
            ...storedProductData,
            ...productData
        },
        timestamp
    };
}

// Initialize nyuko when screen is shown
function openNyukoSystem() {
    // Activate audio for nyuko mode (beep + alert sounds)
    if (window.audioManager) {
        audioManager.activateForMode('nyuko');
    }
    
    // Clear product cache to ensure fresh data
    console.log('🗑️ Clearing nyukoProductCache on open...');
    console.log('📦 Cache before clear:', Object.keys(nyukoProductCache));
    nyukoProductCache = {};
    console.log('✅ Cache cleared');
    
    showScreen('nyuko');
    initializeNyuko();
}

function initializeNyuko() {
    console.log('🔄 Initializing Nyuko system...');
    
    // Load from localStorage if available
    loadNyukoFromStorage();
    
    // Reset scan buffer and displayed product
    currentDisplayedProduct = null;
    nyukoScanBuffer = '';
    
    // Show initial state or last displayed product
    if (nyukoInputProducts.length > 0) {
        // Show the first product in the list
        const firstProduct = nyukoInputProducts[0];
        const firstProductData = getNyukoCachedProductData(firstProduct.品番);
        if (firstProductData) {
            updateProductDisplay(firstProduct.品番, firstProductData);
        } else {
            document.getElementById('nyukoInitialState').classList.remove('hidden');
            document.getElementById('nyukoActiveProduct').classList.add('hidden');
        }
    } else {
        document.getElementById('nyukoInitialState').classList.remove('hidden');
        document.getElementById('nyukoActiveProduct').classList.add('hidden');
    }
    
    // Update summary list
    updateNyukoSummaryList();
    
    // Setup keyboard listener for HID mode QR scanner
    setupNyukoKeyboardListener();
    
    console.log('✅ Nyuko system ready');
}

// Load nyuko data from localStorage
function loadNyukoFromStorage() {
    try {
        const savedProducts = localStorage.getItem(NYUKO_STORAGE_KEY);
        const savedCache = localStorage.getItem(NYUKO_CACHE_KEY);
        
        if (savedProducts) {
            nyukoInputProducts = JSON.parse(savedProducts);
            console.log('💾 Loaded', nyukoInputProducts.length, 'products from storage');
        } else {
            nyukoInputProducts = [];
        }
        
        if (savedCache) {
            nyukoProductCache = JSON.parse(savedCache);
            console.log('💾 Loaded product cache from storage');
        } else {
            nyukoProductCache = {};
        }

        normalizeNyukoProductCache();
    } catch (error) {
        console.error('Error loading nyuko from storage:', error);
        nyukoInputProducts = [];
        nyukoProductCache = {};
    }
}

// Save nyuko data to localStorage
function saveNyukoToStorage() {
    try {
        normalizeNyukoProductCache();
        localStorage.setItem(NYUKO_STORAGE_KEY, JSON.stringify(nyukoInputProducts));
        localStorage.setItem(NYUKO_CACHE_KEY, JSON.stringify(nyukoProductCache));
        console.log('💾 Saved', nyukoInputProducts.length, 'products to storage');
    } catch (error) {
        console.error('Error saving nyuko to storage:', error);
    }
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

    if (hasBlockingModalOpen()) {
        return;
    }
    
    // Ignore if user is typing in an input field
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
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
        return false;
    }

    const scannedProductNumber = parts[0].trim();
    const scannedBoxQuantity = parseInt(parts[1].trim());

    if (!scannedProductNumber || isNaN(scannedBoxQuantity)) {
        showToast('❌ ' + t('qr-data-invalid'), 'error');
        return false;
    }
    
    // Process the scan - fetch product data if needed, then add to list
    return processNyukoProductScan(scannedProductNumber, scannedBoxQuantity);
}

// Process product scan - fetch data and add to list
async function processNyukoProductScan(productNumber, boxQuantity) {
    try {
        let productData;
        
        // Check if we have cached data for this product (with expiration check)
        const cachedEntry = nyukoProductCache[productNumber];
        const cachedProductData = getNyukoCachedProductData(productNumber);
        const now = Date.now();
        
        if (cachedEntry && cachedEntry.timestamp && (now - cachedEntry.timestamp) < NYUKO_CACHE_EXPIRATION) {
            productData = cachedProductData;
            console.log('📋 Using cached product data:', productNumber);
            console.log('📦 Cache age:', Math.floor((now - cachedEntry.timestamp) / 1000), 'seconds');
            console.log('📦 Cached data details:', {
                currentPhysicalQuantity: productData.currentPhysicalQuantity,
                currentReservedQuantity: productData.currentReservedQuantity,
                inventoryExists: productData.inventoryExists
            });
        } else {
            if (cachedEntry && cachedEntry.timestamp) {
                console.log('⏰ Cache expired for:', productNumber, '- fetching fresh data');
            } else {
                console.log('🔍 No cache found for:', productNumber, '- fetching from API');
            }
            
            // Fetch product data from API
            console.log(`🔍 Fetching product data from API: ${productNumber}`);
            showToast('🔍 ' + t('fetching-product-info'), 'info');

            const response = await fetch(`${API_BASE_URL}/nyuko/${productNumber}`);

            if (!response.ok) {
                if (response.status === 404) {
                    showToast('❌ ' + t('product-not-found-error'), 'error');
                } else {
                    showToast('❌ ' + t('product-fetch-failed'), 'error');
                }
                
                // Play alert sound on error, stop after 2 seconds
                if (window.audioManager) {
                    audioManager.playAlert();
                    setTimeout(() => {
                        audioManager.stopAlert();
                    }, 2000);
                }
                
                return false;
            }
            
            productData = await response.json();
            console.log('✅ Product data fetched from API:', productData);
            console.log('📦 API returned inventory:', {
                品番: productData.品番,
                currentPhysicalQuantity: productData.currentPhysicalQuantity,
                currentReservedQuantity: productData.currentReservedQuantity,
                inventoryExists: productData.inventoryExists
            });
            
            // Cache the product data with timestamp
            setNyukoCachedProductData(productNumber, productData, Date.now());
            console.log('💾 Cached product data for:', productNumber, 'at', new Date().toLocaleString());
        }
        
        // Validate box quantity matches 収容数
        if (boxQuantity !== productData.収容数) {
            showToast(`❌ ${t('box-quantity-mismatch')} ${productData.収容数}${t('box-quantity-suffix')}`, 'error');
            
            // Play alert sound on error, stop after 2 seconds
            if (window.audioManager) {
                audioManager.playAlert();
                setTimeout(() => {
                    audioManager.stopAlert();
                }, 2000);
            }
            
            // Flash red on counter area if product is displayed
            if (currentDisplayedProduct === productNumber) {
                flashCounterArea('error');
            }
            
            return false;
        }
        
        // Add to list or increment existing entry
        addOrIncrementProduct(productNumber, productData, boxQuantity);
        
        // Update display to show this product
        updateProductDisplay(productNumber, productData);
        
        // Play beep sound on successful scan
        if (window.audioManager) {
            audioManager.playBeep();
        }
        
        // Flash success on counter area
        flashCounterArea('success');
        return true;
        
    } catch (error) {
        console.error('Error processing product scan:', error);
        showToast('❌ ' + t('error-occurred'), 'error');
        
        // Play alert sound on error, stop after 2 seconds
        if (window.audioManager) {
            audioManager.playAlert();
            setTimeout(() => {
                audioManager.stopAlert();
            }, 2000);
        }
        return false;
    }
}

// Add product to list or increment if already exists
function addOrIncrementProduct(productNumber, productData, boxQuantity) {
    // Find existing entry in the list
    const existingIndex = nyukoInputProducts.findIndex(p => p.品番 === productNumber);
    
    if (existingIndex >= 0) {
        // Increment existing entry
        nyukoInputProducts[existingIndex].inputBoxes += 1;
        nyukoInputProducts[existingIndex].inputQuantity += boxQuantity;
        console.log(`📦 Incremented ${productNumber}: ${nyukoInputProducts[existingIndex].inputBoxes} boxes`);
    } else {
        // Add new entry with count = 1
        console.log('📝 Adding new product to list:', {
            品番: productData.品番,
            oldPhysicalQuantity: productData.currentPhysicalQuantity || 0,
            oldReservedQuantity: productData.currentReservedQuantity || 0,
            inputQuantity: boxQuantity
        });
        
        nyukoInputProducts.push({
            品番: productData.品番,
            品名: productData.品名,
            背番号: productData.背番号,
            収容数: productData.収容数,
            imageURL: productData.imageURL,
            inventoryExists: productData.inventoryExists,
            oldPhysicalQuantity: productData.currentPhysicalQuantity || 0,
            oldReservedQuantity: productData.currentReservedQuantity || 0,
            inputQuantity: boxQuantity,
            inputBoxes: 1
        });
        console.log(`📦 Added new product ${productNumber}: 1 box`);
    }
    
    // Save to localStorage
    saveNyukoToStorage();
    
    // Update the summary list
    updateNyukoSummaryList();
}

// Update the product display area
function updateProductDisplay(productNumber, productData) {
    // Hide initial state, show active product
    document.getElementById('nyukoInitialState').classList.add('hidden');
    document.getElementById('nyukoActiveProduct').classList.remove('hidden');
    
    currentDisplayedProduct = productNumber;
    
    // Update product info
    document.getElementById('nyukoDisplayProductNumber').textContent = productData.品番;
    document.getElementById('nyukoDisplaySebangou').textContent = productData.背番号 || '-';
    document.getElementById('nyukoDisplayProductName').textContent = productData.品名 || '-';
    document.getElementById('nyukoDisplayBoxSize').textContent = productData.収容数;
    
    // Update image
    const imgElement = document.getElementById('nyukoDisplayImage');
    const noImageElement = document.getElementById('nyukoNoImage');
    
    if (productData.imageURL) {
        imgElement.src = productData.imageURL;
        imgElement.classList.remove('hidden');
        noImageElement.classList.add('hidden');
    } else {
        imgElement.classList.add('hidden');
        noImageElement.classList.remove('hidden');
    }
    
    // Update current inventory display
    const currentInventoryDiv = document.getElementById('nyukoDisplayCurrentInventory');
    if (productData.inventoryExists && productData.currentPhysicalQuantity > 0) {
        const currentBoxes = Math.ceil(productData.currentPhysicalQuantity / productData.収容数);
        document.getElementById('nyukoDisplayCurrentQty').textContent = 
            `${productData.currentPhysicalQuantity}個 (${currentBoxes}箱)`;
        currentInventoryDiv.classList.remove('hidden');
    } else {
        currentInventoryDiv.classList.add('hidden');
    }
    
    // Update counter display
    updateNyukoCounterDisplay(productNumber);
}

// Update the counter display for a specific product
function updateNyukoCounterDisplay(productNumber) {
    const product = nyukoInputProducts.find(p => p.品番 === productNumber);
    
    if (product) {
        document.getElementById('nyukoDisplayBoxCount').textContent = product.inputBoxes;
        document.getElementById('nyukoDisplayPieceCount').textContent = `(${product.inputQuantity} 個)`;
    } else {
        document.getElementById('nyukoDisplayBoxCount').textContent = '0';
        document.getElementById('nyukoDisplayPieceCount').textContent = '(0 個)';
    }
}

// Decrement the currently displayed nyuko product by 1 box
function decrementCurrentNyuko() {
    if (!currentDisplayedProduct) return;

    const product = nyukoInputProducts.find(p => p.品番 === currentDisplayedProduct);
    if (!product) return;

    if (product.inputBoxes <= 1) {
        if (!confirm(`${product.品番} の最後の1箱です。完全に削除しますか？`)) return;
        nyukoInputProducts.splice(nyukoInputProducts.indexOf(product), 1);
        saveNyukoToStorage();
        currentDisplayedProduct = null;
        if (nyukoInputProducts.length > 0) {
            showProductInDisplay(nyukoInputProducts[0].品番);
        } else {
            document.getElementById('nyukoInitialState').classList.remove('hidden');
            document.getElementById('nyukoActiveProduct').classList.add('hidden');
        }
        updateNyukoSummaryList();
        showToast('削除しました', 'info');
        return;
    }

    product.inputBoxes -= 1;
    product.inputQuantity -= product.収容数;
    saveNyukoToStorage();
    updateNyukoCounterDisplay(currentDisplayedProduct);
    flashCounterArea('error');
    updateNyukoSummaryList();
    showToast(`1箱減らしました (${product.inputBoxes}箱)`, 'info');
}

// Flash counter area for visual feedback
function flashCounterArea(type) {
    const counterArea = document.getElementById('nyukoCounterArea');
    if (!counterArea) return;
    
    if (type === 'success') {
        counterArea.classList.add('bg-green-100', 'border-green-500');
        setTimeout(() => {
            counterArea.classList.remove('bg-green-100', 'border-green-500');
        }, 300);
    } else if (type === 'error') {
        counterArea.classList.add('bg-red-100', 'border-red-500');
        setTimeout(() => {
            counterArea.classList.remove('bg-red-100', 'border-red-500');
        }, 1000);
    }
}

// Update summary list display
function updateNyukoSummaryList() {
    const itemsList = document.getElementById('nyukoItemsList');
    const itemCount = document.getElementById('nyukoItemCount');
    const emptyState = document.getElementById('nyukoEmptyState');
    const submitBtn = document.getElementById('submitNyukoBtn');
    const resetBtn = document.getElementById('resetNyukoBtn');
    
    // Update count
    itemCount.textContent = `(${nyukoInputProducts.length})`;
    
    // Show/hide empty state and buttons
    if (nyukoInputProducts.length === 0) {
        emptyState.classList.remove('hidden');
        itemsList.classList.add('hidden');
        submitBtn.classList.add('hidden');
        if (resetBtn) resetBtn.classList.add('hidden');
    } else {
        emptyState.classList.add('hidden');
        itemsList.classList.remove('hidden');
        submitBtn.classList.remove('hidden');
        if (resetBtn) resetBtn.classList.remove('hidden');
        
        // Clear and rebuild list
        itemsList.innerHTML = '';
        
        nyukoInputProducts.forEach((product, index) => {
            const row = createNyukoSummaryRow(product, index);
            itemsList.appendChild(row);
        });
    }
}

// Create summary row element
function createNyukoSummaryRow(product, index) {
    const row = document.createElement('div');
    row.className = 'p-4 hover:bg-gray-50 transition-colors';
    row.id = `nyuko-row-${product.品番}`;
    
    const oldBoxes = product.inventoryExists ? Math.ceil(product.oldPhysicalQuantity / product.収容数) : 0;
    const newTotalPieces = product.oldPhysicalQuantity + product.inputQuantity;
    const newTotalBoxes = Math.ceil(newTotalPieces / product.収容数);
    
    // Check if this is the currently displayed product
    const isActive = currentDisplayedProduct === product.品番;
    const activeClass = isActive ? 'ring-2 ring-purple-400 bg-purple-50' : '';
    
    // Row number (1-based)
    const rowNumber = index + 1;
    
    row.innerHTML = `
        <div class="flex items-center justify-between ${activeClass} rounded-lg p-2 -m-2">
            <div class="flex items-center space-x-4 flex-1 cursor-pointer" onclick="showProductInDisplay('${product.品番}')">
                <!-- Row Number -->
                <div class="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <span class="text-purple-700 font-bold text-lg">${rowNumber}</span>
                </div>
                ${product.imageURL ? `
                    <img src="${product.imageURL}" alt="${product.品番}" class="w-16 h-16 object-contain rounded border border-gray-200">
                ` : `
                    <div class="w-16 h-16 bg-gray-100 rounded border border-gray-200 flex items-center justify-center">
                        <i class="fas fa-box text-gray-400"></i>
                    </div>
                `}
                <div class="flex-1">
                    <div class="flex items-center space-x-2">
                        <h4 class="font-bold text-gray-900">${product.品番} <span class="text-purple-600">(${product.背番号 || '-'})</span></h4>
                        ${!product.inventoryExists ? `
                            <span class="px-2 py-1 bg-purple-100 text-purple-700 text-xs font-bold rounded">NEW</span>
                        ` : ''}
                        ${isActive ? `
                            <span class="px-2 py-1 bg-purple-500 text-white text-xs font-bold rounded animate-pulse">表示中</span>
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
                            (+${product.inputQuantity}個 / ${product.inputBoxes}箱)
                        </span>
                    </div>
                </div>
            </div>
            <div class="flex items-center space-x-2">
                <button onclick="decrementNyukoProduct(${index})" class="w-10 h-10 bg-orange-100 hover:bg-orange-200 text-orange-700 rounded-lg transition-colors flex items-center justify-center text-lg font-bold" title="1箱減らす">
                    −
                </button>
                <button onclick="deleteNyukoProduct(${index})" class="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors">
                    <i class="fas fa-trash mr-1"></i>削除
                </button>
            </div>
        </div>
    `;
    
    return row;
}

// Show a product in the display area (when clicking on list item)
function showProductInDisplay(productNumber) {
    const productData = getNyukoCachedProductData(productNumber);
    if (productData) {
        updateProductDisplay(productNumber, productData);
        updateNyukoSummaryList(); // Refresh to update active indicator
    }
}

// Decrement input product by 1 box
function decrementNyukoProduct(index) {
    const product = nyukoInputProducts[index];
    if (!product) return;

    if (product.inputBoxes <= 1) {
        // Last box — remove the product entirely
        if (!confirm(`${product.品番} の最後の1箱です。完全に削除しますか？`)) return;
        const deletedProductNumber = product.品番;
        nyukoInputProducts.splice(index, 1);
        saveNyukoToStorage();
        if (currentDisplayedProduct === deletedProductNumber) {
            if (nyukoInputProducts.length > 0) {
                showProductInDisplay(nyukoInputProducts[0].品番);
            } else {
                currentDisplayedProduct = null;
                document.getElementById('nyukoInitialState').classList.remove('hidden');
                document.getElementById('nyukoActiveProduct').classList.add('hidden');
            }
        }
        updateNyukoSummaryList();
        showToast('削除しました', 'info');
        return;
    }

    // Decrement by 1 box
    product.inputBoxes -= 1;
    product.inputQuantity -= product.収容数;
    saveNyukoToStorage();

    // If this is the currently displayed product, refresh counter
    if (currentDisplayedProduct === product.品番) {
        updateNyukoCounterDisplay(product.品番);
        flashCounterArea('error');
    }

    updateNyukoSummaryList();
    showToast(`${product.品番} を1箱減らしました`, 'info');
}

// Delete input product
function deleteNyukoProduct(index) {
    const product = nyukoInputProducts[index];

    if (!confirm(t('delete-product-confirm').replace('{0}', product.品番))) {
        return;
    }

    const deletedProductNumber = product.品番;
    nyukoInputProducts.splice(index, 1);
    
    // Save to localStorage
    saveNyukoToStorage();
    
    // If we deleted the currently displayed product, clear or update the display
    if (currentDisplayedProduct === deletedProductNumber) {
        if (nyukoInputProducts.length > 0) {
            // Show the first product in the list
            const firstProduct = nyukoInputProducts[0];
            showProductInDisplay(firstProduct.品番);
        } else {
            // Reset to initial state
            currentDisplayedProduct = null;
            document.getElementById('nyukoInitialState').classList.remove('hidden');
            document.getElementById('nyukoActiveProduct').classList.add('hidden');
        }
    }
    
    updateNyukoSummaryList();
    showToast(t('deleted'), 'info');
}

// Reset all nyuko products
function resetAllNyukoProducts() {
    if (nyukoInputProducts.length === 0) {
        showToast('リストは空です', 'info');
        return;
    }
    
    if (!confirm(`${nyukoInputProducts.length}件のデータをすべて削除しますか？\nこの操作は取り消せません。`)) {
        return;
    }
    
    // Clear all data
    nyukoInputProducts = [];
    nyukoProductCache = {};
    currentDisplayedProduct = null;
    
    // Clear localStorage
    localStorage.removeItem(NYUKO_STORAGE_KEY);
    localStorage.removeItem(NYUKO_CACHE_KEY);
    
    // Reset UI to initial state
    document.getElementById('nyukoInitialState').classList.remove('hidden');
    document.getElementById('nyukoActiveProduct').classList.add('hidden');
    
    updateNyukoSummaryList();
    showToast('すべてのデータをリセットしました', 'info');
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

    // Get buttons and overlay
    const submitBtn = document.getElementById('submitNyukoBtn');
    const resetBtn = document.getElementById('resetNyukoBtn');
    const uploadOverlay = document.getElementById('nyukoUploadOverlay');
    
    // Save original button content
    const originalSubmitContent = submitBtn.innerHTML;
    
    // Show upload overlay
    uploadOverlay.classList.remove('hidden');
    
    // Disable buttons and show loading state
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>送信中...';
    submitBtn.classList.add('opacity-75', 'cursor-not-allowed');
    if (resetBtn) {
        resetBtn.disabled = true;
        resetBtn.classList.add('opacity-50', 'cursor-not-allowed');
    }

    try {
        const result = await submitNyukoProductsPayload(nyukoInputProducts);
        console.log('✅ Submission result:', result);

        // Hide overlay
        uploadOverlay.classList.add('hidden');
        resetNyukoStateAfterSuccessfulSubmission();
        
        showToast(`✅ ${result.processedCount}${t('products-received')}`, 'success');

    } catch (error) {
        console.error('Error submitting nyuko:', error);
        
        // Hide overlay
        uploadOverlay.classList.add('hidden');
        
        showToast('❌ ' + t('submit-failed'), 'error');
        
        // Re-enable buttons on error
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalSubmitContent;
        submitBtn.classList.remove('opacity-75', 'cursor-not-allowed');
        if (resetBtn) {
            resetBtn.disabled = false;
            resetBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        }
    }
}

// ==================== END NYUKO SYSTEM ====================
