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

    if (!streamName || !inputSource || !destination || ((destination === 'youtube' || destination === 'facebook' || destination === 'instagram') && !streamKey)) {
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
    const container = document.querySelector('.preview-container-modern') || document.querySelector('.preview-container');
    if (!container) return;
    
    const errorDiv = document.createElement('div');
    errorDiv.className = 'preview-error';
    errorDiv.innerHTML = `<strong>Error:</strong> ${message}`;
    
    const existingError = container.querySelector('.preview-error');
    if (existingError) {
        existingError.remove();
    }
    
    container.appendChild(errorDiv);
}

function clearPreviewError() {
    const container = document.querySelector('.preview-container-modern') || document.querySelector('.preview-container');
    if (!container) return;
    
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
        'active': 'status-active',
        'warning': 'status-warning',
        'failed': 'status-failed',
        'restarting': 'status-active'
    };
    return `status-badge ${statusClasses[status] || 'status-active'}`;
}

function formatHealthData(health) {
    if (!health) return '<span class="text-muted">No data</span>';
    
    const lastCheck = health.last_health_check ? new Date(health.last_health_check).toLocaleTimeString() : 'N/A';
    
    return `
        <div class="stream-health-modern">
            <div class="health-metric"><span>FPS:</span><span>${health.fps || 0}</span></div>
            <div class="health-metric"><span>Bitrate:</span><span>${health.bitrate || '0 kb/s'}</span></div>
            <div class="health-metric"><span>Restarts:</span><span>${health.restart_count || 0}</span></div>
            ${health.last_error ? `<div class="health-metric text-danger"><span>Error:</span><span>${health.last_error.slice(0, 30)}...</span></div>` : ''}
        </div>
    `;
}

function createStreamElement(name, data) {
    const row = document.createElement('tr');
    
    // Format destination with emoji
    const destinationIcons = {
        'youtube': '🔴 YouTube',
        'facebook': '📘 Facebook',
        'instagram': '📷 Instagram',
        'x': '❌ X Live',
        'custom': '🌐 Custom'
    };
    const formattedDestination = destinationIcons[data.destination] || data.destination;
    
    row.innerHTML = `
        <td><strong>${name}</strong></td>
        <td>${formattedDestination}</td>
        <td><span class="${getStatusBadgeClass(data.status)}">${data.status}</span></td>
        <td>${data.owner}</td>
        <td>${formatHealthData(data.health)}</td>
        <td>
            <button class="btn-modern btn-secondary-modern" onclick="handleStopStream('${name}')" style="padding: 6px 12px; font-size: 0.8rem;">🛑 Stop</button>
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
