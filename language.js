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
        'submit-confirm-prefix': '',
        'submit-confirm-suffix': '件のアイテムを送信しますか？',
        'clear-confirm-prefix': '',
        'clear-confirm-suffix': '件のアイテムをクリアしますか？',

        // Voice Recognition
        'voice-not-supported': 'ブラウザが音声認識をサポートしていません',

        // Maintenance
        'sending-maintenance-request': 'メンテナンス要請を送信中...',

        // Task Type
        'type-label': 'タイプ',
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
        'language': '言語',

        // System Lock Message
        'system-lock-strong': 'システムロック中:',
        'system-lock-message': '注文番号',
        'system-lock-by': 'が',
        'system-lock-processing': 'によって処理中です',

        // Tanaoroshi (棚卸し) Screen
        'tanaoroshi-system': '棚卸しシステム',
        'tanaoroshi-subtitle': 'QRコードをスキャンして在庫数をカウント',
        'scan-product-qr': '製品QRコードをスキャン',
        'scan-product-instruction': 'カウントする製品のQRコードをスキャンしてください',
        'scanner-ready': 'スキャナー準備完了',
        'counted-products': 'カウント済み製品',
        'product-number': '品番:',
        'product-number-label': '品番',
        'sebangou': '背番号:',
        'expected-inventory': '期待在庫数',
        'pieces': '個',
        'boxes': '箱',
        'box': '箱',
        'box-info-format': '1箱 = {0}個',
        'scanned': 'スキャン済み',
        'waiting-for-scan': 'スキャン待機中',
        'manual-adjustment': '手動調整',
        'box-count-adjustment': '箱数調整',
        'cancel-button': 'キャンセル',
        'complete-button': '完了',
        'no-inventory': '在庫なし',

        // Tanaoroshi Messages
        'qr-format-invalid': 'QRコード形式が無効です (形式: 品番,数量)',
        'qr-data-invalid': 'QRコードデータが無効です',
        'fetching-product-info': '製品情報を取得中...',
        'product-not-found-error': '製品が見つかりません',
        'product-fetch-failed': '製品情報の取得に失敗しました',
        'item-not-in-inventory': 'このアイテムは在庫にありません。',
        'item-not-in-inventory-detail': '品番: {0}\n品名: {1}\n\n追加しますか？',
        'cancelled': 'キャンセルしました',
        'adding-new-product': '新規製品として追加します',
        'count-start': 'カウント開始',
        'error-occurred': 'エラーが発生しました',
        'error-no-product': 'エラー: 製品がありません',
        'product-number-mismatch': '製品番号が異なります！ 期待:',
        'box-quantity-mismatch': '箱数量が異なります！ 期待:',
        'box-quantity-suffix': '個/箱',
        'box-count-negative': '箱数は0未満にできません',
        'enter-count-quantity': 'カウント数を入力してください',
        'add-new-product-confirm': '新規製品を在庫に追加します。\n品番: {0}\n数量: {1}個 ({2}箱)\n\nよろしいですか？',
        'inventory-adjustment-confirm': '在庫が {0}個 ({1}箱) {2}されます。よろしいですか？',
        'adjustment-add': '追加',
        'adjustment-reduce': '削減',
        'count-complete': 'カウント完了',
        'delete-product-confirm': '{0} を削除しますか？',
        'deleted': '削除しました',
        'no-counted-products': 'カウント済み製品がありません',
        'submit-count-confirm': '{0}件の製品カウントを送信しますか？',
        'submitting': '送信中...',
        'products-updated': '件の製品を更新しました',
        'submit-failed': '送信に失敗しました',
        'edit': '編集',
        'delete': '削除',

        // Nyuko (入庫) Screen
        'nyuko-system': '入庫作業システム',
        'nyuko-subtitle': '工場からの製品を入庫',
        'nyuko-button-title': '入庫管理',
        'nyuko-button-desc': '工場からの入庫処理',
        'scan-nyuko-instruction': '入庫する製品のQRコードをスキャンしてください',
        'input-products': '入庫済み製品',
        'current-inventory-label': '現在の在庫',
        'box-info': '箱情報',
        'nyuko-scan': '入庫スキャン',

        // Nyuko Messages
        'nyuko-start': '入庫開始',
        'nyuko-complete': '入庫完了',
        'enter-nyuko-quantity': '入庫数量を入力してください',
        'nyuko-confirm': '{0}個 ({1}箱) を入庫しますか？',
        'no-input-products': '入庫済み製品がありません',
        'submit-nyuko-confirm': '{0}件の製品入庫を送信しますか？',
        'products-received': '件の製品を入庫しました'
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
        'submit-confirm-prefix': 'Submit',
        'submit-confirm-suffix': 'items?',
        'clear-confirm-prefix': 'Clear',
        'clear-confirm-suffix': 'items?',

        // Voice Recognition
        'voice-not-supported': 'Browser does not support voice recognition',

        // Maintenance
        'sending-maintenance-request': 'Sending maintenance request...',

        // Task Type
        'type-label': 'Type',
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
        'language': 'Language',

        // System Lock Message
        'system-lock-strong': 'System Locked:',
        'system-lock-message': 'Order number',
        'system-lock-by': 'is being processed by',
        'system-lock-processing': '',

        // Tanaoroshi (棚卸し) Screen
        'tanaoroshi-system': 'Inventory Count System',
        'tanaoroshi-subtitle': 'Scan QR code to count inventory',
        'scan-product-qr': 'Scan Product QR Code',
        'scan-product-instruction': 'Please scan the QR code of the product to count',
        'scanner-ready': 'Scanner Ready',
        'counted-products': 'Counted Products',
        'product-number': 'Product No.:',
        'product-number-label': 'Product No.',
        'sebangou': 'Device No.:',
        'expected-inventory': 'Expected Inventory',
        'pieces': 'pcs',
        'boxes': 'boxes',
        'box': 'box',
        'box-info-format': '1 box = {0} pcs',
        'scanned': 'Scanned',
        'waiting-for-scan': 'Waiting for scan',
        'manual-adjustment': 'Manual Adjustment',
        'box-count-adjustment': 'Box Count Adjustment',
        'cancel-button': 'Cancel',
        'complete-button': 'Complete',
        'no-inventory': 'No Inventory',

        // Tanaoroshi Messages
        'qr-format-invalid': 'Invalid QR code format (Format: Product Code, Quantity)',
        'qr-data-invalid': 'Invalid QR code data',
        'fetching-product-info': 'Fetching product information...',
        'product-not-found-error': 'Product not found',
        'product-fetch-failed': 'Failed to fetch product information',
        'item-not-in-inventory': 'This item is not in inventory.',
        'item-not-in-inventory-detail': 'Product No.: {0}\nProduct Name: {1}\n\nAdd to inventory?',
        'cancelled': 'Cancelled',
        'adding-new-product': 'Adding as new product',
        'count-start': 'Count started',
        'error-occurred': 'An error occurred',
        'error-no-product': 'Error: No product',
        'product-number-mismatch': 'Product number mismatch! Expected:',
        'box-quantity-mismatch': 'Box quantity mismatch! Expected:',
        'box-quantity-suffix': 'pcs/box',
        'box-count-negative': 'Box count cannot be negative',
        'enter-count-quantity': 'Please enter count quantity',
        'add-new-product-confirm': 'Add new product to inventory.\nProduct No.: {0}\nQuantity: {1} pcs ({2} boxes)\n\nProceed?',
        'inventory-adjustment-confirm': 'Inventory will be {2} by {0} pcs ({1} boxes). Proceed?',
        'adjustment-add': 'increased',
        'adjustment-reduce': 'decreased',
        'count-complete': 'Count completed',
        'delete-product-confirm': 'Delete {0}?',
        'deleted': 'Deleted',
        'no-counted-products': 'No counted products',
        'submit-count-confirm': 'Submit count for {0} products?',
        'submitting': 'Submitting...',
        'products-updated': 'products updated',
        'submit-failed': 'Submission failed',
        'edit': 'Edit',
        'delete': 'Delete',

        // Nyuko (入庫) Screen
        'nyuko-system': 'Warehouse Receiving System',
        'nyuko-subtitle': 'Receive products from factory',
        'nyuko-button-title': 'Warehouse Receiving',
        'nyuko-button-desc': 'Process incoming goods from factory',
        'scan-nyuko-instruction': 'Please scan the QR code of the product to receive',
        'input-products': 'Received Products',
        'current-inventory-label': 'Current Inventory',
        'box-info': 'Box Information',
        'nyuko-scan': 'Receiving Scan',

        // Nyuko Messages
        'nyuko-start': 'Receiving started',
        'nyuko-complete': 'Receiving completed',
        'enter-nyuko-quantity': 'Please enter receiving quantity',
        'nyuko-confirm': 'Receive {0} pcs ({1} boxes)?',
        'no-input-products': 'No received products',
        'submit-nyuko-confirm': 'Submit receiving for {0} products?',
        'products-received': 'products received'
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
