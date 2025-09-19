import subprocess
import threading
import shlex
import time
import select
import os
import fcntl
from datetime import datetime, timezone

class StreamManager:
    def __init__(self, socketio):
        self.active_streams = {}
        self.socketio = socketio
        self.max_restart_attempts = 3  # Maximum restart attempts before giving up
        self.restart_delay = 5  # Delay in seconds between restarts

    def start_stream(self, stream_name, input_source, destination, stream_key, owner, source_name=None):
        if stream_name in self.active_streams:
            print(f"Stream '{stream_name}' is already running.")
            return False

        command = self._build_ffmpeg_command(input_source, destination, stream_key)
        # Log command without exposing stream key
        safe_command = command.replace(stream_key, '[STREAM_KEY_REDACTED]') if stream_key else command
        print(f"Starting stream '{stream_name}' with command: {safe_command}")

        try:
            process = subprocess.Popen(
                shlex.split(command),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                universal_newlines=True
            )

            self.active_streams[stream_name] = {
                'process': process,
                'input': input_source,
                'destination': destination,
                'stream_key': stream_key,
                'status': 'active',
                'owner': owner,
                'source_name': source_name or 'Unknown',
                'start_time': datetime.now(timezone.utc).isoformat(),
                'health': {
                    'fps': 0,
                    'bitrate': '0 kb/s',
                    'last_error': None,
                    'restart_count': 0,
                    'last_restart': None,
                    'last_health_check': datetime.now(timezone.utc).isoformat()
                }
                # No terminate flag on fresh start
            }
            print(f"Stream '{stream_name}' started successfully.")
            # Start monitoring the stream
            threading.Thread(
                target=self._monitor_stream,
                args=(stream_name, process),
                daemon=True
            ).start()
            return True

        except Exception as e:
            print(f"Error starting stream '{stream_name}': {e}")
            return False

    def stop_stream(self, stream_name, user_role, user_id):
        stream = self.active_streams.get(stream_name)
        if not stream:
            return False, 'Stream not found'

        # Permission check: allow master_admin, admin, or owner of the stream
        if user_role not in ['master_admin', 'admin'] and stream['owner'] != user_id:
            return False, 'Permission denied'

        # Stop the stream process with timeout
        try:
            process = stream['process']
            process.terminate()
            
            # Wait for process to terminate with timeout
            try:
                process.wait(timeout=3)  # Wait up to 3 seconds
            except subprocess.TimeoutExpired:
                # If it doesn't terminate gracefully, force kill
                process.kill()
                process.wait()
                
            print(f"Stream '{stream_name}' stopped successfully.")
        except Exception as e:
            print(f"Error stopping stream '{stream_name}': {e}")
            
        # Remove from active streams and notify
        del self.active_streams[stream_name]
        self.socketio.emit('stream_status_update', self.get_active_streams())
        return True, 'Stream stopped successfully'

    def get_active_streams(self):
        # Return active streams with owner info for frontend permissions
        return {
            name: {
                'input': info['input'],
                'destination': info['destination'],
                'status': info['status'],
                'owner': info['owner'],
                'source_name': info.get('source_name', 'Unknown'),
                'start_time': info.get('start_time'),
                'health': info['health']
            }
            for name, info in self.active_streams.items()
        }

    def _build_ffmpeg_command(self, input_source, destination, stream_key):
        # Build the appropriate FFmpeg command based on destination
        if destination == "youtube":
            return (
                f'ffmpeg -re -i {input_source} -c:v copy -c:a copy -g 60  '
                f'-f flv rtmp://a.rtmp.youtube.com/live2/{stream_key}'
            )
        elif destination == "facebook":
            return (
                f'ffmpeg -re -i {input_source} -c:v copy -c:a copy -g 60  '
                f'-f flv rtmps://live-api-s.facebook.com:443/rtmp/{stream_key}'
            )
        elif destination == "instagram":
            return (
                f'ffmpeg -re -i {input_source} -c:v copy -c:a copy -g 60 '
                f'-f flv rtmps://live-upload.instagram.com:443/rtmp/{stream_key}'
            )
        else:
            # Custom or RTMP destination
            return (
                f'ffmpeg -re -i {input_source} -c:v copy -c:a copy -g 60 '
                f'-f flv {destination}/{stream_key}'
            )

    def _monitor_stream(self, stream_name, process):
        """Monitor a running stream's FFmpeg output and update its status."""
        last_activity = datetime.now(timezone.utc)
        heartbeat_timeout = 30  # seconds without activity before marking as failed
        
        # Make stderr non-blocking
        fd = process.stderr.fileno()
        fl = fcntl.fcntl(fd, fcntl.F_GETFL)
        fcntl.fcntl(fd, fcntl.F_SETFL, fl | os.O_NONBLOCK)
        
        partial_line = ""
        
        while process.poll() is None:
            # Check if process should be terminated due to fatal error
            stream = self.active_streams.get(stream_name)
            if stream and stream.get('_terminate_requested'):
                print(f"Terminating stream '{stream_name}' due to fatal error")
                try:
                    process.terminate()
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill()
                break
            
            # Non-blocking read with timeout
            ready, _, _ = select.select([process.stderr], [], [], 1.0)
            
            if ready:
                try:
                    chunk = process.stderr.read(1024)
                    if chunk:
                        last_activity = datetime.now(timezone.utc)
                        partial_line += chunk
                        
                        # Process complete lines (both \n and \r as delimiters)
                        while '\n' in partial_line or '\r' in partial_line:
                            if '\n' in partial_line:
                                line, partial_line = partial_line.split('\n', 1)
                            else:
                                line, partial_line = partial_line.split('\r', 1)
                            
                            if line.strip():
                                self._update_stream_stats(stream_name, line.strip())
                except (BlockingIOError, OSError):
                    pass
            
            # Check for heartbeat timeout
            time_since_activity = (datetime.now(timezone.utc) - last_activity).total_seconds()
            if time_since_activity > heartbeat_timeout:
                print(f"Stream '{stream_name}' appears dead - no activity for {time_since_activity:.1f}s")
                try:
                    process.terminate()
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill()
                break

        # If stream ends unexpectedly, check for restarts
        if stream_name in self.active_streams:
            stream = self.active_streams[stream_name]
            if stream['health']['restart_count'] < self.max_restart_attempts:
                stream['health']['restart_count'] += 1
                stream['health']['last_restart'] = datetime.now(timezone.utc).isoformat()
                print(f"Stream '{stream_name}' failed, attempting restart... (Attempt {stream['health']['restart_count']})")
                time.sleep(self.restart_delay)  # Add a delay before restarting
                self._restart_stream(stream_name)
            else:
                stream['status'] = 'failed'
                print(f"Stream '{stream_name}' failed after maximum retries.")
                self.socketio.emit('stream_status_update', self.get_active_streams())
                del self.active_streams[stream_name]

    def _update_stream_stats(self, stream_name, log_line):
        """Extract and update stream stats from FFmpeg log output."""
        stream = self.active_streams.get(stream_name)
        if not stream:
            return

        # Parse FPS
        if "fps=" in log_line:
            fps_value = log_line.split("fps=")[1].split()[0]
            try:
                stream['health']['fps'] = int(float(fps_value))
            except ValueError:
                print(f"Could not parse FPS from log: {fps_value}")

        # Parse bitrate
        if "bitrate=" in log_line:
            bitrate = log_line.split("bitrate=")[1].split()[0]
            stream['health']['bitrate'] = bitrate

        # Parse errors and specific failure conditions
        if 'error' in log_line.lower():
            stream['health']['last_error'] = log_line
            stream['status'] = 'warning'
            
        # Check for specific input/connection failures
        if any(failure in log_line.lower() for failure in [
            'connection refused', 'connection reset', 'no such file or directory',
            'input/output error', 'server returned 404', 'server returned 403',
            'rtmp_connect_stream', 'invalid data found', 'connection timed out',
            'end of file'
        ]):
            stream['health']['last_error'] = log_line
            stream['status'] = 'failed'
            stream['_terminate_requested'] = True  # Signal monitor to terminate process
            print(f"Stream '{stream_name}' detected fatal error: {log_line}")

        # Update health check timestamp
        stream['health']['last_health_check'] = datetime.now(timezone.utc).isoformat()
        self.socketio.emit('stream_status_update', self.get_active_streams())

    def _restart_stream(self, stream_name):
        stream = self.active_streams.get(stream_name)
        if not stream:
            return

        # Restart the FFmpeg process
        command = self._build_ffmpeg_command(
            stream['input'], stream['destination'], stream['stream_key']
        )
        try:
            new_process = subprocess.Popen(
                shlex.split(command),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                universal_newlines=True
            )
            stream['process'] = new_process
            stream['status'] = 'active'
            # Reset start_time for the new FFmpeg session
            stream['start_time'] = datetime.now(timezone.utc).isoformat()
            # Clear any previous termination flags and errors
            stream.pop('_terminate_requested', None)
            stream['health']['last_error'] = None
            stream['health']['fps'] = 0
            stream['health']['bitrate'] = '0 kb/s'

            # Start monitoring the new process
            threading.Thread(
                target=self._monitor_stream,
                args=(stream_name, new_process),
                daemon=True
            ).start()

        except Exception as e:
            stream['status'] = 'failed'
            stream['health']['last_error'] = str(e)
            print(f"Error restarting stream '{stream_name}': {e}")

        self.socketio.emit('stream_status_update', self.get_active_streams())
