const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const fs = require('fs');
const path = require('path');
const { WaveFile } = require('wavefile');
const readline = require('readline');

// ==========================================
// CONFIGURAÇÕES DO SISTEMA (Setup Principal)
// ==========================================
const CONFIG = {
    PORTA: 'COM3', // Mude para a porta do seu ESP32
    BAUD_RATE: 460800,
    TAXA_AMOSTRAGEM: 16000,
    SEGUNDOS: 2,
    PASTA_RAIZ: path.join(__dirname, 'dataset')
};

const TOTAL_AMOSTRAS = CONFIG.TAXA_AMOSTRAGEM * CONFIG.SEGUNDOS;

// Interface de Terminal para interação com o usuário
const cli = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

class ColetorAudioPRO {
    constructor() {
        this.audioData = [];
        this.gravando = false;
        this.categoriaAtual = '';
        this.porta = null;
        this.parser = null;
    }

    iniciar() {
        console.clear();
        console.log("==================================================");
        console.log("   STORM X PRO - DATASET COLLECTOR (NODE.JS)      ");
        console.log("==================================================\n");
        
        this.garantirPastas();
        this.conectarSerial();
    }

    garantirPastas() {
        // Cria a estrutura de pastas automaticamente se não existir
        const pastas = ['acerto', 'tiro_erro', 'ruido'];
        if (!fs.existsSync(CONFIG.PASTA_RAIZ)) fs.mkdirSync(CONFIG.PASTA_RAIZ);
        
        pastas.forEach(pasta => {
            const caminho = path.join(CONFIG.PASTA_RAIZ, pasta);
            if (!fs.existsSync(caminho)) fs.mkdirSync(caminho);
        });
    }

    conectarSerial() {
        try {
            this.porta = new SerialPort({ path: CONFIG.PORTA, baudRate: CONFIG.BAUD_RATE });
            this.parser = this.porta.pipe(new ReadlineParser({ delimiter: '\r\n' }));

            this.porta.on('open', () => {
                console.log(`[ SISTEMA ] Conectado com sucesso na porta ${CONFIG.PORTA}`);
                this.exibirMenu();
            });

            this.porta.on('error', (err) => {
                console.error(`[ ERRO CRÍTICO ] Falha na porta Serial: ${err.message}`);
                process.exit(1);
            });

            // Motor de captação de dados (roda silenciosamente no fundo)
            this.parser.on('data', (linha) => this.processarDado(linha));

        } catch (error) {
            console.error(`[ ERRO ] Não foi possível inicializar a serial: ${error.message}`);
        }
    }

    processarDado(linha) {
        if (!this.gravando || this.audioData.length >= TOTAL_AMOSTRAS) return;

        let valor = parseInt(linha.trim(), 10);
        
        if (!isNaN(valor)) {
            // Hard limit de 16-bits para evitar corrupção do WAV
            valor = Math.max(-32768, Math.min(32767, valor));
            this.audioData.push(valor);

            // Feedback visual a cada 25% da gravação
            if (this.audioData.length % (TOTAL_AMOSTRAS / 4) === 0) {
                const progresso = (this.audioData.length / TOTAL_AMOSTRAS) * 100;
                process.stdout.write(`... ${progresso}% `);
            }
            
            // Fim da gravação
            if (this.audioData.length === TOTAL_AMOSTRAS) {
                this.gravando = false;
                console.log("\n[ OK ] Captura finalizada.");
                this.salvarArquivo();
            }
        }
    }

    obterProximoNomeArquivo(categoria) {
        const pasta = path.join(CONFIG.PASTA_RAIZ, categoria);
        const arquivos = fs.readdirSync(pasta);
        
        // Conta quantos arquivos já existem para gerar o próximo número
        const numero = arquivos.length + 1;
        const numeroFormatado = numero.toString().padStart(2, '0'); // ex: 01, 02, 10
        
        return path.join(pasta, `${categoria}_${numeroFormatado}.wav`);
    }

    salvarArquivo() {
        const caminhoCompleto = this.obterProximoNomeArquivo(this.categoriaAtual);
        
        try {
            const wav = new WaveFile();
            wav.fromScratch(1, CONFIG.TAXA_AMOSTRAGEM, '16', this.audioData);
            fs.writeFileSync(caminhoCompleto, wav.toBuffer());
            
            console.log(`[ SUCESSO ] Arquivo salvo: ${caminhoCompleto}\n`);
            this.exibirMenu(); // Volta para o menu automaticamente
            
        } catch (error) {
            console.error(`[ ERRO ] Falha ao salvar o arquivo: ${error.message}`);
            this.exibirMenu();
        }
    }

    exibirMenu() {
        this.audioData = []; // Limpa o buffer antigo
        console.log("--------------------------------------------------");
        console.log("O que você deseja gravar agora?");
        console.log(" 1 - Acerto no Alvo");
        console.log(" 2 - Tiro/Erro (Ao lado do alvo)");
        console.log(" 3 - Ruído de Fundo (Ambiente)");
        console.log(" 0 - Sair");
        
        cli.question('\nDigite a opção desejada: ', (opcao) => {
            switch(opcao.trim()) {
                case '1': this.prepararGravacao('acerto'); break;
                case '2': this.prepararGravacao('tiro_erro'); break;
                case '3': this.prepararGravacao('ruido'); break;
                case '0': 
                    console.log("[ SISTEMA ] Encerrando...");
                    this.porta.close();
                    process.exit(0);
                    break;
                default:
                    console.log("[ AVISO ] Opção inválida.");
                    this.exibirMenu();
            }
        });
    }

    prepararGravacao(categoria) {
        this.categoriaAtual = categoria;
        console.log(`\n[ PREPARANDO ] Categoria selecionada: ${categoria.toUpperCase()}`);
        cli.question('>> Pressione [ENTER] e faça o barulho em seguida...', () => {
            console.log(`[ GRAVANDO ] Gravando 2 segundos...`);
            this.audioData = [];
            this.gravando = true; // Libera o motor para começar a empilhar os dados
        });
    }
}

// Inicializa a ferramenta
const coletor = new ColetorAudioPRO();
coletor.iniciar();