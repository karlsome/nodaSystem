/* ESP32-S3 Touch LCD (Waveshare) — Noda System IoT Device - MQTT VERSION
 * - WiFi connected to Noda System server
 * - MQTT client for real-time communication
 * - Device ID: C74 (背番号)
 * - Default RED screen, GREEN when picking assigned
 * - Touch or button press completes picking task
 */

#include <lvgl.h>
#include <demos/lv_demos.h>
#include <Arduino_GFX_Library.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include "bsp_cst816.h"
#include "FreeSans14pt7b.h"  // Small font for device ID
#include "FreeSans50pt7b.h"  // Large font for quantity (with size multiplier)

// ---------- Forward declarations ----------
void handleDisplayUpdate(String jsonData);
void mqttCallback(char* topic, byte* payload, unsigned int length);
void reconnectMQTT();

// List of known SSIDs and passwords
const char* ssidList[] = {
  "Noda-ioT",
  "sasaki-host",
  "sasaki-host_EXT",
  "OZEKojo",
  "Sasaki_Hidase_2.4GHz",
  "Sasaki_Hidase_Guest_5G",
  "Sasaki-Coating",
  "HR02a-0A5D3E (2.4GHz)",
  "HR02b-0A5D3E (5GHz)",
  "HR02a-0A5D3E_EXT (2.4GHz)",
  "HR02b-0A5D3F_EXT (5GHz)",
  "HR02a-0A5D3E",
  "HR02a-0A5D3E_EXT",
  "TP-Link_30B8",
  "106F3F36FD33",
  "106F3F36FD33_5GEXT"
};

const char* passwordList[] = {
  "6B0B7AC380",
  "6B0B7AC380",
  "6B0B7AC380",
  "65057995",
  "58677728a",
  "Hidase1757",
  "SasAkic0aTinG",
  "SafxxmWt1F",
  "SafxxmWt1F",
  "SafxxmWt1F",
  "SafxxmWt1F",
  "SafxxmWt1F",
  "SafxxmWt1F",
  "93312585",
  "jdbxjrck1wggp",
  "jdbxjrck1wggp"
};

const int numNetworks = sizeof(ssidList) / sizeof(ssidList[0]);

// Server configuration
const char* websockets_server = "nodasystem.onrender.com";
const int websockets_port = 443;  // For REST API fallback
const char* mqtt_server = "351e74fee4f548758a62972322c7eb29.s1.eu.hivemq.cloud";  // HiveMQ Cloud broker
const int mqtt_port = 8883;  // TLS/SSL MQTT port
const char* mqtt_user = "nodasims";  // HiveMQ Cloud username
const char* mqtt_password = "Sasaki1234";  // HiveMQ Cloud password

// Device configuration
const String DEVICE_ID = "C74"; // 背番号 - Change for each device

// MQTT Topics
const String TOPIC_COMMAND = "noda/device/" + DEVICE_ID + "/command";
const String TOPIC_STATUS = "noda/device/" + DEVICE_ID + "/status";  
const String TOPIC_COMPLETION = "noda/device/" + DEVICE_ID + "/completion";
const String TOPIC_HEARTBEAT = "noda/device/" + DEVICE_ID + "/heartbeat";

// ---- Waveshare pins (your working setup) ----
#define EXAMPLE_PIN_NUM_LCD_SCLK 39
#define EXAMPLE_PIN_NUM_LCD_MOSI 38
#define EXAMPLE_PIN_NUM_LCD_MISO 40
#define EXAMPLE_PIN_NUM_LCD_DC   42
#define EXAMPLE_PIN_NUM_LCD_RST  -1
#define EXAMPLE_PIN_NUM_LCD_CS   45
#define EXAMPLE_PIN_NUM_LCD_BL    1
#define EXAMPLE_PIN_NUM_TP_SDA   48
#define EXAMPLE_PIN_NUM_TP_SCL   47

#define LEDC_FREQ             5000
#define LEDC_TIMER_10_BIT     10

// Display config (panel native size; rotation gives landscape)
#define EXAMPLE_LCD_ROTATION  1
#define EXAMPLE_LCD_H_RES     240
#define EXAMPLE_LCD_V_RES     320

// Relays / outputs
#define PIN_RELAY_A 2   // RED when HIGH
#define PIN_RELAY_B 4   // GREEN when HIGH

// --- Single N.O. button bridging GPIO6 <-> GPIO16 ---
#define PIN_BRIDGE_DRIVE   6    // OUTPUT LOW
#define PIN_BRIDGE_SENSE   16   // INPUT_PULLUP we read
const unsigned long BTN_DEBOUNCE_MS = 30;

// MQTT client
WiFiClientSecure wifiClient;  // Use WiFiClientSecure for TLS/SSL MQTT (HiveMQ Cloud)
PubSubClient mqttClient(wifiClient);

// Device state
struct DeviceState {
  bool isConnected = false;
  bool isPickingMode = false;
  int currentQuantity = 0;
  String requestNumber = "";
  int lineNumber = 0;
  String 品番 = "";
  String currentMessage = "Connecting...";
  unsigned long completedTime = 0; // Time when task was completed
  bool isInCompletedMode = false; // Flag for completed state
} deviceState;

// Connection monitoring
struct ConnectionState {
  unsigned long lastHeartbeat = 0;
  unsigned long lastConnectAttempt = 0;
  unsigned long lastMqttMessage = 0;
  unsigned long lastWifiReconnectAttempt = 0;
  bool isReconnecting = false;
  bool wasWifiConnected = false;
  const unsigned long HEARTBEAT_INTERVAL = 25000; // Send heartbeat every 25 seconds (before 30s keepalive)
  const unsigned long CONNECTION_TIMEOUT = 45000; // Consider disconnected after 45 seconds
  const unsigned long RECONNECT_DELAY = 10000; // Wait 10 seconds between reconnect attempts (longer for stability)
  const unsigned long WIFI_RECONNECT_INTERVAL = 10000; // Try WiFi reconnection every 10 seconds
  const unsigned long MAX_RECONNECT_ATTEMPTS = 3; // Max consecutive attempts before longer delay
  unsigned int reconnectAttempts = 0;
  unsigned int wifiReconnectAttempts = 0;
} connectionState;

// Screen power management
struct ScreenState {
  bool isScreenOn = true;
  unsigned long lastActivityTime = 0;
  const unsigned long SCREEN_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
  bool shouldCheckTimeout = false;
} screenState;

// --- Arduino_GFX objects ---
Arduino_DataBus *bus = new Arduino_ESP32SPI(
  EXAMPLE_PIN_NUM_LCD_DC, EXAMPLE_PIN_NUM_LCD_CS,
  EXAMPLE_PIN_NUM_LCD_SCLK, EXAMPLE_PIN_NUM_LCD_MOSI, EXAMPLE_PIN_NUM_LCD_MISO);

Arduino_GFX *gfx = new Arduino_ST7789(
  bus, EXAMPLE_PIN_NUM_LCD_RST, EXAMPLE_LCD_ROTATION, true,
  EXAMPLE_LCD_H_RES, EXAMPLE_LCD_V_RES,
  0, 0, 0, 0); // zero offsets -> no sliver

// --- LVGL buffers ---
uint32_t screenWidth, screenHeight, bufSize;
lv_disp_draw_buf_t draw_buf;
lv_color_t *disp_draw_buf;
lv_disp_drv_t disp_drv;

#if LV_USE_LOG != 0
void my_print(const char *buf) { Serial.printf("%s", buf); Serial.flush(); }
#endif

// --- State & helpers ---
static bool displayGreen = false;  // true => GREEN (picking), false => RED (standby)

static void apply_relays() {
  digitalWrite(PIN_RELAY_A, displayGreen ? LOW : HIGH);   // GPIO2 - RED when not picking
  digitalWrite(PIN_RELAY_B, displayGreen ? HIGH : LOW);   // GPIO4 - GREEN when picking
}

static void turn_screen_off() {
  Serial.println("🌙 Turning screen off to prevent burn-in (15min timeout)");
  Serial.println("📡 Note: MQTT connection remains active during screen timeout");
  gfx->fillScreen(BLACK);
  gfx->flush();
  
  // Turn off LCD backlight completely for power saving
  ledcWrite(EXAMPLE_PIN_NUM_LCD_BL, 0); // 0% backlight = completely off
  
  screenState.isScreenOn = false;
  // Note: GPIO relays stay active, LCD backlight and display content are off
  // MQTT connection is maintained regardless of screen state
}

static void turn_screen_on() {
  if (!screenState.isScreenOn) {
    Serial.println("☀️ Turning screen back on");
    
    // Restore LCD backlight to 80%
    ledcWrite(EXAMPLE_PIN_NUM_LCD_BL, (1 << LEDC_TIMER_10_BIT) * 80 / 100);
    
    screenState.isScreenOn = true;
    update_screen_display(); // Refresh with current content
  }
}

static void update_screen_activity() {
  screenState.lastActivityTime = millis();
  screenState.shouldCheckTimeout = !displayGreen; // Only timeout during red/standby modes
  turn_screen_on(); // Wake up screen if it was off
}

static void check_screen_timeout() {
  // Only check timeout during red/standby modes
  if (!screenState.shouldCheckTimeout || displayGreen) {
    return;
  }
  
  unsigned long now = millis();
  // Handle millis() overflow (happens every ~50 days)
  if (now < screenState.lastActivityTime) {
    screenState.lastActivityTime = now;
    return;
  }
  
  if (screenState.isScreenOn && (now - screenState.lastActivityTime) >= screenState.SCREEN_TIMEOUT_MS) {
    turn_screen_off();
  }
}

// Check if device should return from completed mode to standby
static void check_completed_timeout() {
  if (deviceState.isInCompletedMode && deviceState.completedTime > 0) {
    unsigned long now = millis();
    
    // Handle millis() overflow
    if (now < deviceState.completedTime) {
      deviceState.completedTime = now;
      return;
    }
    
    // Check if 5 seconds have passed since completion
    if ((now - deviceState.completedTime) >= 5000) {
      Serial.println("⏰ ===== 5 SECOND TIMEOUT - RETURNING TO STANDBY =====");
      Serial.printf("⏰ Completed at: %lu, Now: %lu, Diff: %lu ms\n", 
        deviceState.completedTime, now, now - deviceState.completedTime);
      
      // Return to standby mode
      deviceState.isInCompletedMode = false;
      deviceState.completedTime = 0;
      deviceState.currentMessage = "Standby";
      
      Serial.println("💤 Device now in STANDBY mode - ready for new assignments");
      update_screen_activity(); // Wake screen and reset timeout
      update_screen_display();
      
      // Publish updated status
      publishDeviceStatus();
      Serial.println("⏰ ===== STANDBY MODE ACTIVATED =====");
    }
  }
}

static void update_screen_display() {
  // Don't update if screen is intentionally off for power saving
  if (!screenState.isScreenOn) {
    return;
  }

  // Clear screen with background color
  gfx->fillScreen(displayGreen ? GREEN : RED);

  // Set text color to white
  gfx->setTextColor(WHITE);

  // Device ID at top (small font)
  gfx->setFont(&FreeSans14pt7b);
  gfx->setTextSize(1);
  
  // Calculate position for centered text at top
  int16_t x1, y1;
  uint16_t w, h;
  gfx->getTextBounds(DEVICE_ID.c_str(), 0, 0, &x1, &y1, &w, &h);
  int deviceX = (gfx->width() - w) / 2;
  int deviceY = 30; // Top margin
  
  gfx->setCursor(deviceX, deviceY);
  gfx->print(DEVICE_ID);

  if (deviceState.isPickingMode && deviceState.currentQuantity > 0) {
    // PICKING MODE: Show huge quantity number in center
    gfx->setFont(&FreeSans50pt7b);  // Use 50pt font with size multiplier
    gfx->setTextSize(2);  // Double the size to make it really big!
    
    String qtyText = String(deviceState.currentQuantity);
    gfx->getTextBounds(qtyText.c_str(), 0, 0, &x1, &y1, &w, &h);
    int qtyX = (gfx->width() - w) / 2;
    int qtyY = (gfx->height() / 2) + (h / 2); // Center vertically
    
    gfx->setCursor(qtyX, qtyY);
    gfx->print(qtyText);
    
  } else {
    // STANDBY MODE: Show status message in center
    gfx->setFont(&FreeSans14pt7b);
    gfx->setTextSize(1);
    
    gfx->getTextBounds(deviceState.currentMessage.c_str(), 0, 0, &x1, &y1, &w, &h);
    int msgX = (gfx->width() - w) / 2;
    int msgY = (gfx->height() / 2) + (h / 2); // Center vertically
    
    gfx->setCursor(msgX, msgY);
    gfx->print(deviceState.currentMessage);
  }

  // Force the display to update immediately
  gfx->flush();
}

static void complete_picking_task() {
  if (!deviceState.isPickingMode) {
    Serial.println("⚠️ complete_picking_task() called but not in picking mode - ignoring");
    return;
  }

  Serial.println("📦 ===== COMPLETING PICKING TASK =====");
  Serial.printf("📋 Task Details: Request=%s, Line=%d, Qty=%d, 品番=%s\n", 
    deviceState.requestNumber.c_str(), deviceState.lineNumber, deviceState.currentQuantity, deviceState.品番.c_str());

  // Send completion to server via MQTT
  DynamicJsonDocument doc(1024);
  doc["deviceId"] = DEVICE_ID;
  doc["requestNumber"] = deviceState.requestNumber;
  doc["lineNumber"] = deviceState.lineNumber;
  doc["completedBy"] = "IoT Device";
  doc["timestamp"] = millis();

  String payload;
  serializeJson(doc, payload);
  Serial.println("📤 Sending completion payload: " + payload);
  
  if (mqttClient.connected()) {
    bool success = mqttClient.publish(TOPIC_COMPLETION.c_str(), payload.c_str(), true); // Retained message
    if (success) {
      Serial.println("✅ Task completion sent via MQTT successfully");
    } else {
      Serial.println("❌ Failed to send completion via MQTT");
    }
  } else {
    Serial.println("❌ MQTT not connected - completion not sent");
  }

  // Reset to completed mode (red background for 5 seconds)
  Serial.println("🔴 Switching to COMPLETED mode (red background for 5 seconds)");
  deviceState.isPickingMode = false;
  deviceState.currentQuantity = 0;
  deviceState.requestNumber = "";
  deviceState.lineNumber = 0;
  deviceState.品番 = "";
  deviceState.currentMessage = "Completed";
  deviceState.completedTime = millis(); // Record completion time
  deviceState.isInCompletedMode = true; // Set completed flag

  displayGreen = false;
  apply_relays();
  update_screen_activity(); // Reset screen timeout and wake up if needed
  update_screen_display();

  // Publish status update
  publishDeviceStatus();

  Serial.println("✅ Task completed - will return to standby in 5 seconds");
  Serial.println("📦 ===== COMPLETION PROCESS FINISHED =====");
}

// --- LVGL callbacks ---
void my_disp_flush(lv_disp_drv_t * /*disp_drv*/, const lv_area_t * /*area*/, lv_color_t * /*color_p*/) {
  lv_disp_flush_ready(&disp_drv);
}

void my_touchpad_read(lv_indev_drv_t * /*indev_drv*/, lv_indev_data_t *data) {
  static bool was_pressed = false;
  uint16_t tx, ty;
  bsp_touch_read();
  bool pressed = bsp_touch_get_coordinates(&tx, &ty);

  if (pressed) {
    data->point.x = tx;
    data->point.y = ty;
    data->state = LV_INDEV_STATE_PRESSED;
    if (!was_pressed) {
      Serial.printf("👆 TOUCH DETECTED at coordinates (%d, %d)\n", tx, ty);
      Serial.printf("👆 Current state: picking=%s, completed=%s\n", 
        deviceState.isPickingMode ? "true" : "false",
        deviceState.isInCompletedMode ? "true" : "false");
      
      update_screen_activity(); // Reset timeout and wake screen on touch
      if (deviceState.isPickingMode) {
        Serial.println("👆 Touch triggered task completion");
        complete_picking_task();
      } else {
        Serial.println("👆 Touch registered but no picking task active");
      }
    }
    was_pressed = true;
  } else {
    data->state = LV_INDEV_STATE_RELEASED;
    was_pressed = false;
  }
}

// --- Bridge button polling with debounce (sense 16, falling edge means press) ---
static int btnStable   = HIGH; // because INPUT_PULLUP
static int btnLastRaw  = HIGH;
static unsigned long btnLastChange = 0;

void check_bridge_button() {
  unsigned long now = millis();
  int raw = digitalRead(PIN_BRIDGE_SENSE); // HIGH=released, LOW=pressed (shorted to 6)

  if (raw != btnLastRaw) {
    btnLastRaw = raw;
    btnLastChange = now;
  } else if ((now - btnLastChange) > BTN_DEBOUNCE_MS && raw != btnStable) {
    int prev = btnStable;
    btnStable = raw;
    if (prev == HIGH && btnStable == LOW) {
      Serial.println("🔘 BUTTON PRESSED detected");
      Serial.printf("🔘 Current state: picking=%s, completed=%s\n", 
        deviceState.isPickingMode ? "true" : "false",
        deviceState.isInCompletedMode ? "true" : "false");
      
      update_screen_activity(); // Reset timeout and wake screen on button press
      if (deviceState.isPickingMode) {
        Serial.println("🔘 Button triggered task completion");
        complete_picking_task();
      } else {
        Serial.println("🔘 Button pressed but no picking task active");
      }
    }
  }
}

// WiFi helpers
void onWiFiConnected() {
  Serial.println("📶 WiFi connected!");
  Serial.print("IP address: ");
  Serial.println(WiFi.localIP());
  deviceState.currentMessage = "WiFi Connected";
  update_screen_activity(); // Reset timeout and wake screen
  update_screen_display();
  
  // Attempt MQTT connection after WiFi is ready
  connectToMQTT();
}

void onWiFiDisconnected() {
  Serial.println("📶 WiFi disconnected!");
  deviceState.isConnected = false;
  connectionState.wasWifiConnected = false;
  deviceState.currentMessage = "WiFi Disconnected";
  update_screen_activity(); // Reset timeout and wake screen
  update_screen_display();
}

void attemptWiFiReconnection() {
  unsigned long now = millis();
  
  // Check if enough time has passed since last attempt
  if (now - connectionState.lastWifiReconnectAttempt < connectionState.WIFI_RECONNECT_INTERVAL) {
    return; // Too soon to retry
  }
  
  connectionState.lastWifiReconnectAttempt = now;
  connectionState.wifiReconnectAttempts++;
  
  Serial.printf("🔄 WiFi reconnection attempt #%d...\n", connectionState.wifiReconnectAttempts);
  
  deviceState.currentMessage = String("WiFi Reconnect #") + String(connectionState.wifiReconnectAttempts);
  update_screen_activity();
  update_screen_display();
  
  // First try simple reconnect (faster)
  WiFi.reconnect();
  
  // Wait up to 10 seconds for reconnection
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println();
    Serial.println("✅ WiFi reconnected successfully!");
    connectionState.wifiReconnectAttempts = 0;
    connectionState.wasWifiConnected = true;
    onWiFiConnected();
  } else {
    Serial.println();
    Serial.println("❌ Quick reconnect failed, will try full scan next cycle");
    
    // Every 3rd attempt, do a full network scan and reconnect
    if (connectionState.wifiReconnectAttempts % 3 == 0) {
      Serial.println("🔍 Performing full network scan...");
      WiFi.disconnect(true, true);
      delay(100);
      connectToWiFi();
    }
  }
}

// REST API status check - backup method (kept for compatibility)
void checkDeviceStatusViaAPI() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi not connected, skipping API check");
    return;
  }
  
  HTTPClient http;
  String url = "https://" + String(websockets_server) + "/api/device/" + DEVICE_ID + "/status";
  
  Serial.println("🌐 Checking device status via REST API: " + url);
  
  http.begin(url);
  http.setTimeout(5000); // 5 second timeout
  
  int httpCode = http.GET();
  
  if (httpCode == HTTP_CODE_OK) {
    String response = http.getString();
    Serial.println("🌐 API Response: " + response);
    
    DynamicJsonDocument doc(1024);
    DeserializationError err = deserializeJson(doc, response);
    
    if (!err) {
      String status = doc["status"] | "";
      String color = doc["color"] | "red";
      int quantity = doc["quantity"] | 0;
      String message = doc["message"] | "Standby";
      String requestNumber = doc["requestNumber"] | "";
      int lineNumber = doc["lineNumber"] | 0;
      String 品番 = doc["品番"] | "";
      
      Serial.printf("🌐 API Status: %s, Color: %s, Qty: %d\n", status.c_str(), color.c_str(), quantity);
      
      // Apply the status update
      if (color == "green" && quantity > 0) {
        Serial.println("🟢 API: Restoring green screen with quantity");
        deviceState.isPickingMode = true;
        deviceState.currentQuantity = quantity;
        deviceState.requestNumber = requestNumber;
        deviceState.lineNumber = lineNumber;
        deviceState.品番 = 品番;
        deviceState.currentMessage = "Pick " + String(quantity);
        displayGreen = true;
        update_screen_activity(); // Wake screen and reset timeout for green mode
      } else {
        Serial.println("🔴 API: Setting red screen (standby)");
        deviceState.isPickingMode = false;
        deviceState.currentQuantity = 0;
        deviceState.requestNumber = "";
        deviceState.lineNumber = 0;
        deviceState.品番 = "";
        deviceState.currentMessage = message;
        displayGreen = false;
        update_screen_activity(); // Reset timeout for red mode
      }
      
      apply_relays();
      update_screen_display();
    } else {
      Serial.println("🌐 API: JSON parse error");
    }
  } else {
    Serial.printf("🌐 API: HTTP error %d\n", httpCode);
  }
  
  http.end();
}

// MQTT connection and management functions
void connectToMQTT() {
  Serial.println("🔌 Connecting to HiveMQ Cloud broker with TLS...");
  
  // Configure WiFiClientSecure for TLS/SSL connection
  wifiClient.setInsecure(); // Skip certificate verification for simplicity (use CA cert in production)
  
  // Configure MQTT client
  mqttClient.setServer(mqtt_server, mqtt_port);
  mqttClient.setCallback(mqttCallback);
  mqttClient.setKeepAlive(30); // 30 seconds keepalive
  mqttClient.setSocketTimeout(15); // 15 seconds timeout for faster failure detection
  
  // Set buffer sizes for better reliability
  mqttClient.setBufferSize(1024); // Increase buffer for larger messages
  
  deviceState.currentMessage = "Connecting MQTT...";
  update_screen_activity();
  update_screen_display();
}

void reconnectMQTT() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("⚠️ MQTT reconnection skipped - WiFi not connected");
    return; // Don't attempt MQTT connection without WiFi
  }

  if (connectionState.isReconnecting) {
    return; // Already attempting reconnection
  }

  unsigned long now = millis();
  if (now - connectionState.lastConnectAttempt < connectionState.RECONNECT_DELAY) {
    return; // Too soon to retry
  }

  connectionState.isReconnecting = true;
  connectionState.lastConnectAttempt = now;

  Serial.print("🔄 Attempting MQTT connection...");
  Serial.printf(" (Attempt #%d)\n", connectionState.reconnectAttempts + 1);
  
  // Create client ID with device ID
  String clientId = "NodaIoT_" + DEVICE_ID + "_" + String(random(0xffff), HEX);
  
  // Last Will and Testament - notify server if device disconnects unexpectedly
  String willTopic = TOPIC_STATUS;
  String willMessage = "{\"deviceId\":\"" + DEVICE_ID + "\",\"status\":\"offline\",\"timestamp\":" + String(millis()) + "}";
  
  bool connected = mqttClient.connect(clientId.c_str(), mqtt_user, mqtt_password, 
                                     willTopic.c_str(), 1, true, willMessage.c_str());
  
  if (connected) {
    Serial.println(" ✅ MQTT Connected!");
    deviceState.isConnected = true;
    deviceState.currentMessage = "MQTT Connected";
    connectionState.isReconnecting = false;
    connectionState.lastMqttMessage = millis();
    connectionState.reconnectAttempts = 0; // Reset counter on successful connection
    
    // Subscribe to command topic
    bool subSuccess = mqttClient.subscribe(TOPIC_COMMAND.c_str(), 1); // QoS 1 for reliable delivery
    if (subSuccess) {
      Serial.println("📥 Subscribed to command topic: " + TOPIC_COMMAND);
    } else {
      Serial.println("❌ Failed to subscribe to command topic");
    }
    
    // Clear any stale retained messages by publishing empty message
    Serial.println("🧹 Clearing any stale MQTT commands...");
    mqttClient.publish(TOPIC_COMMAND.c_str(), "", true); // Clear retained message
    
    // Publish online status
    publishDeviceStatus();
    
    // Send initial heartbeat
    sendHeartbeat();
    
    update_screen_activity();
    update_screen_display();
    
    // Check current status via API as backup
    delay(2000);
    Serial.println("🔄 Checking device status via REST API as backup...");
    checkDeviceStatusViaAPI();
    
  } else {
    Serial.print(" ❌ Failed, rc=");
    Serial.print(mqttClient.state());
    connectionState.reconnectAttempts++;
    
    // Use exponential backoff after multiple failures
    unsigned long backoffDelay = connectionState.RECONNECT_DELAY;
    if (connectionState.reconnectAttempts >= connectionState.MAX_RECONNECT_ATTEMPTS) {
      backoffDelay = 30000; // Wait 30 seconds after multiple failures
      Serial.println(" (using extended backoff)");
    } else {
      Serial.printf(" retrying in %lu seconds\n", backoffDelay / 1000);
    }
    
    deviceState.isConnected = false;
    deviceState.currentMessage = "MQTT Failed";
    connectionState.isReconnecting = false;
    update_screen_activity();
    update_screen_display();
  }
}

void publishDeviceStatus() {
  if (!mqttClient.connected()) return;
  
  DynamicJsonDocument doc(512);
  doc["deviceId"] = DEVICE_ID;
  doc["status"] = deviceState.isPickingMode ? "picking" : "standby";
  doc["isPickingMode"] = deviceState.isPickingMode;
  doc["currentQuantity"] = deviceState.currentQuantity;
  doc["requestNumber"] = deviceState.requestNumber;
  doc["lineNumber"] = deviceState.lineNumber;
  doc["timestamp"] = millis();
  doc["online"] = true;
  
  String payload;
  serializeJson(doc, payload);
  
  bool success = mqttClient.publish(TOPIC_STATUS.c_str(), payload.c_str(), true); // Retained message
  if (success) {
    Serial.println("📤 Device status published");
  } else {
    Serial.println("❌ Failed to publish device status");
  }
}

void sendHeartbeat() {
  if (!mqttClient.connected()) return;
  
  DynamicJsonDocument doc(256);
  doc["deviceId"] = DEVICE_ID;
  doc["timestamp"] = millis();
  doc["uptime"] = millis();
  doc["status"] = deviceState.isPickingMode ? "picking" : "standby";
  doc["rssi"] = WiFi.RSSI();
  
  String payload;
  serializeJson(doc, payload);
  
  bool success = mqttClient.publish(TOPIC_HEARTBEAT.c_str(), payload.c_str(), false); // Not retained
  if (success) {
    connectionState.lastHeartbeat = millis();
    Serial.println("💓 Heartbeat sent to MQTT broker");
  } else {
    Serial.println("❌ Failed to send heartbeat");
  }
}

void checkConnectionHealth() {
  unsigned long now = millis();
  
  // Check WiFi status first
  if (WiFi.status() != WL_CONNECTED) {
    if (connectionState.wasWifiConnected) {
      Serial.println("⚠️ WiFi connection lost during operation!");
      connectionState.wasWifiConnected = false;
      if (deviceState.isConnected) {
        deviceState.isConnected = false;
        deviceState.currentMessage = "WiFi Lost";
        update_screen_activity();
        update_screen_display();
      }
    }
    return; // Don't check MQTT if WiFi is down
  }
  
  // WiFi is connected - check if it just recovered
  if (!connectionState.wasWifiConnected) {
    Serial.println("✅ WiFi connection recovered! Re-establishing MQTT...");
    connectionState.wasWifiConnected = true;
    connectionState.reconnectAttempts = 0; // Reset MQTT attempts on WiFi recovery
    reconnectMQTT();
    return;
  }
  
  // Check if MQTT connection is lost
  if (deviceState.isConnected && !mqttClient.connected()) {
    Serial.println("⚠️ MQTT connection lost, marking as disconnected");
    deviceState.isConnected = false;
    deviceState.currentMessage = "MQTT Lost";
    update_screen_activity();
    update_screen_display();
  }
  
  // Send periodic heartbeat
  if (deviceState.isConnected && (now - connectionState.lastHeartbeat) >= connectionState.HEARTBEAT_INTERVAL) {
    sendHeartbeat();
  }
  
  // Attempt MQTT reconnection if needed (WiFi is up but MQTT is down)
  if (!deviceState.isConnected && !connectionState.isReconnecting) {
    reconnectMQTT();
  }
}

void ensureConnectionStability() {
  // Make sure we maintain MQTT connection regardless of device state
  if (WiFi.status() == WL_CONNECTED) {
    if (!mqttClient.connected() && !connectionState.isReconnecting) {
      Serial.println("📡 MQTT not connected but WiFi is up - initiating connection");
      checkConnectionHealth();
    }
  }
}

// MQTT message callback
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  Serial.println("� ===== MQTT MESSAGE RECEIVED =====");
  Serial.printf("📡 Topic: %s\n", topic);
  Serial.printf("📡 Payload Length: %u bytes\n", length);
  
  // Convert payload to string
  String message = "";
  for (unsigned int i = 0; i < length; i++) {
    message += (char)payload[i];
  }
  
  Serial.println("� Raw Message: " + message);
  connectionState.lastMqttMessage = millis();
  
  // Handle different topic types
  String topicStr = String(topic);
  if (topicStr == TOPIC_COMMAND) {
    Serial.println("📡 Processing as COMMAND message");
    handleDisplayUpdate(message);
  } else {
    Serial.println("📡 Unknown topic - ignoring message");
  }
  
  Serial.println("📡 ===== MQTT MESSAGE PROCESSING COMPLETE =====");
}

void handleDisplayUpdate(String jsonData) {
  Serial.println("📨 ===== MQTT COMMAND RECEIVED =====");
  Serial.println("📄 Raw JSON: " + jsonData);
  
  DynamicJsonDocument doc(1024);
  DeserializationError err = deserializeJson(doc, jsonData);
  if (err) {
    Serial.printf("❌ JSON parse error: %s\n", err.c_str());
    Serial.println("📨 ===== COMMAND PROCESSING FAILED =====");
    return;
  }

  String color = doc["color"] | "";
  int quantity = doc["quantity"] | 0;
  String message = doc["message"] | "Standby";
  String requestNumber = doc["requestNumber"] | "";
  int lineNumber = doc["lineNumber"] | 0;
  String 品番 = doc["品番"] | "";

  Serial.printf("� Parsed Command: color=%s, qty=%d, msg=%s\n", color.c_str(), quantity, message.c_str());
  Serial.printf("📋 Request Details: reqNum=%s, lineNum=%d, 品番=%s\n", requestNumber.c_str(), lineNumber, 品番.c_str());
  
  // Check current device state
  Serial.printf("🔍 Current State: isPickingMode=%s, isInCompletedMode=%s\n", 
    deviceState.isPickingMode ? "true" : "false",
    deviceState.isInCompletedMode ? "true" : "false");

  if (color == "green" && quantity > 0) {
    // Picking mode - REAL-TIME ACTIVATION!
    Serial.println("🟢 ===== SWITCHING TO PICKING MODE =====");
    Serial.printf("🎯 Target: Pick %d units of %s\n", quantity, 品番.c_str());
    
    deviceState.isPickingMode = true;
    deviceState.currentQuantity = quantity;
    deviceState.requestNumber = requestNumber;
    deviceState.lineNumber = lineNumber;
    deviceState.品番 = 品番;
    deviceState.currentMessage = "Pick " + String(quantity);
    deviceState.isInCompletedMode = false; // Clear completed flag
    deviceState.completedTime = 0; // Clear completion time
    
    displayGreen = true;
    Serial.println("🟢 Green screen activated with quantity: " + String(quantity));
    update_screen_activity(); // Wake screen immediately for new picking task
  } else if (color == "red" || message == "Completed") {
    Serial.println("🔴 ===== RED/COMPLETED COMMAND RECEIVED =====");
    
    // Only process red commands if we're not already in completed mode
    if (deviceState.isInCompletedMode) {
      Serial.println("⚠️ Already in completed mode - ignoring red command");
    } else {
      Serial.println("🔴 Processing red/completed command");
      deviceState.isPickingMode = false;
      deviceState.currentQuantity = 0;
      deviceState.requestNumber = "";
      deviceState.lineNumber = 0;
      deviceState.品番 = "";
      deviceState.currentMessage = message;
      deviceState.completedTime = millis(); // Set completion time
      deviceState.isInCompletedMode = true; // Set completed flag
      
      displayGreen = false;
      Serial.println("🔴 Red screen activated with message: " + message);
      update_screen_activity(); // Reset timeout for completed mode
    }
  } else {
    // Unknown command
    Serial.println("❓ ===== UNKNOWN COMMAND =====");
    Serial.printf("❓ Unrecognized command: color=%s, qty=%d, msg=%s\n", color.c_str(), quantity, message.c_str());
    
    deviceState.isPickingMode = false;
    deviceState.currentQuantity = 0;
    deviceState.requestNumber = "";
    deviceState.lineNumber = 0;
    deviceState.品番 = "";
    deviceState.currentMessage = message;
    deviceState.isInCompletedMode = false;
    deviceState.completedTime = 0;
    
    displayGreen = false;
    update_screen_activity();
  }

  apply_relays();
  update_screen_display();
  
  // Publish status update to confirm command received
  publishDeviceStatus();
  
  Serial.printf("📊 New State: picking=%s, completed=%s, qty=%d, msg=%s\n", 
    deviceState.isPickingMode ? "true" : "false",
    deviceState.isInCompletedMode ? "true" : "false",
    deviceState.currentQuantity, 
    deviceState.currentMessage.c_str());
  Serial.println("📨 ===== COMMAND PROCESSING COMPLETE =====");
}

void connectToWiFi() {
  WiFi.mode(WIFI_STA);         // ensure station mode
  WiFi.disconnect(true, true); // clear stale state
  delay(100);

  bool connected = false;
  int retryCount = 0;
  const int MAX_RETRY_CYCLES = 5; // Try up to 5 full cycles before continuing

  // Retry loop for initial connection
  while (!connected && retryCount < MAX_RETRY_CYCLES) {
    if (retryCount > 0) {
      Serial.printf("🔄 WiFi connection retry cycle %d of %d...\n", retryCount + 1, MAX_RETRY_CYCLES);
      delay(5000); // Wait 5 seconds between full retry cycles
    }

    Serial.println("📡 Scanning for available networks...");
    int n = WiFi.scanNetworks();
    Serial.printf("Found %d networks\n", n);

    for (int i = 0; i < numNetworks && !connected; i++) {
      for (int j = 0; j < n; j++) {
        if (WiFi.SSID(j) == String(ssidList[i])) {
          Serial.printf("🔌 Attempting to connect to: %s\n", ssidList[i]);

          deviceState.currentMessage = String("Connecting: ") + ssidList[i];
          update_screen_activity(); // Wake screen during connection attempts
          update_screen_display();

          WiFi.begin(ssidList[i], passwordList[i]);

          int attempts = 0;
          while (WiFi.status() != WL_CONNECTED && attempts < 40) { // ~20s
            delay(500);
            Serial.print(".");
            attempts++;
          }

          if (WiFi.status() == WL_CONNECTED) {
            Serial.println();
            Serial.printf("✅ Connected to: %s\n", ssidList[i]);
            Serial.printf("IP address: %s\n", WiFi.localIP().toString().c_str());
            connected = true;
            connectionState.wasWifiConnected = true;
            connectionState.wifiReconnectAttempts = 0;
            onWiFiConnected();
            break;
          } else {
            Serial.println();
            Serial.printf("❌ Failed to connect to: %s\n", ssidList[i]);
            WiFi.disconnect();
          }
          break;
        }
      }
    }
    
    if (!connected) {
      retryCount++;
      if (retryCount < MAX_RETRY_CYCLES) {
        deviceState.currentMessage = String("Retry ") + String(retryCount) + "/" + String(MAX_RETRY_CYCLES);
        update_screen_activity();
        update_screen_display();
      }
    }
  }

  if (!connected) {
    Serial.println("❌ Could not connect to any known network after all retries!");
    Serial.println("🔄 Will continue trying in background (every 10 seconds)...");
    deviceState.currentMessage = "WiFi Failed - Retrying...";
    connectionState.lastWifiReconnectAttempt = millis(); // Initialize for background reconnection
    update_screen_activity(); // Wake screen for error message
    update_screen_display();
  }
}

// --- Setup ---
void setup() {
  Serial.begin(115200);
  Serial.println("🚀 ESP32-S3 Noda System IoT Device - MQTT VERSION - ID: " + DEVICE_ID);

  // LCD
  if (!gfx->begin()) Serial.println("gfx->begin() failed!");
  gfx->fillScreen(BLACK);

  // Backlight ~80%
  ledcAttach(EXAMPLE_PIN_NUM_LCD_BL, LEDC_FREQ, LEDC_TIMER_10_BIT);
  ledcWrite(EXAMPLE_PIN_NUM_LCD_BL, (1 << LEDC_TIMER_10_BIT) * 80 / 100);

  // Touch
  Wire.begin(EXAMPLE_PIN_NUM_TP_SDA, EXAMPLE_PIN_NUM_TP_SCL);
  bsp_touch_init(&Wire, gfx->getRotation(), gfx->width(), gfx->height());

  // LVGL
  lv_init();
#if LV_USE_LOG != 0
  lv_log_register_print_cb(my_print);
#endif
  screenWidth  = gfx->width();   // 320 in landscape
  screenHeight = gfx->height();  // 240
  bufSize = screenWidth * screenHeight;

  disp_draw_buf = (lv_color_t *)heap_caps_malloc(bufSize * sizeof(lv_color_t),
                                                 MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
  if (!disp_draw_buf) disp_draw_buf = (lv_color_t *)heap_caps_malloc(bufSize * sizeof(lv_color_t), MALLOC_CAP_8BIT);
  if (!disp_draw_buf) {
    Serial.println("LVGL disp_draw_buf allocate failed!");
  } else {
    lv_disp_draw_buf_init(&draw_buf, disp_draw_buf, NULL, bufSize);
    lv_disp_drv_init(&disp_drv);
    disp_drv.hor_res = screenWidth;
    disp_drv.ver_res = screenHeight;
    disp_drv.flush_cb = my_disp_flush;
    disp_drv.draw_buf = &draw_buf;
    disp_drv.direct_mode = true;
    lv_disp_drv_register(&disp_drv);

    static lv_indev_drv_t indev_drv;
    lv_indev_drv_init(&indev_drv);
    indev_drv.type = LV_INDEV_TYPE_POINTER;
    indev_drv.read_cb = my_touchpad_read;
    lv_indev_drv_register(&indev_drv);
  }

  // Relays + initial display
  pinMode(PIN_RELAY_A, OUTPUT);
  pinMode(PIN_RELAY_B, OUTPUT);
  displayGreen = false; // Start with red (standby)
  apply_relays();

  // Bridge button setup
  pinMode(PIN_BRIDGE_DRIVE, OUTPUT);
  digitalWrite(PIN_BRIDGE_DRIVE, LOW);         // drive GPIO6 LOW
  pinMode(PIN_BRIDGE_SENSE, INPUT_PULLUP);     // sense GPIO16; HIGH released, LOW when shorted to 6

  // init debounce baselines
  btnStable = digitalRead(PIN_BRIDGE_SENSE);
  btnLastRaw = btnStable;
  btnLastChange = millis();

  // Initial screen setup
  deviceState.currentMessage = "Starting...";
  screenState.lastActivityTime = millis(); // Initialize activity timer
  connectionState.lastHeartbeat = millis(); // Initialize connection monitoring
  connectionState.lastConnectAttempt = 0;
  connectionState.isReconnecting = false;
  update_screen_display();

  // Connect to WiFi (MQTT connection will be initiated from onWiFiConnected)
  connectToWiFi();

  Serial.println("📱 Device ready. Touch screen or press button when picking assigned.");
  Serial.println("🔄 MQTT system provides real-time activation for immediate response!");
}

// --- Loop ---
void loop() {
  lv_timer_handler();
  check_bridge_button();
  check_screen_timeout(); // Check if screen should timeout during red/standby modes
  check_completed_timeout(); // Check if device should return from completed to standby

  // MQTT message handling
  if (mqttClient.connected()) {
    mqttClient.loop(); // Handle MQTT messages and keep connection alive
  }
  
  // Connection health monitoring and reconnection
  checkConnectionHealth(); // Monitor WiFi and MQTT, handle reconnections
  ensureConnectionStability(); // Ensure we stay connected

  // WiFi reconnection handler - continuously monitor and attempt reconnection
  if (WiFi.status() != WL_CONNECTED) {
    // WiFi is down - attempt reconnection
    attemptWiFiReconnection();
  } else {
    // WiFi is up - ensure MQTT is also connected
    if (!mqttClient.connected() && !connectionState.isReconnecting) {
      ensureConnectionStability();
    }
  }

  delay(10); // Small delay to prevent watchdog issues
}