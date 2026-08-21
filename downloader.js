const fs = require('fs');
const https = require('https');

function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath);
        const request = https.get(url, {
            headers: { 'User-Agent': 'RCLauncher/1.0.0' }
        }, (response) => {
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                return downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
            }
            if (response.statusCode !== 200) {
                reject(new Error(`Error al descargar: Código ${response.statusCode}`));
                return;
            }
            response.pipe(file);
            file.on('finish', () => { file.close(() => resolve()); });
        });
        request.on('error', (err) => {
            fs.unlink(destPath, () => reject(err));
        });
    });
}

module.exports = { downloadFile };