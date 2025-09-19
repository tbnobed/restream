# RE-STREAM LIVE - Live Streaming Management Application

## Overview
This is a Flask-based web application for managing live streaming workflows. It allows users to restream content from RTMP/HLS sources to popular platforms like YouTube, Facebook, and custom RTMP destinations using FFmpeg. The application features user authentication, role-based permissions, and real-time stream monitoring via WebSockets.

## Recent Changes (2025-09-19)
- ✅ Imported from GitHub and configured for Replit environment
- ✅ Installed Python 3.11 and all required dependencies
- ✅ Installed FFmpeg system dependency for video processing
- ✅ Fixed port configuration to use port 5000 (required for Replit)
- ✅ Set up Flask Server workflow for automatic startup
- ✅ Configured deployment settings for autoscale deployment
- ✅ Application successfully running and accessible

## Project Architecture

### Backend (Flask)
- **Framework**: Flask with Socket.IO for real-time communication
- **Authentication**: Flask-Login with role-based permissions (master_admin, admin, general)
- **Security**: Werkzeug for password hashing
- **Cross-origin**: Flask-CORS for handling cross-origin requests

### Frontend
- **Technology**: HTML5, Bootstrap (dark theme), vanilla JavaScript
- **Real-time**: Socket.IO client for live stream status updates
- **Video**: HLS.js for video preview functionality

### Key Files
- `main.py`: Main Flask application with routes and Socket.IO handlers
- `stream_manager.py`: Handles FFmpeg processes and stream monitoring
- `predefined_streams.py`: Contains predefined RTMP and M3U8 stream configurations
- `templates/`: HTML templates for login, dashboard, and management pages
- `static/`: CSS, JavaScript, and image assets
- `user_data.json`: User credentials and roles (excluded from git)

### System Requirements
- **Python**: 3.11+
- **FFmpeg**: Required for video processing and streaming
- **Dependencies**: Flask, Flask-SocketIO, Flask-Login, Flask-CORS, Werkzeug

## User Roles & Default Credentials
- **master_admin**: Full system control, user management (default: username="master_admin", password="masterpassword")
- **admin**: Stream management and some administrative functions
- **general**: Basic stream operations only

## Stream Configuration
The application comes with predefined stream sources:
- Multiple Plex streams (RTMP inputs with M3U8 previews)
- MSM Live stream
- Support for custom RTMP inputs and destinations

## Deployment
- **Target**: Autoscale (suitable for web applications)
- **Port**: 5000 (required for Replit environment)
- **Host**: 0.0.0.0 (allows external access)
- **Production**: Uses production-ready settings with disabled debug mode

## Current State
✅ **OPERATIONAL**: Application is successfully running on port 5000 with all dependencies installed and properly configured for the Replit environment.