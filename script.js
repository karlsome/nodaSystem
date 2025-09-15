// Noda System - Tablet UI for Inventory and Picking
// Global variables
let currentScreen = 'home';
let pickingRequests = [];
let currentRequestNumber = null;
let currentFilter = 'all';

// API base URL - change this to your server URL
const API_BASE_URL = 'http://localhost:3001/api';

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
});

function initializeApp() {
    updateCurrentTime();
    setInterval(updateCurrentTime, 1000); // Update time every second
    
    // Show home screen by default
    showScreen('home');
}

// Screen management functions
function showScreen(screenName) {
    // Hide all screens
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

async function viewPickingDetail(requestNumber) {
    try {
        currentRequestNumber = requestNumber;
        
        const response = await fetch(`${API_BASE_URL}/picking-requests/group/${requestNumber}`);
        if (!response.ok) {
            throw new Error('Failed to fetch picking request details');
        }
        
        const requestItems = await response.json();
        displayPickingDetail(requestItems);
        showScreen('pickingDetail');
        
    } catch (error) {
        console.error('Error loading picking request details:', error);
        showToast('ピッキング詳細の読み込みに失敗しました', 'error');
    }
}

function displayPickingDetail(requestItems) {
    if (!requestItems || requestItems.length === 0) {
        return;
    }
    
    const firstItem = requestItems[0];
    
    // Update header
    document.getElementById('pickingDetailTitle').textContent = `ピッキング詳細: ${firstItem.requestNumber}`;
    document.getElementById('pickingDetailSubtitle').textContent = `${requestItems.length}項目のピッキング依頼`;
    
    // Update request info
    const infoContainer = document.getElementById('pickingRequestInfo');
    infoContainer.innerHTML = `
        <div class="text-center">
            <p class="text-sm text-gray-500">依頼番号</p>
            <p class="text-lg font-semibold text-gray-900">${firstItem.requestNumber}</p>
        </div>
        <div class="text-center">
            <p class="text-sm text-gray-500">ステータス</p>
            <span class="status-badge ${getStatusClass(firstItem.status)}">
                ${getStatusText(firstItem.status)}
            </span>
        </div>
        <div class="text-center">
            <p class="text-sm text-gray-500">作成日</p>
            <p class="text-lg font-semibold text-gray-900">${new Date(firstItem.createdAt).toLocaleDateString('ja-JP')}</p>
        </div>
        <div class="text-center">
            <p class="text-sm text-gray-500">作成者</p>
            <p class="text-lg font-semibold text-gray-900">${firstItem.createdBy}</p>
        </div>
    `;
    
    // Update items list
    const itemsContainer = document.getElementById('pickingItemsList');
    itemsContainer.innerHTML = '';
    
    requestItems.forEach((item, index) => {
        const itemElement = createPickingItemElement(item, index + 1);
        itemsContainer.appendChild(itemElement);
    });
}

function createPickingItemElement(item, index) {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'picking-item';
    
    itemDiv.innerHTML = `
        <div class="flex items-center justify-between">
            <div class="flex items-center space-x-4">
                <div class="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                    <span class="text-blue-600 font-bold">${index}</span>
                </div>
                <div>
                    <h4 class="text-lg font-semibold text-gray-900">品番: ${item.品番}</h4>
                    <p class="text-gray-600">背番号: ${item.背番号}</p>
                    <p class="text-sm text-gray-500">数量: ${item.quantity}</p>
                </div>
            </div>
            <div class="text-right">
                <div class="text-2xl font-bold text-gray-900">${item.quantity}</div>
                <div class="text-sm text-gray-500">個</div>
            </div>
        </div>
    `;
    
    return itemDiv;
}

function displayNoRequests() {
    const container = document.getElementById('pickingRequestsList');
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

// Refresh function
function refreshPickingRequests() {
    loadPickingRequests();
    showToast('ピッキング依頼を更新しました', 'success');
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
    switch (status) {
        case 'pending': return '待機中';
        case 'in-progress': return '進行中';
        case 'completed': return '完了';
        default: return '不明';
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

// Export functions for global access
window.openInventorySystem = openInventorySystem;
window.openPickingSystem = openPickingSystem;
window.backToHome = backToHome;
window.backToPickingList = backToPickingList;
window.filterByStatus = filterByStatus;
window.refreshPickingRequests = refreshPickingRequests;

// Language translations
const translations = {
    ja: {
        'scan-title': 'スキャンしてください',
        'scan-subtitle': 'QRコードまたはバーコードをスキャン',
        'start-scan': 'スキャン開始',
        'voice-input': '音声入力 (QRなし)',
        'available-tasks': '利用可能なタスク',
        'help': 'ヘルプ',
        'map': 'マップ',
        'messages': 'メッセージ',
        'stats': '統計',
        'today-summary': '今日の概要',
        'completed': '完了',
        'in-progress': '進行中',
        'pending': '待機中',
        'scanner-title': 'スキャナー',
        'position-code': 'コードを中央に配置してください',
        'scan-instruction': 'QRコードまたはバーコードをスキャン',
        'process': '処理',
        'manual': '手動入力',
        'voice-title': '音声入力',
        'speak-item': '品番を話してください',
        'voice-instruction': 'マイクボタンを押して品番を読み上げてください',
        'heard': '聞き取り結果:',
        'start-recording': '録音開始',
        'stop-recording': '録音停止',
        'confirm': '確認',
        'start-task': 'タスク開始',
        'cancel': 'キャンセル',
        'messages-title': 'メッセージ',
        'help-title': 'ヘルプ・サポート',
        'call-supervisor': '監督者に連絡',
        'report-problem': '問題を報告',
        'maintenance': 'メンテナンス要請',
        'instructions': '操作手順'
    },
    en: {
        'scan-title': 'Please Scan',
        'scan-subtitle': 'Scan QR code or barcode',
        'start-scan': 'Start Scan',
        'voice-input': 'Voice Input (No QR)',
        'available-tasks': 'Available Tasks',
        'help': 'Help',
        'map': 'Map',
        'messages': 'Messages',
        'stats': 'Stats',
        'today-summary': 'Today\'s Summary',
        'completed': 'Completed',
        'in-progress': 'In Progress',
        'pending': 'Pending',
        'scanner-title': 'Scanner',
        'position-code': 'Position code in center',
        'scan-instruction': 'Scan QR code or barcode',
        'process': 'Process',
        'manual': 'Manual Entry',
        'voice-title': 'Voice Input',
        'speak-item': 'Please speak item number',
        'voice-instruction': 'Press microphone button and speak item number',
        'heard': 'Heard:',
        'start-recording': 'Start Recording',
        'stop-recording': 'Stop Recording',
        'confirm': 'Confirm',
        'start-task': 'Start Task',
        'cancel': 'Cancel',
        'messages-title': 'Messages',
        'help-title': 'Help & Support',
        'call-supervisor': 'Call Supervisor',
        'report-problem': 'Report Problem',
        'maintenance': 'Request Maintenance',
        'instructions': 'Instructions'
    }
};

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

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
    loadAvailableTasks();
    updateLanguage();
    
    // Setup voice recognition if available
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = currentLanguage === 'ja' ? 'ja-JP' : 'en-US';
        
        recognition.onresult = function(event) {
            const result = event.results[0][0].transcript;
            document.getElementById('voiceText').textContent = result;
            document.getElementById('voiceResult').classList.remove('hidden');
            document.getElementById('confirmVoiceButton').classList.remove('hidden');
            isRecording = false;
            updateRecordButton();
        };
        
        recognition.onerror = function(event) {
            showToast(currentLanguage === 'ja' ? '音声認識エラーが発生しました' : 'Voice recognition error', 'error');
            isRecording = false;
            updateRecordButton();
        };
    }
});

function initializeApp() {
    // Auto-focus main scanner input when modal opens
    document.getElementById('mainScanInput').addEventListener('focus', function() {
        // Simulate scanner input for demo
        setTimeout(() => {
            if (this.value === '') {
                simulateScanInput();
            }
        }, 1500);
    });
    
    // Update message count
    const unreadCount = messages.filter(m => m.unread).length;
    if (unreadCount > 0) {
        document.getElementById('messageCount').textContent = unreadCount;
        document.getElementById('messageCount').classList.remove('hidden');
        document.getElementById('messageNotification').textContent = unreadCount;
        document.getElementById('messageNotification').classList.remove('hidden');
    }
}

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
        showToast(currentLanguage === 'ja' ? 'ブラウザが音声認識をサポートしていません' : 'Browser does not support voice recognition', 'error');
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
                <p class="text-gray-600">${currentLanguage === 'ja' ? 'タイプ' : 'Type'}: ${task.type}</p>
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
    showToast(currentLanguage === 'ja' ? 'メンテナンス要請を送信中...' : 'Sending maintenance request...', 'info');
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

document.getElementById('manualForm').addEventListener('submit', function(e) {
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
    
    document.getElementById('todayIncoming').textContent = incoming;
    document.getElementById('todayOutgoing').textContent = outgoing;
    document.getElementById('pendingTasks').textContent = pendingTasksCount;
    
    // Update last activity
    if (recentActivities.length > 0) {
        const lastActivity = getTimeAgo(recentActivities[0].timestamp);
        document.getElementById('lastActivity').textContent = lastActivity;
    }
}

// Toast notifications
function showToast(message, type = 'success') {
    const toast = document.getElementById('successToast');
    const messageElement = document.getElementById('successMessage');
    
    messageElement.textContent = message;
    
    // Update toast styling based on type
    toast.className = toast.className.replace(/bg-(green|red|yellow|blue)-500/g, '');
    
    switch(type) {
        case 'error':
            toast.classList.add('bg-red-500');
            break;
        case 'warning':
            toast.classList.add('bg-yellow-500');
            break;
        case 'info':
            toast.classList.add('bg-blue-500');
            break;
        default:
            toast.classList.add('bg-green-500');
    }
    
    toast.classList.remove('hidden');
    
    setTimeout(() => {
        toast.classList.add('hidden');
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

// Receiving form handler
document.getElementById('receivingForm').addEventListener('submit', function(e) {
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

// Print label function
function printLabel() {
    showToast('Label sent to printer', 'success');
    playSound('success');
}

// Simulate location suggestions
document.getElementById('receivingItemScan').addEventListener('input', function(e) {
    const value = e.target.value;
    if (value) {
        // Simulate expected quantity lookup
        document.getElementById('expectedQty').textContent = Math.floor(Math.random() * 100) + 1;
        document.getElementById('expectedQuantityDisplay').classList.remove('hidden');
        
        // Simulate location suggestion
        const locations = ['A1', 'A2', 'B1', 'B2', 'C1'];
        const suggestedLocation = locations[Math.floor(Math.random() * locations.length)];
        
        const locationSelect = document.getElementById('suggestedLocation');
        locationSelect.innerHTML = `<option value="${suggestedLocation}">Suggested: ${suggestedLocation}</option>`;
        locationSelect.value = suggestedLocation;
    }
});

// Auto-simulate universal scanner for demo
document.getElementById('universalScanInput').addEventListener('focus', function() {
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
