const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const cors = require('cors');
const path = require('path');
const { createServer } = require('http');
const { Server } = require('socket.io');
const mqtt = require('mqtt');
const admin = require('firebase-admin');
require('dotenv').config();

// Initialize Firebase Admin SDK
const firebaseConfig = {
    credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
};

let firebaseApp;
let firebaseBucket;

try {
    firebaseApp = admin.initializeApp(firebaseConfig);
    firebaseBucket = admin.storage().bucket();
    console.log('🔥 Firebase Admin SDK initialized successfully');
} catch (error) {
    console.error('❌ Firebase initialization error:', error.message);
}

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static('.'));

// MongoDB connection with SSL options for local testing
let db;

// MongoDB options for local development (bypass SSL certificate verification)
const mongoOptions = {
    tls: true,
    tlsAllowInvalidCertificates: true,
    tlsAllowInvalidHostnames: true,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
};

const client = new MongoClient(process.env.MONGODB_URI, mongoOptions);

// Connected devices storage
const connectedDevices = new Map(); // deviceId -> socket
const connectedTablets = new Set(); // tablet sockets

// MQTT Configuration
const MQTT_ENABLED = process.env.MQTT_ENABLED === 'true';
const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL || 'mqtt://test.mosquitto.org:1883';
const MQTT_USERNAME = process.env.MQTT_USERNAME || '';
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || '';

// MQTT Client and device tracking
let mqttClient = null;
const mqttConnectedDevices = new Map(); // deviceId -> last seen timestamp
const mqttDevices = new Map(); // deviceId -> device info (isOnline, lastSeen, etc.)
const processedCompletions = new Map(); // Track processed completions: "requestNumber-lineNumber-timestamp" -> true

// Global picking lock state
let globalPickingLock = {
    isLocked: false,
    activeRequestNumber: null,
    startedBy: null,
    startedAt: null
};

// 🔐 MUTEX: Prevent concurrent inventory transactions for the same item
const inventoryTransactionLocks = new Map(); // key: "背番号" -> { locked: boolean, queue: [] }

// Global lock management functions
async function checkGlobalPickingLock() {
    // Check database for any in-progress orders
    const collection = db.collection(process.env.COLLECTION_NAME);
    const inProgressOrder = await collection.findOne({ status: 'in-progress' });
    
    if (inProgressOrder && !globalPickingLock.isLocked) {
        // Found an in-progress order, set the lock
        const previousRequestNumber = globalPickingLock.activeRequestNumber;
        
        globalPickingLock = {
            isLocked: true,
            activeRequestNumber: inProgressOrder.requestNumber,
            startedBy: inProgressOrder.startedBy,
            startedAt: inProgressOrder.startedAt
        };
        
        // 🚨 NEW: If this is a different request or newly in-progress, notify ESP32 devices
        if (previousRequestNumber !== inProgressOrder.requestNumber) {
            console.log(`🔄 Detected new/changed in-progress order: ${inProgressOrder.requestNumber}`);
            await notifyESP32DevicesForRequest(inProgressOrder.requestNumber, 'System Lock Check');
        }
        
    } else if (!inProgressOrder && globalPickingLock.isLocked) {
        // No in-progress orders, release the lock
        globalPickingLock = {
            isLocked: false,
            activeRequestNumber: null,
            startedBy: null,
            startedAt: null
        };
        // Notify all tablets that lock is released
        broadcastLockStatus();
    }
    
    return globalPickingLock;
}

// Function to notify ESP32 devices for a specific request
async function notifyESP32DevicesForRequest(requestNumber, triggeredBy = 'System') {
    try {
        console.log(`📢 Notifying ESP32 devices for request ${requestNumber} (triggered by: ${triggeredBy})`);
        
        await client.connect();
        const db = client.db("submittedDB");
        const requestsCollection = db.collection("nodaRequestDB");
        
        // Find the request by requestNumber
        const request = await requestsCollection.findOne({ requestNumber: requestNumber });
        if (!request) {
            console.log(`⚠️ Request ${requestNumber} not found for ESP32 notification`);
            return;
        }
        
        const notifiedDevices = [];
        
        // Check if request is in-progress and notify devices
        if (request.status === 'in-progress') {
            if (request.requestType === 'bulk' && request.lineItems) {
                // Notify all devices in this bulk request that are in-progress or pending
                for (const lineItem of request.lineItems) {
                    if (lineItem.status === 'in-progress' || lineItem.status === 'pending') {
                        console.log(`🔔 Notifying device ${lineItem.背番号} for line item ${lineItem.lineNumber} (status: ${lineItem.status})`);
                        await notifyDeviceStatusChange(
                            lineItem.背番号, 
                            request.requestNumber, 
                            lineItem.lineNumber, 
                            lineItem.quantity, 
                            lineItem.品番, 
                            'in-progress'
                        );
                        notifiedDevices.push(lineItem.背番号);
                    }
                }
            } else {
                // Single request
                if (request.背番号) {
                    await notifyDeviceStatusChange(
                        request.背番号, 
                        request.requestNumber, 
                        1, 
                        request.quantity, 
                        request.品番, 
                        'in-progress'
                    );
                    notifiedDevices.push(request.背番号);
                }
            }
        }
        
        if (notifiedDevices.length > 0) {
            console.log(`✅ Notified ${notifiedDevices.length} ESP32 devices: ${notifiedDevices.join(', ')}`);
        } else {
            console.log(`ℹ️ No ESP32 devices to notify for request ${requestNumber}`);
        }
        
    } catch (error) {
        console.error('Error notifying ESP32 devices:', error);
    }
}

function broadcastLockStatus() {
    const lockStatus = {
        isLocked: globalPickingLock.isLocked,
        activeRequestNumber: globalPickingLock.activeRequestNumber,
        startedBy: globalPickingLock.startedBy,
        startedAt: globalPickingLock.startedAt
    };
    
    connectedTablets.forEach(tabletSocket => {
        tabletSocket.emit('picking-lock-status', lockStatus);
    });
    
    console.log(`🔒 Broadcasting lock status: ${globalPickingLock.isLocked ? 'LOCKED' : 'UNLOCKED'} - ${globalPickingLock.activeRequestNumber || 'None'}`);
}

// Check if device has active picking assignment
async function getActivePickingForDevice(deviceId) {
    try {
        console.log(`🔍 getActivePickingForDevice called for: ${deviceId}`);
        const collection = db.collection(process.env.COLLECTION_NAME);
        console.log(`📚 Using collection: ${process.env.COLLECTION_NAME}`);
        
        // Find requests that are in-progress and have this device assigned
        const query = {
            status: 'in-progress',
            'lineItems': {
                $elemMatch: {
                    背番号: deviceId,
                    status: { $in: ['pending', 'in-progress'] }
                }
            }
        };
        console.log(`🔎 MongoDB query:`, JSON.stringify(query, null, 2));
        
        const activeRequest = await collection.findOne(query);
        console.log(`📄 Found request:`, activeRequest ? `${activeRequest.requestNumber} with ${activeRequest.lineItems?.length} items` : 'null');
        
        if (activeRequest) {
            // Find the specific line item for this device
            const lineItem = activeRequest.lineItems.find(item => 
                item.背番号 === deviceId && ['pending', 'in-progress'].includes(item.status)
            );
            console.log(`📋 Found line item for ${deviceId}:`, lineItem);
            
            if (lineItem) {
                const result = {
                    requestNumber: activeRequest.requestNumber,
                    lineNumber: lineItem.lineNumber,
                    quantity: lineItem.quantity,
                    品番: lineItem.品番
                };
                console.log(`✅ Returning active picking:`, result);
                return result;
            }
        }
        
        console.log(`❌ No active picking found for ${deviceId}`);
        return null;
    } catch (error) {
        console.error('❌ Error checking active picking for device:', error);
        return null;
    }
}

// Helper function to calculate box quantity from piece quantity
async function calculateBoxQuantity(品番, pieceQuantity) {
    try {
        const masterDB = client.db('Sasaki_Coating_MasterDB');
        const masterCollection = masterDB.collection('masterDB');
        
        console.log(`🔍 Looking up 品番: "${品番}" in masterDB collection`);
        const masterData = await masterCollection.findOne({ 品番 });
        
        if (!masterData) {
            console.warn(`⚠️ No masterData found for ${品番} in masterDB collection`);
            console.log(`   Defaulting to pieces: ${pieceQuantity}`);
            return pieceQuantity;
        }
        
        console.log(`✅ Found masterData for ${品番}:`, { 収容数: masterData.収容数, 品名: masterData.品名 });
        
        if (!masterData.収容数) {
            console.warn(`⚠️ masterData exists but 収容数 is missing for ${品番}`);
            console.log(`   Defaulting to pieces: ${pieceQuantity}`);
            return pieceQuantity;
        }
        
        const 収容数 = parseInt(masterData.収容数) || 1;
        
        // Safeguard: Ensure pieceQuantity is not negative
        const safePieceQuantity = Math.max(0, pieceQuantity || 0);
        if (safePieceQuantity === 0) {
            console.log(`📦 Box calculation for ${品番}: 0 pieces = 0 boxes`);
            return 0;
        }
        
        const boxQuantity = Math.ceil(safePieceQuantity / 収容数);
        // Ensure at least 1 box if there are any pieces
        const safeBoxQuantity = safePieceQuantity > 0 ? Math.max(1, boxQuantity) : 0;
        
        console.log(`📦 Box calculation for ${品番}: ${pieceQuantity} pieces ÷ ${収容数} = ${safeBoxQuantity} boxes`);
        return safeBoxQuantity;
    } catch (error) {
        console.error(`❌ Error calculating box quantity for ${品番}:`, error);
        return pieceQuantity; // Fallback to piece quantity on error
    }
}

async function connectToMongoDB() {
    try {
        await client.connect();
        db = client.db(process.env.DATABASE_NAME);
        console.log('Connected to MongoDB successfully');
        
        // 🔍 Set up change stream to monitor status changes
        setupStatusChangeMonitoring();
        
        // 🔍🔍🔍 NEW: Monitor ALL insertions to nodaInventoryDB
        setupInventoryInsertMonitoring();
    } catch (error) {
        console.error('Failed to connect to MongoDB:', error);
        process.exit(1);
    }
}

// 🔍🔍🔍 Monitor ALL insertions to inventory collection
function setupInventoryInsertMonitoring() {
    try {
        const submittedDb = client.db("submittedDB");
        const inventoryCollection = submittedDb.collection('nodaInventoryDB');
        const changeStream = inventoryCollection.watch([
            {
                $match: {
                    operationType: 'insert'
                }
            }
        ]);
        
        changeStream.on('change', async (change) => {
            const doc = change.fullDocument;
            const docId = change.documentKey._id;
            
            console.log(`\n🔔🔔🔔 [INVENTORY INSERT DETECTED] 🔔🔔🔔`);
            console.log(`   Operation: ${change.operationType}`);
            console.log(`   Document ID: ${docId}`);
            console.log(`   背番号: ${doc.背番号}`);
            console.log(`   Action: ${doc.action}`);
            console.log(`   Picked Quantity: ${doc.physicalQuantity !== undefined ? 'Physical: ' + doc.physicalQuantity : 'N/A'}`);
            console.log(`   Request: ${doc.requestId}, Line: ${doc.lineNumber}`);
            console.log(`   TimeStamp: ${doc.timeStamp}`);
            console.log(`   _insertedBy: ${doc._insertedBy || 'NOT SET (EXTERNAL SOURCE!)'}`);
            console.log(`   _insertSource: ${doc._insertSource || 'NOT SET'}`);
            
            // 🚨 SAFEGUARD 1: Delete unauthorized insertions (missing our tracking field)
            if (!doc._insertedBy && doc.action && doc.action.includes('Picking')) {
                console.log(`\n🚨🚨🚨 [UNAUTHORIZED INSERTION - NO TRACKING] 🚨🚨🚨`);
                console.log(`   Document ID: ${docId}`);
                console.log(`   This insertion does NOT have _insertedBy tracking field!`);
                console.log(`   🗑️ DELETING THIS UNAUTHORIZED RECORD...`);
                
                try {
                    const deleteResult = await inventoryCollection.deleteOne({ _id: docId });
                    if (deleteResult.deletedCount > 0) {
                        console.log(`   ✅ Successfully deleted unauthorized insertion: ${docId}`);
                    }
                } catch (deleteError) {
                    console.error(`   ❌ Failed to delete:`, deleteError);
                }
                return; // Stop processing
            }
            
            // 🚨 SAFEGUARD 2: Delete DUPLICATES (same _insertSource but different _id)
            // MongoDB Trigger copies our documents including _insertSource, creating duplicates
            if (doc._insertSource && doc.action && doc.action.includes('Picking')) {
                const existingWithSameSource = await inventoryCollection.find({
                    _insertSource: doc._insertSource
                }).toArray();
                
                if (existingWithSameSource.length > 1) {
                    console.log(`\n🚨🚨🚨 [DUPLICATE INSERTION DETECTED] 🚨🚨🚨`);
                    console.log(`   Found ${existingWithSameSource.length} records with same _insertSource`);
                    console.log(`   _insertSource: ${doc._insertSource}`);
                    
                    // Keep only the FIRST one (oldest), delete this duplicate
                    const sortedByTime = existingWithSameSource.sort((a, b) => 
                        new Date(a._insertedAt) - new Date(b._insertedAt)
                    );
                    const originalId = sortedByTime[0]._id.toString();
                    
                    if (docId.toString() !== originalId) {
                        console.log(`   🗑️ This is a DUPLICATE of ${originalId}, deleting...`);
                        try {
                            const deleteResult = await inventoryCollection.deleteOne({ _id: docId });
                            if (deleteResult.deletedCount > 0) {
                                console.log(`   ✅ Successfully deleted duplicate: ${docId}`);
                            }
                        } catch (deleteError) {
                            console.error(`   ❌ Failed to delete duplicate:`, deleteError);
                        }
                    }
                }
            }
        });
        
        console.log('✅ Inventory insertion monitoring active (with duplicate deletion safeguard)');
    } catch (error) {
        console.error('❌ Failed to set up inventory change stream:', error);
    }
}

// Monitor all status changes to detect external modifications
function setupStatusChangeMonitoring() {
    try {
        const collection = db.collection(process.env.COLLECTION_NAME);
        const changeStream = collection.watch([
            {
                $match: {
                    $or: [
                        { 'updateDescription.updatedFields.status': { $exists: true } },
                        { 'updateDescription.updatedFields.lineItems.0.status': { $exists: true } }
                    ]
                }
            }
        ]);
        
        changeStream.on('change', (change) => {
            console.log(`\n🔔🔔🔔 DATABASE STATUS CHANGE DETECTED 🔔🔔🔔`);
            console.log(`   Operation: ${change.operationType}`);
            console.log(`   Document ID: ${change.documentKey._id}`);
            console.log(`   Updated fields:`, change.updateDescription?.updatedFields);
            console.log(`   Timestamp: ${new Date().toISOString()}`);
            console.log(`   Stack trace at time of detection:`);
            console.log(new Error().stack);
        });
        
        console.log('✅ Status change monitoring active');
    } catch (error) {
        console.error('❌ Failed to set up change stream:', error);
    }
}

// Helper function to get master data and calculate box quantity
async function getMasterDataAndCalculateBoxQuantity(品番, pieceQuantity) {
    try {
        await client.connect();
        const masterDb = client.db("Sasaki_Coating_MasterDB");
        const masterCollection = masterDb.collection("masterDB");
        
        const masterData = await masterCollection.findOne({ 品番: 品番 });
        
        if (masterData && masterData.収容数) {
            const 収容数 = parseInt(masterData.収容数);
            if (収容数 > 0) {
                const boxQuantity = Math.ceil(pieceQuantity / 収容数);
                console.log(`📦 ${品番}: ${pieceQuantity}枚 ÷ ${収容数} = ${boxQuantity}個`);
                return boxQuantity;
            }
        }
        
        // If no master data or 収容数 is 0, return original quantity
        console.log(`⚠️ No master data found for ${品番}, using piece quantity: ${pieceQuantity}`);
        return pieceQuantity;
    } catch (error) {
        console.error(`Error fetching master data for ${品番}:`, error);
        return pieceQuantity; // Fallback to piece quantity
    }
}

// ==================== MQTT INTEGRATION ====================

// Initialize MQTT Client
function initializeMQTT() {
    console.log('🔌 Initializing MQTT client...');
    
    // Don't send credentials if they're empty (for test brokers)
    const mqttOptions = {
        clientId: `NodaServer_${Math.random().toString(16).substr(2, 8)}`,
        keepalive: 30,          // Reduced from 60 to 30 seconds
        connectTimeout: 10000,   // 10 second connection timeout
        reconnectPeriod: 10000,  // Increased from 5 to 10 seconds
        clean: true,
        will: {
            topic: 'noda/server/status',
            payload: JSON.stringify({ status: 'offline', timestamp: Date.now() }),
            qos: 1,
            retain: true
        },
        // SSL/TLS options for HiveMQ Cloud
        rejectUnauthorized: false  // Skip certificate verification (similar to MongoDB)
    };
    
    // Only add credentials if they're provided
    if (MQTT_USERNAME && MQTT_PASSWORD) {
        mqttOptions.username = MQTT_USERNAME;
        mqttOptions.password = MQTT_PASSWORD;
    }
    
    mqttClient = mqtt.connect(MQTT_BROKER_URL, mqttOptions);

    mqttClient.on('connect', () => {
        console.log('✅ MQTT broker connected successfully');
        
        // Subscribe to all device topics
        const subscriptions = [
            'noda/device/+/status',      // Device status updates
            'noda/device/+/completion',  // Task completions  
            'noda/device/+/heartbeat'    // Device heartbeats
        ];
        
        subscriptions.forEach(topic => {
            mqttClient.subscribe(topic, { qos: 1 }, (err) => {
                if (err) {
                    console.error(`❌ Failed to subscribe to ${topic}:`, err);
                } else {
                    console.log(`📥 Subscribed to MQTT topic: ${topic}`);
                }
            });
        });
    });

    mqttClient.on('message', handleMQTTMessage);
    
    mqttClient.on('error', (error) => {
        console.error('❌ MQTT connection error:', error);
        // Clear device tracking on connection error
        if (error.code === 'ETIMEDOUT' || error.message.includes('Keepalive timeout')) {
            console.log('🧹 Clearing MQTT device tracking due to connection error');
            mqttConnectedDevices.clear();
        }
    });
    
    mqttClient.on('close', () => {
        console.log('⚠️ MQTT connection closed');
        // Clear device online status when connection closes
        mqttDevices.forEach((device, deviceId) => {
            if (device.isOnline) {
                console.log(`📱 Marking device ${deviceId} as potentially offline due to MQTT disconnect`);
                device.isOnline = false;
            }
        });
    });
    
    mqttClient.on('reconnect', () => {
        console.log('🔄 MQTT reconnecting...');
    });
    
    mqttClient.on('offline', () => {
        console.log('📵 MQTT client went offline');
    });
}

// Handle incoming MQTT messages
async function handleMQTTMessage(topic, message) {
    try {
        // Ignore empty messages (from clearing retained messages)
        const messageString = message.toString();
        if (!messageString || messageString.trim() === '') {
            console.log(`📭 Received empty MQTT message on ${topic} - ignoring (likely cleared retained message)`);
            return;
        }
        
        const data = JSON.parse(messageString);
        const topicParts = topic.split('/');
        const deviceId = topicParts[2];
        const messageType = topicParts[3];
        
        //console.log(`📨 MQTT message from ${deviceId} (${messageType}):`, data);
        
        // Update device tracking
        mqttConnectedDevices.set(deviceId, Date.now());
        
        switch (messageType) {
            case 'status':
                await handleDeviceStatusUpdate(deviceId, data);
                break;
                
            case 'completion':
                await handleDeviceCompletion(deviceId, data);
                break;
                
            case 'heartbeat':
                handleDeviceHeartbeat(deviceId, data);
                break;
                
            default:
                console.log(`❓ Unknown MQTT message type: ${messageType}`);
        }
        
    } catch (error) {
        console.error('❌ Error handling MQTT message:', error);
    }
}

// Handle device status updates
async function handleDeviceStatusUpdate(deviceId, data) {
    //console.log(`📊 Device ${deviceId} status update:`, data);
    
    // Track device online/offline status
    const wasOffline = !mqttDevices.has(deviceId) || !mqttDevices.get(deviceId).isOnline;
    
    mqttDevices.set(deviceId, {
        isOnline: data.status !== 'offline',
        lastSeen: new Date(),
        deviceStatus: data
    });
    
    // Only check for assignments if device was previously offline and is now coming back online
    // Do NOT check when device transitions from picking to standby (that's just task completion)
    if (wasOffline && data.status === 'standby' && data.online === true) {
        console.log(`🔄 Device ${deviceId} came online from offline state, checking for current assignments...`);
        await checkDeviceAssignments(deviceId);
    }
    
    // Forward to Socket.IO tablets for real-time updates
    connectedTablets.forEach(tabletSocket => {
        tabletSocket.emit('device-status-update', {
            deviceId,
            status: data.status,
            isPickingMode: data.isPickingMode,
            currentQuantity: data.currentQuantity,
            requestNumber: data.requestNumber,
            timestamp: data.timestamp
        });
    });
}

// Check if a device has current assignments when it comes online
async function checkDeviceAssignments(deviceId) {
    try {
        await client.connect();
        const db = client.db("submittedDB");
        const requestsCollection = db.collection("nodaRequestDB");
        
        // Find any in-progress requests assigned to this device
        const inProgressRequests = await requestsCollection.find({
            status: 'in-progress',
            $or: [
                { '背番号': deviceId }, // Single requests
                { 'lineItems.背番号': deviceId, 'lineItems.status': 'in-progress' } // Bulk requests
            ]
        }).toArray();
        
        console.log(`🔍 Found ${inProgressRequests.length} in-progress requests for device ${deviceId}`);
        
        for (const request of inProgressRequests) {
            if (request.requestType === 'bulk' && request.lineItems) {
                // Check bulk request line items
                const deviceItems = request.lineItems.filter(item => 
                    item.背番号 === deviceId && item.status === 'in-progress'
                );
                
                for (const item of deviceItems) {
                    console.log(`🟢 Sending assignment to device ${deviceId}: ${item.quantity} units of ${item.品番}`);
                    await notifyDeviceStatusChange(
                        deviceId,
                        request.requestNumber,
                        item.lineNumber,
                        item.quantity,
                        item.品番,
                        'in-progress'
                    );
                }
            } else if (request.背番号 === deviceId) {
                // Single request
                console.log(`🟢 Sending assignment to device ${deviceId}: ${request.quantity} units of ${request.品番}`);
                await notifyDeviceStatusChange(
                    deviceId,
                    request.requestNumber,
                    1,
                    request.quantity,
                    request.品番,
                    'in-progress'
                );
            }
        }
        
        if (inProgressRequests.length === 0) {
            console.log(`ℹ️ No current assignments for device ${deviceId} - staying in standby`);
        }
        
    } catch (error) {
        console.error(`❌ Error checking assignments for device ${deviceId}:`, error);
    }
}

// Handle device task completion via MQTT
async function handleDeviceCompletion(deviceId, data) {
    const traceId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    console.log(`\n========== TRACE START [${traceId}] ==========`);
    console.log(`✅ [${traceId}] handleDeviceCompletion CALLED for device ${deviceId}:`, data);
    
    const { requestNumber, lineNumber, completedBy, timestamp } = data;
    
    // ===== DUPLICATE DETECTION: Check if this completion was already processed =====
    const completionKey = `${requestNumber}-${lineNumber}-${timestamp}`;
    console.log(`🔍 Checking completion key: ${completionKey}`);
    console.log(`📋 Currently tracked completions: ${processedCompletions.size} entries`);
    
    if (processedCompletions.has(completionKey)) {
        console.log(`⚠️ DUPLICATE completion detected for ${completionKey} - IGNORING`);
        return; // Skip duplicate processing
    }
    
    // Mark this completion as processed
    processedCompletions.set(completionKey, true);
    console.log(`✅ Marked ${completionKey} as processed`);
    
    // ===== CRITICAL: Clear retained completion message to prevent re-delivery =====
    mqttClient.publish(`noda/device/${deviceId}/completion`, "", { qos: 1, retain: true }, (err) => {
        if (err) {
            console.log(`⚠️ Failed to clear retained completion message for ${deviceId}`);
        } else {
            console.log(`🧹 Cleared retained completion message for ${deviceId}`);
        }
    });
    
    // Clean up old entries (keep only last 100)
    if (processedCompletions.size > 100) {
        const firstKey = processedCompletions.keys().next().value;
        processedCompletions.delete(firstKey);
    }
    
    try {
        // Use existing completion logic with new inventory-aware handling
        console.log(`📞 [${traceId}] CALLING completeLineItem(${requestNumber}, ${lineNumber}, ${completedBy})`);
        const result = await completeLineItem(requestNumber, lineNumber, completedBy);
        console.log(`📞 [${traceId}] completeLineItem RETURNED:`, { fullyCompleted: result.fullyCompleted, partialComplete: result.partialComplete, insufficientInventory: result.insufficientInventory });
        
        // Check if this was a duplicate completion
        if (result.alreadyCompleted) {
            console.log(`⚠️ Duplicate completion ignored for ${requestNumber} line ${lineNumber}`);
            return; // Don't send notifications for duplicates
        }
        
        // ===== NEW: Handle different completion scenarios using HELPER COLLECTION =====
        const submittedDb = client.db("submittedDB");
        const helperCollection = submittedDb.collection('nodaRequestHelperDB');
        const helperRecord = await helperCollection.findOne({ requestNumber, lineNumber });
        
        console.log(`📊 Helper record state:`, {
            pickingComplete: helperRecord?.pickingComplete,
            pickedQuantity: helperRecord?.pickedQuantity,
            remainingQuantity: helperRecord?.remainingQuantity
        });
        
        if (result.fullyCompleted || helperRecord?.pickingComplete) {
            // SUFFICIENT inventory: Full completion - send RED and keep RED
            console.log(`🔴 Fully completed - sending RED to device ${deviceId}`);
            publishDeviceCommand(deviceId, {
                color: 'red',
                quantity: null,
                message: 'Completed'
            });
            
            // Notify tablets
            connectedTablets.forEach(tabletSocket => {
                tabletSocket.emit('item-completed', {
                    requestNumber,
                    lineNumber,
                    deviceId,
                    completedBy,
                    fullyCompleted: true
                });
            });
        }
        else if (result.partialComplete || result.insufficientInventory || (helperRecord && helperRecord.remainingQuantity > 0)) {
            // INSUFFICIENT or NONE: Reactivate IoT with remaining quantity from HELPER
            const rawRemainingQuantity = helperRecord ? helperRecord.remainingQuantity : (result.remaining || result.needed);
            
            // SAFEGUARD: Ensure remaining quantity is never negative
            const remainingQuantity = Math.max(0, rawRemainingQuantity || 0);
            if (rawRemainingQuantity < 0) {
                console.warn(`⚠️ [SAFEGUARD] Helper had negative remainingQuantity: ${rawRemainingQuantity}, corrected to ${remainingQuantity}`);
            }
            
            const remainingBoxQty = await calculateBoxQuantity(result.品番, remainingQuantity);
            
            // SAFEGUARD: Ensure box quantity is never negative
            const safeBoxQty = Math.max(0, remainingBoxQty);
            
            console.log(`📦 Using HELPER COLLECTION data: ${remainingQuantity} pieces = ${safeBoxQty} boxes remaining`);
            
            console.log(`🟢 Partial/None inventory - reactivating device ${deviceId} with ${safeBoxQty} boxes (${remainingQuantity} pieces)`);
            
            // Flash RED briefly to acknowledge button press
            publishDeviceCommand(deviceId, {
                color: 'red',
                quantity: null,
                message: 'Acknowledged'
            });
            
            // After brief delay, send GREEN with remaining quantity
            setTimeout(() => {
                publishDeviceCommand(deviceId, {
                    color: 'green',
                    quantity: safeBoxQty,
                    message: result.partialComplete 
                        ? `残り ${safeBoxQty} 箱` 
                        : '在庫なし',
                    requestNumber: requestNumber,  // ← CRITICAL: ESP32 needs this!
                    lineNumber: lineNumber,        // ← CRITICAL: ESP32 needs this!
                    品番: result.品番               // ← Include product number
                });
            }, 500); // 500ms delay for visual feedback
            
            // Notify tablets about partial completion
            connectedTablets.forEach(tabletSocket => {
                tabletSocket.emit('item-partial-completed', {
                    requestNumber,
                    lineNumber,
                    deviceId,
                    completedBy,
                    deducted: result.deducted,
                    remaining: remainingQuantity,
                    partialComplete: result.partialComplete,
                    insufficientInventory: result.insufficientInventory
                });
            });
        }
        
    } catch (error) {
        console.error('❌ Error processing device completion:', error);
        
        // Send error back to device - use 0 instead of null to avoid -1 display
        publishDeviceCommand(deviceId, {
            color: 'red',
            quantity: 0,
            message: 'Error - Try Again'
        });
    }
}

// Handle device heartbeat
function handleDeviceHeartbeat(deviceId, data) {
    //console.log(`💓 Heartbeat from device ${deviceId} - RSSI: ${data.rssi || 'N/A'}`);
    // Just update the tracking - heartbeat is for connection monitoring
}

// Publish command to specific device
function publishDeviceCommand(deviceId, command) {
    if (!mqttClient) {
        console.error('❌ MQTT client is NULL - MQTT not initialized!');
        console.error('❌ Check: MQTT_ENABLED in .env file');
        return false;
    }
    
    if (!mqttClient.connected) {
        console.error('❌ MQTT client not connected to broker!');
        console.error('❌ Device command for', deviceId, 'will NOT be delivered');
        console.error('❌ Check: MQTT broker URL, username, password');
        return false;
    }
    
    const topic = `noda/device/${deviceId}/command`;
    const message = JSON.stringify(command);
    
    console.log(`📡 Publishing to topic: ${topic}`);
    
    mqttClient.publish(topic, message, { qos: 1, retain: true }, (err) => {
        if (err) {
            console.error(`❌ Failed to publish to ${deviceId}:`, err);
        } else {
            console.log(`✅ Successfully published command to ${deviceId}:`, command);
        }
    });
    
    return true;
}

// ==================== END MQTT INTEGRATION ====================

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    // Device registration
    socket.on('device-register', async (data) => {
        const { deviceId, type } = data;
        if (type === 'iot-device') {
            connectedDevices.set(deviceId, socket);
            socket.deviceId = deviceId;
            console.log(`🔧 IoT Device registered: ${deviceId}`);
            
            // Check if device has active picking assignment
            console.log(`🔍 Checking active picking for device ${deviceId}...`);
            const activePicking = await getActivePickingForDevice(deviceId);
            console.log(`📊 Active picking result for ${deviceId}:`, activePicking);
            
            if (activePicking) {
                // Device has active picking - restore green screen with box quantity
                console.log(`🟢 Restoring active picking for device ${deviceId}: ${activePicking.requestNumber} - ${activePicking.品番} (${activePicking.quantity})`);
                const boxQuantity = await calculateBoxQuantity(activePicking.品番, activePicking.quantity);
                const displayUpdate = {
                    color: 'green',
                    quantity: boxQuantity,
                    message: `Pick ${boxQuantity}`,
                    requestNumber: activePicking.requestNumber,
                    lineNumber: activePicking.lineNumber,
                    品番: activePicking.品番
                };
                console.log(`📤 Sending display update with box quantity:`, displayUpdate);
                socket.emit('display-update', displayUpdate);
            } else {
                // No active picking - send initial state (red screen)
                console.log(`🔴 No active picking found for ${deviceId}, sending red screen`);
                const displayUpdate = {
                    color: 'red',
                    quantity: null,
                    message: 'Standby'
                };
                console.log(`📤 Sending display update:`, displayUpdate);
                socket.emit('display-update', displayUpdate);
            }
        } else if (type === 'tablet') {
            connectedTablets.add(socket);
            socket.isTablet = true;
            console.log('Tablet connected');
            
            // Send current lock status to the new tablet
            checkGlobalPickingLock().then(() => {
                socket.emit('picking-lock-status', {
                    isLocked: globalPickingLock.isLocked,
                    activeRequestNumber: globalPickingLock.activeRequestNumber,
                    startedBy: globalPickingLock.startedBy,
                    startedAt: globalPickingLock.startedAt
                });
            });
        }
    });

    // Device completion notification - DISABLED (now using MQTT exclusively)
    // This handler caused duplicate transactions when ESP32 devices sent completion via both MQTT and Socket.IO
    /*
    socket.on('item-completed', async (data) => {
        const { deviceId, requestNumber, lineNumber, completedBy } = data;
        console.log(`Item completed by device ${deviceId}: ${requestNumber} line ${lineNumber}`);
        
        try {
            const result = await completeLineItem(requestNumber, lineNumber, completedBy);
            
            // Check if this was a duplicate completion
            if (result.alreadyCompleted) {
                console.log(`⚠️ Duplicate completion ignored for ${requestNumber} line ${lineNumber}`);
                return; // Don't send notifications for duplicates
            }
            
            // Send red screen back to device
            socket.emit('display-update', {
                color: 'red',
                quantity: null,
                message: 'Completed'
            });
            
            // Notify all tablets of the completion with rich details
            connectedTablets.forEach(tabletSocket => {
                tabletSocket.emit('item-completed', {
                    requestNumber,
                    lineNumber,
                    deviceId,
                    completedBy,
                    timestamp: new Date().toISOString(),
                    status: 'completed',
                    fromSocketIO: true
                });
            });
            
        } catch (error) {
            console.error('Error completing item:', error);
            socket.emit('error', { message: 'Failed to complete item' });
        }
    });
    */

    // Handle disconnection
    socket.on('disconnect', () => {
        if (socket.deviceId) {
            connectedDevices.delete(socket.deviceId);
            console.log(`IoT Device disconnected: ${socket.deviceId}`);
        }
        if (socket.isTablet) {
            connectedTablets.delete(socket);
            console.log('Tablet disconnected');
        }
    });
});

// API Routes

// Get all picking requests
app.get('/api/picking-requests', async (req, res) => {
    try {
        const collection = db.collection(process.env.COLLECTION_NAME);
        const requests = await collection.find({}).sort({ createdAt: -1 }).toArray();
        res.json(requests);
    } catch (error) {
        console.error('Error fetching picking requests:', error);
        res.status(500).json({ error: 'Failed to fetch picking requests' });
    }
});

// Get picking requests by status
app.get('/api/picking-requests/status/:status', async (req, res) => {
    try {
        const { status } = req.params;
        const collection = db.collection(process.env.COLLECTION_NAME);
        const requests = await collection.find({ status }).sort({ createdAt: -1 }).toArray();
        res.json(requests);
    } catch (error) {
        console.error('Error fetching picking requests by status:', error);
        res.status(500).json({ error: 'Failed to fetch picking requests' });
    }
});

// Get picking request by request number
app.get('/api/picking-requests/:requestNumber', async (req, res) => {
    try {
        const { requestNumber } = req.params;
        const collection = db.collection(process.env.COLLECTION_NAME);
        const request = await collection.findOne({ requestNumber });
        
        if (!request) {
            return res.status(404).json({ error: 'Picking request not found' });
        }
        
        res.json(request);
    } catch (error) {
        console.error('Error fetching picking request:', error);
        res.status(500).json({ error: 'Failed to fetch picking request' });
    }
});

// Get grouped picking requests by request number (for multiple items in same request)
app.get('/api/picking-requests/group/:requestNumber', async (req, res) => {
    try {
        const { requestNumber } = req.params;
        const collection = db.collection(process.env.COLLECTION_NAME);
        const request = await collection.findOne({ requestNumber });
        
        if (!request) {
            return res.status(404).json({ error: 'No picking requests found for this request number' });
        }
        
        res.json(request);
    } catch (error) {
        console.error('Error fetching grouped picking requests:', error);
        res.status(500).json({ error: 'Failed to fetch grouped picking requests' });
    }
});

// Start picking process - send to all IoT devices
app.post('/api/picking-requests/:requestNumber/start', async (req, res) => {
    try {
        const { requestNumber } = req.params;
        const { startedBy, factory } = req.body;
        
        // Check global picking lock
        await checkGlobalPickingLock();
        
        if (globalPickingLock.isLocked) {
            return res.status(423).json({ 
                error: 'System locked', 
                message: `Another picking operation is in progress: ${globalPickingLock.activeRequestNumber}`,
                activeRequest: globalPickingLock.activeRequestNumber,
                startedBy: globalPickingLock.startedBy,
                startedAt: globalPickingLock.startedAt
            });
        }
        
        const collection = db.collection(process.env.COLLECTION_NAME);
        const request = await collection.findOne({ requestNumber });
        
        if (!request) {
            return res.status(404).json({ error: 'Picking request not found' });
        }
        
        // Update request status to in-progress and update all pending line items to in-progress
        await collection.updateOne(
            { requestNumber },
            { 
                $set: { 
                    status: 'in-progress',
                    startedBy,
                    startedAt: new Date(),
                    updatedAt: new Date(),
                    factory: factory || '野田倉庫', // Store factory information
                    'lineItems.$[elem].status': 'in-progress',
                    'lineItems.$[elem].startedAt': new Date()
                }
            },
            {
                arrayFilters: [{ 'elem.status': 'pending' }]
            }
        );
        
        // Set global lock
        globalPickingLock = {
            isLocked: true,
            activeRequestNumber: requestNumber,
            startedBy: startedBy,
            startedAt: new Date()
        };
        
        // Broadcast lock status to all tablets
        broadcastLockStatus();
        
        // Get updated request with new status
        const updatedRequest = await collection.findOne({ requestNumber });
        
        // ===== CREATE HELPER RECORDS for picking progress tracking =====
        console.log(`📝 Creating helper records in nodaRequestHelperDB for ${requestNumber}`);
        const submittedDb = client.db("submittedDB");
        const helperCollection = submittedDb.collection('nodaRequestHelperDB');
        
        // Clear any existing helper records for this request
        await helperCollection.deleteMany({ requestNumber });
        
        // Create helper record for each line item
        const helperRecords = updatedRequest.lineItems.map(item => ({
            requestNumber,
            lineNumber: item.lineNumber,
            背番号: item.背番号,
            品番: item.品番,
            totalQuantity: item.quantity,
            requestedQuantity: item.quantity,
            pickedQuantity: 0,
            remainingQuantity: item.quantity,
            reservedQuantity: item.reservedQuantity || 0,
            shortfallQuantity: item.shortfallQuantity || 0,
            pickingComplete: false,
            createdAt: new Date(),
            updatedAt: new Date(),
            startedBy: startedBy,
            factory: factory || '野田倉庫'
        }));
        
        if (helperRecords.length > 0) {
            await helperCollection.insertMany(helperRecords);
            console.log(`✅ Created ${helperRecords.length} helper records for tracking picking progress`);
        }
        
        // Explicitly notify ESP32 devices of the new picking order
        console.log(`🚀 Start picking triggered for request ${requestNumber} by ${startedBy}`);
        await notifyESP32DevicesForRequest(requestNumber, startedBy);
        
        // Send picking data to all connected devices
        const pickingData = {
            requestNumber,
            lineItems: updatedRequest.lineItems.map(item => ({
                背番号: item.背番号,
                品番: item.品番,
                quantity: item.quantity,
                lineNumber: item.lineNumber,
                status: item.status
            }))
        };
        
        // Broadcast to all IoT devices (MQTT + Socket.IO)
        console.log(`🚀 Broadcasting to both MQTT and Socket.IO devices`);
        console.log(`📋 Processing ${updatedRequest.lineItems.length} line items for device commands`);
        
        // Send to MQTT devices (new hybrid approach) - with box quantities
        for (const item of updatedRequest.lineItems) {
            const deviceId = item.背番号;
            console.log(`\n🔍 Processing line ${item.lineNumber} for device ${deviceId}:`);
            console.log(`   Status: ${item.status}`);
            console.log(`   品番: ${item.品番}`);
            console.log(`   Quantity: ${item.quantity}`);
            
            if (item.status === 'in-progress') {
                const boxQuantity = await calculateBoxQuantity(item.品番, item.quantity);
                console.log(`   📦 Calculated box quantity: ${boxQuantity}`);
                console.log(`   🟢 Sending GREEN command to device ${deviceId}`);
                
                publishDeviceCommand(deviceId, {
                    color: 'green',
                    quantity: boxQuantity,
                    message: `Pick ${boxQuantity}`,
                    requestNumber,
                    lineNumber: item.lineNumber,
                    品番: item.品番
                });
            } else {
                console.log(`   🔴 Sending RED command to device ${deviceId} (status: ${item.status})`);
                
                publishDeviceCommand(deviceId, {
                    color: 'red',
                    quantity: null,
                    message: 'No Pick'
                });
            }
        }
        
        console.log(`\n✅ Finished sending commands to all ${updatedRequest.lineItems.length} devices`);

        // Send to Socket.IO devices (existing functionality) - with box quantities
        for (const [deviceId, deviceSocket] of connectedDevices.entries()) {
            const deviceItem = updatedRequest.lineItems.find(item => item.背番号 === deviceId);
            
            if (deviceItem && deviceItem.status === 'in-progress') {
                const boxQuantity = await calculateBoxQuantity(deviceItem.品番, deviceItem.quantity);
                // Device has items to pick - show green with quantity
                deviceSocket.emit('display-update', {
                    color: 'green',
                    quantity: boxQuantity,
                    message: `Pick ${boxQuantity}`,
                    requestNumber,
                    lineNumber: deviceItem.lineNumber,
                    品番: deviceItem.品番
                });
            } else {
                // Device has no items - show red
                deviceSocket.emit('display-update', {
                    color: 'red',
                    quantity: null,
                    message: 'No Pick'
                });
            }
        }
        
        console.log(`Picking started for ${requestNumber} by ${startedBy}`);
        res.json({ message: 'Picking process started', pickingData });
        
    } catch (error) {
        console.error('Error starting picking process:', error);
        res.status(500).json({ error: 'Failed to start picking process' });
    }
});

// Complete a line item
async function completeLineItem(requestNumber, lineNumber, completedBy) {
    const callStack = new Error().stack;
    console.log(`\n🔵 completeLineItem ENTERED for request ${requestNumber}, line ${lineNumber}`);
    console.log(`📍 Called from:`, callStack.split('\n')[2].trim());
    
    const collection = db.collection(process.env.COLLECTION_NAME);
    const submittedDb = client.db("submittedDB");
    const inventoryCollection = submittedDb.collection('nodaInventoryDB');
    const helperCollection = submittedDb.collection('nodaRequestHelperDB');
    const now = new Date();
    
    // ===== CHECK HELPER COLLECTION FIRST - it's the source of truth for picking =====
    let helperRecord = await helperCollection.findOne({ requestNumber, lineNumber });
    console.log(`\n📊 [HELPER CHECK] Helper record for ${requestNumber} line ${lineNumber}:`, helperRecord ? {
        pickedQuantity: helperRecord.pickedQuantity,
        remainingQuantity: helperRecord.remainingQuantity,
        totalQuantity: helperRecord.totalQuantity,
        pickingComplete: helperRecord.pickingComplete
    } : 'NOT FOUND');
    
    // ===== SAFEGUARD: Validate and fix corrupted helper data =====
    if (helperRecord && helperRecord.pickedQuantity > helperRecord.totalQuantity) {
        console.warn(`\n🚨🚨🚨 [HELPER CORRUPTION DETECTED] 🚨🚨🚨`);
        console.warn(`   pickedQuantity (${helperRecord.pickedQuantity}) > totalQuantity (${helperRecord.totalQuantity})`);
        console.warn(`   This indicates external process (MongoDB Trigger?) is also updating helper`);
        console.warn(`   🔧 AUTO-FIXING: Recalculating based on inventory records...`);
        
        // Recalculate actual picked quantity from inventory records
        // Use _insertSource pattern to identify UNIQUE insertions (excludes trigger duplicates)
        const inventoryRecords = await inventoryCollection.find({
            requestId: requestNumber,
            lineNumber: lineNumber,
            action: { $regex: /^Picking/ },
            _insertedBy: 'nodaServer.js:createInventoryTransaction'
        }).toArray();
        
        // CRITICAL: Filter duplicates by _insertSource unique ID
        // Each real insertion has a unique ID like "nodaServer-createInventoryTransaction-INV-1768903637454-osiab"
        // Duplicates from MongoDB Trigger will have the SAME _insertSource as the original
        const seenInsertSources = new Set();
        const uniqueRecords = [];
        
        for (const record of inventoryRecords) {
            if (record._insertSource && !seenInsertSources.has(record._insertSource)) {
                seenInsertSources.add(record._insertSource);
                uniqueRecords.push(record);
            }
        }
        
        let actualPicked = 0;
        for (const record of uniqueRecords) {
            // Calculate actual deducted amount: lastQuantity (before) - physicalQuantity (after)
            const lastQty = record.lastQuantity || 0;
            const newQty = record.physicalQuantity || 0;
            const deducted = lastQty - newQty;
            if (deducted > 0) {
                actualPicked += deducted;
                console.warn(`   📦 Record: lastQty=${lastQty} -> physicalQty=${newQty}, deducted=${deducted}`);
            }
        }
        
        // Cap at total quantity - can never pick more than requested
        actualPicked = Math.min(actualPicked, helperRecord.totalQuantity);
        const correctedRemaining = Math.max(0, helperRecord.totalQuantity - actualPicked);
        
        console.warn(`   📊 Found ${inventoryRecords.length} total inventory records`);
        console.warn(`   📊 After deduplication: ${uniqueRecords.length} unique records`);
        console.warn(`   📊 Actual picked (deduplicated): ${actualPicked}`);
        console.warn(`   📊 Corrected remaining: ${correctedRemaining}`);
        
        // Fix the helper record
        await helperCollection.updateOne(
            { requestNumber, lineNumber },
            {
                $set: {
                    pickedQuantity: actualPicked,
                    remainingQuantity: correctedRemaining,
                    _correctedAt: now,
                    _correctionReason: `Auto-fixed: pickedQuantity was ${helperRecord.pickedQuantity}, corrected to ${actualPicked}`,
                    _correctedBy: 'nodaServer.js:completeLineItem:safeguard'
                }
            }
        );
        
        // Re-read the corrected record
        helperRecord = await helperCollection.findOne({ requestNumber, lineNumber });
        console.warn(`   ✅ Helper record corrected: picked=${helperRecord.pickedQuantity}, remaining=${helperRecord.remainingQuantity}`);
    }
    
    if (helperRecord && helperRecord.pickingComplete) {
        console.log(`⚠️ Helper collection shows line ${lineNumber} already complete - ignoring duplicate`);
        console.log(`   Picked: ${helperRecord.pickedQuantity}/${helperRecord.totalQuantity}`);
        console.log(`   CompletedAt: ${helperRecord.completedAt}`);
        return { allCompleted: true, alreadyCompleted: true };
    }
    
    // Get the request first to get item details for inventory update
    const request = await collection.findOne({ requestNumber });
    if (!request) {
        throw new Error('Request not found');
    }
    
    // Find the specific line item
    const lineItem = request.lineItems.find(item => item.lineNumber === lineNumber);
    if (!lineItem) {
        throw new Error('Line item not found');
    }
    
    console.log(`📋 [LINE ITEM] Status: ${lineItem.status}, Original Quantity: ${lineItem.quantity}, 品番: ${lineItem.品番}, 背番号: ${lineItem.背番号}`);
    
    // Only process if status is 'in-progress'
    if (lineItem.status !== 'in-progress') {
        console.log(`⚠️ Line item ${lineNumber} for request ${requestNumber} has status '${lineItem.status}', cannot complete.`);
        throw new Error(`Line item status is '${lineItem.status}', expected 'in-progress'`);
    }
    
    // ===== NEW: Check if we already processed a partial deduction =====
    // If completedAt exists but status is still in-progress, this is a SECOND button press waiting for more inventory
    if (lineItem.completedAt) {
        console.log(`⚠️ Line item ${lineNumber} already has completedAt but waiting for more inventory. Creating audit trail only.`);
        
        // Create audit trail showing user pressed button again but inventory still insufficient
        console.log(`🔵 [RETRY PATH] Calling createInventoryTransaction with 0 quantity for ${lineItem.背番号}`);
        await createInventoryTransaction({
            背番号: lineItem.背番号,
            品番: lineItem.品番,
            pickedQuantity: 0,
            action: 'Picking Attempted (Insufficient Inventory - Retry)',
            source: `IoT Device ${lineItem.背番号} - ${completedBy}`,
            requestNumber: requestNumber,
            lineNumber: lineNumber,
            completedBy: completedBy,
            工場: request.工場 || '野田倉庫'
        });
        
        // Calculate remaining needed based on original quantity minus what was already picked
        const alreadyPicked = (lineItem.reservedQuantity || 0);
        const remainingNeeded = lineItem.quantity - alreadyPicked;
        
        return {
            allCompleted: false,
            request: request,
            insufficientInventory: true,
            deducted: 0,
            needed: remainingNeeded,
            remaining: remainingNeeded,
            品番: lineItem.品番,
            背番号: lineItem.背番号,
            lineNumber: lineNumber,
            isRetry: true
        };
    }
    
    // ===== NEW: Fetch real-time inventory availability =====
    console.log(`\n📊 [INVENTORY CHECK] Fetching real-time inventory for 背番号: ${lineItem.背番号}...`);
    const inventoryResults = await inventoryCollection.aggregate([
        { $match: { 背番号: lineItem.背番号 } },
        {
            $addFields: {
                timeStampDate: {
                    $cond: {
                        if: { $type: "$timeStamp" },
                        then: {
                            $cond: {
                                if: { $eq: [{ $type: "$timeStamp" }, "string"] },
                                then: { $dateFromString: { dateString: "$timeStamp" } },
                                else: "$timeStamp"
                            }
                        },
                        else: new Date()
                    }
                }
            }
        },
        { $sort: { timeStampDate: -1 } },
        { $limit: 1 }
    ]).toArray();
    
    let currentAvailable = 0;
    let currentReserved = 0;
    let currentPhysical = 0;
    if (inventoryResults.length > 0) {
        const inventoryItem = inventoryResults[0];
        currentAvailable = inventoryItem.availableQuantity || 0;
        currentReserved = inventoryItem.reservedQuantity || 0;
        currentPhysical = inventoryItem.physicalQuantity || 0;
        console.log(`📊 [LATEST INVENTORY] 背番号: ${inventoryItem.背番号}`);
        console.log(`   Physical Quantity: ${currentPhysical}`);
        console.log(`   Reserved Quantity: ${currentReserved}`);
        console.log(`   Available Quantity: ${currentAvailable}`);
        console.log(`   Last Action: ${inventoryItem.action}`);
        console.log(`   Last Timestamp: ${inventoryItem.timeStamp}`);
    } else {
        console.log(`⚠️ [NO INVENTORY] No inventory records found for ${lineItem.背番号}`);
    }
    
    // ===== CRITICAL: For picking, ALWAYS use physical quantity =====
    // When picking items from the warehouse, we're taking PHYSICAL items, not "available" items
    // availableQuantity is for RESERVATION tracking (what can be reserved for NEW requests)
    // physicalQuantity is for PICKING (what's actually in the warehouse to take)
    // 
    // Example: Physical=1720, Reserved=1600, Available=120
    // - We can PICK up to 1720 items (physical stock in warehouse)
    // - Only 120 can be reserved for NEW requests (available)
    // - 1600 is already reserved/allocated to existing requests
    //
    // The key insight: Picking REDUCES physical stock, not available stock
    // Available stock is reduced when NEW reservations are made
    
    let pickableQuantity = currentPhysical; // ✅ FIXED: Always use physical for picking
    
    console.log(`\n🔍 [PICKING QUANTITY CALCULATION]`);
    console.log(`   Available (for new reservations)=${currentAvailable}`);
    console.log(`   Reserved (already allocated)=${currentReserved}`);
    console.log(`   Physical (actual stock in warehouse)=${currentPhysical}`);
    console.log(`   ✅ Pickable Quantity: ${pickableQuantity} (using PHYSICAL stock)`);
    
    // Sanity check: if physical is 0, we can't pick anything
    if (currentPhysical === 0) {
        console.log(`⚠️ [NO PHYSICAL STOCK] Cannot pick - warehouse is empty`);
        pickableQuantity = 0;
    }
    
    // ===== CRITICAL FIX: Calculate remaining quantity from HELPER, not original lineItem =====
    const previouslyPicked = helperRecord ? helperRecord.pickedQuantity : 0;
    const remainingNeeded = lineItem.quantity - previouslyPicked;
    
    console.log(`\n🎯 [QUANTITY CALCULATION]`);
    console.log(`   Original Requested: ${lineItem.quantity}`);
    console.log(`   Previously Picked: ${previouslyPicked}`);
    console.log(`   Remaining Needed: ${remainingNeeded}`);
    console.log(`   Physical Available Now: ${pickableQuantity}`);
    
    // ===== PREVENT NEGATIVE DEDUCTIONS: Only deduct what's physically available =====
    const actualDeductQuantity = Math.max(0, Math.min(pickableQuantity, remainingNeeded));
    const remaining = remainingNeeded - actualDeductQuantity;
    
    console.log(`\n💡 [DEDUCTION DECISION]`);
    console.log(`   Will Deduct: ${actualDeductQuantity} (min of ${pickableQuantity} physical and ${remainingNeeded} needed)`);
    console.log(`   Will Remain After: ${remaining}`);
    console.log(`   Deduction Type: ${actualDeductQuantity === 0 ? '🔴 ZERO (Audit Only)' : actualDeductQuantity < remainingNeeded ? '🟡 PARTIAL' : '🟢 FULL'}`);

    
    // ===== Decide action based on availability =====
    console.log(`\n🔀 [DECISION POINT] actualDeductQuantity=${actualDeductQuantity}, remainingNeeded=${remainingNeeded}`);
    
    if (actualDeductQuantity === remainingNeeded && remainingNeeded > 0) {
        // SUFFICIENT: Full deduction - mark as completed
        console.log(`\n✅✅✅ [SUFFICIENT PATH] Full inventory available ✅✅✅`);
        console.log(`   Deducting: ${actualDeductQuantity}`);
        console.log(`   This will complete the line item`);

        
        const updateResult = await collection.updateOne(
            { requestNumber },
            {
                $set: {
                    'lineItems.$[elem].status': 'completed',
                    'lineItems.$[elem].completedAt': now,
                    'lineItems.$[elem].completedBy': completedBy,
                    'lineItems.$[elem].shortfallQuantity': 0,  // Reset shortfall when completed
                    'lineItems.$[elem].inventoryStatus': 'sufficient',  // Mark as sufficient
                    'lineItems.$[elem].updatedAt': now,
                    'updatedAt': now
                }
            },
            {
                arrayFilters: [
                    { 
                        'elem.lineNumber': lineNumber,
                        'elem.status': 'in-progress'
                    }
                ]
            }
        );
        
        if (updateResult.matchedCount === 0) {
            console.log(`⚠️ Line item ${lineNumber} was already completed by another process.`);
            return { allCompleted: true, request: request, alreadyCompleted: true };
        }
        
        console.log(`🟢 [SUFFICIENT PATH] Calling createInventoryTransaction with ${actualDeductQuantity} quantity for ${lineItem.背番号}`);
        console.log(`   Action: 'Picking' (Full)`);
        console.log(`   This is INSERT #${Date.now()}`);
        await createInventoryTransaction({
            背番号: lineItem.背番号,
            品番: lineItem.品番,
            pickedQuantity: actualDeductQuantity,
            action: 'Picking',
            source: `IoT Device ${lineItem.背番号} - ${request.startedBy || completedBy}`,
            requestNumber: requestNumber,
            lineNumber: lineNumber,
            completedBy: completedBy,
            工場: request.factory || '野田倉庫'
        });
        
        // ===== UPDATE HELPER COLLECTION - mark as complete =====
        const submittedDb = client.db("submittedDB");
        const helperCollection = submittedDb.collection('nodaRequestHelperDB');
        
        await helperCollection.updateOne(
            { requestNumber, lineNumber },
            {
                $set: {
                    pickedQuantity: lineItem.quantity,
                    remainingQuantity: 0,
                    shortfallQuantity: 0,  // CRITICAL: Reset shortfall when completed
                    pickingComplete: true,
                    completedAt: now,
                    completedBy: completedBy,
                    updatedAt: now
                }
            },
            { upsert: true }
        );
        
        console.log(`✅ Helper collection updated - marked as COMPLETE (all ${lineItem.quantity} picked, shortfall reset to 0)`);
        
        // ===== POST-UPDATE CORRUPTION CHECK FOR COMPLETED PATH =====
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const verifyHelper = await helperCollection.findOne({ requestNumber, lineNumber });
        // Check if values don't match expected (trigger may have corrupted them)
        if (verifyHelper && (verifyHelper.pickedQuantity !== lineItem.quantity || verifyHelper.remainingQuantity !== 0 || verifyHelper.shortfallQuantity !== 0 || !verifyHelper.pickingComplete)) {
            console.warn(`\n🚨 [POST-COMPLETE CORRUPTION] Trigger corrupted completed helper!`);
            console.warn(`   pickedQuantity: ${verifyHelper.pickedQuantity} (should be ${lineItem.quantity})`);
            console.warn(`   remainingQuantity: ${verifyHelper.remainingQuantity} (should be 0)`);
            console.warn(`   shortfallQuantity: ${verifyHelper.shortfallQuantity} (should be 0)`);
            console.warn(`   pickingComplete: ${verifyHelper.pickingComplete} (should be true)`);
            await helperCollection.updateOne(
                { requestNumber, lineNumber },
                {
                    $set: {
                        pickedQuantity: lineItem.quantity,
                        remainingQuantity: 0,
                        shortfallQuantity: 0,
                        pickingComplete: true,
                        _postUpdateCorrectedAt: new Date().toISOString()
                    }
                }
            );
            console.warn(`   ✅ Corrected back to: picked=${lineItem.quantity}, remaining=0, shortfall=0, complete=true`);
        }
        
        // Check if all line items are completed based on HELPER COLLECTION
        const allHelperRecords = await helperCollection.find({ requestNumber }).toArray();
        const totalLineItemsInRequest = request.lineItems ? request.lineItems.length : 0;
        const allHelperRecordsComplete = allHelperRecords.every(h => h.pickingComplete);
        const anyWithShortfall = allHelperRecords.some(h => h.shortfallQuantity > 0);
        
        // CRITICAL: Also check that we have helper records for ALL line items in the request
        const allLineItemsHaveHelperRecords = allHelperRecords.length >= totalLineItemsInRequest;
        const allCompleted = allHelperRecordsComplete && allLineItemsHaveHelperRecords;
        
        console.log(`🔍 Completion check using HELPER COLLECTION:`);
        console.log(`   Total line items in request: ${totalLineItemsInRequest}`);
        console.log(`   Helper records found: ${allHelperRecords.length}`);
        console.log(`   Completed helper records: ${allHelperRecords.filter(h => h.pickingComplete).length}`);
        console.log(`   All helper records complete: ${allHelperRecordsComplete}`);
        console.log(`   All line items have helper records: ${allLineItemsHaveHelperRecords}`);
        
        console.log(`🔍 Request completion check:`);
        console.log(`   All items completed: ${allCompleted}`);
        console.log(`   Any with shortfall: ${anyWithShortfall}`);
        
        if (allCompleted) {
            // Complete request when ALL line items are done - regardless of shortfalls
            const completionStatus = anyWithShortfall ? 'completed-with-shortfall' : 'completed';
            console.log(`✅ All items completed - marking request as '${completionStatus}'`);
            
            await collection.updateOne(
                { requestNumber },
                {
                    $set: {
                        status: 'completed',
                        completedAt: now,
                        updatedAt: now,
                        hasShortfall: anyWithShortfall
                    }
                }
            );
            
            if (globalPickingLock.isLocked && globalPickingLock.activeRequestNumber === requestNumber) {
                globalPickingLock = {
                    isLocked: false,
                    activeRequestNumber: null,
                    startedBy: null,
                    startedAt: null
                };
                broadcastLockStatus();
            }
            
            if (anyWithShortfall) {
                console.log(`✅ Request ${requestNumber} completed WITH SHORTFALLS! Lock released.`);
            } else {
                console.log(`✅ Request ${requestNumber} fully completed! Lock released.`);
            }
        } else if (!allLineItemsHaveHelperRecords) {
            console.log(`⚠️⚠️⚠️ NOT completing request - only ${allHelperRecords.length} of ${totalLineItemsInRequest} line items have been picked!`);
            console.log(`   Request status remains: in-progress (missing line items)`);
        }
        
        return { 
            allCompleted, 
            request: request,
            fullyCompleted: true,
            deducted: actualDeductQuantity
        };
    }
    else if (actualDeductQuantity > 0 && actualDeductQuantity < remainingNeeded) {
        // INSUFFICIENT: Partial deduction - keep as in-progress
        console.log(`\n⚠️⚠️⚠️ [INSUFFICIENT PATH] Partial inventory only ⚠️⚠️⚠️`);
        console.log(`   Requested: ${remainingNeeded} (remaining from original ${lineItem.quantity})`);
        console.log(`   Available: ${actualDeductQuantity}`);
        console.log(`   Will keep line item as 'in-progress' after partial pick`);

        
        // ===== UPDATE HELPER COLLECTION for picking progress =====
        const submittedDb = client.db("submittedDB");
        const helperCollection = submittedDb.collection('nodaRequestHelperDB');
        
        // Get current helper record
        const currentHelper = await helperCollection.findOne({ requestNumber, lineNumber });
        const previouslyPicked = currentHelper ? currentHelper.pickedQuantity : 0;
        
        // SAFEGUARD: Ensure we never exceed the total quantity
        const rawNewTotalPicked = previouslyPicked + actualDeductQuantity;
        const newTotalPicked = Math.min(rawNewTotalPicked, lineItem.quantity);
        const newRemaining = Math.max(0, lineItem.quantity - newTotalPicked);
        
        if (rawNewTotalPicked > lineItem.quantity) {
            console.warn(`⚠️ [HELPER SAFEGUARD] Prevented over-counting!`);
            console.warn(`   Raw total would have been: ${rawNewTotalPicked}`);
            console.warn(`   Capped to max quantity: ${newTotalPicked}`);
        }
        
        console.log(`\n📝 [HELPER UPDATE] Updating progress in helper collection:`);
        console.log(`   Previously Picked: ${previouslyPicked}`);
        console.log(`   This Pick: ${actualDeductQuantity}`);
        console.log(`   New Total Picked: ${newTotalPicked}`);
        console.log(`   New Remaining: ${newRemaining}`);
        console.log(`   Picking Complete: false`);

        
        // Update helper record with new pick
        await helperCollection.updateOne(
            { requestNumber, lineNumber },
            {
                $set: {
                    pickedQuantity: newTotalPicked,
                    remainingQuantity: newRemaining,
                    pickingComplete: false,
                    lastPickedAt: now,
                    lastPickedBy: completedBy,
                    updatedAt: now
                }
            },
            { upsert: true }
        );
        
        console.log(`✅ [HELPER UPDATE] Helper collection updated successfully`);
        
        // ===== POST-UPDATE CORRUPTION CHECK =====
        // MongoDB Atlas Trigger may double the values - check and fix immediately
        // Wait a brief moment for any trigger to execute
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const verifyHelper = await helperCollection.findOne({ requestNumber, lineNumber });
        // Check if values don't match what we EXPECTED to set (trigger may have doubled them)
        if (verifyHelper && (verifyHelper.pickedQuantity !== newTotalPicked || verifyHelper.remainingQuantity !== newRemaining)) {
            console.warn(`\n🚨🚨🚨 [POST-UPDATE CORRUPTION DETECTED] MongoDB Trigger corrupted helper!`);
            console.warn(`   Expected: picked=${newTotalPicked}, remaining=${newRemaining}`);
            console.warn(`   Actual: picked=${verifyHelper.pickedQuantity}, remaining=${verifyHelper.remainingQuantity}`);
            console.warn(`   Total quantity limit: ${lineItem.quantity}`);
            
            // Re-correct immediately
            await helperCollection.updateOne(
                { requestNumber, lineNumber },
                {
                    $set: {
                        pickedQuantity: newTotalPicked,
                        remainingQuantity: newRemaining,
                        _postUpdateCorrectedAt: new Date().toISOString(),
                        _postUpdateCorrectionReason: `Trigger corrupted values: was picked=${verifyHelper.pickedQuantity}/remaining=${verifyHelper.remainingQuantity}, corrected to picked=${newTotalPicked}/remaining=${newRemaining}`
                    }
                }
            );
            console.warn(`   ✅ Immediately corrected back to: picked=${newTotalPicked}, remaining=${newRemaining}`);
            
            // Wait and verify AGAIN (trigger might fire again)
            await new Promise(resolve => setTimeout(resolve, 300));
            const reVerify = await helperCollection.findOne({ requestNumber, lineNumber });
            if (reVerify && (reVerify.pickedQuantity !== newTotalPicked || reVerify.remainingQuantity !== newRemaining)) {
                console.warn(`   🚨 Second corruption detected! Fixing again...`);
                await helperCollection.updateOne(
                    { requestNumber, lineNumber },
                    { $set: { pickedQuantity: newTotalPicked, remainingQuantity: newRemaining } }
                );
            }
        } else {
            console.log(`✅ [POST-UPDATE VERIFY] Helper record integrity confirmed: picked=${verifyHelper?.pickedQuantity}, remaining=${verifyHelper?.remainingQuantity}`);
        }
        
        // ===== CRITICAL: Update MAIN REQUEST to keep lineItem as 'in-progress' =====
        console.log(`\n🔒 [MAIN REQUEST UPDATE] Explicitly setting main request lineItem ${lineNumber} to 'in-progress'`);
        await collection.updateOne(
            { requestNumber, 'lineItems.lineNumber': lineNumber },
            {
                $set: {
                    'lineItems.$.status': 'in-progress',
                    'lineItems.$.updatedAt': now,
                    updatedAt: now
                },
                $unset: {
                    'lineItems.$.completedAt': "",
                    'lineItems.$.completedBy': ""
                }
            }
        );
        
        console.log(`✅ [MAIN REQUEST UPDATE] LineItem status forced to 'in-progress', completedAt/completedBy removed`);
        
        // Also ensure REQUEST status is 'in-progress'
        console.log(`🔒 [REQUEST UPDATE] Ensuring request ${requestNumber} status is 'in-progress'`);
        await collection.updateOne(
            { requestNumber },
            {
                $set: {
                    status: 'in-progress',
                    updatedAt: now
                },
                $unset: {
                    completedAt: ""
                }
            }
        );
        
        console.log(`✅ [REQUEST UPDATE] Request status forced to 'in-progress', completedAt removed`);
        
        console.log(`\n💾💾💾 [INVENTORY INSERT] Creating inventory transaction...`);
        console.log(`   INSERT TYPE: Partial Pick`);
        console.log(`   Quantity: ${actualDeductQuantity}`);
        console.log(`   Action: 'Picking (Partial)'`);
        console.log(`   Background: ${previouslyPicked} already picked, ${newRemaining} still remaining`);
        console.log(`   This is INSERT #${Date.now()}`);
        
        await createInventoryTransaction({
            背番号: lineItem.背番号,
            品番: lineItem.品番,
            pickedQuantity: actualDeductQuantity,
            action: 'Picking (Partial)',
            source: `IoT Device ${lineItem.背番号} - ${request.startedBy || completedBy}`,
            requestNumber: requestNumber,
            lineNumber: lineNumber,
            completedBy: completedBy,
            工場: request.factory || '野田倉庫'
        });
        
        console.log(`✅ [INVENTORY INSERT] Partial pick transaction inserted successfully`);
        
        console.log(`\n⚠️⚠️⚠️ [INSUFFICIENT SUMMARY] Partial pick recorded in helper collection`);
        console.log(`   Deducted This Time: ${actualDeductQuantity}`);
        console.log(`   Total Picked So Far: ${newTotalPicked}/${lineItem.quantity}`);
        console.log(`   Still Remaining: ${newRemaining}`);
        console.log(`   Main request lineItem kept as 'in-progress'`);
        console.log(`   Waiting for inventory replenishment or next pick attempt`);
        
        console.log(`🔵 completeLineItem EXITING with partialComplete=true, deducted=${actualDeductQuantity}, remaining=${newRemaining}`);
        return {
            allCompleted: false,
            request: request,
            partialComplete: true,
            deducted: actualDeductQuantity,
            remaining: newRemaining,
            totalPicked: newTotalPicked,
            品番: lineItem.品番,
            背番号: lineItem.背番号,
            lineNumber: lineNumber
        };
    }
    else {
        // NONE: Zero inventory - don't deduct, keep as in-progress, AUDIT ONLY
        console.log(`\n❌❌❌ [ZERO PATH] No physical inventory available ❌❌❌`);
        console.log(`   Requested: ${remainingNeeded} (remaining from original ${lineItem.quantity})`);
        console.log(`   Physical Available: 0`);
        console.log(`   Will insert 0 deduction for AUDIT PURPOSES ONLY`);
        console.log(`   Reason: Cannot deduct from empty inventory - prevents negative stock`);
        
        // ===== CRITICAL: Keep line item and request as 'in-progress' =====
        console.log(`\n🔒 [ZERO PATH - MAIN REQUEST UPDATE] Keeping lineItem ${lineNumber} as 'in-progress'`);
        await collection.updateOne(
            { requestNumber, 'lineItems.lineNumber': lineNumber },
            {
                $set: {
                    'lineItems.$.status': 'in-progress',
                    'lineItems.$.updatedAt': now,
                    updatedAt: now
                },
                $unset: {
                    'lineItems.$.completedAt': "",
                    'lineItems.$.completedBy': ""
                }
            }
        );
        console.log(`✅ [ZERO PATH] LineItem status forced to 'in-progress', completedAt/completedBy removed`);
        
        // Also ensure REQUEST status is 'in-progress'
        console.log(`🔒 [ZERO PATH - REQUEST UPDATE] Ensuring request ${requestNumber} status is 'in-progress'`);
        await collection.updateOne(
            { requestNumber },
            {
                $set: {
                    status: 'in-progress',
                    updatedAt: now
                },
                $unset: {
                    completedAt: ""
                }
            }
        );
        console.log(`✅ [ZERO PATH] Request status forced to 'in-progress', completedAt removed`);
        
        // Audit trail: Record attempt with zero deduction
        console.log(`\n💾💾💾 [INVENTORY INSERT] Creating ZERO audit transaction...`);
        console.log(`   INSERT TYPE: Zero Deduction (Audit Only)`);
        console.log(`   Quantity: 0`);
        console.log(`   Action: 'Picking Attempted (No Inventory)'`);
        console.log(`   Background: User pressed button but physical inventory is 0`);
        console.log(`   This is INSERT #${Date.now()}`);
        
        await createInventoryTransaction({
            背番号: lineItem.背番号,
            品番: lineItem.品番,
            pickedQuantity: 0,
            action: 'Picking Attempted (No Inventory)',
            source: `IoT Device ${lineItem.背番号} - ${request.startedBy || completedBy}`,
            requestNumber: requestNumber,
            lineNumber: lineNumber,
            completedBy: completedBy,
            工場: request.factory || '野田倉庫'
        });
        
        console.log(`✅ [INVENTORY INSERT] Zero audit transaction inserted successfully`);
        console.log(`   Purpose: Track button press attempt when inventory is empty`);
        console.log(`   Physical inventory remains at 0 (no negative values)`);
        
        console.log(`\n❌ [ZERO SUMMARY] Cannot pick - waiting for inventory replenishment`);
        console.log(`   Still Needed: ${remainingNeeded}`);
        console.log(`   Physical Stock: 0`);
        console.log(`   Next Step: Add inventory, then press button again`);
        
        return {
            allCompleted: false,
            request: request,
            insufficientInventory: true,
            deducted: 0,
            needed: remainingNeeded,
            remaining: remainingNeeded,
            品番: lineItem.品番,
            背番号: lineItem.背番号,
            lineNumber: lineNumber
        };
    }
}

// Create inventory transaction to match admin backend structure
async function createInventoryTransaction(transactionData) {
    const callStack = new Error().stack;
    const traceId = `INV-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const lockKey = `${transactionData.背番号}-${transactionData.requestNumber}-${transactionData.lineNumber}`;
    
    // 🔐 MUTEX CHECK: Prevent duplicate concurrent transactions
    if (inventoryTransactionLocks.has(lockKey)) {
        console.log(`\n🚫🚫🚫 [DUPLICATE BLOCKED] Transaction already in progress for ${lockKey} 🚫🚫🚫`);
        console.log(`   This call would have created a DUPLICATE insertion!`);
        console.log(`   TraceId: ${traceId}`);
        console.log(`   Action: ${transactionData.action}`);
        console.log(`   Quantity: ${transactionData.pickedQuantity}`);
        console.log(callStack);
        return { blocked: true, reason: 'Duplicate transaction blocked by mutex' };
    }
    
    // Set lock
    inventoryTransactionLocks.set(lockKey, { traceId, startedAt: Date.now() });
    console.log(`🔐 [MUTEX] Lock acquired for ${lockKey}`);
    
    console.log(`\n💾💾💾💾💾💾💾💾💾💾💾💾💾💾💾💾💾💾💾💾💾💾💾💾💾💾`);
    console.log(`[${traceId}] ✨ createInventoryTransaction FUNCTION CALLED ✨`);
    console.log(`💾💾💾💾💾💾💾💾💾💾💾💾💾💾💾💾💾💾💾💾💾💾💾💾💾💾`);
    console.log(`\n📋 [TRANSACTION DATA]`);
    console.log(`   背番号: ${transactionData.背番号}`);
    console.log(`   品番: ${transactionData.品番}`);
    console.log(`   Request: ${transactionData.requestNumber}`);
    console.log(`   Line: ${transactionData.lineNumber}`);
    console.log(`   Picked Qty: ${transactionData.pickedQuantity}`);
    console.log(`   Action: ${transactionData.action}`);
    console.log(`   Source: ${transactionData.source}`);
    console.log(`   CompletedBy: ${transactionData.completedBy}`);
    console.log(`   工場: ${transactionData.工場}`);
    console.log(`\n📞 [CALL STACK] This function was called from:`);
    console.log(callStack);

    
    try {
        // Connect to the submittedDB database (same as admin backend)
        const submittedDb = client.db("submittedDB");
        const inventoryCollection = submittedDb.collection('nodaInventoryDB');
        
        // Get current inventory state for this item using aggregation pipeline (same as admin backend)
        const inventoryResults = await inventoryCollection.aggregate([
            { $match: { 背番号: transactionData.背番号 } },
            {
                $addFields: {
                    timeStampDate: {
                        $cond: {
                            if: { $type: "$timeStamp" },
                            then: {
                                $cond: {
                                    if: { $eq: [{ $type: "$timeStamp" }, "string"] },
                                    then: { $dateFromString: { dateString: "$timeStamp" } },
                                    else: "$timeStamp"
                                }
                            },
                            else: new Date()
                        }
                    }
                }
            },
            { $sort: { timeStampDate: -1 } },
            { $limit: 1 }
        ]).toArray();
        
        // Get current quantities (default to 0 if no previous record)
        let currentPhysical = 0;
        let currentReserved = 0;
        let currentAvailable = 0;
        let lastAction = null;
        let lastRequestNumber = null;
        let lastLineNumber = null;
        
        if (inventoryResults.length > 0) {
            const inventoryItem = inventoryResults[0];
            currentPhysical = inventoryItem.physicalQuantity || inventoryItem.runningQuantity || 0;
            currentReserved = inventoryItem.reservedQuantity || 0;
            currentAvailable = inventoryItem.availableQuantity || inventoryItem.runningQuantity || 0;
            lastAction = inventoryItem.action;
            lastRequestNumber = inventoryItem.requestNumber;
            lastLineNumber = inventoryItem.lineNumber;
            console.log(`\n📊 [BEFORE CALCULATION] Current inventory state:`);
            console.log(`   Physical: ${currentPhysical}`);
            console.log(`   Reserved: ${currentReserved}`);
            console.log(`   Available: ${currentAvailable}`);
            console.log(`   Last Action: ${inventoryItem.action}`);
            console.log(`   Last TimeStamp: ${inventoryItem.timeStamp}`);
            
            // 🚨 DUPLICATE DETECTION: Check if Atlas Trigger already deducted for this pick
            const isPickingAction = lastAction && (lastAction.includes('Picking') || lastAction.includes('picking'));
            const sameRequest = lastRequestNumber === transactionData.requestNumber;
            const sameLine = lastLineNumber === transactionData.lineNumber;
            
            if (isPickingAction && sameRequest && sameLine) {
                console.log(`\n🚨🚨🚨 [DUPLICATE TRANSACTION DETECTED] 🚨🚨🚨`);
                console.log(`   Last action was already: ${lastAction}`);
                console.log(`   For same request: ${lastRequestNumber}, line: ${lastLineNumber}`);
                console.log(`   MongoDB Atlas Trigger likely already deducted inventory!`);
                console.log(`   Skipping this transaction to prevent double-deduction.`);
                
                inventoryTransactionLocks.delete(lockKey);
                console.log(`🔓 [MUTEX] Lock released for ${lockKey} (duplicate detected)`);
                
                return { 
                    success: true, 
                    skipped: true, 
                    reason: 'Transaction already completed by Atlas Trigger' 
                };
            }
        } else {
            console.log(`\n⚠️ [NO PRIOR INVENTORY] No previous records found - starting from 0`);
        }
        
        // Calculate new quantities after picking
        const pickedQuantity = transactionData.pickedQuantity;
        
        console.log(`\n🧮 [QUANTITY CALCULATION]`);
        console.log(`   Picked Quantity to Deduct: ${pickedQuantity}`);
        console.log(`   Current Physical: ${currentPhysical}`);
        console.log(`   Current Reserved: ${currentReserved}`);
        console.log(`   Current Available: ${currentAvailable}`);

        // 🔒 AUDIT-ONLY MODE: If pickedQuantity is 0, preserve all existing values
        let newPhysicalQuantity, newReservedQuantity, newAvailableQuantity;
        
        if (pickedQuantity === 0) {
            console.log(`\n📋 [AUDIT-ONLY MODE] pickedQuantity is 0 - preserving existing inventory values`);
            newPhysicalQuantity = currentPhysical;
            newReservedQuantity = currentReserved;
            newAvailableQuantity = currentAvailable;
            console.log(`   Physical: ${newPhysicalQuantity} (unchanged)`);
            console.log(`   Reserved: ${newReservedQuantity} (unchanged)`);
            console.log(`   Available: ${newAvailableQuantity} (unchanged)`);
        } else {
            newPhysicalQuantity = currentPhysical - pickedQuantity;  // Reduce physical stock
            newReservedQuantity = Math.max(0, currentReserved - pickedQuantity);  // Reduce reserved stock (no negative)
            newAvailableQuantity = newPhysicalQuantity - newReservedQuantity; // Recalculate available
            
            console.log(`\n📐 [AFTER CALCULATION] New inventory state:`);
            console.log(`   New Physical: ${currentPhysical} - ${pickedQuantity} = ${newPhysicalQuantity}`);
            console.log(`   New Reserved: max(0, ${currentReserved} - ${pickedQuantity}) = ${newReservedQuantity}`);
            console.log(`   New Available: ${newPhysicalQuantity} - ${newReservedQuantity} = ${newAvailableQuantity}`);
        }
        
        // ===== SAFETY CHECK: Prevent negative physical quantity =====
        if (newPhysicalQuantity < 0) {
            console.error(`\n🚨🚨🚨 [CRITICAL ERROR] Negative physical quantity detected! 🚨🚨🚨`);
            console.error(`   This should NEVER happen!`);
            console.error(`   Current Physical: ${currentPhysical}`);
            console.error(`   Trying to Deduct: ${pickedQuantity}`);
            console.error(`   Would Result In: ${newPhysicalQuantity}`);
            console.error(`   🛑 ABORTING TRANSACTION TO PREVENT DATA CORRUPTION`);
            throw new Error(`Cannot deduct ${pickedQuantity} from physical quantity ${currentPhysical} - would result in negative inventory`);
        }
        
        console.log(`✅ [SAFETY CHECK] Physical quantity validation passed (${newPhysicalQuantity} >= 0)`);

        // 🚨 CHECK: Is action being provided or using default?
        const providedAction = transactionData.action;
        const finalAction = providedAction || `Picking (-${pickedQuantity})`;
        
        if (!providedAction) {
            console.log(`\n🚨🚨🚨 [WARNING] NO ACTION PROVIDED - USING DEFAULT 🚨🚨🚨`);
            console.log(`   This should NOT happen! All callers should provide explicit action.`);
            console.log(`   Default action being used: "${finalAction}"`);
            console.log(`   transactionData.action value: "${transactionData.action}" (type: ${typeof transactionData.action})`);
            console.log(`   Full transactionData:`, JSON.stringify(transactionData, null, 2));
        } else {
            console.log(`✅ [ACTION CHECK] Using provided action: "${providedAction}"`);
        }

        
        // Create new transaction record (exact same structure as admin backend)
        const insertSourceId = `nodaServer-createInventoryTransaction-${traceId}`;
        const transactionRecord = {
            背番号: transactionData.背番号,
            品番: transactionData.品番,
            timeStamp: new Date(),
            Date: new Date().toISOString().split('T')[0],
            
            // Two-stage inventory fields (same as admin backend)
            physicalQuantity: newPhysicalQuantity,
            reservedQuantity: newReservedQuantity,
            availableQuantity: newAvailableQuantity,
            
            // Legacy field for compatibility
            runningQuantity: newPhysicalQuantity,
            lastQuantity: currentPhysical,
            
            action: finalAction,
            source: transactionData.source,
            
            // Optional picking-specific fields
            requestId: transactionData.requestNumber,
            lineNumber: transactionData.lineNumber,
            note: `Picked ${pickedQuantity} units for request ${transactionData.requestNumber} line ${transactionData.lineNumber} by ${transactionData.completedBy}`,
            工場: transactionData.工場 || '野田倉庫',
            
            // 🔍 DEBUG: Track insertion source
            _insertSource: insertSourceId,
            _insertedAt: new Date().toISOString(),
            _insertedBy: 'nodaServer.js:createInventoryTransaction',
            _providedAction: providedAction || 'NONE - USING DEFAULT'
        };
        
        console.log(`\n📝 [TRANSACTION RECORD] About to insert:`);
        console.log(JSON.stringify(transactionRecord, null, 2));
        
        // Insert the new record
        console.log(`\n🔽 [DATABASE INSERT] Calling inventoryCollection.insertOne()...`);
        const insertStartTime = Date.now();
        const result = await inventoryCollection.insertOne(transactionRecord);
        const insertEndTime = Date.now();
        const insertDuration = insertEndTime - insertStartTime;
        
        // 🔓 Release the lock AFTER successful insertion
        inventoryTransactionLocks.delete(lockKey);
        console.log(`🔓 [MUTEX] Lock released for ${lockKey}`);
        
        console.log(`\n✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅`);
        console.log(`[${traceId}] 🎉 SUCCESSFULLY INSERTED TO nodaInventoryDB 🎉`);
        console.log(`✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅`);
        console.log(`\n📌 [INSERT DETAILS]`);
        console.log(`   MongoDB Insert ID: ${result.insertedId}`);
        console.log(`   Request: ${transactionData.requestNumber}`);
        console.log(`   Line: ${transactionData.lineNumber}`);
        console.log(`   背番号: ${transactionData.背番号}`);
        console.log(`   Action: ${transactionRecord.action}`);
        console.log(`   Picked: ${pickedQuantity} units`);
        console.log(`   Insert Duration: ${insertDuration}ms`);
        console.log(`   TimeStamp: ${transactionRecord.timeStamp.toISOString()}`);
        
        console.log(`\n📊 [INVENTORY SUMMARY] Changes applied:`);
        console.log(`   Physical: ${currentPhysical} → ${newPhysicalQuantity} (${pickedQuantity > 0 ? '-' : ''}${pickedQuantity})`);
        console.log(`   Reserved: ${currentReserved} → ${newReservedQuantity}`);
        console.log(`   Available: ${currentAvailable} → ${newAvailableQuantity}`);
        
        console.log(`\n💾 [FUNCTION EXIT] createInventoryTransaction completed successfully\n`);

        
        return result;
        
    } catch (error) {
        // 🔓 Release the lock on error too
        inventoryTransactionLocks.delete(lockKey);
        console.log(`🔓 [MUTEX] Lock released for ${lockKey} (due to error)`);
        console.error('Error creating inventory transaction:', error);
        throw error;
    }
}

// Start individual line item picking
app.post('/api/picking-requests/:requestNumber/line/:lineNumber/start', async (req, res) => {
    try {
        const { requestNumber, lineNumber } = req.params;
        const { startedBy, deviceId } = req.body;
        
        const db = client.db('nodaSystem');
        const collection = db.collection('pickingRequests');
        
        // Update the specific line item to in-progress
        const updateResult = await collection.updateOne(
            { 
                requestNumber: requestNumber,
                'lineItems.lineNumber': parseInt(lineNumber)
            },
            { 
                $set: { 
                    'lineItems.$.status': 'in-progress',
                    'lineItems.$.startedAt': new Date(),
                    'lineItems.$.startedBy': startedBy
                }
            }
        );
        
        if (updateResult.matchedCount === 0) {
            return res.status(404).json({ error: 'Line item not found' });
        }
        
        // Send display update to specific device
        if (deviceId) {
            const lineItem = await collection.findOne(
                { requestNumber: requestNumber },
                { projection: { lineItems: { $elemMatch: { lineNumber: parseInt(lineNumber) } } } }
            );
            
            if (lineItem && lineItem.lineItems && lineItem.lineItems[0]) {
                const item = lineItem.lineItems[0];
                const boxQuantity = await calculateBoxQuantity(item.品番, item.quantity);
                io.emit('display-update', {
                    deviceId: deviceId,
                    color: 'green',
                    quantity: boxQuantity,
                    message: `Pick ${boxQuantity}`,
                    requestNumber: requestNumber,
                    lineNumber: parseInt(lineNumber),
                    品番: item.品番
                });
                
                console.log(`Picking started for ${requestNumber} line ${lineNumber} on device ${deviceId} by ${startedBy} (${boxQuantity} boxes)`);
            }
        }
        
        res.json({ 
            message: 'Individual picking started successfully',
            requestNumber: requestNumber,
            lineNumber: parseInt(lineNumber),
            deviceId: deviceId
        });
        
    } catch (error) {
        console.error('Error starting individual picking:', error);
        res.status(500).json({ error: 'Failed to start individual picking' });
    }
});

// Get current lock status
app.get('/api/picking-lock-status', async (req, res) => {
    try {
        await checkGlobalPickingLock();
        
        res.json({
            isLocked: globalPickingLock.isLocked,
            activeRequestNumber: globalPickingLock.activeRequestNumber,
            startedBy: globalPickingLock.startedBy,
            startedAt: globalPickingLock.startedAt
        });
    } catch (error) {
        console.error('Error getting lock status:', error);
        res.status(500).json({ error: 'Failed to get lock status' });
    }
});

// Get device status - RESTful API for ESP32 to check its current assignment
app.get('/api/device/:deviceId/status', async (req, res) => {
    try {
        const { deviceId } = req.params;
        console.log(`🌐 REST API: Device status requested for ${deviceId}`);
        
        const activePicking = await getActivePickingForDevice(deviceId);
        console.log(`🌐 REST API: Active picking for ${deviceId}:`, activePicking);
        
        if (activePicking) {
            const boxQuantity = await calculateBoxQuantity(activePicking.品番, activePicking.quantity);
            const response = {
                status: 'picking',
                color: 'green',
                quantity: boxQuantity,
                message: `Pick ${boxQuantity}`,
                requestNumber: activePicking.requestNumber,
                lineNumber: activePicking.lineNumber,
                品番: activePicking.品番
            };
            console.log(`🌐 REST API: Sending response with box quantity:`, response);
            res.json(response);
        } else {
            const response = {
                status: 'standby',
                color: 'red',
                quantity: null,
                message: 'Standby'
            };
            console.log(`🌐 REST API: Sending response:`, response);
            res.json(response);
        }
    } catch (error) {
        console.error('🌐 REST API: Error getting device status:', error);
        res.status(500).json({ error: 'Failed to get device status' });
    }
});

// Update picking request status
app.put('/api/picking-requests/:requestNumber/line/:lineNumber/status', async (req, res) => {
    try {
        const { requestNumber, lineNumber } = req.params;
        const { status, completedBy } = req.body;
        
        if (!['pending', 'in-progress', 'completed', 'cancelled'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }
        
        console.log(`🌐 REST API: Status update requested for ${requestNumber} line ${lineNumber} by ${completedBy}`);
        console.log(`⚠️ WARNING: This endpoint should NOT be called for IoT completions - use MQTT only!`);
        
        // Check if this line item was already processed via MQTT
        const collection = db.collection(process.env.COLLECTION_NAME);
        const request = await collection.findOne({ requestNumber });
        if (request) {
            const lineItem = request.lineItems.find(item => item.lineNumber === parseInt(lineNumber));
            if (lineItem && lineItem.completedAt) {
                console.log(`⚠️ REST API: Line item ${lineNumber} already has completedAt - likely already processed via MQTT`);
                return res.json({ 
                    message: 'Line item already processed via MQTT', 
                    alreadyProcessed: true,
                    completedAt: lineItem.completedAt
                });
            }
        }
        
        const result = await completeLineItem(requestNumber, parseInt(lineNumber), completedBy);
        
        if (result.alreadyCompleted) {
            res.json({ message: 'Line item was already completed', alreadyCompleted: true });
        } else {
            res.json({ message: 'Line item status updated successfully' });
        }
        
    } catch (error) {
        console.error('Error updating line item status:', error);
        res.status(500).json({ error: 'Failed to update line item status' });
    }
});

// Get connected devices status
app.get('/api/devices/status', (req, res) => {
    const devices = Array.from(connectedDevices.keys()).map(deviceId => ({
        deviceId,
        connected: true,
        lastSeen: new Date().toISOString()
    }));
    
    res.json({
        connectedDevices: devices.length,
        connectedTablets: connectedTablets.size,
        devices
    });
});

// Get unique request numbers (for the picking request list)
app.get('/api/request-numbers', async (req, res) => {
    try {
        const collection = db.collection(process.env.COLLECTION_NAME);
        const requests = await collection.find({}).sort({ createdAt: -1 }).toArray();
        
        const requestsWithInfo = requests.map(request => {
            const totalQuantity = request.lineItems.reduce((sum, item) => sum + item.quantity, 0);
            const completedItems = request.lineItems.filter(item => item.status === 'completed').length;
            const totalItems = request.lineItems.length;
            
            return {
                requestNumber: request.requestNumber,
                totalQuantity,
                status: request.status,
                createdAt: request.createdAt,
                itemCount: totalItems,
                completedItems,
                pickupDate: request.pickupDate
            };
        });
        
        res.json(requestsWithInfo);
    } catch (error) {
        console.error('Error fetching request numbers:', error);
        res.status(500).json({ error: 'Failed to fetch request numbers' });
    }
});

// ==================== NODA WAREHOUSE MANAGEMENT API ROUTES ====================

// ==================== MQTT DEVICE API ENDPOINTS ====================

// Check if MQTT device is online
app.get('/api/mqtt/device/:deviceId/status', (req, res) => {
    const { deviceId } = req.params;
    
    // Check if device has been seen recently via MQTT
    const isOnline = mqttDevices.has(deviceId) && mqttDevices.get(deviceId).isOnline;
    const lastSeen = mqttDevices.has(deviceId) ? mqttDevices.get(deviceId).lastSeen : null;
    
    res.json({
        deviceId,
        protocol: 'mqtt',
        isOnline,
        lastSeen,
        status: isOnline ? 'connected' : 'disconnected'
    });
});

// Get picking progress from helper collection
app.get('/api/picking-requests/:requestNumber/helper', async (req, res) => {
    try {
        const { requestNumber } = req.params;
        const submittedDb = client.db("submittedDB");
        const helperCollection = submittedDb.collection('nodaRequestHelperDB');
        const inventoryCollection = submittedDb.collection('nodaInventoryDB');
        
        let helperRecords = await helperCollection.find({ requestNumber }).toArray();
        
        if (helperRecords.length === 0) {
            return res.status(404).json({ error: 'No picking progress found' });
        }
        
        // ===== SAFEGUARD: Validate and fix corrupted helper data =====
        const now = new Date();
        for (let i = 0; i < helperRecords.length; i++) {
            const record = helperRecords[i];
            
            if (record.pickedQuantity > record.totalQuantity) {
                console.warn(`\n🚨 [HELPER API] Corruption detected for ${requestNumber} line ${record.lineNumber}`);
                console.warn(`   pickedQuantity (${record.pickedQuantity}) > totalQuantity (${record.totalQuantity})`);
                
                // Recalculate from inventory records
                const inventoryRecords = await inventoryCollection.find({
                    requestId: requestNumber,
                    lineNumber: record.lineNumber,
                    action: { $regex: /^Picking/ },
                    _insertedBy: 'nodaServer.js:createInventoryTransaction'
                }).toArray();
                
                // Deduplicate by _insertSource
                const seenInsertSources = new Set();
                const uniqueRecords = [];
                for (const invRec of inventoryRecords) {
                    if (invRec._insertSource && !seenInsertSources.has(invRec._insertSource)) {
                        seenInsertSources.add(invRec._insertSource);
                        uniqueRecords.push(invRec);
                    }
                }
                
                let actualPicked = 0;
                for (const invRec of uniqueRecords) {
                    if (invRec.lastQuantity && invRec.lastQuantity > 0) {
                        actualPicked += invRec.lastQuantity;
                    }
                }
                
                // Cap at total quantity
                actualPicked = Math.min(actualPicked, record.totalQuantity);
                const correctedRemaining = Math.max(0, record.totalQuantity - actualPicked);
                
                console.warn(`   🔧 Correcting: picked=${actualPicked}, remaining=${correctedRemaining}`);
                
                // Fix the helper record in DB
                await helperCollection.updateOne(
                    { requestNumber, lineNumber: record.lineNumber },
                    {
                        $set: {
                            pickedQuantity: actualPicked,
                            remainingQuantity: correctedRemaining,
                            _correctedAt: now,
                            _correctionReason: `API fix: pickedQuantity was ${record.pickedQuantity}, corrected to ${actualPicked}`,
                            _correctedBy: 'nodaServer.js:helper-api-endpoint'
                        }
                    }
                );
                
                // Update the record in our array for the response
                helperRecords[i].pickedQuantity = actualPicked;
                helperRecords[i].remainingQuantity = correctedRemaining;
            }
        }
        
        // Calculate overall progress
        const totalItems = helperRecords.length;
        const completedItems = helperRecords.filter(h => h.pickingComplete).length;
        const totalRequested = helperRecords.reduce((sum, h) => sum + h.totalQuantity, 0);
        const totalPicked = helperRecords.reduce((sum, h) => sum + h.pickedQuantity, 0);
        const totalRemaining = helperRecords.reduce((sum, h) => sum + h.remainingQuantity, 0);
        
        res.json({
            requestNumber,
            progress: {
                totalItems,
                completedItems,
                totalRequested,
                totalPicked,
                totalRemaining,
                percentComplete: Math.round((totalPicked / totalRequested) * 100)
            },
            lineItems: helperRecords
        });
    } catch (error) {
        console.error('Error fetching picking progress:', error);
        res.status(500).json({ error: 'Failed to fetch picking progress' });
    }
});

// Send command to MQTT device
app.post('/api/mqtt/device/:deviceId/command', (req, res) => {
    const { deviceId } = req.params;
    const { command } = req.body;
    
    if (!command) {
        return res.status(400).json({ error: 'Command is required' });
    }
    
    const success = publishDeviceCommand(deviceId, command);
    
    if (success) {
        res.json({ 
            message: 'Command sent successfully via MQTT',
            deviceId,
            command
        });
    } else {
        res.status(500).json({ 
            error: 'Failed to send command via MQTT'
        });
    }
});

// Get all MQTT devices status
app.get('/api/mqtt/devices', (req, res) => {
    const devices = Array.from(mqttDevices.entries()).map(([deviceId, info]) => ({
        deviceId,
        protocol: 'mqtt',
        isOnline: info.isOnline,
        lastSeen: info.lastSeen,
        status: info.isOnline ? 'connected' : 'disconnected'
    }));
    
    res.json({ devices });
});

// ==================== END MQTT DEVICE API ENDPOINTS ====================

// Function to notify ESP32 devices when status changes
async function notifyDeviceStatusChange(deviceId, requestNumber, lineNumber, quantity, 品番, newStatus) {
    console.log(`📢 Notifying device ${deviceId} of status change: ${newStatus} (MQTT + Socket.IO)`);
    
    let command = null;
    
    if (newStatus === 'in-progress') {
        // ===== CRITICAL FIX: Check helper collection for ACTUAL remaining quantity =====
        // The passed 'quantity' might be the ORIGINAL request, not the REMAINING amount
        let actualQuantityToDisplay = quantity;
        
        try {
            const submittedDb = client.db("submittedDB");
            const helperCollection = submittedDb.collection('nodaRequestHelperDB');
            const helperRecord = await helperCollection.findOne({ requestNumber, lineNumber });
            
            if (helperRecord) {
                // Use remaining quantity from helper (source of truth for picking progress)
                let remainingFromHelper = helperRecord.remainingQuantity;
                
                // SAFEGUARD: Never use negative quantities
                if (remainingFromHelper < 0) {
                    console.warn(`⚠️ [HELPER CHECK] Negative remainingQuantity detected: ${remainingFromHelper}, using 0`);
                    remainingFromHelper = 0;
                }
                
                if (remainingFromHelper !== undefined && remainingFromHelper !== quantity) {
                    console.log(`🔄 [HELPER CHECK] Original quantity: ${quantity}, Helper remaining: ${remainingFromHelper}`);
                    actualQuantityToDisplay = remainingFromHelper;
                }
                
                // If picking is complete, don't send green - should be red
                if (helperRecord.pickingComplete) {
                    console.log(`⚠️ [HELPER CHECK] Line item already complete - sending RED instead of GREEN`);
                    command = {
                        color: 'red',
                        quantity: 0,
                        message: 'Completed',
                        requestNumber: '',
                        lineNumber: 0,
                        品番: ''
                    };
                    // Skip the green command creation below
                    newStatus = 'completed';
                }
            }
        } catch (helperError) {
            console.error(`⚠️ Error checking helper collection:`, helperError);
            // Fall back to original quantity if helper check fails
        }
        
        // Only create green command if not already completed
        if (newStatus === 'in-progress') {
            // Calculate box quantity for display using ACTUAL remaining quantity
            const boxQuantity = await calculateBoxQuantity(品番, actualQuantityToDisplay);
            console.log(`📦 Using actual remaining: ${actualQuantityToDisplay} pieces = ${boxQuantity} boxes`);
            
            command = {
                color: 'green',
                quantity: boxQuantity,
                message: `Pick ${boxQuantity}`,
                requestNumber: requestNumber,
                lineNumber: lineNumber,
                品番: 品番
            };
        }
    } else if (newStatus === 'completed') {
        command = {
            color: 'red',
            quantity: 0,
            message: 'Completed',
            requestNumber: '',
            lineNumber: 0,
            品番: ''
        };
    }
    
    if (command) {
        // Send via MQTT (for new MQTT devices)
        const mqttSuccess = publishDeviceCommand(deviceId, command);
        
        // Send via Socket.IO (for existing devices)
        const deviceSocket = connectedDevices.get(deviceId);
        if (deviceSocket) {
            deviceSocket.emit('display-update', command);
            console.log(`✅ Sent display-update via Socket.IO to device ${deviceId}`);
        } else {
            console.log(`⚠️ Device ${deviceId} not connected via Socket.IO`);
        }
        
        if (mqttSuccess) {
            console.log(`✅ Sent command via MQTT to device ${deviceId}`);
        }
    }
}

// NODA Requests API Route
app.post("/api/noda-requests", async (req, res) => {
  const { action, filters = {}, page = 1, limit = 10, sort = {}, requestId, data } = req.body;

  try {
    await client.connect();
    const db = client.db("submittedDB");
    const requestsCollection = db.collection("nodaRequestDB");
    const inventoryCollection = db.collection("nodaInventoryDB");

    switch (action) {
      case 'updateLineItemStatus':
        try {
          console.log(`🌐🌐🌐 /api/noda-requests: updateLineItemStatus called`);
          console.log(`   Request ID: ${requestId}`);
          console.log(`   Line Number: ${data?.lineNumber}`);
          console.log(`   New Status: ${data?.status}`);
          
          if (!requestId || !data || !data.lineNumber || !data.status) {
            return res.status(400).json({ error: "Request ID, line number, and status are required" });
          }

          // Find the bulk request
          const bulkRequest = await requestsCollection.findOne({ _id: new ObjectId(requestId) });
          if (!bulkRequest) {
            return res.status(404).json({ error: "Bulk request not found" });
          }
          
          console.log(`   Request Number: ${bulkRequest.requestNumber}`);
          console.log(`   Request Type: ${bulkRequest.requestType}`);

          if (bulkRequest.requestType !== 'bulk') {
            return res.status(400).json({ error: "This operation is only for bulk requests" });
          }

          // Get the specific line item before updating
          const lineItem = bulkRequest.lineItems.find(item => item.lineNumber === data.lineNumber);
          if (!lineItem) {
            return res.status(404).json({ error: "Line item not found" });
          }

          const oldStatus = lineItem.status;
          const newStatus = data.status;
          
          // ⚠️ CRITICAL: Prevent completing line items with remaining inventory
          if (newStatus === 'completed' && lineItem.completedAt) {
            console.log(`⚠️⚠️⚠️ BLOCKED: Line item ${data.lineNumber} already processed by IoT at ${lineItem.completedAt}`);
            console.log(`   Current status: ${oldStatus}`);
            console.log(`   Remaining inventory: ${lineItem.shortfallQuantity || 0} units`);
            
            if (lineItem.shortfallQuantity > 0) {
              console.log(`❌ REJECTING: Cannot complete - ${lineItem.shortfallQuantity} units still missing!`);
              return res.status(400).json({ 
                error: "Cannot complete line item with insufficient inventory",
                shortfall: lineItem.shortfallQuantity,
                message: `${lineItem.shortfallQuantity} units still needed before completion`
              });
            }
          }

          // Update the specific line item status
          const result = await requestsCollection.updateOne(
            { 
              _id: new ObjectId(requestId),
              "lineItems.lineNumber": data.lineNumber
            },
            { 
              $set: { 
                "lineItems.$.status": newStatus,
                "lineItems.$.updatedAt": new Date(),
                updatedAt: new Date()
              }
            }
          );

          if (result.matchedCount === 0) {
            return res.status(404).json({ error: "Line item not found" });
          }

          // Check if all line items are completed to update bulk request status
          const updatedRequest = await requestsCollection.findOne({ _id: new ObjectId(requestId) });
          const allCompleted = updatedRequest.lineItems.every(item => item.status === 'completed');
          const anyInProgress = updatedRequest.lineItems.some(item => item.status === 'in-progress');
          const anyWithShortfall = updatedRequest.lineItems.some(item => item.shortfallQuantity > 0);

          console.log(`📊 Bulk status check:`);
          console.log(`   All completed: ${allCompleted}`);
          console.log(`   Any in-progress: ${anyInProgress}`);
          console.log(`   Any with shortfall: ${anyWithShortfall}`);

          let newBulkStatus = updatedRequest.status;
          if (allCompleted && !anyWithShortfall) {
            newBulkStatus = 'completed';
            console.log(`✅ All items completed with no shortfalls - marking bulk as completed`);
          } else if (anyInProgress || anyWithShortfall) {
            newBulkStatus = 'in-progress';
            console.log(`⚠️ Keeping bulk status as in-progress (inProgress=${anyInProgress}, shortfall=${anyWithShortfall})`);
          }

          // Update bulk request status if needed
          if (newBulkStatus !== updatedRequest.status) {
            await requestsCollection.updateOne(
              { _id: new ObjectId(requestId) },
              { 
                $set: { 
                  status: newBulkStatus,
                  updatedAt: new Date()
                }
              }
            );
          }

          // 🚨 NEW: Notify ESP32 device of status change
          if (oldStatus !== newStatus) {
            await notifyDeviceStatusChange(
              lineItem.背番号, 
              bulkRequest.requestNumber, 
              lineItem.lineNumber, 
              lineItem.quantity, 
              lineItem.品番, 
              newStatus
            );
          }

          res.json({
            success: true,
            message: "Line item status updated successfully",
            bulkStatus: newBulkStatus
          });

        } catch (error) {
          console.error("Error in updateLineItemStatus:", error);
          res.status(500).json({ error: "Failed to update line item status", details: error.message });
        }
        break;

      case 'changeRequestStatus':
        try {
          console.log(`\n🌐🌐🌐 /api/noda-requests: changeRequestStatus called 🌐🌐🌐`);
          console.log(`   ⚠️⚠️⚠️ THIS MAY BE THE DUPLICATE INSERTION SOURCE!`);
          console.log(`   Request ID: ${requestId}`);
          console.log(`   New Status: ${data?.status}`);
          console.log(`   User: ${data?.userName}`);
          console.log(`   FULL CALL STACK:`);
          console.log(new Error().stack);
          console.log(`   🔍 Checking if this is causing duplicate inventory transaction...`);
          
          if (!requestId || !data || !data.status) {
            return res.status(400).json({ error: "Request ID and status are required" });
          }

          const request = await requestsCollection.findOne({ _id: new ObjectId(requestId) });
          if (!request) {
            return res.status(404).json({ error: "Request not found" });
          }
          
          console.log(`   Request Number: ${request.requestNumber}`);
          console.log(`   Request Type: ${request.requestType}`);

          const userName = data.userName || 'Unknown User';
          const oldStatus = request.status;
          const newStatus = data.status;
          
          console.log(`\n📊 [REQUEST DETAILS]`);
          console.log(`   Status transition: ${oldStatus} → ${newStatus}`);
          console.log(`   Request type: ${request.requestType}`);
          console.log(`   Has lineItems: ${!!request.lineItems}`);
          console.log(`   LineItems count: ${request.lineItems?.length || 0}`);
          console.log(`   Is bulk request: ${request.requestType === 'bulk'}`);
          console.log(`   Has lineItems array: ${Array.isArray(request.lineItems)}`);

          // Handle inventory changes based on status transition
          if (oldStatus !== newStatus) {
            console.log(`\n🔀 [STATUS CHANGE HANDLER] Status transition detected: ${oldStatus} → ${newStatus}`);
            
            // For bulk requests, handle line items individually
            if (request.requestType === 'bulk' && request.lineItems && Array.isArray(request.lineItems)) {
              console.log(`\n✅✅✅ [BULK REQUEST PATH] Entering bulk request handler ✅✅✅`);
              console.log(`   ⛔ SKIPPING inventory transaction creation`);
              console.log(`   📌 Reason: IoT devices already created inventory transactions via MQTT completions`);
              console.log(`   🎯 This endpoint only updates status fields, NOT inventory`);
              console.log(`   📋 Line items: ${request.lineItems.length} items`);
              
              // Update all line items to the new status
              await requestsCollection.updateOne(
                { _id: new ObjectId(requestId) },
                { 
                  $set: { 
                    status: newStatus,
                    updatedAt: new Date(),
                    updatedBy: userName,
                    "lineItems.$[].status": newStatus,
                    "lineItems.$[].updatedAt": new Date()
                  }
                }
              );
              
              console.log(`✅ Status updated to ${newStatus} WITHOUT creating duplicate inventory transactions`);

              // 🚨 NEW: Notify all ESP32 devices in this bulk request
              for (const lineItem of request.lineItems) {
                await notifyDeviceStatusChange(
                  lineItem.背番号, 
                  request.requestNumber, 
                  lineItem.lineNumber, 
                  lineItem.quantity, 
                  lineItem.品番, 
                  newStatus
                );
              }
            } else {
              console.log(`\n🚨🚨🚨 [SINGLE REQUEST PATH] Entering single request handler 🚨🚨🚨`);
              console.log(`   ⚠️ WARNING: This may create duplicate inventory transactions!`);
              console.log(`   Request type: ${request.requestType || 'undefined'}`);
              console.log(`   Request number: ${request.requestNumber}`);
              console.log(`   Request quantity: ${request.quantity || 'N/A'}`);
              console.log(`   Has lineItems: ${!!request.lineItems}`);
              console.log(`   LineItems is Array: ${Array.isArray(request.lineItems)}`);
              console.log(`\n   🔍 Investigating why this is treated as single request...`);
              if (request.requestType === 'bulk') {
                console.log(`   ❌ ERROR: Request type is 'bulk' but entered single request path!`);
                console.log(`   ❌ This is a BUG - should have gone to bulk path`);
                console.log(`   ❌ ABORTING to prevent duplicate inventory transaction`);
                return res.status(400).json({ 
                  error: 'Invalid request type handling',
                  message: 'Bulk request incorrectly routed to single request handler'
                });
              }
              
              // Single request - existing inventory logic
              const inventoryItem = await inventoryCollection.findOne({ 
                背番号: request.背番号 
              }, { 
                sort: { timeStamp: -1 } 
              });

              if (inventoryItem) {
                const currentPhysical = inventoryItem.physicalQuantity || inventoryItem.runningQuantity || 0;
                const currentReserved = inventoryItem.reservedQuantity || 0;
                const currentAvailable = inventoryItem.availableQuantity || inventoryItem.runningQuantity || 0;

                let newPhysical = currentPhysical;
                let newReserved = currentReserved;
                let newAvailable = currentAvailable;
                let action = '';
                let note = '';

                // Handle different status transitions
                if (newStatus === 'complete' && (oldStatus === 'pending' || oldStatus === 'active')) {
                  console.log(`\n🚨🚨🚨 [API ROUTE] SINGLE REQUEST COMPLETION TRIGGERED 🚨🚨🚨`);
                  console.log(`   ⚠️ WARNING: This should NOT be called for IoT-driven completions!`);
                  console.log(`   Request: ${request.requestNumber}`);
                  console.log(`   Old Status: ${oldStatus} → New Status: ${newStatus}`);
                  console.log(`   Quantity: ${request.quantity}`);
                  console.log(`   Current Physical: ${currentPhysical}`);
                  console.log(`   Called by: ${userName}`);
                  console.log(`   Call Stack:`);
                  console.log(new Error().stack);
                  console.log(`\n   ⛔ SKIPPING INVENTORY TRANSACTION - IoT devices handle this via MQTT`);
                  console.log(`   🔒 If this was an IoT completion, transaction already created by completeLineItem()`);
                  
                  // ⛔ DO NOT create inventory transaction here for IoT completions
                  // The MQTT handler already created the transaction via completeLineItem()
                  // This API route should only be for MANUAL admin overrides
                  console.log(`\n   ❌ BLOCKING duplicate inventory transaction creation`);
                  // Skip the inventory transaction creation for IoT-driven completions
                  action = `Status Change: ${oldStatus} → ${newStatus} (No Inventory Change - IoT Handled)`;
                  note = `Request ${request.requestNumber} completed via IoT device - inventory already adjusted`;
                  
                  // Keep quantities unchanged since IoT already handled it
                  newPhysical = currentPhysical;
                  newReserved = currentReserved;
                  newAvailable = currentAvailable;

                } else if (newStatus === 'failed' && (oldStatus === 'pending' || oldStatus === 'active')) {
                  // Failed pickup: restore available, reduce reserved
                  newReserved = Math.max(0, currentReserved - request.quantity);
                  newAvailable = currentAvailable + request.quantity;
                  action = `Picking Failed (Restored +${request.quantity})`;
                  note = `Failed to pick ${request.quantity} units, restored to available inventory`;

                } else if (newStatus === 'active' && oldStatus === 'pending') {
                  action = `Status Change: ${oldStatus} → ${newStatus}`;
                  note = `Request ${request.requestNumber} status changed to active`;

                } else {
                  action = `Status Change: ${oldStatus} → ${newStatus}`;
                  note = `Request ${request.requestNumber} status updated`;
                }

                // Create inventory transaction if there was a quantity change
                if (newPhysical !== currentPhysical || newReserved !== currentReserved || newAvailable !== currentAvailable) {
                  console.log(`\n🚨🚨🚨🚨🚨 [DUPLICATE SOURCE FOUND!] 🚨🚨🚨🚨🚨`);
                  console.log(`   THIS IS THE SECOND INSERTION - FROM /api/noda-requests changeRequestStatus!`);
                  console.log(`   Request: ${request.requestNumber}`);
                  console.log(`   背番号: ${request.背番号}`);
                  console.log(`   品番: ${request.品番}`);
                  console.log(`   Status: ${oldStatus} → ${newStatus}`);
                  console.log(`   User: ${userName}`);
                  console.log(`   newPhysical: ${newPhysical}`);
                  console.log(`   newReserved: ${newReserved}`);
                  console.log(`   newAvailable: ${newAvailable}`);
                  console.log(`   action: ${action}`);
                  console.log(`   FULL CALL STACK:`);
                  console.log(new Error().stack);
                  console.log(`   ⛔ BLOCKING THIS INSERTION - IT CREATES DUPLICATES!`);
                  console.log(`\n`);
                  
                  // ⛔⛔⛔ DISABLE THIS INSERTION - IT CREATES DUPLICATES! ⛔⛔⛔
                  // const statusTransaction = {
                  //   背番号: request.背番号,
                  //   品番: request.品番,
                  //   timeStamp: new Date(),
                  //   Date: new Date().toISOString().split('T')[0],
                  //   
                  //   // Two-stage inventory fields
                  //   physicalQuantity: newPhysical,
                  //   reservedQuantity: newReserved,
                  //   availableQuantity: newAvailable,
                  //   
                  //   // Legacy field for compatibility
                  //   runningQuantity: newAvailable,
                  //   lastQuantity: currentAvailable,
                  //   
                  //   action: action,
                  //   source: `Freya Admin - ${userName}`,
                  //   requestId: requestId,
                  //   note: note
                  //   };

                  // await inventoryCollection.insertOne(statusTransaction);
                }
              }

              // 🚨 NEW: Notify ESP32 device for single request
              await notifyDeviceStatusChange(
                request.背番号, 
                request.requestNumber, 
                1, // Single request line number
                request.quantity, 
                request.品番, 
                newStatus
              );
            }
          }

          // Update request status
          const updateData = {
            status: newStatus,
            updatedAt: new Date(),
            updatedBy: userName
          };

          if (newStatus === 'complete') {
            updateData.completedAt = new Date();
          }

          const result = await requestsCollection.updateOne(
            { _id: new ObjectId(requestId) },
            { $set: updateData }
          );

          if (result.matchedCount === 0) {
            return res.status(404).json({ error: "Request not found" });
          }

          res.json({ 
            success: true,
            message: `Request status changed from ${oldStatus} to ${newStatus}`
          });

        } catch (error) {
          console.error("Error in changeRequestStatus:", error);
          res.status(500).json({ error: "Failed to change request status", details: error.message });
        }
        break;

      // ... (include other NODA API cases as needed - I'm showing just the key ones for status changes)

      default:
        res.status(400).json({ error: "Invalid action" });
    }

  } catch (error) {
    console.error("Error in NODA requests API:", error);
    res.status(500).json({ error: "Internal server error", details: error.message });
  }
});

// ==================== END OF NODA API ROUTES ====================

// Simplified admin endpoint to change line item status with ESP32 notification
app.put('/api/admin/request/:requestId/line/:lineNumber/status', async (req, res) => {
    try {
        const { requestId, lineNumber } = req.params;
        const { status, userName = 'Admin' } = req.body;
        
        if (!['pending', 'in-progress', 'completed', 'cancelled'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }
        
        await client.connect();
        const db = client.db("submittedDB");
        const requestsCollection = db.collection("nodaRequestDB");
        
        // Find the request
        const request = await requestsCollection.findOne({ _id: new ObjectId(requestId) });
        if (!request) {
            return res.status(404).json({ error: "Request not found" });
        }
        
        // Find the specific line item
        const lineItem = request.lineItems.find(item => item.lineNumber === parseInt(lineNumber));
        if (!lineItem) {
            return res.status(404).json({ error: "Line item not found" });
        }
        
        const oldStatus = lineItem.status;
        
        // Update the line item status
        const updateResult = await requestsCollection.updateOne(
            { 
                _id: new ObjectId(requestId),
                "lineItems.lineNumber": parseInt(lineNumber)
            },
            { 
                $set: { 
                    "lineItems.$.status": status,
                    "lineItems.$.updatedAt": new Date(),
                    updatedAt: new Date(),
                    updatedBy: userName
                }
            }
        );
        
        if (updateResult.matchedCount === 0) {
            return res.status(404).json({ error: "Failed to update line item" });
        }
        
        // Notify ESP32 device of status change
        if (oldStatus !== status) {
            await notifyDeviceStatusChange(
                lineItem.背番号, 
                request.requestNumber, 
                lineItem.lineNumber, 
                lineItem.quantity, 
                lineItem.品番, 
                status
            );
        }
        
        res.json({ 
            success: true,
            message: `Line item ${lineNumber} status changed from ${oldStatus} to ${status}`,
            deviceNotified: lineItem.背番号
        });
        
    } catch (error) {
        console.error('Error updating line item status:', error);
        res.status(500).json({ error: 'Failed to update line item status' });
    }
});

// Simplified admin endpoint to change request status with ESP32 notification
app.put('/api/admin/request/:requestId/status', async (req, res) => {
    try {
        const { requestId } = req.params;
        const { status, userName = 'Admin' } = req.body;
        
        if (!['pending', 'in-progress', 'completed', 'cancelled'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }
        
        await client.connect();
        const db = client.db("submittedDB");
        const requestsCollection = db.collection("nodaRequestDB");
        
        // Find the request
        const request = await requestsCollection.findOne({ _id: new ObjectId(requestId) });
        if (!request) {
            return res.status(404).json({ error: "Request not found" });
        }
        
        const oldStatus = request.status;
        
        // Update the request status
        const updateData = {
            status: status,
            updatedAt: new Date(),
            updatedBy: userName
        };
        
        if (status === 'completed') {
            updateData.completedAt = new Date();
        }
        
        const updateResult = await requestsCollection.updateOne(
            { _id: new ObjectId(requestId) },
            { $set: updateData }
        );
        
        if (updateResult.matchedCount === 0) {
            return res.status(404).json({ error: "Failed to update request" });
        }
        
        // Notify ESP32 devices
        const notifiedDevices = [];
        if (oldStatus !== status) {
            if (request.requestType === 'bulk' && request.lineItems) {
                // Update all line items to match request status
                await requestsCollection.updateOne(
                    { _id: new ObjectId(requestId) },
                    { 
                        $set: { 
                            "lineItems.$[].status": status,
                            "lineItems.$[].updatedAt": new Date()
                        }
                    }
                );
                
                // Notify all devices in this bulk request
                for (const lineItem of request.lineItems) {
                    await notifyDeviceStatusChange(
                        lineItem.背番号, 
                        request.requestNumber, 
                        lineItem.lineNumber, 
                        lineItem.quantity, 
                        lineItem.品番, 
                        status
                    );
                    notifiedDevices.push(lineItem.背番号);
                }
            } else {
                // Single request
                await notifyDeviceStatusChange(
                    request.背番号, 
                    request.requestNumber, 
                    1, 
                    request.quantity, 
                    request.品番, 
                    status
                );
                notifiedDevices.push(request.背番号);
            }
        }
        
        res.json({ 
            success: true,
            message: `Request status changed from ${oldStatus} to ${status}`,
            devicesNotified: notifiedDevices
        });
        
    } catch (error) {
        console.error('Error updating request status:', error);
        res.status(500).json({ error: 'Failed to update request status' });
    }
});

// API endpoint to refresh ESP32 devices for a specific request
app.post('/api/refresh-devices/:requestNumber', async (req, res) => {
    try {
        const { requestNumber } = req.params;
        const { userName = 'Tablet' } = req.body;
        
        console.log(`🔄 Device refresh requested for ${requestNumber} by ${userName}`);
        
        await client.connect();
        const db = client.db("submittedDB");
        const requestsCollection = db.collection("nodaRequestDB");
        
        // Find the request by requestNumber
        const request = await requestsCollection.findOne({ requestNumber: requestNumber });
        if (!request) {
            return res.status(404).json({ error: "Request not found" });
        }
        
        const notifiedDevices = [];
        
        // Check if request is in-progress and notify devices
        if (request.status === 'in-progress') {
            if (request.requestType === 'bulk' && request.lineItems) {
                // Notify all devices in this bulk request
                for (const lineItem of request.lineItems) {
                    if (lineItem.status === 'in-progress') {
                        await notifyDeviceStatusChange(
                            lineItem.背番号, 
                            request.requestNumber, 
                            lineItem.lineNumber, 
                            lineItem.quantity, 
                            lineItem.品番, 
                            'in-progress'
                        );
                        notifiedDevices.push(lineItem.背番号);
                    }
                }
            } else {
                // Single request
                await notifyDeviceStatusChange(
                    request.背番号, 
                    request.requestNumber, 
                    1, 
                    request.quantity, 
                    request.品番, 
                    'in-progress'
                );
                notifiedDevices.push(request.背番号);
            }
        }
        
        res.json({ 
            success: true,
            message: `Refreshed ${notifiedDevices.length} devices for request ${requestNumber}`,
            devicesNotified: notifiedDevices,
            requestStatus: request.status
        });
        
    } catch (error) {
        console.error('Error refreshing devices:', error);
        res.status(500).json({ error: 'Failed to refresh devices' });
    }
});

// ==================== INVENTORY COUNT API ENDPOINTS ====================

// Validate if a product exists in inventory
app.get('/api/inventory/validate/:productNumber', async (req, res) => {
    try {
        const { productNumber } = req.params;

        await client.connect();
        const submittedDb = client.db("submittedDB");
        const inventoryCollection = submittedDb.collection('nodaInventoryDB');

        // Check if product exists
        const product = await inventoryCollection.findOne({ 品番: productNumber });

        res.json({
            exists: product !== null,
            productNumber: productNumber
        });

    } catch (error) {
        console.error('Error validating product:', error);
        res.status(500).json({ error: 'Failed to validate product' });
    }
});

// Get current inventory data for a product
app.get('/api/inventory/current/:productNumber', async (req, res) => {
    try {
        const { productNumber } = req.params;

        await client.connect();
        const submittedDb = client.db("submittedDB");
        const inventoryCollection = submittedDb.collection('nodaInventoryDB');

        // Get the most recent inventory record for this product
        const inventoryResults = await inventoryCollection.aggregate([
            { $match: { 品番: productNumber } },
            {
                $addFields: {
                    timeStampDate: {
                        $cond: {
                            if: { $type: "$timeStamp" },
                            then: {
                                $cond: {
                                    if: { $eq: [{ $type: "$timeStamp" }, "string"] },
                                    then: { $dateFromString: { dateString: "$timeStamp" } },
                                    else: "$timeStamp"
                                }
                            },
                            else: new Date()
                        }
                    }
                }
            },
            { $sort: { timeStampDate: -1 } },
            { $limit: 1 }
        ]).toArray();

        if (inventoryResults.length === 0) {
            return res.status(404).json({ error: 'Product not found in inventory' });
        }

        const inventory = inventoryResults[0];

        res.json({
            品番: inventory.品番,
            背番号: inventory.背番号,
            physicalQuantity: inventory.physicalQuantity || inventory.runningQuantity || 0,
            reservedQuantity: inventory.reservedQuantity || 0,
            availableQuantity: inventory.availableQuantity || inventory.runningQuantity || 0,
            lastUpdated: inventory.timeStamp
        });

    } catch (error) {
        console.error('Error getting current inventory:', error);
        res.status(500).json({ error: 'Failed to get current inventory' });
    }
});

// Submit inventory count (棚卸し)
app.post('/api/inventory/count-submit', async (req, res) => {
    try {
        const { items, submittedBy, submittedAt } = req.body;

        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'Items array is required' });
        }

        if (!submittedBy) {
            return res.status(400).json({ error: 'submittedBy is required' });
        }

        await client.connect();
        const submittedDb = client.db("submittedDB");
        const inventoryCollection = submittedDb.collection('nodaInventoryDB');

        const processedItems = [];
        const errors = [];

        // Process each item
        for (const item of items) {
            try {
                const { 品番, 背番号, currentQuantity, newQuantity } = item;

                // Validate item data
                if (!品番 || newQuantity === undefined || newQuantity === null) {
                    errors.push({ 品番, error: 'Missing required fields' });
                    continue;
                }

                // Get the most recent inventory record for this product
                const inventoryResults = await inventoryCollection.aggregate([
                    { $match: { 品番: 品番 } },
                    {
                        $addFields: {
                            timeStampDate: {
                                $cond: {
                                    if: { $type: "$timeStamp" },
                                    then: {
                                        $cond: {
                                            if: { $eq: [{ $type: "$timeStamp" }, "string"] },
                                            then: { $dateFromString: { dateString: "$timeStamp" } },
                                            else: "$timeStamp"
                                        }
                                    },
                                    else: new Date()
                                }
                            }
                        }
                    },
                    { $sort: { timeStampDate: -1 } },
                    { $limit: 1 }
                ]).toArray();

                if (inventoryResults.length === 0) {
                    errors.push({ 品番, error: 'Product not found in inventory' });
                    continue;
                }

                const currentInventory = inventoryResults[0];
                const oldPhysicalQuantity = currentInventory.physicalQuantity || currentInventory.runningQuantity || 0;
                const oldReservedQuantity = currentInventory.reservedQuantity || 0;
                const oldAvailableQuantity = currentInventory.availableQuantity || currentInventory.runningQuantity || 0;

                // Calculate new quantities
                const newPhysicalQuantity = newQuantity;
                const newReservedQuantity = oldReservedQuantity; // Reserved stays the same
                const newAvailableQuantity = newPhysicalQuantity - newReservedQuantity; // Recalculate available

                const quantityDifference = newPhysicalQuantity - oldPhysicalQuantity;

                // Create transaction record
                const transactionRecord = {
                    背番号: currentInventory.背番号,
                    品番: 品番,
                    timeStamp: new Date(),
                    Date: new Date().toISOString().split('T')[0],

                    // Two-stage inventory fields
                    physicalQuantity: newPhysicalQuantity,
                    reservedQuantity: newReservedQuantity,
                    availableQuantity: newAvailableQuantity,

                    // Legacy field for compatibility
                    runningQuantity: newPhysicalQuantity,
                    lastQuantity: oldPhysicalQuantity,

                    action: '棚卸し adjustments',
                    source: `Freya Sims 棚卸し - ${submittedBy}`,
                    note: `Physical inventory count: ${oldPhysicalQuantity} → ${newPhysicalQuantity} (${quantityDifference >= 0 ? '+' : ''}${quantityDifference})`
                };

                // Insert the new record
                await inventoryCollection.insertOne(transactionRecord);

                processedItems.push({
                    品番: 品番,
                    背番号: currentInventory.背番号,
                    oldQuantity: oldPhysicalQuantity,
                    newQuantity: newPhysicalQuantity,
                    difference: quantityDifference
                });

                console.log(`✅ Inventory count processed for ${品番}: ${oldPhysicalQuantity} → ${newPhysicalQuantity}`);

            } catch (itemError) {
                console.error(`Error processing item ${item.品番}:`, itemError);
                errors.push({ 品番: item.品番, error: itemError.message });
            }
        }

        res.json({
            success: true,
            processedCount: processedItems.length,
            errorCount: errors.length,
            processedItems: processedItems,
            errors: errors.length > 0 ? errors : undefined,
            submittedBy: submittedBy,
            submittedAt: submittedAt || new Date().toISOString()
        });

    } catch (error) {
        console.error('Error submitting inventory count:', error);
        res.status(500).json({ error: 'Failed to submit inventory count', details: error.message });
    }
});

// ==================== END INVENTORY COUNT API ENDPOINTS ====================

// ==================== TANAOROSHI (棚卸し) API ENDPOINTS ====================

// Get product info for tanaoroshi by 品番
app.get('/api/tanaoroshi/:productNumber', async (req, res) => {
    try {
        const { productNumber } = req.params;
        console.log(`📦 Fetching tanaoroshi data for: ${productNumber}`);

        await client.connect();
        
        // Fetch master data
        const masterDb = client.db("Sasaki_Coating_MasterDB");
        const masterCollection = masterDb.collection("masterDB");
        const masterData = await masterCollection.findOne({ 品番: productNumber });

        if (!masterData) {
            return res.status(404).json({ error: 'Product not found in master database' });
        }

        // Fetch current inventory data
        const db = client.db("submittedDB");
        const inventoryCollection = db.collection("nodaInventoryDB");
        
        // Get the latest inventory record for this product
        const currentInventory = await inventoryCollection
            .find({ 品番: productNumber })
            .sort({ timeStamp: -1 })
            .limit(1)
            .toArray();

        // Check if product exists in inventory
        const isNewProduct = currentInventory.length === 0;
        const latestRecord = isNewProduct ? null : currentInventory[0];

        res.json({
            // Master data
            品番: masterData.品番,
            品名: masterData.品名,
            モデル: masterData.モデル,
            背番号: masterData.背番号,
            形状: masterData.形状,
            色: masterData.色,
            収容数: parseInt(masterData.収容数) || 1,
            imageURL: masterData.imageURL || '',
            
            // Current inventory data (0 if new product)
            isNewProduct: isNewProduct,
            currentPhysicalQuantity: isNewProduct ? 0 : (latestRecord.physicalQuantity || 0),
            currentReservedQuantity: isNewProduct ? 0 : (latestRecord.reservedQuantity || 0),
            currentAvailableQuantity: isNewProduct ? 0 : (latestRecord.availableQuantity || 0),
            currentRunningQuantity: isNewProduct ? 0 : (latestRecord.runningQuantity || 0)
        });

    } catch (error) {
        console.error('Error fetching tanaoroshi data:', error);
        res.status(500).json({ error: 'Failed to fetch tanaoroshi data', details: error.message });
    }
});

// Submit tanaoroshi (棚卸し) count results
app.post('/api/tanaoroshi/submit', async (req, res) => {
    try {
        const { countedProducts, submittedBy } = req.body;
        const factory = req.body.factory || '野田倉庫'; // Default to 野田倉庫 if not specified
        
        if (!countedProducts || !Array.isArray(countedProducts) || countedProducts.length === 0) {
            return res.status(400).json({ error: 'No counted products provided' });
        }

        if (!submittedBy) {
            return res.status(400).json({ error: 'Submitted by information required' });
        }

        console.log(`📦 Processing tanaoroshi submission from ${submittedBy} for ${countedProducts.length} products`);
        console.log(`🏭 Factory location: ${factory}`);

        await client.connect();
        const db = client.db("submittedDB");
        const inventoryCollection = db.collection("nodaInventoryDB");

        const processedItems = [];
        const errors = [];
        const submissionTimestamp = new Date();

        for (const product of countedProducts) {
            try {
                const { 品番, 背番号, newPhysicalQuantity, oldPhysicalQuantity, oldReservedQuantity, isNewProduct } = product;

                if (!品番 || !背番号 || newPhysicalQuantity === undefined) {
                    errors.push({ 品番, error: 'Missing required fields' });
                    continue;
                }

                // Handle new products (not in inventory before)
                if (isNewProduct) {
                    const transactionRecord = {
                        背番号: 背番号,
                        品番: 品番,
                        timeStamp: submissionTimestamp,
                        Date: submissionTimestamp.toISOString().split('T')[0],
                        
                        physicalQuantity: newPhysicalQuantity,
                        reservedQuantity: 0,
                        availableQuantity: newPhysicalQuantity,
                        runningQuantity: newPhysicalQuantity,
                        lastQuantity: 0,
                        
                        action: `棚卸し (+${newPhysicalQuantity})`,
                        source: `tablet 棚卸し - ${submittedBy}`,
                        note: `added ${newPhysicalQuantity} because missing from inventory`,
                        工場: factory
                    };

                    await inventoryCollection.insertOne(transactionRecord);

                    processedItems.push({
                        品番: 品番,
                        背番号: 背番号,
                        oldQuantity: 0,
                        newQuantity: newPhysicalQuantity,
                        difference: newPhysicalQuantity,
                        isNew: true
                    });

                    console.log(`✅ New product added to inventory: ${品番} with ${newPhysicalQuantity} pieces`);
                    continue;
                }

                // Handle existing products
                // Calculate the difference
                const difference = newPhysicalQuantity - oldPhysicalQuantity;
                
                // Calculate new available quantity (reservedQuantity stays the same)
                const newAvailableQuantity = newPhysicalQuantity - oldReservedQuantity;
                
                console.log(`🔍 [TANAOROSHI] Getting latest record for 品番: ${品番}`);
                
                // Get the previous running quantity to calculate new running quantity
                // Use aggregation to properly handle timeStamp conversion and sorting
                const previousRecord = await inventoryCollection.aggregate([
                    { $match: { 品番: 品番 } },
                    {
                        $addFields: {
                            timeStampDate: {
                                $cond: {
                                    if: { $eq: [{ $type: "$timeStamp" }, "string"] },
                                    then: { $dateFromString: { dateString: "$timeStamp" } },
                                    else: { $toDate: "$timeStamp" }
                                }
                            }
                        }
                    },
                    { $sort: { timeStampDate: -1 } },
                    { $limit: 1 }
                ]).toArray();
                
                console.log(`📊 [TANAOROSHI] Latest record:`, previousRecord[0] ? {
                    timeStamp: previousRecord[0].timeStamp,
                    physicalQuantity: previousRecord[0].physicalQuantity,
                    lastQuantity: previousRecord[0].lastQuantity,
                    action: previousRecord[0].action
                } : 'NO RECORD FOUND');
                
                const previousRunningQuantity = previousRecord.length > 0 ? previousRecord[0].runningQuantity : 0;
                const previousPhysicalQuantity = previousRecord.length > 0 ? previousRecord[0].physicalQuantity : 0;
                const newRunningQuantity = previousRunningQuantity + difference;
                
                console.log(`📊 [TANAOROSHI] Previous: ${previousPhysicalQuantity}, New: ${newPhysicalQuantity}, Diff: ${difference}`);

                // Determine action and note
                let action, note;
                if (difference > 0) {
                    action = `棚卸し (+${difference})`;
                    note = `added ${difference} pieces because lacking`;
                } else if (difference < 0) {
                    action = `棚卸し (${difference})`;
                    note = `deducted ${Math.abs(difference)} pieces because excess`;
                } else {
                    action = '棚卸し (±0)';
                    note = 'count matches inventory';
                }

                // Create transaction record
                const transactionRecord = {
                    背番号: 背番号,
                    品番: 品番,
                    timeStamp: submissionTimestamp,
                    Date: submissionTimestamp.toISOString().split('T')[0],
                    
                    physicalQuantity: newPhysicalQuantity,
                    reservedQuantity: oldReservedQuantity, // Keep the same
                    availableQuantity: newAvailableQuantity,
                    runningQuantity: newRunningQuantity,
                    lastQuantity: previousPhysicalQuantity, // Use previous physical quantity, not new
                    
                    action: action,
                    source: `tablet 棚卸し - ${submittedBy}`,
                    note: note,
                    工場: factory
                };

                // Insert the new record
                await inventoryCollection.insertOne(transactionRecord);

                processedItems.push({
                    品番: 品番,
                    背番号: 背番号,
                    oldQuantity: oldPhysicalQuantity,
                    newQuantity: newPhysicalQuantity,
                    difference: difference
                });

                console.log(`✅ Tanaoroshi processed for ${品番}: ${oldPhysicalQuantity} → ${newPhysicalQuantity} (${difference >= 0 ? '+' : ''}${difference})`);

            } catch (itemError) {
                console.error(`Error processing item ${product.品番}:`, itemError);
                errors.push({ 品番: product.品番, error: itemError.message });
            }
        }

        res.json({
            success: true,
            processedCount: processedItems.length,
            errorCount: errors.length,
            processedItems: processedItems,
            errors: errors.length > 0 ? errors : undefined,
            submittedBy: submittedBy,
            submittedAt: submissionTimestamp.toISOString()
        });

    } catch (error) {
        console.error('Error submitting tanaoroshi:', error);
        res.status(500).json({ error: 'Failed to submit tanaoroshi', details: error.message });
    }
});

// ==================== END TANAOROSHI API ENDPOINTS ====================

// ==================== NYUKO (入庫) API ENDPOINTS ====================

// Get product info for nyuko by 品番
app.get('/api/nyuko/:productNumber', async (req, res) => {
    try {
        const { productNumber } = req.params;
        console.log(`📦 Fetching nyuko data for: ${productNumber}`);

        await client.connect();
        
        // Fetch master data
        const masterDb = client.db("Sasaki_Coating_MasterDB");
        const masterCollection = masterDb.collection("masterDB");
        const masterData = await masterCollection.findOne({ 品番: productNumber });

        if (!masterData) {
            return res.status(404).json({ error: 'Product not found in master database' });
        }

        // Fetch current inventory data (if exists)
        const db = client.db("submittedDB");
        const inventoryCollection = db.collection("nodaInventoryDB");
        
        console.log(`🔍 [NYUKO API] Getting latest inventory record for 品番: ${productNumber}`);
        
        // Get the latest inventory record for this product
        // Use aggregation to properly handle timeStamp conversion and sorting
        const currentInventory = await inventoryCollection.aggregate([
            { $match: { 品番: productNumber } },
            {
                $addFields: {
                    timeStampDate: {
                        $cond: {
                            if: { $eq: [{ $type: "$timeStamp" }, "string"] },
                            then: { $dateFromString: { dateString: "$timeStamp" } },
                            else: { $toDate: "$timeStamp" }
                        }
                    }
                }
            },
            { $sort: { timeStampDate: -1 } },
            { $limit: 1 }
        ]).toArray();

        // Check if product exists in inventory
        const inventoryExists = currentInventory.length > 0;
        const latestRecord = inventoryExists ? currentInventory[0] : null;
        
        console.log(`📊 [NYUKO API] Latest inventory:`, latestRecord ? {
            timeStamp: latestRecord.timeStamp,
            physicalQuantity: latestRecord.physicalQuantity,
            action: latestRecord.action
        } : 'NO INVENTORY RECORD');

        const responseData = {
            // Master data
            品番: masterData.品番,
            品名: masterData.品名,
            モデル: masterData.モデル,
            背番号: masterData.背番号,
            形状: masterData.形状,
            色: masterData.色,
            収容数: parseInt(masterData.収容数) || 1,
            imageURL: masterData.imageURL || '',
            
            // Current inventory data (if exists)
            inventoryExists: inventoryExists,
            currentPhysicalQuantity: inventoryExists ? (latestRecord.physicalQuantity || 0) : 0,
            currentReservedQuantity: inventoryExists ? (latestRecord.reservedQuantity || 0) : 0,
            currentAvailableQuantity: inventoryExists ? (latestRecord.availableQuantity || 0) : 0,
            currentRunningQuantity: inventoryExists ? (latestRecord.runningQuantity || 0) : 0
        };
        
        console.log(`📤 [NYUKO API] Sending response for ${productNumber}:`, {
            currentPhysicalQuantity: responseData.currentPhysicalQuantity,
            currentReservedQuantity: responseData.currentReservedQuantity,
            inventoryExists: responseData.inventoryExists
        });

        res.json(responseData);

    } catch (error) {
        console.error('Error fetching nyuko data:', error);
        res.status(500).json({ error: 'Failed to fetch nyuko data', details: error.message });
    }
});

// Submit nyuko (入庫) input results
app.post('/api/nyuko/submit', async (req, res) => {
    try {
        const { inputProducts, submittedBy } = req.body;
        const factory = req.body.factory || '野田倉庫'; // Default to 野田倉庫 if not specified
        
        if (!inputProducts || !Array.isArray(inputProducts) || inputProducts.length === 0) {
            return res.status(400).json({ error: 'No input products provided' });
        }

        if (!submittedBy) {
            return res.status(400).json({ error: 'Submitted by information required' });
        }

        console.log(`📦 Processing nyuko submission from ${submittedBy} for ${inputProducts.length} products`);
        console.log(`🏭 Factory location: ${factory}`);

        await client.connect();
        const db = client.db("submittedDB");
        const inventoryCollection = db.collection("nodaInventoryDB");

        const processedItems = [];
        const errors = [];
        const submissionTimestamp = new Date();

        for (const product of inputProducts) {
            try {
                const { 品番, 背番号, inputQuantity, inventoryExists, oldPhysicalQuantity, oldReservedQuantity } = product;

                if (!品番 || !背番号 || inputQuantity === undefined) {
                    errors.push({ 品番, error: 'Missing required fields' });
                    continue;
                }

                let transactionRecord;

                if (!inventoryExists) {
                    // NEW PRODUCT: Create initial inventory record
                    transactionRecord = {
                        背番号: 背番号,
                        品番: 品番,
                        timeStamp: submissionTimestamp,
                        Date: submissionTimestamp.toISOString().split('T')[0],
                        
                        physicalQuantity: inputQuantity,
                        reservedQuantity: 0,
                        availableQuantity: inputQuantity,
                        runningQuantity: inputQuantity,
                        lastQuantity: 0,
                        
                        action: `Warehouse Input (+${inputQuantity})`,
                        source: `tablet 入庫 - ${submittedBy}`,
                        工場: factory
                    };

                    processedItems.push({
                        品番: 品番,
                        背番号: 背番号,
                        oldQuantity: 0,
                        newQuantity: inputQuantity,
                        inputQuantity: inputQuantity,
                        isNew: true
                    });

                } else {
                    // EXISTING PRODUCT: Add to current inventory
                    const newPhysicalQuantity = oldPhysicalQuantity + inputQuantity;
                    const newAvailableQuantity = newPhysicalQuantity - oldReservedQuantity;
                    
                    console.log(`🔍 [NYUKO] Getting latest record for 品番: ${品番}`);
                    
                    // Get previous running quantity
                    // Use aggregation to properly handle timeStamp conversion and sorting
                    const previousRecord = await inventoryCollection.aggregate([
                        { $match: { 品番: 品番 } },
                        {
                            $addFields: {
                                timeStampDate: {
                                    $cond: {
                                        if: { $eq: [{ $type: "$timeStamp" }, "string"] },
                                        then: { $dateFromString: { dateString: "$timeStamp" } },
                                        else: { $toDate: "$timeStamp" }
                                    }
                                }
                            }
                        },
                        { $sort: { timeStampDate: -1 } },
                        { $limit: 1 }
                    ]).toArray();
                    
                    console.log(`📊 [NYUKO] Latest record:`, previousRecord[0] ? {
                        timeStamp: previousRecord[0].timeStamp,
                        physicalQuantity: previousRecord[0].physicalQuantity,
                        lastQuantity: previousRecord[0].lastQuantity,
                        action: previousRecord[0].action
                    } : 'NO RECORD FOUND');
                    
                    const previousRunningQuantity = previousRecord.length > 0 ? previousRecord[0].runningQuantity : 0;
                    const previousPhysicalQuantity = previousRecord.length > 0 ? previousRecord[0].physicalQuantity : 0;
                    const newRunningQuantity = previousRunningQuantity + inputQuantity;
                    
                    console.log(`📊 [NYUKO] Previous: ${previousPhysicalQuantity}, Adding: ${inputQuantity}, New: ${newPhysicalQuantity}`);

                    transactionRecord = {
                        背番号: 背番号,
                        品番: 品番,
                        timeStamp: submissionTimestamp,
                        Date: submissionTimestamp.toISOString().split('T')[0],
                        
                        physicalQuantity: newPhysicalQuantity,
                        reservedQuantity: oldReservedQuantity,
                        availableQuantity: newAvailableQuantity,
                        runningQuantity: newRunningQuantity,
                        lastQuantity: previousPhysicalQuantity, // Use previous physical quantity, not new
                        
                        action: `Warehouse Input (+${inputQuantity})`,
                        source: `tablet 入庫 - ${submittedBy}`,
                        工場: factory
                    };

                    processedItems.push({
                        品番: 品番,
                        背番号: 背番号,
                        oldQuantity: oldPhysicalQuantity,
                        newQuantity: newPhysicalQuantity,
                        inputQuantity: inputQuantity,
                        isNew: false
                    });
                }

                // Insert the new record
                await inventoryCollection.insertOne(transactionRecord);

                console.log(`✅ Nyuko processed for ${品番}: ${inventoryExists ? `${oldPhysicalQuantity} → ${oldPhysicalQuantity + inputQuantity}` : `NEW → ${inputQuantity}`} (+${inputQuantity})`);

            } catch (itemError) {
                console.error(`Error processing item ${product.品番}:`, itemError);
                errors.push({ 品番: product.品番, error: itemError.message });
            }
        }

        res.json({
            success: true,
            processedCount: processedItems.length,
            errorCount: errors.length,
            processedItems: processedItems,
            errors: errors.length > 0 ? errors : undefined,
            submittedBy: submittedBy,
            submittedAt: submissionTimestamp.toISOString()
        });

    } catch (error) {
        console.error('Error submitting nyuko:', error);
        res.status(500).json({ error: 'Failed to submit nyuko', details: error.message });
    }
});

// ==================== END NYUKO API ENDPOINTS ====================

// ==================== MASTER DATA API ENDPOINT ====================

// Get master data by 品番
app.get('/api/master-data/:productNumber', async (req, res) => {
    try {
        const { productNumber } = req.params;

        await client.connect();
        const masterDb = client.db("Sasaki_Coating_MasterDB");
        const masterCollection = masterDb.collection("masterDB");

        // Find the master data by 品番
        const masterData = await masterCollection.findOne({ 品番: productNumber });

        if (!masterData) {
            return res.status(404).json({ error: 'Master data not found' });
        }

        res.json({
            品番: masterData.品番,
            モデル: masterData.モデル,
            背番号: masterData.背番号,
            品名: masterData.品名,
            形状: masterData.形状,
            色: masterData.色,
            収容数: masterData.収容数,
            工場: masterData.工場,
            材料: masterData.材料,
            材料背番号: masterData.材料背番号,
            imageURL: masterData.imageURL
        });

    } catch (error) {
        console.error('Error fetching master data:', error);
        res.status(500).json({ error: 'Failed to fetch master data', details: error.message });
    }
});

// ==================== END MASTER DATA API ENDPOINT ====================

// ==================== GENTAN (原単) IMAGE PROCESSING ENDPOINTS ====================

// Store for pending image processing jobs
const gentanProcessingJobs = new Map(); // jobId -> { socketId, status, result }

// Endpoint: Tablet uploads image for processing
app.post('/api/gentan/process-image', express.json({ limit: '50mb' }), express.raw({ limit: '50mb', type: 'image/*' }), async (req, res) => {
    try {
        const jobId = `gentan-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const socketId = req.body.socketId || req.headers['x-socket-id'];
        
        console.log(`📸 Received image processing request. Job ID: ${jobId}, Socket: ${socketId}`);
        
        // Store job with pending status
        gentanProcessingJobs.set(jobId, {
            socketId: socketId,
            status: 'processing',
            result: null,
            createdAt: new Date()
        });
        
        // Immediately return job ID to tablet
        res.json({ 
            success: true, 
            jobId: jobId,
            message: '画像を処理中です...'
        });
        
        // Forward image to n8n webhook asynchronously (after response sent)
        setImmediate(async () => {
            try {
                const FormData = require('form-data');
                const fetch = require('node-fetch');
                const https = require('https');
                
                // Create HTTPS agent that bypasses SSL verification (for local development)
                const httpsAgent = new https.Agent({
                    rejectUnauthorized: false
                });
                
                const form = new FormData();
                
                // Get image from request
                let imageBuffer;
                if (req.body.image) {
                    // Base64 encoded image
                    imageBuffer = Buffer.from(req.body.image, 'base64');
                } else if (Buffer.isBuffer(req.body)) {
                    // Raw image buffer
                    imageBuffer = req.body;
                } else {
                    throw new Error('No image data found in request');
                }
                
                form.append('image', imageBuffer, { filename: 'gentan-image.jpg' });
                form.append('jobId', jobId);
                
                console.log(`🔄 Forwarding image to n8n webhook...`);
                
                const n8nResponse = await fetch('https://karlsome.app.n8n.cloud/webhook/7081d838-c11e-42f5-8c17-94c5ee557cf6', {
                    method: 'POST',
                    body: form,
                    headers: form.getHeaders(),
                    agent: httpsAgent
                });
                
                if (!n8nResponse.ok) {
                    throw new Error(`n8n returned ${n8nResponse.status}`);
                }
                
                const n8nResult = await n8nResponse.json();
                console.log(`✅ n8n processing complete for job ${jobId}`);
                // Update will come through /api/gentan/n8n-callback endpoint
                
            } catch (error) {
                console.error(`❌ Error forwarding to n8n for job ${jobId}:`, error);
                gentanProcessingJobs.set(jobId, {
                    ...gentanProcessingJobs.get(jobId),
                    status: 'error',
                    error: error.message
                });
                
                // Notify tablet of error via Socket.IO
                if (socketId) {
                    const targetSocket = Array.from(connectedTablets).find(s => s.id === socketId);
                    if (targetSocket) {
                        targetSocket.emit('gentan-processing-error', {
                            jobId: jobId,
                            error: error.message
                        });
                    }
                }
            }
        });
        
    } catch (error) {
        console.error('Error in gentan/process-image:', error);
        res.status(500).json({ error: 'Failed to process image', details: error.message });
    }
});

// Endpoint: n8n sends back the processed result
app.post('/api/gentan/n8n-callback', async (req, res) => {
    try {
        const { jobId, 品番, 品名, 納入数, 納入日, 色番 } = req.body;
        
        console.log(`📥 Received n8n callback for job ${jobId}:`, req.body);
        
        if (!jobId) {
            return res.status(400).json({ error: 'Job ID is required' });
        }
        
        const job = gentanProcessingJobs.get(jobId);
        if (!job) {
            console.warn(`⚠️ Job ${jobId} not found in processing jobs`);
            return res.status(404).json({ error: 'Job not found' });
        }
        
        // Update job with result
        const result = { 品番, 品名, 納入数, 納入日, 色番 };
        gentanProcessingJobs.set(jobId, {
            ...job,
            status: 'completed',
            result: result
        });
        
        console.log(`✅ Job ${jobId} completed. Notifying tablet via Socket.IO...`);
        
        // Send result to tablet via Socket.IO
        const targetSocket = Array.from(connectedTablets).find(s => s.id === job.socketId);
        if (targetSocket) {
            targetSocket.emit('gentan-processing-complete', {
                jobId: jobId,
                data: result
            });
            console.log(`✅ Sent result to tablet socket ${job.socketId}`);
        } else {
            console.warn(`⚠️ Tablet socket ${job.socketId} not found`);
        }
        
        // Clean up old jobs (older than 10 minutes)
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
        for (const [id, jobData] of gentanProcessingJobs.entries()) {
            if (jobData.createdAt < tenMinutesAgo) {
                gentanProcessingJobs.delete(id);
            }
        }
        
        res.json({ success: true, message: 'Result received and forwarded to tablet' });
        
    } catch (error) {
        console.error('Error in gentan/n8n-callback:', error);
        res.status(500).json({ error: 'Failed to process callback', details: error.message });
    }
});

// Endpoint: Submit gentan data to MongoDB (with Firebase Storage for images)
app.post('/api/gentan/submit', async (req, res) => {
    try {
        const { documents, factory } = req.body;
        
        if (!documents || !Array.isArray(documents) || documents.length === 0) {
            return res.status(400).json({ error: 'Documents array is required' });
        }
        
        const gentanDB = client.db('submittedDB');
        const collection = gentanDB.collection('nodaRawMaterialDB');
        
        console.log(`📝 Processing ${documents.length} gentan documents...`);
        
        // Process each document - upload images to Firebase if sourceType is 'image'
        const processedDocuments = await Promise.all(documents.map(async (doc, index) => {
            const processedDoc = { ...doc };
            
            // Add factory to the document
            if (factory) {
                processedDoc['工場'] = factory;
            }
            
            // If it's an image type and has imageSource (base64), upload to Firebase
            if (doc.sourceType === 'image' && doc.imageSource && firebaseBucket) {
                try {
                    console.log(`📤 Uploading image ${index + 1} to Firebase Storage...`);
                    
                    // Extract base64 data (remove data:image/xxx;base64, prefix if present)
                    let base64Data = doc.imageSource;
                    let mimeType = 'image/jpeg';
                    
                    if (base64Data.includes(',')) {
                        const matches = base64Data.match(/^data:(.+);base64,(.+)$/);
                        if (matches) {
                            mimeType = matches[1];
                            base64Data = matches[2];
                        } else {
                            base64Data = base64Data.split(',')[1];
                        }
                    }
                    
                    const buffer = Buffer.from(base64Data, 'base64');
                    
                    // Generate filename: 品番_納入日_timestamp.jpg
                    const hinban = doc['品番'] || 'unknown';
                    const nounyubi = doc['納入日'] || new Date().toISOString().split('T')[0];
                    const timestamp = Date.now();
                    const extension = mimeType.includes('png') ? 'png' : 'jpg';
                    const filename = `${hinban}_${nounyubi}_${timestamp}.${extension}`;
                    
                    // Sanitize factory name for file path
                    const factoryFolder = factory ? factory.replace(/[\/\\]/g, '_') : 'unknown';
                    const filePath = `rawMaterialImages/${factoryFolder}/${filename}`;
                    
                    const file = firebaseBucket.file(filePath);
                    
                    // Save file with only contentType (no custom metadata to avoid preview issues)
                    await file.save(buffer, {
                        contentType: mimeType
                    });
                    
                    // Set the download token metadata to use our fixed token
                    await file.setMetadata({
                        metadata: {
                            firebaseStorageDownloadTokens: 'masterDBToken69'
                        }
                    });
                    
                    // Generate the public URL with the fixed token
                    const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
                    const encodedPath = encodeURIComponent(filePath);
                    const imageURL = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedPath}?alt=media&token=masterDBToken69`;
                    
                    processedDoc.imageURL = imageURL;
                    console.log(`✅ Image uploaded: ${imageURL}`);
                    
                } catch (uploadError) {
                    console.error(`❌ Failed to upload image ${index + 1}:`, uploadError.message);
                    // Continue without imageURL if upload fails
                }
            }
            
            // Remove the base64 imageSource from the document (we don't want to store it in MongoDB)
            delete processedDoc.imageSource;
            
            return processedDoc;
        }));
        
        console.log(`📝 Inserting ${processedDocuments.length} gentan documents to MongoDB...`);
        
        const result = await collection.insertMany(processedDocuments);
        
        console.log(`✅ Successfully inserted ${result.insertedCount} documents`);
        
        res.json({ 
            success: true, 
            insertedCount: result.insertedCount,
            insertedIds: result.insertedIds
        });
        
    } catch (error) {
        console.error('Error submitting gentan data:', error);
        res.status(500).json({ error: 'Failed to submit data', details: error.message });
    }
});

// ==================== OCR LEARNING ENDPOINTS ====================

// Levenshtein distance for fuzzy matching
function levenshteinDistance(str1, str2) {
    const m = str1.length;
    const n = str2.length;
    
    // Create a matrix
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
    
    // Initialize first row and column
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    
    // Fill the matrix
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (str1[i - 1] === str2[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1];
            } else {
                dp[i][j] = 1 + Math.min(
                    dp[i - 1][j],     // deletion
                    dp[i][j - 1],     // insertion
                    dp[i - 1][j - 1]  // substitution
                );
            }
        }
    }
    
    return dp[m][n];
}

// Calculate similarity percentage (0-100)
function calculateSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    if (str1 === str2) return 100;
    
    const maxLen = Math.max(str1.length, str2.length);
    if (maxLen === 0) return 100;
    
    const distance = levenshteinDistance(str1.toLowerCase(), str2.toLowerCase());
    return Math.round((1 - distance / maxLen) * 100);
}

// Get suggestions for OCR values (with fuzzy matching)
app.post('/api/ocr-learning/suggest', async (req, res) => {
    try {
        const { ocrValues } = req.body;
        
        if (!ocrValues || typeof ocrValues !== 'object') {
            return res.status(400).json({ error: 'ocrValues object is required' });
        }
        
        const learningDB = client.db('submittedDB');
        const collection = learningDB.collection('ocrLearningDB');
        
        const suggestions = {};
        const SIMILARITY_THRESHOLD = 75; // Minimum 75% similarity to suggest
        
        // Find suggestions for each field
        for (const [field, ocrValue] of Object.entries(ocrValues)) {
            if (ocrValue && ocrValue.trim()) {
                // First, try exact match
                const exactMatch = await collection.findOne({
                    field: field,
                    ocrValue: ocrValue
                });
                
                if (exactMatch && exactMatch.correctedValue !== ocrValue) {
                    suggestions[field] = {
                        original: ocrValue,
                        suggested: exactMatch.correctedValue,
                        useCount: exactMatch.useCount || 1,
                        matchType: 'exact',
                        similarity: 100
                    };
                } else {
                    // No exact match - try fuzzy matching
                    const allLearned = await collection.find({ field: field }).toArray();
                    
                    let bestMatch = null;
                    let bestSimilarity = 0;
                    
                    for (const learned of allLearned) {
                        const similarity = calculateSimilarity(ocrValue, learned.ocrValue);
                        
                        if (similarity >= SIMILARITY_THRESHOLD && similarity > bestSimilarity) {
                            bestSimilarity = similarity;
                            bestMatch = learned;
                        }
                    }
                    
                    if (bestMatch && bestMatch.correctedValue !== ocrValue) {
                        suggestions[field] = {
                            original: ocrValue,
                            suggested: bestMatch.correctedValue,
                            useCount: bestMatch.useCount || 1,
                            matchType: 'fuzzy',
                            similarity: bestSimilarity,
                            matchedOcr: bestMatch.ocrValue // What OCR text it matched with
                        };
                        console.log(`🔍 Fuzzy match for ${field}: "${ocrValue}" ~ "${bestMatch.ocrValue}" (${bestSimilarity}%) → "${bestMatch.correctedValue}"`);
                    }
                }
            }
        }
        
        res.json({ suggestions });
        
    } catch (error) {
        console.error('Error getting OCR suggestions:', error);
        res.status(500).json({ error: 'Failed to get suggestions', details: error.message });
    }
});

// Learn from user correction
app.post('/api/ocr-learning/learn', async (req, res) => {
    try {
        const { corrections, learnedBy } = req.body;
        
        if (!corrections || !Array.isArray(corrections)) {
            return res.status(400).json({ error: 'corrections array is required' });
        }
        
        const learningDB = client.db('submittedDB');
        const collection = learningDB.collection('ocrLearningDB');
        
        let learnedCount = 0;
        
        for (const correction of corrections) {
            const { field, ocrValue, correctedValue } = correction;
            
            // Only learn if there was an actual correction (values are different)
            if (field && ocrValue && correctedValue && ocrValue !== correctedValue) {
                // Upsert: update if exists, insert if not
                await collection.updateOne(
                    { field: field, ocrValue: ocrValue },
                    {
                        $set: {
                            correctedValue: correctedValue,
                            lastLearnedAt: new Date().toISOString(),
                            lastLearnedBy: learnedBy || 'Unknown'
                        },
                        $inc: { useCount: 1 },
                        $setOnInsert: {
                            createdAt: new Date().toISOString()
                        }
                    },
                    { upsert: true }
                );
                learnedCount++;
                console.log(`🧠 Learned: ${field} "${ocrValue}" → "${correctedValue}"`);
            }
        }
        
        res.json({ 
            success: true, 
            learnedCount,
            message: learnedCount > 0 ? `Learned ${learnedCount} correction(s)` : 'No new corrections to learn'
        });
        
    } catch (error) {
        console.error('Error learning OCR correction:', error);
        res.status(500).json({ error: 'Failed to learn correction', details: error.message });
    }
});

// Get learning statistics (optional - for debugging/admin)
app.get('/api/ocr-learning/stats', async (req, res) => {
    try {
        const learningDB = client.db('submittedDB');
        const collection = learningDB.collection('ocrLearningDB');
        
        const totalLearnings = await collection.countDocuments();
        const byField = await collection.aggregate([
            { $group: { _id: '$field', count: { $sum: 1 }, totalUses: { $sum: '$useCount' } } }
        ]).toArray();
        
        const recentLearnings = await collection.find()
            .sort({ lastLearnedAt: -1 })
            .limit(10)
            .toArray();
        
        res.json({
            totalLearnings,
            byField,
            recentLearnings
        });
        
    } catch (error) {
        console.error('Error getting OCR learning stats:', error);
        res.status(500).json({ error: 'Failed to get stats', details: error.message });
    }
});

// ==================== END OCR LEARNING ENDPOINTS ====================

// ==================== END GENTAN ENDPOINTS ====================

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Serve the main application
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server
async function startServer() {
    try {
        await connectToMongoDB();
        
        // Initialize MQTT connection
        if (MQTT_ENABLED) {
            console.log('🔗 Initializing MQTT connection...');
            initializeMQTT();
        } else {
            console.log('ℹ️ MQTT is disabled. Set MQTT_ENABLED=true to enable MQTT support.');
        }
        
        httpServer.listen(PORT, () => {
            console.log(`Noda System server running on port ${PORT}`);
            console.log(`Access the application at: http://localhost:${PORT}`);
            console.log('Socket.IO server ready for IoT devices and tablets');
            if (MQTT_ENABLED) {
                console.log(`MQTT broker: ${MQTT_BROKER_URL}`);
                console.log('Hybrid system: Supporting both Socket.IO and MQTT devices');
            }
            
            // 🚨 NEW: Start periodic ESP32 notification check
            startPeriodicESP32Check();
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

// Periodic check to ensure ESP32 devices are notified of status changes
function startPeriodicESP32Check() {
    console.log('🔄 Starting periodic ESP32 notification check (every 10 seconds)');
    
    setInterval(async () => {
        try {
            // Check global picking lock which will trigger ESP32 notifications if needed
            await checkGlobalPickingLock();
            
            // Also check for any recently changed requests (last 30 seconds)
            await checkRecentStatusChanges();
            
        } catch (error) {
            console.error('Error in periodic ESP32 check:', error);
        }
    }, 10000); // Check every 10 seconds
}

// Check for recently changed requests that might need ESP32 notification
async function checkRecentStatusChanges() {
    try {
        await client.connect();
        const db = client.db("submittedDB");
        const requestsCollection = db.collection("nodaRequestDB");
        
        // Look for requests updated in the last 30 seconds that are in-progress
        const thirtySecondsAgo = new Date(Date.now() - 30000);
        
        const recentlyChangedRequests = await requestsCollection.find({
            status: 'in-progress',
            updatedAt: { $gte: thirtySecondsAgo }
        }).toArray();
        
        for (const request of recentlyChangedRequests) {
            // Check if any line items are in-progress and notify devices
            if (request.requestType === 'bulk' && request.lineItems) {
                const inProgressItems = request.lineItems.filter(item => 
                    item.status === 'in-progress' && 
                    item.updatedAt >= thirtySecondsAgo
                );
                
                for (const lineItem of inProgressItems) {
                    const deviceSocket = connectedDevices.get(lineItem.背番号);
                    if (deviceSocket) {
                        console.log(`🔄 Periodic check: Refreshing device ${lineItem.背番号} for recently changed request ${request.requestNumber}`);
                        await notifyDeviceStatusChange(
                            lineItem.背番号, 
                            request.requestNumber, 
                            lineItem.lineNumber, 
                            lineItem.quantity, 
                            lineItem.品番, 
                            'in-progress'
                        );
                    }
                }
            }
        }
        
    } catch (error) {
        console.error('Error checking recent status changes:', error);
    }
}

// API endpoint to fetch unique factories from multiple collections
app.post('/api/factories/batch', async (req, res) => {
    try {
        // Hardcoded collections - always fetch from kensaDB and pressDB
        const collections = ['kensaDB', 'pressDB'];

        console.log(`📋 Fetching unique factory values from collections: ${collections.join(', ')}`);

        const db = client.db('submittedDB');
        const results = {};

        // Process each collection
        for (const collectionName of collections) {
            try {
                const targetCollection = db.collection(collectionName);

                const uniqueFactories = await targetCollection.aggregate([
                    {
                        $match: {
                            '工場': { $exists: true, $ne: null, $ne: '' }
                        }
                    },
                    {
                        $group: {
                            _id: '$工場'
                        }
                    },
                    {
                        $sort: { '_id': 1 }
                    },
                    {
                        $project: {
                            _id: 0,
                            factory: '$_id'
                        }
                    }
                ]).toArray();

                results[collectionName] = {
                    factories: uniqueFactories.map(item => item.factory),
                    count: uniqueFactories.length
                };

                console.log(`✅ Found ${uniqueFactories.length} unique factories in ${collectionName}`);

            } catch (collectionError) {
                console.error(`❌ Error processing ${collectionName}:`, collectionError);
                results[collectionName] = {
                    error: collectionError.message,
                    factories: [],
                    count: 0
                };
            }
        }

        res.json({
            success: true,
            results: results,
            totalCollections: collections.length
        });

    } catch (error) {
        console.error('❌ Error in batch factory fetch:', error);
        res.status(500).json({ 
            error: 'Failed to fetch factory lists',
            message: error.message
        });
    }
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down server...');
    await client.close();
    process.exit(0);
});

startServer();
