const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// MongoDB connection
let db;
const client = new MongoClient(process.env.MONGODB_URI);

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
        const requests = await collection.find({ requestNumber }).toArray();
        
        if (requests.length === 0) {
            return res.status(404).json({ error: 'No picking requests found for this request number' });
        }
        
        res.json(requests);
    } catch (error) {
        console.error('Error fetching grouped picking requests:', error);
        res.status(500).json({ error: 'Failed to fetch grouped picking requests' });
    }
});

// Update picking request status
app.put('/api/picking-requests/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        
        if (!['pending', 'in-progress', 'completed', 'cancelled'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }
        
        const collection = db.collection(process.env.COLLECTION_NAME);
        const result = await collection.updateOne(
            { _id: new require('mongodb').ObjectId(id) },
            { 
                $set: { 
                    status,
                    updatedAt: new Date()
                }
            }
        );
        
        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Picking request not found' });
        }
        
        res.json({ message: 'Status updated successfully' });
    } catch (error) {
        console.error('Error updating picking request status:', error);
        res.status(500).json({ error: 'Failed to update status' });
    }
});

// Get unique request numbers (for the picking request list)
app.get('/api/request-numbers', async (req, res) => {
    try {
        const collection = db.collection(process.env.COLLECTION_NAME);
        const requestNumbers = await collection.distinct('requestNumber');
        
        // Get additional info for each request number
        const requestsWithInfo = await Promise.all(
            requestNumbers.map(async (requestNumber) => {
                const requests = await collection.find({ requestNumber }).toArray();
                const totalQuantity = requests.reduce((sum, req) => sum + req.quantity, 0);
                const status = requests[0].status; // Assuming all items in a request have same status
                const createdAt = requests[0].createdAt;
                const itemCount = requests.length;
                
                return {
                    requestNumber,
                    totalQuantity,
                    status,
                    createdAt,
                    itemCount
                };
            })
        );
        
        // Sort by creation date (newest first)
        requestsWithInfo.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        
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
        app.listen(PORT, () => {
            console.log(`Noda System server running on port ${PORT}`);
            console.log(`Access the application at: http://localhost:${PORT}`);
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
