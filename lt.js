const localtunnel = require('localtunnel');
const fs = require('fs');

(async () => {
  try {
    console.log("Starting tunnel with alternative host...");
    const tunnel = await localtunnel({ 
      port: 8000,
      host: 'https://lt.oldweb.today'
    });
    console.log("Tunnel started at URL:", tunnel.url);
    fs.writeFileSync('lt_url.txt', tunnel.url);
    
    tunnel.on('close', () => {
      console.log("Tunnel closed");
    });
  } catch (e) {
    console.error("Tunnel error:", e);
    fs.writeFileSync('lt_url.txt', "Error: " + e.message);
  }
})();
