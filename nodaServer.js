const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const cors = require('cors');
const path = require('path');
const { createServer } = require('http');
const { Server } = require('socket.io');
const mqtt = require('mqtt');
require('dotenv').config();

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
app.use(express.json());
app.use(express.static('.'));

// MongoDB connection
let db;
const client = new MongoClient(process.env.MONGODB_URI);

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

// Global picking lock state
let globalPickingLock = {
    isLocked: false,
    activeRequestNumber: null,
    startedBy: null,
    startedAt: null
};

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
                // Notify all devices in this bulk request that are in-progress
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

async function connectToMongoDB() {
    try {
        await client.connect();
        db = client.db(process.env.DATABASE_NAME);
        console.log('Connected to MongoDB successfully');
    } catch (error) {
        console.error('Failed to connect to MongoDB:', error);
        process.exit(1);
    }
}

// ==================== MQTT INTEGRATION ====================

// Initialize MQTT Client
function initializeMQTT() {
    console.log('🔌 Initializing MQTT client...');
    
    // Don't send credentials if they're empty (for test brokers)
    const mqttOptions = {
        clientId: `NodaServer_${Math.random().toString(16).substr(2, 8)}`,
        keepalive: 60,
        reconnectPeriod: 5000,
        clean: true
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
    });
    
    mqttClient.on('close', () => {
        console.log('⚠️ MQTT connection closed');
    });
    
    mqttClient.on('reconnect', () => {
        console.log('🔄 MQTT reconnecting...');
    });
}

// Handle incoming MQTT messages
async function handleMQTTMessage(topic, message) {
    try {
        const data = JSON.parse(message.toString());
        const topicParts = topic.split('/');
        const deviceId = topicParts[2];
        const messageType = topicParts[3];
        
        console.log(`📨 MQTT message from ${deviceId} (${messageType}):`, data);
        
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
    console.log(`📊 Device ${deviceId} status update:`, data);
    
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

// Handle device task completion via MQTT
async function handleDeviceCompletion(deviceId, data) {
    console.log(`✅ Device ${deviceId} completed task:`, data);
    
    const { requestNumber, lineNumber, completedBy } = data;
    
    try {
        // Use existing completion logic
        await completeLineItem(requestNumber, lineNumber, completedBy);
        
        // Send confirmation back to device (red screen)
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
                completedBy
            });
        });
        
    } catch (error) {
        console.error('❌ Error processing device completion:', error);
        
        // Send error back to device
        publishDeviceCommand(deviceId, {
            color: 'red',
            quantity: null,
            message: 'Error - Try Again'
        });
    }
}

// Handle device heartbeat
function handleDeviceHeartbeat(deviceId, data) {
    console.log(`💓 Heartbeat from device ${deviceId} - RSSI: ${data.rssi || 'N/A'}`);
    // Just update the tracking - heartbeat is for connection monitoring
}

// Publish command to specific device
function publishDeviceCommand(deviceId, command) {
    if (!mqttClient || !mqttClient.connected) {
        console.error('❌ MQTT client not connected, cannot send command');
        return false;
    }
    
    const topic = `noda/device/${deviceId}/command`;
    const message = JSON.stringify(command);
    
    mqttClient.publish(topic, message, { qos: 1, retain: true }, (err) => {
        if (err) {
            console.error(`❌ Failed to publish to ${deviceId}:`, err);
        } else {
            console.log(`📤 Published command to ${deviceId}:`, command);
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
                // Device has active picking - restore green screen
                console.log(`🟢 Restoring active picking for device ${deviceId}: ${activePicking.requestNumber} - ${activePicking.品番} (${activePicking.quantity})`);
                const displayUpdate = {
                    color: 'green',
                    quantity: activePicking.quantity,
                    message: `Pick ${activePicking.quantity}`,
                    requestNumber: activePicking.requestNumber,
                    lineNumber: activePicking.lineNumber,
                    品番: activePicking.品番
                };
                console.log(`📤 Sending display update:`, displayUpdate);
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

    // Device completion notification
    socket.on('item-completed', async (data) => {
        const { deviceId, requestNumber, lineNumber, completedBy } = data;
        console.log(`Item completed by device ${deviceId}: ${requestNumber} line ${lineNumber}`);
        
        try {
            await completeLineItem(requestNumber, lineNumber, completedBy);
            
            // Send red screen back to device
            socket.emit('display-update', {
                color: 'red',
                quantity: null,
                message: 'Completed'
            });
            
            // Notify all tablets of the completion
            connectedTablets.forEach(tabletSocket => {
                tabletSocket.emit('item-completed', {
                    requestNumber,
                    lineNumber,
                    deviceId,
                    completedBy
                });
            });
            
        } catch (error) {
            console.error('Error completing item:', error);
            socket.emit('error', { message: 'Failed to complete item' });
        }
    });

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
        const { startedBy } = req.body;
        
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
        
        // Update request status to in-progress
        await collection.updateOne(
            { requestNumber },
            { 
                $set: { 
                    status: 'in-progress',
                    startedBy,
                    startedAt: new Date(),
                    updatedAt: new Date()
                }
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
        
        // Send picking data to all connected devices
        const pickingData = {
            requestNumber,
            lineItems: request.lineItems.map(item => ({
                背番号: item.背番号,
                品番: item.品番,
                quantity: item.quantity,
                lineNumber: item.lineNumber,
                status: item.status
            }))
        };
        
        // Broadcast to all IoT devices (MQTT + Socket.IO)
        console.log(`🚀 Broadcasting to both MQTT and Socket.IO devices`);
        
        // Send to MQTT devices (new hybrid approach)
        request.lineItems.forEach(item => {
            const deviceId = item.背番号;
            
            if (item.status === 'pending') {
                publishDeviceCommand(deviceId, {
                    color: 'green',
                    quantity: item.quantity,
                    message: `Pick ${item.quantity}`,
                    requestNumber,
                    lineNumber: item.lineNumber,
                    品番: item.品番
                });
            } else {
                publishDeviceCommand(deviceId, {
                    color: 'red',
                    quantity: null,
                    message: 'No Pick'
                });
            }
        });

        // Send to Socket.IO devices (existing functionality)
        connectedDevices.forEach((deviceSocket, deviceId) => {
            const deviceItem = request.lineItems.find(item => item.背番号 === deviceId);
            
            if (deviceItem && deviceItem.status === 'pending') {
                // Device has items to pick - show green with quantity
                deviceSocket.emit('display-update', {
                    color: 'green',
                    quantity: deviceItem.quantity,
                    message: `Pick ${deviceItem.quantity}`,
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
        });
        
        console.log(`Picking started for ${requestNumber} by ${startedBy}`);
        res.json({ message: 'Picking process started', pickingData });
        
    } catch (error) {
        console.error('Error starting picking process:', error);
        res.status(500).json({ error: 'Failed to start picking process' });
    }
});

// Complete a line item
async function completeLineItem(requestNumber, lineNumber, completedBy) {
    const collection = db.collection(process.env.COLLECTION_NAME);
    const now = new Date();
    
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
    
    // Update the specific line item
    const updateResult = await collection.updateOne(
        { 
            requestNumber,
            'lineItems.lineNumber': lineNumber
        },
        {
            $set: {
                'lineItems.$.status': 'completed',
                'lineItems.$.completedAt': now,
                'lineItems.$.completedBy': completedBy,
                'lineItems.$.updatedAt': now,
                'updatedAt': now
            }
        }
    );
    
    if (updateResult.matchedCount === 0) {
        throw new Error('Line item not found');
    }
    
    // Create inventory transaction record to match admin backend structure
    await createInventoryTransaction({
        背番号: lineItem.背番号,
        品番: lineItem.品番,
        pickedQuantity: lineItem.quantity,
        action: 'Picking',
        source: `IoT Device ${lineItem.背番号} - ${completedBy}`,
        requestNumber: requestNumber,
        lineNumber: lineNumber,
        completedBy: completedBy
    });
    
    // Check if all line items are completed
    const updatedRequest = await collection.findOne({ requestNumber });
    const allCompleted = updatedRequest.lineItems.every(item => item.status === 'completed');
    
    if (allCompleted) {
        // Update overall request status to completed
        await collection.updateOne(
            { requestNumber },
            {
                $set: {
                    status: 'completed',
                    completedAt: now,
                    updatedAt: now
                }
            }
        );
        
        // Release global lock when request is completed
        if (globalPickingLock.isLocked && globalPickingLock.activeRequestNumber === requestNumber) {
            globalPickingLock = {
                isLocked: false,
                activeRequestNumber: null,
                startedBy: null,
                startedAt: null
            };
            
            // Broadcast lock release to all tablets
            broadcastLockStatus();
        }
        
        console.log(`Request ${requestNumber} fully completed! Lock released.`);
    }
    
    return { allCompleted, request: updatedRequest };
}

// Create inventory transaction to match admin backend structure
async function createInventoryTransaction(transactionData) {
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
        
        if (inventoryResults.length > 0) {
            const inventoryItem = inventoryResults[0];
            currentPhysical = inventoryItem.physicalQuantity || inventoryItem.runningQuantity || 0;
            currentReserved = inventoryItem.reservedQuantity || 0;
            currentAvailable = inventoryItem.availableQuantity || inventoryItem.runningQuantity || 0;
        }
        
        // Calculate new quantities after picking
        const pickedQuantity = transactionData.pickedQuantity;
        const newPhysicalQuantity = currentPhysical - pickedQuantity;  // Reduce physical stock
        const newReservedQuantity = currentReserved - pickedQuantity;  // Reduce reserved stock
        const newAvailableQuantity = newPhysicalQuantity - newReservedQuantity; // Recalculate available
        
        // Create new transaction record (exact same structure as admin backend)
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
            
            action: `Picking (-${pickedQuantity})`,
            source: transactionData.source,
            
            // Optional picking-specific fields
            requestId: transactionData.requestNumber,
            lineNumber: transactionData.lineNumber,
            note: `Picked ${pickedQuantity} units for request ${transactionData.requestNumber} line ${transactionData.lineNumber} by ${transactionData.completedBy}`
        };
        
        // Insert the new record
        const result = await inventoryCollection.insertOne(transactionRecord);
        
        console.log(`📦 Inventory transaction created for ${transactionData.背番号}:`);
        console.log(`   Picked: ${pickedQuantity} units`);
        console.log(`   Physical: ${currentPhysical} → ${newPhysicalQuantity}`);
        console.log(`   Reserved: ${currentReserved} → ${newReservedQuantity}`);
        console.log(`   Available: ${currentAvailable} → ${newAvailableQuantity}`);
        
        return result;
        
    } catch (error) {
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
                io.emit('display-update', {
                    deviceId: deviceId,
                    color: 'green',
                    quantity: item.quantity,
                    message: `Pick ${item.quantity}`,
                    requestNumber: requestNumber,
                    lineNumber: parseInt(lineNumber),
                    品番: item.品番
                });
                
                console.log(`Picking started for ${requestNumber} line ${lineNumber} on device ${deviceId} by ${startedBy}`);
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
            const response = {
                status: 'picking',
                color: 'green',
                quantity: activePicking.quantity,
                message: `Pick ${activePicking.quantity}`,
                requestNumber: activePicking.requestNumber,
                lineNumber: activePicking.lineNumber,
                品番: activePicking.品番
            };
            console.log(`🌐 REST API: Sending response:`, response);
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
        
        await completeLineItem(requestNumber, parseInt(lineNumber), completedBy);
        res.json({ message: 'Line item status updated successfully' });
        
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
        command = {
            color: 'green',
            quantity: quantity,
            message: `Pick ${quantity}`,
            requestNumber: requestNumber,
            lineNumber: lineNumber,
            品番: 品番
        };
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
          if (!requestId || !data || !data.lineNumber || !data.status) {
            return res.status(400).json({ error: "Request ID, line number, and status are required" });
          }

          // Find the bulk request
          const bulkRequest = await requestsCollection.findOne({ _id: new ObjectId(requestId) });
          if (!bulkRequest) {
            return res.status(404).json({ error: "Bulk request not found" });
          }

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

          let newBulkStatus = updatedRequest.status;
          if (allCompleted) {
            newBulkStatus = 'completed';
          } else if (anyInProgress) {
            newBulkStatus = 'in-progress';
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
          if (!requestId || !data || !data.status) {
            return res.status(400).json({ error: "Request ID and status are required" });
          }

          const request = await requestsCollection.findOne({ _id: new ObjectId(requestId) });
          if (!request) {
            return res.status(404).json({ error: "Request not found" });
          }

          const userName = data.userName || 'Unknown User';
          const oldStatus = request.status;
          const newStatus = data.status;

          // Handle inventory changes based on status transition
          if (oldStatus !== newStatus) {
            // For bulk requests, handle line items individually
            if (request.requestType === 'bulk' && request.lineItems) {
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
                  // Completing pickup: reduce physical and reserved quantities
                  newPhysical = currentPhysical - request.quantity;
                  newReserved = Math.max(0, currentReserved - request.quantity);
                  action = `Picking Completed (-${request.quantity})`;
                  note = `Physically picked ${request.quantity} units for request ${request.requestNumber}`;

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
                  const statusTransaction = {
                    背番号: request.背番号,
                    品番: request.品番,
                    timeStamp: new Date(),
                    Date: new Date().toISOString().split('T')[0],
                    
                    // Two-stage inventory fields
                    physicalQuantity: newPhysical,
                    reservedQuantity: newReserved,
                    availableQuantity: newAvailable,
                    
                    // Legacy field for compatibility
                    runningQuantity: newAvailable,
                    lastQuantity: currentAvailable,
                    
                    action: action,
                    source: `Freya Admin - ${userName}`,
                    requestId: requestId,
                    note: note
                  };

                  await inventoryCollection.insertOne(statusTransaction);
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

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down server...');
    await client.close();
    process.exit(0);
});

startServer();
