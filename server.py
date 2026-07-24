import os
import sys
import json
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from http.server import SimpleHTTPRequestHandler, HTTPServer

class CustomHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # Add CORS headers to all responses
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        # Disable browser cache completely for development fluidness
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_POST(self):
        if self.path == '/api/send-email':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            try:
                data = json.loads(post_data.decode('utf-8'))
                to_email = data.get('to')
                subject = data.get('subject')
                html_content = data.get('html_content')
                smtp_host = data.get('smtp_host', 'smtp.gmail.com')
                smtp_port = int(data.get('smtp_port', 587))
                sender = data.get('sender', 'agendamento.transporte.eventos@gmail.com')
                password = data.get('password', '')

                # Check if there is a local config file for the password
                config_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'smtp_config.json')
                if os.path.exists(config_path):
                    try:
                        with open(config_path, 'r', encoding='utf-8') as f:
                            config_data = json.load(f)
                            if config_data.get('smtp_password'):
                                password = config_data.get('smtp_password').replace(' ', '').strip()
                                print("Loaded SMTP password from local smtp_config.json file (spaces stripped).")
                    except Exception as ec:
                        print(f"Error reading local smtp_config.json: {ec}")

                if password:
                    password = password.replace(' ', '').strip()

                if not password:
                    self.send_response(400)
                    self.end_headers()
                    self.wfile.write(json.dumps({'error': 'Senha do e-mail não configurada.'}).encode('utf-8'))
                    return

                # Create email message
                msg = MIMEMultipart('alternative')
                msg['Subject'] = subject
                msg['From'] = sender
                msg['To'] = to_email
                msg.attach(MIMEText(html_content, 'html'))

                # Connect to SMTP server
                print(f"Connecting to SMTP server {smtp_host}:{smtp_port}...")
                server = smtplib.SMTP(smtp_host, smtp_port)
                server.starttls()
                server.login(sender, password)
                server.sendmail(sender, to_email, msg.as_string())
                server.quit()
                print("Email sent successfully!")

                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps({'success': True}).encode('utf-8'))
            except Exception as e:
                print(f"Error sending email: {e}")
                self.send_response(500)
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode('utf-8'))
        elif self.path == '/api/ping':
            self.send_response(200)
            self.end_headers()
            self.wfile.write(json.dumps({'status': 'online', 'backend': 'python'}).encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()

def run(port=8000):
    server_address = ('', port)
    httpd = HTTPServer(server_address, CustomHandler)
    print(f"Conexão Transportes Custom Server running on port {port}...")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
        sys.exit(0)

if __name__ == '__main__':
    port = 8000
    if len(sys.argv) > 1:
        port = int(sys.argv[1])
    run(port)
