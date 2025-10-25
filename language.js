// Language translations for Noda SIMS
// Supported languages: Japanese (ja), English (en)

const translations = {
    ja: {
        // Header
        'subtitle': '在庫管理システム',

        // Login Screen
        'login-title': 'ログイン',
        'worker-name-placeholder': '作業者名を入力',
        'login-button': 'ログイン',

        // Home Screen
        'work-selection': '作業選択',
        'inventory-button-title': '棚卸し',
        'inventory-button-desc': '在庫確認・棚卸し作業',
        'picking-button-title': 'ピッキング',
        'picking-button-desc': 'ピッキング依頼処理',

        // Picking Request List Screen
        'picking-requests': 'ピッキング依頼',
        'refresh-button': '更新',
        'filter-all': '全て',
        'filter-pending': '待機中',
        'filter-in-progress': '進行中',
        'filter-completed': '完了',
        'loading': '読み込み中...',
        'no-requests-title': 'ピッキング依頼がありません',
        'no-requests-desc': '現在処理可能な依頼はありません',

        // Picking Detail Screen
        'picking-detail': 'ピッキング詳細',
        'start-button': '開始',
        'picking-items': 'ピッキング項目',
        'connection-status-connected': '接続中',
        'connection-status-disconnected': '切断',
        'request-number': '依頼番号',
        'status-label': 'ステータス',
        'progress-label': '進捗',
        'created-by': '作成者',
        'items-suffix': '項目',
        'items-picking': '項目のピッキング依頼',
        'in-progress-button': '進行中...',
        'completed-button': '完了',

        // Status Labels
        'status-pending': '待機中',
        'status-in-progress': '進行中',
        'status-completed': '完了',
        'status-unknown': '不明',

        // Inventory Screen
        'inventory-system': '棚卸しシステム',
        'inventory-subtitle': 'QRコードをスキャンして在庫数を更新',
        'clear-button': 'クリア',
        'submit-button': '送信',
        'scanner-title': 'スキャナー',
        'scanner-status-waiting': '待機中',
        'scan-placeholder': 'QRコードをスキャンしてください (例: GN519-10120,100)',
        'scan-format': '形式: 品番,数量 (例: GN519-10120,100)',
        'scanned-items': 'スキャン済みアイテム',
        'scan-prompt': 'QRコードをスキャンしてください',
        'scan-prompt-desc': 'スキャンした商品がここに表示されます',
        'under-development': '開発中',
        'under-development-desc': 'このシステムは現在開発中です',
        'current-inventory': '現在の在庫',
        'new-inventory': '新しい在庫',
        'difference': '差分',

        // Item Details
        'device-number': '背番号',
        'quantity': '数量',
        'items-count': '項目',
        'pieces': '個',

        // Toast Messages
        'welcome-message': 'さん、ようこそ！',
        'logout-message': 'ログアウトしました',
        'connection-error': '通信エラーが発生しました',
        'item-completed-message': 'がアイテムを完了しました',
        'lock-system-message': 'システムロック中: 注文番号',
        'lock-being-processed': 'が',
        'lock-by': 'によって処理中です',
        'other-order-processing': '他の注文が処理中です',
        'picking-started': 'ピッキングプロセスを開始しました！',
        'picking-start-failed': 'ピッキング開始に失敗しました',
        'picking-complete-back': 'ピッキング完了！リストに戻ります',
        'requests-refreshed': 'ピッキング依頼を更新しました',
        'refresh-failed': '更新に失敗しました',
        'login-required': 'ログインが必要です',
        'no-request-selected': 'ピッキング依頼が選択されていません',
        'load-failed': 'の読み込みに失敗しました',
        'device-update': 'デバイス更新:',

        // Inventory Messages
        'invalid-qr-format': '無効なQRコード形式です。形式: 品番,数量',
        'invalid-product-quantity': '品番または数量が無効です',
        'product-not-found': 'は在庫に存在しません',
        'quantity-updated': 'の数量を更新しました',
        'added-to-list': 'をリストに追加しました',
        'scan-error': 'スキャン処理中にエラーが発生しました',
        'list-already-empty': 'リストは既に空です',
        'clear-items-confirm': '件のアイテムをクリアしますか？',
        'list-cleared': 'リストをクリアしました',
        'no-scanned-items': 'スキャンしたアイテムがありません',
        'submit-items-confirm': '件のアイテムを送信しますか？',
        'submitting': '送信中...',
        'items-updated': '件のアイテムを更新しました！',
        'submit-error': '送信エラー:',
        'removed-from-list': 'をリストから削除しました',
        'quantity-validation': '数量は0以上の数値を入力してください',

        // Device Status
        'device-status-picking': 'ピッキング中',
        'device-status-standby': 'スタンバイ',
        'device-status-offline': 'オフライン',

        // Footer
        'footer-copyright': '© 2025 Noda System',

        // Language Selector
        'language': '言語'
    },
    en: {
        // Header
        'subtitle': 'Inventory Management System',

        // Login Screen
        'login-title': 'Login',
        'worker-name-placeholder': 'Enter worker name',
        'login-button': 'Login',

        // Home Screen
        'work-selection': 'Select Work',
        'inventory-button-title': 'Inventory',
        'inventory-button-desc': 'Inventory Check Operations',
        'picking-button-title': 'Picking',
        'picking-button-desc': 'Picking Request Processing',

        // Picking Request List Screen
        'picking-requests': 'Picking Requests',
        'refresh-button': 'Refresh',
        'filter-all': 'All',
        'filter-pending': 'Pending',
        'filter-in-progress': 'In Progress',
        'filter-completed': 'Completed',
        'loading': 'Loading...',
        'no-requests-title': 'No Picking Requests',
        'no-requests-desc': 'There are currently no requests available for processing',

        // Picking Detail Screen
        'picking-detail': 'Picking Details',
        'start-button': 'Start',
        'picking-items': 'Picking Items',
        'connection-status-connected': 'Connected',
        'connection-status-disconnected': 'Disconnected',
        'request-number': 'Request Number',
        'status-label': 'Status',
        'progress-label': 'Progress',
        'created-by': 'Created By',
        'items-suffix': 'items',
        'items-picking': 'item picking request',
        'in-progress-button': 'In Progress...',
        'completed-button': 'Completed',

        // Status Labels
        'status-pending': 'Pending',
        'status-in-progress': 'In Progress',
        'status-completed': 'Completed',
        'status-unknown': 'Unknown',

        // Inventory Screen
        'inventory-system': 'Inventory System',
        'inventory-subtitle': 'Scan QR code to update inventory count',
        'clear-button': 'Clear',
        'submit-button': 'Submit',
        'scanner-title': 'Scanner',
        'scanner-status-waiting': 'Waiting',
        'scan-placeholder': 'Please scan QR code (e.g., GN519-10120,100)',
        'scan-format': 'Format: Product Code, Quantity (e.g., GN519-10120,100)',
        'scanned-items': 'Scanned Items',
        'scan-prompt': 'Please scan QR code',
        'scan-prompt-desc': 'Scanned products will be displayed here',
        'under-development': 'Under Development',
        'under-development-desc': 'This system is currently under development',
        'current-inventory': 'Current Stock',
        'new-inventory': 'New Stock',
        'difference': 'Difference',

        // Item Details
        'device-number': 'Device No.',
        'quantity': 'Quantity',
        'items-count': 'items',
        'pieces': 'pcs',

        // Toast Messages
        'welcome-message': ', welcome!',
        'logout-message': 'Logged out',
        'connection-error': 'Communication error occurred',
        'item-completed-message': 'completed an item',
        'lock-system-message': 'System locked: Order number',
        'lock-being-processed': 'is being processed by',
        'lock-by': '',
        'other-order-processing': 'Another order is being processed',
        'picking-started': 'Picking process started!',
        'picking-start-failed': 'Failed to start picking',
        'picking-complete-back': 'Picking complete! Returning to list',
        'requests-refreshed': 'Picking requests refreshed',
        'refresh-failed': 'Refresh failed',
        'login-required': 'Login required',
        'no-request-selected': 'No picking request selected',
        'load-failed': 'Failed to load',
        'device-update': 'Device update:',

        // Inventory Messages
        'invalid-qr-format': 'Invalid QR code format. Format: Product Code, Quantity',
        'invalid-product-quantity': 'Invalid product code or quantity',
        'product-not-found': 'does not exist in inventory',
        'quantity-updated': 'quantity updated',
        'added-to-list': 'added to list',
        'scan-error': 'Error occurred during scan processing',
        'list-already-empty': 'List is already empty',
        'clear-items-confirm': 'Clear',
        'list-cleared': 'List cleared',
        'no-scanned-items': 'No scanned items',
        'submit-items-confirm': 'Submit',
        'submitting': 'Submitting...',
        'items-updated': 'items updated!',
        'submit-error': 'Submit error:',
        'removed-from-list': 'removed from list',
        'quantity-validation': 'Please enter a quantity of 0 or greater',

        // Device Status
        'device-status-picking': 'Picking',
        'device-status-standby': 'Standby',
        'device-status-offline': 'Offline',

        // Footer
        'footer-copyright': '© 2025 Noda System',

        // Language Selector
        'language': 'Language'
    }
};

// Current language state (default: Japanese)
let currentLanguage = 'ja';

// Initialize language from localStorage or default
function initializeLanguage() {
    const savedLanguage = localStorage.getItem('preferredLanguage');
    if (savedLanguage && (savedLanguage === 'ja' || savedLanguage === 'en')) {
        currentLanguage = savedLanguage;
    }
    applyLanguage();
    updateLanguageDropdown();
}

// Apply language to all elements with data-i18n attribute
function applyLanguage() {
    document.querySelectorAll('[data-i18n]').forEach(element => {
        const key = element.getAttribute('data-i18n');
        if (translations[currentLanguage][key]) {
            if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
                element.placeholder = translations[currentLanguage][key];
            } else {
                element.textContent = translations[currentLanguage][key];
            }
        }
    });

    // Update HTML lang attribute
    document.documentElement.lang = currentLanguage;
}

// Switch language
function switchLanguage(lang) {
    if (lang === 'ja' || lang === 'en') {
        currentLanguage = lang;
        localStorage.setItem('preferredLanguage', lang);
        applyLanguage();
        updateLanguageDropdown();
    }
}

// Update language dropdown display
function updateLanguageDropdown() {
    const dropdown = document.getElementById('languageSelect');
    if (dropdown) {
        dropdown.value = currentLanguage;
    }
}

// Get translated text
function t(key) {
    return translations[currentLanguage][key] || key;
}

// Export functions for use in other scripts
if (typeof window !== 'undefined') {
    window.translations = translations;
    window.currentLanguage = currentLanguage;
    window.initializeLanguage = initializeLanguage;
    window.applyLanguage = applyLanguage;
    window.switchLanguage = switchLanguage;
    window.t = t;
}
