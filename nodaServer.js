const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const cors = require('cors');
const path = require('path');
const { createServer } = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

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

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    // Device registration
    socket.on('device-register', (data) => {
        const { deviceId, type } = data;
        if (type === 'iot-device') {
            connectedDevices.set(deviceId, socket);
            socket.deviceId = deviceId;
            console.log(`IoT Device registered: ${deviceId}`);
            
            // Send initial state (red screen)
            socket.emit('display-update', {
                color: 'red',
                quantity: null,
                message: 'Standby'
            });
        } else if (type === 'tablet') {
            connectedTablets.add(socket);
            socket.isTablet = true;
            console.log('Tablet connected');
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
        
        // Broadcast to all IoT devices
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
    
    // Check if all line items are completed
    const request = await collection.findOne({ requestNumber });
    const allCompleted = request.lineItems.every(item => item.status === 'completed');
    
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
        console.log(`Request ${requestNumber} fully completed!`);
    }
    
    return { allCompleted, request };
}

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
        httpServer.listen(PORT, () => {
            console.log(`Noda System server running on port ${PORT}`);
            console.log(`Access the application at: http://localhost:${PORT}`);
            console.log('Socket.IO server ready for IoT devices and tablets');
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down server...');
    await client.close();
    process.exit(0);
});

startServer();
