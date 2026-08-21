const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');
const { downloadFile } = require('./downloader');
const launchGame = require('./gameLauncher');


function getOrCreateInstanceDir(appDataPath, instanceIdentifier) {
    const instancesRoot = path.join(appDataPath, 'instances');
    if (!fs.existsSync(instancesRoot)) {
        fs.mkdirSync(instancesRoot, { recursive: true });
    }

    if (!instanceIdentifier || typeof instanceIdentifier !== 'string' || instanceIdentifier.trim() === '') {
        return path.join(instancesRoot, `modpack_${Date.now()}`);
    }

    const cleanName = instanceIdentifier.replace(/^Modpack:\s*/i, '').trim();
    const safeName = cleanName.replace(/[^a-zA-Z0-9-_]/g, '_') || `modpack_${Date.now()}`;
    
    return path.join(instancesRoot, safeName);
}


ipcMain.on('download-mod', async (event, data) => {
    const { title, downloadUrl, instancePath } = data;
    try {
        const appDataPath = app.getPath('userData');
        const instanceDir = getOrCreateInstanceDir(appDataPath, instancePath);
        const modsDir = path.join(instanceDir, 'mods');
        
        if (!fs.existsSync(modsDir)) { 
            fs.mkdirSync(modsDir, { recursive: true }); 
        }

        const fileName = path.basename(new URL(downloadUrl).pathname) || `${title}.jar`;
        const destinationPath = path.join(modsDir, fileName);

        await downloadFile(downloadUrl, destinationPath, (percentage) => {
            event.sender.send('download-progress', { percentage });
        });

        console.log(`¡Mod descargado con éxito: ${title}!`);
        event.sender.send('download-complete', { title });
    } catch (error) {
        console.error(`Error al descargar el mod ${title}:`, error.message);
        event.sender.send('download-error', error.message);
    }
});


ipcMain.on('create-instance', async (event, data) => {
    const { name, version, hasZip, zipPath } = data;
    try {
        const appDataPath = app.getPath('userData');
        const instanceDir = getOrCreateInstanceDir(appDataPath, name);

        if (!fs.existsSync(instanceDir)) {
            fs.mkdirSync(instanceDir, { recursive: true });
        }
        const modsDir = path.join(instanceDir, 'mods');
        if (!fs.existsSync(modsDir)) {
            fs.mkdirSync(modsDir, { recursive: true });
        }

        if (hasZip && zipPath && fs.existsSync(zipPath)) {
            const zip = new AdmZip(zipPath);
            zip.extractAllTo(instanceDir, true);
            console.log(`¡Modpack ZIP extraído con éxito en la instancia ${name}!`);
        }

        const configPath = path.join(instanceDir, 'instance.json');
        fs.writeFileSync(configPath, JSON.stringify({ name, version, createdAt: new Date() }, null, 2));

        console.log(`¡Instancia "${name}" creada correctamente para la versión ${version}!`);
    } catch (error) {
        console.error(`Error al crear la instancia ${name}:`, error.message);
    }
});


ipcMain.on('download-modpack', async (event, data) => {
    const { title, downloadUrl, instancePath } = data; // <-- Recibimos instancePath correctamente
    try {
        const appDataPath = app.getPath('userData');
        

        const targetIdentifier = instancePath || title;
        const instanceDir = getOrCreateInstanceDir(appDataPath, targetIdentifier);
        const cleanTitle = title ? title.replace(/^Modpack:\s*/i, '').trim() : 'Modpack';

        if (!fs.existsSync(instanceDir)) {
            fs.mkdirSync(instanceDir, { recursive: true });
        }

        console.log(`[Modpack] Instalando estrictamente dentro de la instancia: ${instanceDir}`);

        const tempMrpackPath = path.join(instanceDir, 'temp_pack.mrpack');

        console.log(`[Modpack] Descargando .mrpack para: ${cleanTitle}`);
        await downloadFile(downloadUrl, tempMrpackPath, (percentage) => {
            event.sender.send('download-progress', { percentage });
        });

        console.log(`[Modpack] Descarga finalizada. Leyendo contenido...`);
        const zip = new AdmZip(tempMrpackPath);
        const entries = zip.getEntries();

        const indexEntry = entries.find(entry => entry.entryName === 'modrinth.index.json' || entry.entryName.endsWith('/modrinth.index.json'));
        if (!indexEntry) {
            throw new Error('El archivo .mrpack no es válido: falta modrinth.index.json.');
        }

        const indexData = JSON.parse(indexEntry.getData().toString('utf8'));
        const filesToDownload = indexData.files || [];
        console.log(`[Modpack] Total de archivos a descargar: ${filesToDownload.length}`);


        let downloadedCount = 0;
        for (const fileObj of filesToDownload) {
            if (fileObj.env && fileObj.env.client === 'unsupported') {
                continue;
            }

            const fileUrl = fileObj.downloads && fileObj.downloads[0];
            if (!fileUrl) continue;

            const relativePath = fileObj.path.replace(/^[/\\]+/, '');
            const absoluteFilePath = path.join(instanceDir, relativePath);

            const parentDir = path.dirname(absoluteFilePath);
            if (!fs.existsSync(parentDir)) {
                fs.mkdirSync(parentDir, { recursive: true });
            }

            try {
                await downloadFile(fileUrl, absoluteFilePath);
                downloadedCount++;
                console.log(`[Modpack] (${downloadedCount}/${filesToDownload.length}) Descargado: ${relativePath}`);
            } catch (fileErr) {
                console.error(`[Modpack] Error al descargar ${relativePath}:`, fileErr.message);
            }
        }


        console.log(`[Modpack] Extrayendo configuraciones (overrides)...`);
        for (const entry of entries) {
            if (entry.isDirectory) continue;

            const entryPath = entry.entryName.replace(/\\/g, '/');
            let relativePath = null;

            if (entryPath.startsWith('overrides/')) {
                relativePath = entryPath.substring('overrides/'.length);
            } else if (entryPath.startsWith('client-overrides/')) {
                relativePath = entryPath.substring('client-overrides/'.length);
            }

            if (relativePath) {
                relativePath = relativePath.replace(/^[/\\]+/, '');
                const targetPath = path.join(instanceDir, relativePath);
                const targetDir = path.dirname(targetPath);

                if (!fs.existsSync(targetDir)) {
                    fs.mkdirSync(targetDir, { recursive: true });
                }

                fs.writeFileSync(targetPath, entry.getData());
            }
        }

        if (fs.existsSync(tempMrpackPath)) {
            fs.unlinkSync(tempMrpackPath);
        }

        const configPath = path.join(instanceDir, 'instance.json');
        const instanceConfig = {
            name: cleanTitle,
            version: indexData.dependencies ? indexData.dependencies.minecraft : '1.21.1',
            loader: indexData.dependencies || {},
            createdAt: new Date()
        };
        fs.writeFileSync(configPath, JSON.stringify(instanceConfig, null, 2));

        console.log(`[Modpack] ¡Instalación de "${cleanTitle}" completada con éxito en su instancia!`);
        event.sender.send('download-complete', { title: cleanTitle });

    } catch (error) {
        console.error(`[Modpack] Error crítico al instalar el modpack ${title}:`, error);
        event.sender.send('download-error', error.message);
    }
});

ipcMain.on('open-folder', (event, folderPath) => {
    const appDataPath = app.getPath('userData');
    const absolutePath = getOrCreateInstanceDir(appDataPath, folderPath);
    if (fs.existsSync(absolutePath)) {
        shell.openPath(absolutePath);
    } else {
        console.error('La ruta de la instancia no existe:', absolutePath);
    }
});

ipcMain.on('launch-game', async (event, config) => {
    const appDataPath = app.getPath('userData');
    const instanceKey = config.name || config.instancePath;
    if (instanceKey) {
        const realDir = getOrCreateInstanceDir(appDataPath, instanceKey);
        const folderName = path.basename(realDir);
        config.name = folderName;
        config.instancePath = folderName;
    }

    await launchGame(config, appDataPath);
});

function createWindow() {
    const win = new BrowserWindow({
        width: 1024,
        height: 768,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    win.loadFile('index.html');
}

app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});