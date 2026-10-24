"""
Development helper to preview test pages and popup UI.
Starts a local HTTP server and opens Chrome directly with the test pages.
"""
import http.server
import socketserver
import webbrowser
import threading
import os
import sys

PORT = 3000
DIRECTORY = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

def start_server():
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"Test server running at http://localhost:{PORT}/")
        print(f"German Test Page:    http://localhost:{PORT}/test-pages/test-german.html")
        print(f"French Test Page:    http://localhost:{PORT}/test-pages/test-french.html")
        print(f"Spanish Test Page:   http://localhost:{PORT}/test-pages/test-spanish.html")
        print(f"Japanese Test Page:  http://localhost:{PORT}/test-pages/test-japanese.html")
        print(f"English Test Page:   http://localhost:{PORT}/test-pages/test-english.html")
        print(f"Dynamic SPA Test:    http://localhost:{PORT}/test-pages/test-dynamic.html")
        print(f"Popup UI Preview:    http://localhost:{PORT}/extension/popup.html")
        print("\nPress Ctrl+C to stop the server.")
        httpd.serve_forever()

if __name__ == "__main__":
    t = threading.Thread(target=start_server, daemon=True)
    t.start()
    webbrowser.open(f"http://localhost:{PORT}/test-pages/test-german.html")
    try:
        t.join()
    except KeyboardInterrupt:
        print("\nServer stopped.")
