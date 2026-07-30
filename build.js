const fs = require('fs');
const path = require('path');

const filesToCopy = [
    'index.html',
    'app.js',
    'rit-monitoring.js',
    'rit-monitoring.css',
    'database.js',
    'conexao_transporte.png',
    'driver_icon.png',
    'Imagem Conexão Transportes Eventos.png',
    'Planilha Modelo de Agendamento em Lote - Transportes Rock in Rio 2026.xlsx'
];

const destDir = path.join(__dirname, 'deploy_dist');

console.log("Iniciando build: copiando arquivos para a pasta 'deploy_dist'...");

// Cria a pasta de destino se não existir
if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir);
    console.log("Pasta 'deploy_dist' criada.");
}

let successCount = 0;

filesToCopy.forEach(file => {
    const srcPath = path.join(__dirname, file);
    const destPath = path.join(destDir, file);

    if (fs.existsSync(srcPath)) {
        try {
            fs.copyFileSync(srcPath, destPath);
            console.log(`[OK] Copiado: ${file}`);
            successCount++;
        } catch (err) {
            console.error(`[ERRO] Falha ao copiar ${file}:`, err.message);
        }
    } else {
        console.warn(`[AVISO] Arquivo não encontrado na raiz: ${file}`);
    }
});

console.log(`Build concluído! ${successCount} de ${filesToCopy.length} arquivos copiados.`);
