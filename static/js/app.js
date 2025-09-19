let socket = io();
let activeStreamData = {};
let hls = null;

// Wait for DOM to be fully loaded
window.addEventListener('load', function() {
    initializeControls();
    initializeSocketListeners();
});

async function testStreamConnection(url) {
    // Skip connection test to avoid CORS issues
    // Let HLS.js handle the stream loading and error handling directly
    return true;
}

function initializeControls() {
    const elements = {
        startButton: document.getElementById('startStream'),
        inputSelect: document.getElementById('inputSource'),
        customInput: document.getElementById('customInput'),
        destination: document.getElementById('destination'),
        customDestination: document.getElementById('customDestination'),
        streamKey: document.getElementById('streamKey'),
    };

    // Handle input source changes
    elements.inputSelect.addEventListener('change', function() {
        const selectedOption = this.options[this.selectedIndex];
        const customInput = elements.customInput;

        if (this.value === 'custom') {
            customInput.classList.remove('d-none');
            stopPreview();
        } else {
            customInput.classList.add('d-none');
            if (selectedOption.dataset.preview) {
                initializeHLSPlayer(selectedOption.dataset.preview);
            }
        }
    });

    // Handle destination changes
    elements.destination.addEventListener('change', function() {
        const customDestination = elements.customDestination;
        const streamKeyField = elements.streamKey;

        if (this.value === 'custom') {
            customDestination.classList.remove('d-none');
            streamKeyField.parentElement.classList.add('d-none');
        } else {
            customDestination.classList.add('d-none');
            streamKeyField.parentElement.classList.remove('d-none');
        }
    });

    // Start Stream Button Click
    elements.startButton.addEventListener('click', handleStartStream);
}

function handleStartStream() {
    const streamName = document.getElementById('streamName').value;
    const inputSource = document.getElementById('inputSource').value === 'custom' 
        ? document.getElementById('customInput').value 
        : document.getElementById('inputSource').value;
    const destination = document.getElementById('destination').value === 'custom'
        ? document.getElementById('customDestination').value
        : document.getElementById('destination').value;
    const streamKey = document.getElementById('streamKey').value;

    if (!streamName || !inputSource || !destination || ((destination === 'youtube' || destination === 'facebook') && !streamKey)) {
        alert('Please fill in all required fields.');
        return;
    }

    socket.emit('start_stream', {
        stream_name: streamName,
        input: inputSource,
        destination: destination,
        stream_key: streamKey
    });
}

function initializeSocketListeners() {
    socket.on('connect', () => {
        console.log('Connected to server');
        requestStreamStatus();
    });
    
    socket.on('stream_status_update', updateActiveStreams);
}

function showPreviewError(message) {
    const container = document.querySelector('.preview-container');
    const errorDiv = document.createElement('div');
    errorDiv.className = 'preview-error alert alert-danger m-2';
    errorDiv.innerHTML = `<strong>Error:</strong> ${message}`;
    
    const existingError = container.querySelector('.preview-error');
    if (existingError) {
        existingError.remove();
    }
    
    container.appendChild(errorDiv);
}

function clearPreviewError() {
    const container = document.querySelector('.preview-container');
    const errorDiv = container.querySelector('.preview-error');
    if (errorDiv) {
        errorDiv.remove();
    }
}

async function initializeHLSPlayer(url) {
    console.log('Testing stream connection:', url);
    const isAvailable = await testStreamConnection(url);
    if (!isAvailable) {
        showPreviewError('Stream is currently unavailable');
        return;
    }

    clearPreviewError();
    
    if (hls) {
        stopPreview();
    }
    
    const video = document.getElementById('videoPlayer');
    
    if (Hls.isSupported()) {
        hls = new Hls();
        
        hls.on(Hls.Events.ERROR, (event, data) => {
            console.error('HLS error:', data);
            if (data.fatal) {
                switch(data.type) {
                    case Hls.ErrorTypes.NETWORK_ERROR:
                        showPreviewError('Network error - stream may be unavailable');
                        break;
                    case Hls.ErrorTypes.MEDIA_ERROR:
                        showPreviewError('Media error - stream format issue');
                        break;
                    default:
                        showPreviewError('Stream playback error occurred');
                        break;
                }
                stopPreview();
            }
        });

        hls.loadSource(url);
        hls.attachMedia(video);
        
        video.play().catch((error) => {
            console.error('Video playback failed:', error);
            showPreviewError('Failed to start video playback');
        });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url;
        video.addEventListener('error', () => {
            showPreviewError('Playback error occurred');
        });
    } else {
        showPreviewError('HLS playback not supported');
    }
}

function stopPreview() {
    clearPreviewError();
    if (hls) {
        hls.destroy();
        hls = null;
    }
    const video = document.getElementById('videoPlayer');
    video.src = '';
}

function updateActiveStreams(streams) {
    const container = document.getElementById('activeStreams');
    container.innerHTML = '';
    
    Object.entries(streams).forEach(([name, data]) => {
        const streamElement = createStreamElement(name, data);
        container.appendChild(streamElement);
    });
}

function getStatusBadgeClass(status) {
    const statusClasses = {
        'active': 'bg-success',
        'warning': 'bg-warning',
        'failed': 'bg-danger',
        'restarting': 'bg-info'
    };
    return `badge ${statusClasses[status] || 'bg-secondary'}`;
}

function formatHealthData(health) {
    if (!health) return '';
    
    const lastCheck = health.last_health_check ? new Date(health.last_health_check).toLocaleTimeString() : 'N/A';
    const lastRestart = health.last_restart ? new Date(health.last_restart).toLocaleTimeString() : 'N/A';
    
    return `
        <div class="stream-health mt-2">
            <small class="text-muted">
                <div>FPS: ${health.fps || 0}</div>
                <div>Bitrate: ${health.bitrate || '0 kb/s'}</div>
                <div>Restart Count: ${health.restart_count || 0}</div>
                <div>Last Check: ${lastCheck}</div>
                ${health.last_restart ? `<div>Last Restart: ${lastRestart}</div>` : ''}
                ${health.last_error ? `<div class="text-danger">Last Error: ${health.last_error}</div>` : ''}
            </small>
        </div>
    `;
}

function createStreamElement(name, data) {
    const row = document.createElement('tr');
    row.innerHTML = `
        <td><strong>${name}</strong></td>
        <td>${data.destination}</td>
        <td><span class="${getStatusBadgeClass(data.status)}">${data.status}</span></td>
        <td>${data.owner}</td>
        <td>
            <button class="btn btn-danger btn-sm" onclick="handleStopStream('${name}')">Stop</button>
        </td>
    `;
    return row;
}

function handleStopStream(streamName) {
    socket.emit('stop_stream', { stream_name: streamName }, (response) => {
        if (response.success) {
            requestStreamStatus();
        } else {
            alert(response.message || 'Failed to stop stream');
        }
    });
}

function requestStreamStatus() {
    socket.emit('get_stream_status', {}, updateActiveStreams);
}
