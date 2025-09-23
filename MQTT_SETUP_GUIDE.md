# MQTT Broker Setup Guide

## Quick Setup Options

### Option 1: Local Mosquitto MQTT Broker (Recommended for Development)

1. Install Mosquitto MQTT broker:
   ```bash
   # macOS
   brew install mosquitto
   
   # Ubuntu/Debian
   sudo apt install mosquitto mosquitto-clients
   ```

2. Start the broker:
   ```bash
   # macOS (starts automatically, or manually start)
   brew services start mosquitto
   # or
   mosquitto -v
   
   # Ubuntu/Debian
   sudo systemctl start mosquitto
   sudo systemctl enable mosquitto
   ```

3. Update your `.env` file:
   ```
   MQTT_ENABLED=true
   MQTT_BROKER_URL=mqtt://localhost:1883
   ```

### Option 2: Cloud MQTT Broker

For production or remote testing, you can use cloud MQTT brokers:

#### HiveMQ Cloud (Free tier available)
1. Sign up at https://www.hivemq.com/mqtt-cloud-broker/
2. Create a cluster and note the connection details
3. Update your `.env` file:
   ```
   MQTT_ENABLED=true
   MQTT_BROKER_URL=mqtts://your-cluster.hivemq.cloud:8883
   MQTT_USERNAME=your-username
   MQTT_PASSWORD=your-password
   ```

#### AWS IoT Core
1. Set up AWS IoT Core in your AWS account
2. Create certificates and policies
3. Update your `.env` file with certificate paths

## Testing the MQTT Integration

1. Start your server:
   ```bash
   npm start
   ```

2. Check MQTT connection in server logs:
   ```
   🔗 Initializing MQTT connection...
   ✅ MQTT client connected to mqtt://localhost:1883
   📡 MQTT subscribed to: noda/device/+/status
   📡 MQTT subscribed to: noda/device/+/completion
   ```

3. Test MQTT API endpoints:
   ```bash
   # Check MQTT devices
   curl http://localhost:3000/api/mqtt/devices
   
   # Send test command to device
   curl -X POST http://localhost:3000/api/mqtt/device/ESP32_001/command \
     -H "Content-Type: application/json" \
     -d '{"color": "green", "quantity": 5, "message": "Test Pick"}'
   ```

4. Monitor MQTT messages (if using Mosquitto):
   ```bash
   # Subscribe to all noda topics
   mosquitto_sub -t "noda/#" -v
   
   # Publish test message
   mosquitto_pub -t "noda/device/ESP32_001/status" -m "online"
   ```

## ESP32 Setup

1. Upload the `nodaIOT_MQTT.ino` to your ESP32 device
2. Update WiFi credentials and MQTT broker details in the Arduino code
3. Ensure device ID matches your system configuration
4. Device will automatically connect and appear in MQTT device list

## Hybrid System Operation

Your system now supports both protocols simultaneously:
- **Tablets**: Continue using Socket.IO (no changes needed)
- **ESP32 Devices**: Can use either Socket.IO or MQTT
- **Server**: Bridges both protocols automatically

When a picking request starts, the server will:
1. Send commands via MQTT to MQTT-connected devices
2. Send commands via Socket.IO to Socket.IO-connected devices
3. Log the communication for both protocols

## Troubleshooting

### MQTT Connection Issues
- Check broker URL and credentials
- Verify firewall settings (port 1883 for MQTT, 8883 for MQTTS)
- Check server logs for connection errors

### Device Not Receiving Commands
- Verify device ID matches exactly
- Check MQTT topic subscriptions
- Monitor MQTT broker logs
- Use MQTT client tools to test manually

### Environment Variables
- Copy `.env.example` to `.env`
- Update MQTT configuration as needed
- Restart server after environment changes