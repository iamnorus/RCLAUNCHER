const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { downloadFile } = require('./downloader');

async function launchGame(config, appDataPath) {
    const { instance, account, javaPath, ram } = config;
    
    try {
        console.log(`Iniciando instancia: ${instance.name}`);
        console.log(`Versión: ${instance.version} | Loader: ${instance.loader}`);
        console.log(`Cuenta activa: ${account.name}`);
        console.log(`Ruta Java: ${javaPath}`);
        console.log(`Memoria RAM: ${ram} MB`);

        const instanceDir = path.join(appDataPath, 'instances', instance.path);
        const versionsDir = path.join(appDataPath, 'versions');
        const librariesDir = path.join(appDataPath, 'libraries');
        const assetsDir = path.join(appDataPath, 'assets');

        if (!fs.existsSync(instanceDir)) fs.mkdirSync(instanceDir, { recursive: true });
        if (!fs.existsSync(versionsDir)) fs.mkdirSync(versionsDir, { recursive: true });
        if (!fs.existsSync(librariesDir)) fs.mkdirSync(librariesDir, { recursive: true });
        if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

        const manifestRes = await fetch('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json');
        const manifest = await manifestRes.json();
        const versionMeta = manifest.versions.find(v => v.id === instance.version);

        if (!versionMeta) throw new Error(`No se encontró la versión ${instance.version} en el manifest.`);

        const versionRes = await fetch(versionMeta.url);
        const versionData = await versionRes.json();

        const clientJarPath = path.join(versionsDir, `${instance.version}.jar`);
        if (!fs.existsSync(clientJarPath)) {
            console.log(`Descargando el cliente de Minecraft ${instance.version}...`);
            await downloadFile(versionData.downloads.client.url, clientJarPath);
        }

        let classpathFiles = [clientJarPath];
        let mainClass = versionData.mainClass;

        if (instance.loader === 'fabric') {
            console.log('Configurando perfil de Fabric...');
            const fabricMetaRes = await fetch(`https://meta.fabricmc.net/v2/versions/loader/${instance.version}`);
            const fabricLoaders = await fabricMetaRes.json();
            
            if (fabricLoaders.length === 0) throw new Error(`No hay loaders de Fabric para la versión ${instance.version}`);
            const loaderVersion = fabricLoaders[0].loader.version;

            const profileRes = await fetch(`https://meta.fabricmc.net/v2/versions/loader/${instance.version}/${loaderVersion}/profile/json`);
            const fabricProfile = await profileRes.json();

            mainClass = fabricProfile.mainClass;

            for (const lib of fabricProfile.libraries) {
                const [group, artifact, version] = lib.name.split(':');
                const groupPath = group.replace(/\./g, '/');
                const relativePath = path.join(groupPath, artifact, version, `${artifact}-${version}.jar`);
                const destination = path.join(librariesDir, relativePath);
                
                const mavenUrl = lib.url || 'https://maven.fabricmc.net/';
                const libUrl = `${mavenUrl}${groupPath}/${artifact}/${version}/${artifact}-${version}.jar`;

                if (!fs.existsSync(destination)) {
                    fs.mkdirSync(path.dirname(destination), { recursive: true });
                    try {
                        await downloadFile(libUrl, destination);
                    } catch (e) {
                        console.warn(`Aviso: No se pudo descargar la librería de Fabric ${lib.name}`);
                    }
                }
                classpathFiles.push(destination);
            }
        }

        for (const lib of versionData.libraries) {
            if (lib.downloads && lib.downloads.artifact) {
                const libPath = lib.downloads.artifact.path;
                const libUrl = lib.downloads.artifact.url;
                const destination = path.join(librariesDir, libPath);

                if (!fs.existsSync(destination)) {
                    fs.mkdirSync(path.dirname(destination), { recursive: true });
                    try {
                        await downloadFile(libUrl, destination);
                    } catch (e) {
                        console.warn(`No se pudo descargar la librería: ${libPath}`);
                    }
                }
                classpathFiles.push(destination);
            }
        }

        const nativesDir = path.join(instanceDir, 'natives');
        if (!fs.existsSync(nativesDir)) fs.mkdirSync(nativesDir, { recursive: true });

        const classPathString = classpathFiles.join(path.delimiter);

        const jvmArgs = [
            `-Xmx${ram}m`,
            `-XX:+UnlockExperimentalVMOptions`,
            `-XX:+UseG1GC`,
            `-XX:G1NewSizePercent=20`,
            `-XX:G1ReservePercent=20`,
            `-XX:MaxGCPauseMillis=50`,
            `-XX:G1HeapRegionSize=32M`,
            `-Djava.library.path=${nativesDir}`,
            `-cp`,
            classPathString,
            mainClass
        ];

        const gameArgs = [
            `--username`, account.name || 'Jugador',
            `--version`, instance.version,
            `--gameDir`, instanceDir,
            `--assetsDir`, assetsDir,
            `--assetIndex`, versionData.assetIndex.id,
            `--uuid`, account.uuid || '00000000-0000-0000-0000-000000000000',
            `--accessToken`, account.token || 'null',
            `--userType`, 'mojang',
            `--versionType`, 'release'
        ];

        const fullArgs = [...jvmArgs, ...gameArgs];

        console.log('Lanzando proceso de Java para Minecraft...');
        const child = spawn(javaPath, fullArgs, { cwd: instanceDir });

        child.stdout.on('data', (data) => console.log(`Minecraft Log: ${data}`));
        child.stderr.on('data', (data) => console.error(`Minecraft Error: ${data}`));
        child.on('close', (code) => console.log(`El proceso de Minecraft finalizó con código: ${code}`));

    } catch (error) {
        console.error('Error crítico al iniciar el juego:', error.message);
    }
}

module.exports = launchGame;