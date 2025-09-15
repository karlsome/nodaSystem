# Warehouse Management System - Worker Portal

A responsive, intuitive warehouse management system designed for warehouse workers using laptops or Android tablets with QR code scanning capabilities.

## Features

### 🎯 Core Functionality
- **Incoming Materials Registration**: Process materials arriving at the warehouse
- **Outgoing Materials Processing**: Handle materials leaving the warehouse
- **Dual Input Methods**: QR code scanning and manual entry for flexibility
- **Real-time Activity Tracking**: Monitor all warehouse operations
- **Touch-Optimized Interface**: Designed for tablet and mobile devices

### 📱 Device Support
- **Laptops**: Full desktop experience with keyboard shortcuts
- **Android Tablets**: Touch-optimized interface with large buttons
- **Mobile Devices**: Responsive design that works on smaller screens

### 🔍 QR Code Integration
- QR scanner acts as keyboard input device
- Automatic processing of scanned data
- Fallback to manual entry for items without QR codes
- Real-time validation and feedback

### 📊 Dashboard Features
- **Real-time Statistics**: Today's incoming/outgoing counts
- **Recent Activity Feed**: Live updates of all operations
- **Quick Action Buttons**: One-tap access to common tasks
- **Time Tracking**: Automatic timestamps for all activities

## File Structure

```
nodaSystem/
├── index.html          # Main application interface
├── script.js          # Application logic and interactions
├── styles.css         # Custom styles and responsive design
└── README.md          # Documentation
```

## Usage

### Getting Started
1. Open `index.html` in a web browser
2. The system will display the main dashboard with current statistics
3. Use the large action buttons to process incoming or outgoing materials

### Processing Incoming Materials
1. Click "Incoming Materials" card
2. Choose between:
   - **Scan QR Code**: For items with QR codes
   - **Manual Entry**: For items without QR codes
3. Fill in the required information
4. Submit to record the transaction

### Processing Outgoing Materials
1. Click "Outgoing Materials" card
2. Choose scanning or manual entry method
3. Complete the form with item details
4. Submit to process the outgoing material

### Keyboard Shortcuts
- `Ctrl/Cmd + 1`: Scan incoming materials
- `Ctrl/Cmd + 2`: Scan outgoing materials
- `Ctrl/Cmd + 3`: Manual entry for incoming
- `Ctrl/Cmd + 4`: Manual entry for outgoing
- `Escape`: Close current modal

## QR Code Format

The system expects QR codes in the following format:
```
ITEM_CODE|ITEM_NAME|QUANTITY|LOCATION
```

Example:
```
SP001|Steel Pipes|50|A1
```

## Browser Compatibility

- **Chrome**: Fully supported
- **Firefox**: Fully supported
- **Safari**: Fully supported
- **Edge**: Fully supported
- **Mobile Browsers**: Optimized for touch interfaces

## Technical Features

### Responsive Design
- Mobile-first approach
- Tailwind CSS for consistent styling
- Touch-friendly button sizes (minimum 48px)
- Adaptive grid layouts

### Accessibility
- High contrast mode support
- Keyboard navigation
- Focus indicators
- Screen reader friendly
- Reduced motion support

### Performance
- Lightweight vanilla JavaScript
- CDN-delivered dependencies
- Optimized for tablet performance
- Minimal resource usage

## Future Enhancements

### Phase 2 Features
- [ ] Real QR code scanner integration
- [ ] Offline mode with data synchronization
- [ ] Barcode support
- [ ] Print labels functionality
- [ ] Advanced search and filtering

### Phase 3 Features
- [ ] Admin dashboard integration
- [ ] Inventory level tracking
- [ ] Automated alerts and notifications
- [ ] Advanced reporting and analytics
- [ ] Multi-warehouse support

### Phase 4 Features
- [ ] Voice commands
- [ ] AI-powered item recognition
- [ ] Predictive analytics
- [ ] Integration with external systems
- [ ] Advanced workflow automation

## Installation

### Simple Setup
1. Clone or download the repository
2. Open `index.html` in any modern web browser
3. No build process or dependencies required

### Web Server Setup (Optional)
For production use, serve the files through a web server:

```bash
# Using Python
python -m http.server 8000

# Using Node.js (with http-server)
npx http-server

# Using PHP
php -S localhost:8000
```

## Customization

### Styling
- Modify `styles.css` for custom styling
- Adjust Tailwind configuration in `index.html`
- Update color scheme in the Tailwind config

### Functionality
- Extend `script.js` for additional features
- Modify QR code format handling
- Add new form fields or validation rules

## Support

For issues, questions, or feature requests, please refer to the project documentation or contact the development team.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
