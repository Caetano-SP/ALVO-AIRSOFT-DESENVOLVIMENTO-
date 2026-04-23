const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const fs = require('fs');
const { WaveFile } = require('wavefile');

const PORTA_SERIAL = 'COM14'; 
const BAUD_RATE = 115200;
const TAXA_AMOSTRAGEM = 16000;
const SEGUNDOS_GRAVACAO = 2; 
const NOME_ARQUIVO = 'acerto_012.wav'; // MUDE O NOME A CADA UM

const totalAmostras = TAXA_AMOSTRAGEM * SEGUNDOS_GRAVACAO;
let audioData = [];

console.log(`Conectando na porta ${PORTA_SERIAL}...`);
const port = new SerialPort({ path: PORTA_SERIAL, baudRate: BAUD_RATE });
const parser = port.pipe(new ReadlineParser({ delimiter: '\r\n' }));

console.log("GRAVANDO! Faça o disparo...");

parser.on('data', (linha) => {
    if (audioData.length >= totalAmostras) return;

    let valor = parseInt(linha.trim(), 10);
    
    if (!isNaN(valor)) {
        valor = Math.max(-32768, Math.min(32767, valor));
        audioData.push(valor);
        
        if (audioData.length % 1000 === 0) { 
            console.log(`Recebido: ${audioData.length} de ${totalAmostras} amostras...`); 
        }
  
        
        if (audioData.length === totalAmostras) {
            salvarArquivoWav();
        }
    }
});

function salvarArquivoWav() {
    console.log(`Salvando ${NOME_ARQUIVO}...`);
    const wav = new WaveFile();
    wav.fromScratch(1, TAXA_AMOSTRAGEM, '16', audioData);
    fs.writeFileSync(NOME_ARQUIVO, wav.toBuffer());
    console.log("Salvo! Mude o nome do arquivo no código e rode novamente.");
    port.close();
    process.exit(0);
}
