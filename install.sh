#!/bin/bash

# RE-STREAM LIVE - Installation Script
# This script installs all dependencies needed to run the application

set -e  # Exit on any error

echo "🚀 Starting RE-STREAM LIVE installation..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running as root
if [[ $EUID -eq 0 ]]; then
    print_warning "Running as root. This is not recommended for production."
fi

# Detect operating system
detect_os() {
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        if [ -f /etc/debian_version ]; then
            OS="debian"
        elif [ -f /etc/redhat-release ]; then
            OS="redhat"
        else
            OS="linux"
        fi
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        OS="macos"
    else
        OS="unknown"
    fi
}

# Install system dependencies
install_system_dependencies() {
    print_status "Installing system dependencies..."
    
    case $OS in
        "debian")
            print_status "Detected Debian/Ubuntu system"
            sudo apt-get update
            sudo apt-get install -y python3 python3-pip python3-venv ffmpeg
            ;;
        "redhat")
            print_status "Detected RedHat/CentOS/Fedora system"
            sudo yum install -y python3 python3-pip ffmpeg || sudo dnf install -y python3 python3-pip ffmpeg
            ;;
        "macos")
            print_status "Detected macOS system"
            if command -v brew >/dev/null 2>&1; then
                brew install python3 ffmpeg
            else
                print_error "Homebrew not found. Please install Homebrew first: https://brew.sh/"
                exit 1
            fi
            ;;
        *)
            print_error "Unsupported operating system: $OSTYPE"
            print_status "Please manually install: Python 3.11+, pip, and FFmpeg"
            exit 1
            ;;
    esac
    
    print_success "System dependencies installed successfully"
}

# Check Python version
check_python_version() {
    print_status "Checking Python version..."
    
    if command -v python3 >/dev/null 2>&1; then
        PYTHON_VERSION=$(python3 -c 'import sys; print(".".join(map(str, sys.version_info[:2])))')
        print_status "Found Python $PYTHON_VERSION"
        
        # Check if Python version is 3.8 or higher
        if python3 -c 'import sys; exit(0 if sys.version_info >= (3, 8) else 1)'; then
            print_success "Python version is compatible"
        else
            print_error "Python 3.8 or higher is required. Found: $PYTHON_VERSION"
            exit 1
        fi
    else
        print_error "Python 3 not found. Please install Python 3.8 or higher"
        exit 1
    fi
}

# Check FFmpeg installation
check_ffmpeg() {
    print_status "Checking FFmpeg installation..."
    
    if command -v ffmpeg >/dev/null 2>&1; then
        FFMPEG_VERSION=$(ffmpeg -version | head -n1 | cut -d' ' -f3)
        print_success "FFmpeg found: $FFMPEG_VERSION"
    else
        print_error "FFmpeg not found. This is required for video processing."
        exit 1
    fi
}

# Create virtual environment
create_virtual_environment() {
    print_status "Creating Python virtual environment..."
    
    if [ -d "venv" ]; then
        print_warning "Virtual environment already exists. Removing old one..."
        rm -rf venv
    fi
    
    python3 -m venv venv
    print_success "Virtual environment created"
}

# Install Python dependencies
install_python_dependencies() {
    print_status "Installing Python dependencies..."
    
    # Activate virtual environment
    source venv/bin/activate
    
    # Upgrade pip
    pip install --upgrade pip
    
    # Install requirements
    if [ -f "requirements.txt" ]; then
        pip install -r requirements.txt
        print_success "Python dependencies installed successfully"
    else
        print_error "requirements.txt not found"
        exit 1
    fi
}

# Set up application files
setup_application() {
    print_status "Setting up application..."
    
    # Create necessary directories if they don't exist
    mkdir -p static/css static/js static/img templates
    
    # Set permissions for user data file
    if [ ! -f "user_data.json" ]; then
        print_status "User data file will be created on first run"
    fi
    
    # Make sure the main application file exists
    if [ ! -f "main.py" ]; then
        print_error "main.py not found. Make sure you're in the correct directory."
        exit 1
    fi
    
    print_success "Application setup completed"
}

# Create startup script
create_startup_script() {
    print_status "Creating startup script..."
    
    cat > start.sh << 'EOF'
#!/bin/bash

# RE-STREAM LIVE - Startup Script

# Activate virtual environment
source venv/bin/activate

# Set default port if not specified
export PORT=${PORT:-5000}

# Set Flask environment
export FLASK_ENV=${FLASK_ENV:-production}

# Generate secret key if not set
if [ -z "$FLASK_SECRET_KEY" ]; then
    export FLASK_SECRET_KEY=$(python3 -c 'import secrets; print(secrets.token_hex(16))')
fi

echo "🚀 Starting RE-STREAM LIVE on port $PORT..."

# Start the application
python3 main.py
EOF
    
    chmod +x start.sh
    print_success "Startup script created (start.sh)"
}

# Create systemd service file (optional)
create_systemd_service() {
    if [[ "$OS" == "debian" ]] || [[ "$OS" == "redhat" ]]; then
        print_status "Creating systemd service file..."
        
        SERVICE_FILE="re-stream-live.service"
        CURRENT_DIR=$(pwd)
        CURRENT_USER=$(whoami)
        
        cat > $SERVICE_FILE << EOF
[Unit]
Description=RE-STREAM LIVE - Live Streaming Management Application
After=network.target

[Service]
Type=simple
User=$CURRENT_USER
WorkingDirectory=$CURRENT_DIR
Environment=PATH=$CURRENT_DIR/venv/bin
Environment=FLASK_ENV=production
Environment=PORT=5000
ExecStart=$CURRENT_DIR/venv/bin/python main.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
        
        print_success "Systemd service file created ($SERVICE_FILE)"
        print_status "To install as a system service, run:"
        print_status "  sudo cp $SERVICE_FILE /etc/systemd/system/"
        print_status "  sudo systemctl enable re-stream-live"
        print_status "  sudo systemctl start re-stream-live"
    fi
}

# Main installation process
main() {
    print_status "RE-STREAM LIVE Installation Script"
    print_status "=================================="
    
    # Detect OS
    detect_os
    print_status "Operating System: $OS"
    
    # Install system dependencies
    install_system_dependencies
    
    # Check installations
    check_python_version
    check_ffmpeg
    
    # Set up Python environment
    create_virtual_environment
    install_python_dependencies
    
    # Set up application
    setup_application
    
    # Create helper scripts
    create_startup_script
    create_systemd_service
    
    print_success "Installation completed successfully! 🎉"
    print_status ""
    print_status "Next steps:"
    print_status "1. Start the application: ./start.sh"
    print_status "2. Open your browser and go to: http://localhost:5000"
    print_status "3. Login with: username=master_admin, password=masterpassword"
    print_status ""
    print_status "Default credentials:"
    print_status "  Username: master_admin"
    print_status "  Password: masterpassword"
    print_status ""
    print_warning "IMPORTANT: Change the default password after first login!"
    print_status ""
    print_status "For production deployment:"
    print_status "- Set FLASK_SECRET_KEY environment variable"
    print_status "- Configure firewall to allow port 5000"
    print_status "- Consider using a reverse proxy (nginx/apache)"
    print_status "- Use the systemd service for auto-start"
}

# Run main function
main