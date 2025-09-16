/* ESP32-S3 Touch LCD (Waveshare) — Noda System IoT Device
 * - WiFi connected to Noda System server
 * - Socket.IO client for real-time communication
 * - Device ID: C74 (背番号)
 * - Default RED screen, GREEN when picking assigned
 * - Touch or button press completes picking task
 */

#include <lvgl.h>
#include <demos/lv_demos.h>
#include <Arduino_GFX_Library.h>
#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include "bsp_cst816.h"
#include "FreeSans14pt7b.h"  // Small font for device ID
#include "FreeSans50pt7b.h"  // Large font for quantity (with size multiplier)

// ---------- Forward declarations ----------
void handleDisplayUpdate(String jsonData);

// List of known SSIDs and passwords
const char* ssidList[] = {
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
const char* websockets_server = "192.168.0.64";
const int websockets_port = 3001;  // Local server port

// Device configuration
const String DEVICE_ID = "C74"; // 背番号 - Change for each device

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

// Socket.IO client
WebSocketsClient webSocket;

// Device state
struct DeviceState {
  bool isConnected = false;
  bool isPickingMode = false;
  int currentQuantity = 0;
  String requestNumber = "";
  int lineNumber = 0;
  String 品番 = "";
  String currentMessage = "Connecting...";
} deviceState;

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
  gfx->fillScreen(BLACK);
  gfx->flush();
  
  // Turn off LCD backlight completely for power saving
  ledcWrite(EXAMPLE_PIN_NUM_LCD_BL, 0); // 0% backlight = completely off
  
  screenState.isScreenOn = false;
  // Note: GPIO relays stay active, LCD backlight and display content are off
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
  if (!deviceState.isPickingMode) return;

  Serial.println("Completing picking task...");

  // Send completion to server
  DynamicJsonDocument doc(1024);
  doc["deviceId"] = DEVICE_ID;
  doc["requestNumber"] = deviceState.requestNumber;
  doc["lineNumber"] = deviceState.lineNumber;
  doc["completedBy"] = "IoT Device";

  String payload;
  serializeJson(doc, payload);
  webSocket.sendTXT("42[\"item-completed\"," + payload + "]");

  // Reset to standby mode
  deviceState.isPickingMode = false;
  deviceState.currentQuantity = 0;
  deviceState.requestNumber = "";
  deviceState.lineNumber = 0;
  deviceState.品番 = "";
  deviceState.currentMessage = "Completed";

  displayGreen = false;
  apply_relays();
  update_screen_activity(); // Reset screen timeout and wake up if needed
  update_screen_display();

  Serial.println("Task completed - returning to standby");
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
      update_screen_activity(); // Reset timeout and wake screen on touch
      if (deviceState.isPickingMode) {
        complete_picking_task();
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
      update_screen_activity(); // Reset timeout and wake screen on button press
      if (deviceState.isPickingMode) {
        complete_picking_task();
      }
    }
  }
}

// WiFi helpers
void onWiFiConnected() {
  Serial.println("WiFi connected!");
  Serial.print("IP address: ");
  Serial.println(WiFi.localIP());
  deviceState.currentMessage = "WiFi Connected";
  update_screen_activity(); // Reset timeout and wake screen
  update_screen_display();
}

void onWiFiDisconnected() {
  Serial.println("WiFi disconnected!");
  deviceState.isConnected = false;
  deviceState.currentMessage = "WiFi Disconnected";
  update_screen_activity(); // Reset timeout and wake screen
  update_screen_display();
}

// REST API status check - backup method
void checkDeviceStatusViaAPI() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi not connected, skipping API check");
    return;
  }
  
  HTTPClient http;
  String url = "http://" + String(websockets_server) + ":" + String(websockets_port) + "/api/device/" + DEVICE_ID + "/status";
  
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

// WebSocket event handlers
void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch(type) {
    case WStype_DISCONNECTED:
      Serial.println("WebSocket Disconnected");
      deviceState.isConnected = false;
      deviceState.currentMessage = "Server Disconnected";
      update_screen_activity(); // Wake screen and reset timeout
      update_screen_display();
      break;

    case WStype_CONNECTED:
      Serial.printf("WebSocket Connected to: %s\n", payload);
      deviceState.currentMessage = "Connecting...";
      update_screen_activity(); // Wake screen and reset timeout
      update_screen_display();
      break;

    case WStype_TEXT: {
      String message = String((char*)payload, length);
      Serial.printf("Received: %s\n", message.c_str());

      // Handle Socket.IO handshake
      if (message.startsWith("0{")) {
        Serial.println("Socket.IO handshake received, sending connect");
        webSocket.sendTXT("40"); // Socket.IO connect packet
        return;
      }
      
      // Handle Socket.IO connect confirmation
      if (message.startsWith("40")) {
        Serial.println("Socket.IO connected successfully");
        deviceState.isConnected = true;
        deviceState.currentMessage = "Connected";
        update_screen_activity(); // Wake screen and reset timeout
        update_screen_display();

        // Register device after successful connection
        DynamicJsonDocument doc(512);
        doc["deviceId"] = DEVICE_ID;
        doc["type"] = "iot-device";
        String regPayload;
        serializeJson(doc, regPayload);
        webSocket.sendTXT("42[\"device-register\"," + regPayload + "]");
        Serial.println("Device registration sent");
        
        // Also check status via REST API as backup after a short delay
        delay(2000); // Wait 2 seconds for Socket.IO registration to process
        Serial.println("🔄 Checking device status via REST API as backup...");
        checkDeviceStatusViaAPI();
        
        return;
      }

      // Handle Socket.IO events
      if (message.startsWith("42[\"display-update\",")) {
        int firstComma = message.indexOf(',');
        int lastBracket = message.lastIndexOf(']');
        if (firstComma > 0 && lastBracket > firstComma) {
          String jsonData = message.substring(firstComma + 1, lastBracket);
          handleDisplayUpdate(jsonData);
        }
      }
      
      // Handle Socket.IO ping
      if (message == "2") {
        webSocket.sendTXT("3"); // Send pong
        Serial.println("Socket.IO ping received, pong sent");
      }
      
      break; }

    default:
      break;
  }
}

void handleDisplayUpdate(String jsonData) {
  DynamicJsonDocument doc(1024);
  DeserializationError err = deserializeJson(doc, jsonData);
  if (err) {
    Serial.printf("JSON parse error: %s\n", err.c_str());
    return;
  }

  String color = doc["color"] | "";
  int quantity = doc["quantity"] | 0;
  String message = doc["message"] | "Standby";
  String requestNumber = doc["requestNumber"] | "";
  int lineNumber = doc["lineNumber"] | 0;
  String 品番 = doc["品番"] | "";

  Serial.printf("Display update: color=%s, qty=%d, msg=%s\n",
                color.c_str(), quantity, message.c_str());

  if (color == "green" && quantity > 0) {
    // Picking mode
    deviceState.isPickingMode = true;
    deviceState.currentQuantity = quantity;
    deviceState.requestNumber = requestNumber;
    deviceState.lineNumber = lineNumber;
    deviceState.品番 = 品番;
    deviceState.currentMessage = "Pick " + String(quantity);
    displayGreen = true;
    update_screen_activity(); // Wake screen immediately for new picking task
  } else {
    // Standby mode
    deviceState.isPickingMode = false;
    deviceState.currentQuantity = 0;
    deviceState.requestNumber = "";
    deviceState.lineNumber = 0;
    deviceState.品番 = "";
    deviceState.currentMessage = message;
    displayGreen = false;
    update_screen_activity(); // Reset timeout for standby mode
  }

  apply_relays();
  update_screen_display();
}

void connectToWiFi() {
  WiFi.mode(WIFI_STA);         // ensure station mode
  WiFi.disconnect(true, true); // clear stale state
  delay(100);

  Serial.println("Scanning for available networks...");
  int n = WiFi.scanNetworks();
  Serial.printf("Found %d networks\n", n);

  bool connected = false;

  for (int i = 0; i < numNetworks && !connected; i++) {
    for (int j = 0; j < n; j++) {
      if (WiFi.SSID(j) == String(ssidList[i])) {
        Serial.printf("Attempting to connect to: %s\n", ssidList[i]);

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
          Serial.printf("Connected to: %s\n", ssidList[i]);
          Serial.printf("IP address: %s\n", WiFi.localIP().toString().c_str());
          connected = true;
          onWiFiConnected();
          break;
        } else {
          Serial.println();
          Serial.printf("Failed to connect to: %s\n", ssidList[i]);
          WiFi.disconnect();
        }
        break;
      }
    }
  }

  if (!connected) {
    Serial.println("Could not connect to any known network!");
    deviceState.currentMessage = "WiFi Failed!";
    update_screen_activity(); // Wake screen for error message
    update_screen_display();
  }
}

void connectToServer() {
  // Use regular HTTP connection for local server
  webSocket.begin(websockets_server, websockets_port,
                  "/socket.io/?EIO=4&transport=websocket");
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000);

  Serial.printf("Connecting to server %s:%d\n", websockets_server, websockets_port);
  deviceState.currentMessage = "Connecting Server...";
  update_screen_activity(); // Wake screen during server connection
  update_screen_display();
}

// --- Setup ---
void setup() {
  Serial.begin(115200);
  Serial.println("ESP32-S3 Noda System IoT Device - ID: " + DEVICE_ID);

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
  update_screen_display();

  // Connect to WiFi and server
  connectToWiFi();
  connectToServer();

  Serial.println("Device ready. Touch screen or press button when picking assigned.");
}

// --- Loop ---
void loop() {
  lv_timer_handler();
  check_bridge_button();
  check_screen_timeout(); // Check if screen should timeout during red/standby modes

  // Socket.IO
  webSocket.loop();

  // WiFi reconnection
  if (WiFi.status() != WL_CONNECTED) {
    if (deviceState.isConnected) onWiFiDisconnected();
    static unsigned long lastReconnectAttempt = 0;
    if (millis() - lastReconnectAttempt > 5000) {
      Serial.println("Attempting WiFi reconnection...");
      WiFi.reconnect();
      lastReconnectAttempt = millis();
    }
  }

  // Comment out LVGL bitmap rendering since we're using Arduino_GFX directly
  /*
#if (LV_COLOR_16_SWAP != 0)
  gfx->draw16bitBeRGBBitmap(0, 0, (uint16_t *)disp_draw_buf, screenWidth, screenHeight);
#else
  gfx->draw16bitRGBBitmap(0, 0, (uint16_t *)disp_draw_buf, screenWidth, screenHeight);
#endif
  */
  
  delay(10);
}