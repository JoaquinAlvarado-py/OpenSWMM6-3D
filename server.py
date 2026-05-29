import http.server
import socketserver
import os
import json

PORT = 8080
PUBLIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'public')

class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC_DIR, **kwargs)

    def do_GET(self):
        if self.path == '/api/status':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "running", "msg": "3D Map Prototype Server Online"}).encode())
        else:
            super().do_GET()

if __name__ == '__main__':
    # Ensure public folder exists
    os.makedirs(PUBLIC_DIR, exist_ok=True)
    
    print(f"Starting server on http://localhost:{PORT}")
    print(f"Serving files from: {PUBLIC_DIR}")
    
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), CustomHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server.")
            httpd.server_close()
