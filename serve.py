#!/usr/bin/env python3
"""Local dev server for the tracker.

    python serve.py

Serves this folder on every network interface so you can open it on your phone
over Wi-Fi, and prints the URL to use. Two things it does that Python's stock
``http.server`` does not:

  * Forces correct MIME types. On Windows, Python reads ``.js`` from the
    registry, which some installs map to ``text/plain`` — that breaks ES
    modules with a confusing error.
  * Sends no-cache headers, so a refresh on the phone actually shows your edit.

This is a dev convenience only. It is not part of the deployed app: GitHub
Pages serves the same folder as plain static files.
"""

import http.server
import socket
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000

TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
}


class Handler(http.server.SimpleHTTPRequestHandler):
    def guess_type(self, path):
        for ext, mime in TYPES.items():
            if path.endswith(ext):
                return mime
        return super().guess_type(path)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Service-Worker-Allowed", "/")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("  %s\n" % (fmt % args))


def lan_ip():
    """Best guess at this machine's address on the local network."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))  # no packet is actually sent
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    with Server(("0.0.0.0", PORT), Handler) as httpd:
        print("\n  Fitness tracker dev server\n")
        print(f"    this machine   http://localhost:{PORT}/")
        print(f"    your phone     http://{lan_ip()}:{PORT}/")
        print("\n  Phone must be on the same Wi-Fi. Ctrl+C to stop.\n")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n  Stopped.\n")
