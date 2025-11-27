# n8n Gentan Image Processing Setup

## Overview
The Gentan (原単) system uses real-time Socket.IO communication for image processing. Images are automatically sent to n8n after capture, and results are pushed back to the tablet in real-time.

## Architecture Flow

```
Tablet (Camera) 
    ↓ (1. Capture image)
    ↓ (2. Auto-send to server via HTTP)
Server (nodaServer.js)
    ↓ (3. Forward to n8n webhook - non-blocking)
    ↓ (4. Return job ID immediately)
Tablet ← Socket.IO (5. Wait for callback)
    ↑
n8n (Process image with OCR/AI)
    ↓ (6. Send result to callback endpoint)
Server (Receive callback)
    ↓ (7. Push result via Socket.IO)
Tablet (Update UI in real-time)
```

## n8n Workflow Configuration

### Step 1: Webhook Node (Trigger)
**Node Type:** Webhook  
**HTTP Method:** POST  
**Path:** `/webhook-test/7081d838-c11e-42f5-8c17-94c5ee557cf6`  
**Response Mode:** `Respond Immediately`

**Expected Input:**
- `image` - Image file (binary)
- `jobId` - Job identifier (string)

### Step 2: Image Processing
Add your image processing nodes here:
- OCR (Optical Character Recognition)
- AI/ML text extraction
- Data parsing and formatting

**Extract these fields:**
- 品番 (Product Code)
- 品名 (Product Name)
- 納入数 (Delivery Quantity)
- 納入日 (Delivery Date)
- 色番 (Color Code)

### Step 3: HTTP Request Node (Callback)
**Node Type:** HTTP Request  
**Method:** POST  
**URL:** `https://nodasystem.onrender.com/api/gentan/n8n-callback`  
**Content-Type:** `application/json`

**Body (JSON):**
```json
{
  "jobId": "{{ $node['Webhook'].json.jobId }}",
  "品番": "{{ $node['ProcessImage'].json.品番 }}",
  "品名": "{{ $node['ProcessImage'].json.品名 }}",
  "納入数": "{{ $node['ProcessImage'].json.納入数 }}",
  "納入日": "{{ $node['ProcessImage'].json.納入日 }}",
  "色番": "{{ $node['ProcessImage'].json.色番 }}"
}
```

## Server API Endpoints

### 1. Process Image (Tablet → Server)
**Endpoint:** `POST /api/gentan/process-image`  
**Headers:**
- `Content-Type: application/json`
- `X-Socket-Id: <socket.id>` (optional)

**Request Body:**
```json
{
  "image": "<base64-encoded-image>",
  "socketId": "<socket-id>"
}
```

**Response:**
```json
{
  "success": true,
  "jobId": "gentan-1234567890-abc123",
  "message": "画像を処理中です..."
}
```

### 2. n8n Callback (n8n → Server)
**Endpoint:** `POST /api/gentan/n8n-callback`  
**Content-Type:** `application/json`

**Request Body:**
```json
{
  "jobId": "gentan-1234567890-abc123",
  "品番": "0N4D52M6HF",
  "品名": "Sample Product",
  "納入数": "40.0m",
  "納入日": "25-06-01",
  "色番": "Color123"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Result received and forwarded to tablet"
}
```

### 3. Submit to MongoDB (Tablet → Server)
**Endpoint:** `POST /api/gentan/submit`  
**Content-Type:** `application/json`

**Request Body:**
```json
{
  "documents": [
    {
      "品番": "0N4D52M6HF",
      "品名": "Sample Product",
      "納入数": "40.0m",
      "納入日": "25-06-01",
      "色番": "Color123",
      "submittedBy": "Worker Name",
      "submittedAt": "2025-11-27T10:30:00.000Z",
      "sourceType": "image"
    }
  ]
}
```

## Socket.IO Events

### Client → Server
- `device-register` - Register tablet for Socket.IO communication

### Server → Client
- `gentan-processing-complete` - Image processing finished successfully
  ```javascript
  {
    jobId: "gentan-1234567890-abc123",
    data: {
      品番: "...",
      品名: "...",
      納入数: "...",
      納入日: "...",
      色番: "..."
    }
  }
  ```

- `gentan-processing-error` - Image processing failed
  ```javascript
  {
    jobId: "gentan-1234567890-abc123",
    error: "Error message"
  }
  ```

## MongoDB Collection

**Database:** `submittedDB`  
**Collection:** `nodaRawMaterialDB`

**Document Schema:**
```javascript
{
  _id: ObjectId,
  品番: String,           // Product code
  品名: String,           // Product name
  納入数: String,         // Delivery quantity
  納入日: String,         // Delivery date
  色番: String,           // Color code
  submittedBy: String,    // Worker name
  submittedAt: Date,      // Timestamp
  sourceType: String      // "image" or "barcode"
}
```

## Testing the Integration

1. **Test Image Upload:**
   ```bash
   curl -X POST https://nodasystem.onrender.com/api/gentan/process-image \
     -H "Content-Type: application/json" \
     -d '{"image":"<base64-image>","socketId":"test-socket"}'
   ```

2. **Test n8n Callback:**
   ```bash
   curl -X POST https://nodasystem.onrender.com/api/gentan/n8n-callback \
     -H "Content-Type: application/json" \
     -d '{
       "jobId":"test-job-123",
       "品番":"TEST001",
       "品名":"Test Product",
       "納入数":"10m",
       "納入日":"25-11-27",
       "色番":"RED"
     }'
   ```

## User Experience Flow

1. User clicks "写真を撮る" (Take Photo)
2. Camera opens (tablet camera)
3. User takes photo
4. **Auto-processing begins** (no manual button press needed)
5. Photo appears in left column with "処理中..." (Processing) status
6. n8n extracts text data
7. **Real-time update** - extracted data appears in right column automatically
8. Status changes to "処理済み" (Processed)
9. User can edit any field if needed
10. Click "データ送信" to submit all items to MongoDB

## Error Handling

- **Network errors:** Toast notification + retry available
- **n8n timeout:** 10-minute job cleanup
- **Socket disconnection:** Auto-reconnect via Socket.IO
- **Invalid image:** Error message via Socket.IO

## Notes

- Jobs are automatically cleaned up after 10 minutes
- Socket.IO provides automatic reconnection
- Images are processed asynchronously (non-blocking)
- Base64 encoding keeps image data manageable for HTTP transport
