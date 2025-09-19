from flask import Flask, render_template, redirect, url_for, request, flash, jsonify
from flask_socketio import SocketIO
from flask_cors import CORS
from flask_login import LoginManager, login_user, logout_user, login_required, UserMixin, current_user
from werkzeug.security import generate_password_hash, check_password_hash
import json
import os
from stream_manager import StreamManager
from predefined_streams import RTMP_STREAMS, M3U8_STREAMS

# Initialize Flask app and other components
app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('FLASK_SECRET_KEY', 'your-secret-key')
CORS(app)
socketio = SocketIO(app)
login_manager = LoginManager(app)
login_manager.login_view = 'login'

# Initialize the stream manager
stream_manager = StreamManager(socketio)

# Load or initialize user data
USER_DATA_FILE = 'user_data.json'
if os.path.exists(USER_DATA_FILE):
    with open(USER_DATA_FILE, 'r') as f:
        users = json.load(f)
else:
    # Default master_admin account
    users = {
        "master_admin": {"password": generate_password_hash("masterpassword"), "role": "master_admin"}
    }
    with open(USER_DATA_FILE, 'w') as f:
        json.dump(users, f)

class User(UserMixin):
    def __init__(self, username, role):
        self.id = username
        self.role = role

@login_manager.user_loader
def load_user(user_id):
    user_data = users.get(user_id)
    if user_data:
        return User(user_id, user_data["role"])
    return None

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        
        user_data = users.get(username)
        if user_data and check_password_hash(user_data["password"], password):
            user = User(username, user_data["role"])
            login_user(user)
            return redirect(url_for('index'))
        else:
            flash('Invalid username or password')
    
    return render_template('login.html')

@app.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('login'))

@app.route('/')
@login_required
def index():
    return render_template(
        'index.html', 
        rtmp_streams=RTMP_STREAMS, 
        m3u8_streams=M3U8_STREAMS, 
        users=users if current_user.role in ['master_admin', 'admin'] else None
    )

@app.route('/add_user', methods=['POST'])
@login_required
def add_user():
    if current_user.role != 'master_admin':
        flash('Only the master admin can add users.')
        return redirect(url_for('index'))

    username = request.form.get('username')
    password = request.form.get('password')
    role = request.form.get('role')

    if username in users:
        flash('User already exists.')
    else:
        users[username] = {"password": generate_password_hash(password), "role": role}
        with open(USER_DATA_FILE, 'w') as f:
            json.dump(users, f)
        flash('User added successfully.')
    
    return redirect(url_for('index'))

@app.route('/delete_user', methods=['POST'])
@login_required
def delete_user():
    if current_user.role != 'master_admin':
        flash('Only the master admin can delete users.')
        return redirect(url_for('index'))

    username = request.form.get('username')
    if username in users and username != 'master_admin':
        del users[username]
        with open(USER_DATA_FILE, 'w') as f:
            json.dump(users, f)
        flash('User deleted successfully.')
    else:
        flash('Cannot delete this user.')

    return redirect(url_for('index'))

@app.route('/change_password', methods=['GET', 'POST'])
@login_required
def change_password():
    if request.method == 'POST':
        new_password = request.form.get('new_password')
        users[current_user.id]['password'] = generate_password_hash(new_password)
        with open(USER_DATA_FILE, 'w') as f:
            json.dump(users, f)
        flash('Password updated successfully.')
        return redirect(url_for('index'))

    return render_template('change_password.html')

# Socket.IO Events

@socketio.on('start_stream')
@login_required
def handle_start_stream(data):
    stream_name = data.get('stream_name')
    input_source = data.get('input')
    destination = data.get('destination')
    stream_key = data.get('stream_key')
    
    success = stream_manager.start_stream(
        stream_name, input_source, destination, stream_key, owner=current_user.id
    )
    return {'success': success}

@socketio.on('stop_stream')
@login_required
def handle_stop_stream(data):
    stream_name = data.get('stream_name')
    user_role = current_user.role
    user_id = current_user.id
    
    success, message = stream_manager.stop_stream(stream_name, user_role, user_id)
    return {'success': success, 'message': message}

@socketio.on('get_stream_status')
@login_required
def handle_stream_status(data=None):
    streams = stream_manager.get_active_streams()
    return streams

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    socketio.run(app, host='0.0.0.0', port=port, debug=False, use_reloader=False, log_output=False)
