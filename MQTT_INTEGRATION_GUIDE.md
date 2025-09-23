# MQTT Integration Setup for Noda System

## 📋 Required Changes Summary

### 1. **Install MQTT Dependency**
```bash
npm install mqtt
```

### 2. **Environment Variables (.env)**
Add these to your `.env` file:
```
MQTT_BROKER_URL=mqtt://localhost:1883
MQTT_USERNAME=noda_iot
MQTT_PASSWORD=noda_secure_2024
```

### 3. **Server Integration Steps**

#### Step 1: Import MQTT module at the top of nodaServer.js
```javascript
// Add this after existing imports
const { initializeMQTT, publishDeviceCommand, startPickingWithMQTT, notifyDeviceStatusChangeWithMQTT } = require('./mqttIntegration');
```

#### Step 2: Initialize MQTT after server starts
```javascript
// Add this before the final startServer() call
async function startServer() {
    try {
        await connectToMongoDB();
        httpServer.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
            console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
            
            // Initialize MQTT integration
            setTimeout(() => {
                initializeMQTT();
            }, 2000);
        });
        startPeriodicESP32Check();
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}
```

#### Step 3: Update the picking start endpoint
Replace the existing broadcast section in the picking start endpoint:
```javascript
// In app.post('/api/picking-requests/:requestNumber/start', ...)
// Replace the "// Broadcast to all IoT devices" section with:

console.log(`🚀 Broadcasting to both MQTT and Socket.IO devices`);

// Send to MQTT devices (new)
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

// Send to Socket.IO devices (existing)
connectedDevices.forEach((deviceSocket, deviceId) => {
    const deviceItem = request.lineItems.find(item => item.背番号 === deviceId);
    
    if (deviceItem && deviceItem.status === 'pending') {
        deviceSocket.emit('display-update', {
            color: 'green',
            quantity: deviceItem.quantity,
            message: `Pick ${deviceItem.quantity}`,
            requestNumber,
            lineNumber: deviceItem.lineNumber,
            品番: deviceItem.品番
        });
    } else {
        deviceSocket.emit('display-update', {
            color: 'red',
            quantity: null,
            message: 'No Pick'
        });
    }
});
```

#### Step 4: Update device notification function
Replace the `notifyDeviceStatusChange` function with dual support:
```javascript
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
        // Send via MQTT (new devices)
        publishDeviceCommand(deviceId, command);
        
        // Send via Socket.IO (existing devices)
        const deviceSocket = connectedDevices.get(deviceId);
        if (deviceSocket) {
            deviceSocket.emit('display-update', command);
            console.log(`✅ Sent via Socket.IO to device ${deviceId}`);
        } else {
            console.log(`⚠️ Device ${deviceId} not connected via Socket.IO`);
        }
    }
}
```

## 🛠️ MQTT Broker Setup Options

### Option 1: Free Public Broker (Testing)
```
MQTT_BROKER_URL=mqtt://test.mosquitto.org:1883
```

### Option 2: HiveMQ Cloud (Production)
1. Sign up at https://www.hivemq.com/
2. Create cluster
3. Update .env:
```
MQTT_BROKER_URL=mqtts://your-cluster.hivemq.cloud:8883
MQTT_USERNAME=your-username
MQTT_PASSWORD=your-password
```

### Option 3: Self-hosted Mosquitto
```bash
# Install Mosquitto
sudo apt-get install mosquitto mosquitto-clients

# Start Mosquitto
sudo systemctl start mosquitto
sudo systemctl enable mosquitto

# .env setting
MQTT_BROKER_URL=mqtt://localhost:1883
```

## 🔄 Migration Strategy

### Phase 1: Hybrid Mode (Recommended)
- Keep existing Socket.IO devices working
- Add MQTT support alongside
- Test with new MQTT devices
- Both systems run simultaneously

### Phase 2: Gradual Migration
- Update devices one by one to MQTT version
- Monitor both systems
- Verify real-time performance

### Phase 3: Full MQTT (Optional)
- Remove Socket.IO device handling
- Keep Socket.IO only for tablets
- Full MQTT for all IoT devices

## 🧪 Testing Commands

### Check MQTT device status:
```bash
curl http://localhost:3001/api/mqtt/devices/status
```

### Send manual command to device:
```bash
curl -X POST http://localhost:3001/api/mqtt/device/C74/command \
  -H "Content-Type: application/json" \
  -d '{
    "color": "green",
    "quantity": 5,
    "message": "Pick 5",
    "requestNumber": "TEST-001",
    "lineNumber": 1
  }'
```

## 📊 Benefits of This Integration

✅ **Real-time performance** - MQTT is faster than Socket.IO for IoT  
✅ **Better reliability** - MQTT handles reconnections automatically  
✅ **Persistent messages** - Commands are retained until devices receive them  
✅ **Backward compatibility** - Existing Socket.IO devices continue working  
✅ **Easy rollback** - Can disable MQTT without affecting current system  
✅ **Scalable** - MQTT handles many devices better than Socket.IO  

## 🚨 Important Notes

1. **Test thoroughly** - Run both systems in parallel initially
2. **Monitor performance** - Check logs for MQTT connection issues
3. **Update ESP32 gradually** - Don't update all devices at once
4. **Keep backup** - Original Socket.IO version remains untouched