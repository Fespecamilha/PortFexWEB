from app import app, init_db

try:
    init_db()
except Exception as e:
    print(f'DB init: {e}')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)
