const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const fs = require('fs');
const path = require('path');
const { WaveFile } = require('wavefile');
const readline = require('readline');

// ==========================================
// PALETA DE CORES (Nativo do Terminal)
// ==========================================
const COR = {
    RESET: "\x1b[0m",
    BRILHO: "\x1b[1m",
    VERDE: "\x1b[32m",
    AMARELO: "\x1b[33m",
    VERMELHO: "\x1b[31m",
    CIANO: "\x1b[36m"
};

// ==========================================
// CONFIGURAÇÕES DO SISTEMA
// ==========================================
const CONFIG = {
    PORTA: 'COM3', // Confirme se continua sendo a COM3
    BAUD_RATE: 460800,
    TAXA_AMOSTRAGEM: 16000,
    SEGUNDOS: 2,
    PASTA_RAIZ: path.join(__dirname, 'dataset')
};

const TOTAL_AMOSTRAS = CONFIG.TAXA_AMOSTRAGEM * CONFIG.SEGUNDOS;

const cli = readline.createInterface({ input: process.stdin, output: process.stdout });

class ColetorUltra {
    constructor() {
        // Uso de Memória Otimizada (Typed Array em vez de Array comum)
        this.audioBuffer = new Int16Array(TOTAL_AMOSTRAS);
        this.amostrasLidas = 0;
        this.gravando = false;
        this.categoriaAtual = '';
        this.porta = null;
    }

    iniciar() {
        console.clear();
        console.log(`${COR.CIANO}${COR.BRILHO}==================================================`);
        console.log(" 🚀 STORM X PRO - ULTRA DATASET COLLECTOR ");
        console.log(`==================================================${COR.RESET}\n`);
        
        this.garantirPastas();
        this.interceptarDesligamento();
        this.conectarSerial();
    }

    garantirPastas() {
        const pastas = ['acerto', 'tiro_erro', 'ruido'];
        if (!fs.existsSync(CONFIG.PASTA_RAIZ)) fs.mkdirSync(CONFIG.PASTA_RAIZ, { recursive: true });
        pastas.forEach(pasta => {
            const caminho = path.join(CONFIG.PASTA_RAIZ, pasta);
            if (!fs.existsSync(caminho)) fs.mkdirSync(caminho, { recursive: true });
        });
    }

    conectarSerial() {
        try {
            this.porta = new SerialPort({ path: CONFIG.PORTA, baudRate: CONFIG.BAUD_RATE });
            const parser = this.porta.pipe(new ReadlineParser({ delimiter: '\r\n' }));

            this.porta.on('open', () => {
                console.log(`${COR.VERDE}[ SISTEMA ] Hardware ESP32 conectado na porta ${CONFIG.PORTA}${COR.RESET}`);
                this.exibirMenu();
            });

            this.porta.on('error', (err) => {
                console.error(`${COR.VERMELHO}[ ERRO CRÍTICO ] Falha na porta Serial: ${err.message}${COR.RESET}`);
                process.exit(1);
            });

            parser.on('data', (linha) => this.processarDado(linha));

        } catch (error) {
            console.error(`${COR.VERMELHO}[ ERRO ] Não foi possível inicializar: ${error.message}${COR.RESET}`);
        }
    }

    processarDado(linha) {
        if (!this.gravando || this.amostrasLidas >= TOTAL_AMOSTRAS) return;

        const valor = parseInt(linha.trim(), 10);
        
        if (!isNaN(valor)) {
            // Trava o limite de 16-bits para não estourar o áudio
            this.audioBuffer[this.amostrasLidas] = Math.max(-32768, Math.min(32767, valor));
            this.amostrasLidas++;

            this.atualizarBarraProgresso();
            
            if (this.amostrasLidas === TOTAL_AMOSTRAS) {
                this.gravando = false;
                process.stdout.write(`\n${COR.VERDE}[ OK ] Captura finalizada com sucesso.${COR.RESET}\n`);
                this.salvarArquivo();
            }
        }
    }

    atualizarBarraProgresso() {
        // Atualiza a barra visual a cada 5% para economizar processamento da tela
        if (this.amostrasLidas % (TOTAL_AMOSTRAS / 20) === 0) {
            const porcentagem = (this.amostrasLidas / TOTAL_AMOSTRAS) * 100;
            const tamanhoBarra = 20;
            const blocosPreenchidos = Math.round((porcentagem / 100) * tamanhoBarra);
            const barra = '█'.repeat(blocosPreenchidos) + '░'.repeat(tamanhoBarra - blocosPreenchidos);
            
            // \r faz o cursor voltar pro início da linha e sobrescrever (animação fluida)
            process.stdout.write(`\r${COR.AMARELO}[ GRAVANDO ] [${barra}] ${porcentagem.toFixed(0)}%${COR.RESET}`);
        }
    }

    obterNomeArquivo(categoria) {
        const pasta = path.join(CONFIG.PASTA_RAIZ, categoria);
        const arquivos = fs.readdirSync(pasta);
        const numeroFormatado = String(arquivos.length + 1).padStart(2, '0');
        return path.join(pasta, `${categoria}_${numeroFormatado}.wav`);
    }

    salvarArquivo() {
        const caminhoCompleto = this.obterNomeArquivo(this.categoriaAtual);
        
        try {
            const wav = new WaveFile();
            // wavefile aceita nosso Int16Array nativamente!
            wav.fromScratch(1, CONFIG.TAXA_AMOSTRAGEM, '16', this.audioBuffer);
            fs.writeFileSync(caminhoCompleto, wav.toBuffer());
            
            console.log(`${COR.VERDE}💾 Salvo: ${caminhoCompleto}${COR.RESET}\n`);
            this.exibirMenu();
            
        } catch (error) {
            console.error(`${COR.VERMELHO}[ ERRO ] Falha ao salvar: ${error.message}${COR.RESET}`);
            this.exibirMenu();
        }
    }

    exibirMenu() {
        this.amostrasLidas = 0; // Zera o contador
        console.log(`${COR.CIANO}--------------------------------------------------${COR.RESET}`);
        console.log(`${COR.BRILHO}O que você deseja gravar agora?${COR.RESET}`);
        console.log(` ${COR.VERDE}1 - Acerto no Alvo${COR.RESET}`);
        console.log(` ${COR.AMARELO}2 - Tiro/Erro (Arma atirando ao lado)${COR.RESET}`);
        console.log(` ${COR.CIANO}3 - Ruído de Fundo (Ambiente)${COR.RESET}`);
        console.log(` ${COR.VERMELHO}0 - Sair${COR.RESET}`);
        
        cli.question('\n👉 Digite a opção: ', (opcao) => {
            switch(opcao.trim()) {
                case '1': this.prepararGravacao('acerto'); break;
                case '2': this.prepararGravacao('tiro_erro'); break;
                case '3': this.prepararGravacao('ruido'); break;
                case '0': this.encerrar(); break;
                default:
                    console.log(`${COR.VERMELHO}[ AVISO ] Opção inválida.${COR.RESET}`);
                    this.exibirMenu();
            }
        });
    }

    prepararGravacao(categoria) {
        this.categoriaAtual = categoria;
        console.log(`\n🎯 Categoria selecionada: ${COR.BRILHO}${categoria.toUpperCase()}${COR.RESET}`);
        cli.question(`Pressione ${COR.VERDE}[ENTER]${COR.RESET} e faça o barulho em seguida...`, () => {
            this.amostrasLidas = 0;
            this.gravando = true; 
        });
    }

    interceptarDesligamento() {
        // Se o usuário apertar Ctrl+C, fecha a porta serial sem corromper o ESP32
        process.on('SIGINT', () => this.encerrar());
    }

    encerrar() {
        console.log(`\n${COR.AMARELO}[ SISTEMA ] Desconectando hardware e encerrando...${COR.RESET}`);
        if (this.porta && this.porta.isOpen) {
            this.porta.close();
        }
        process.exit(0);
    }
}

const coletor = new ColetorUltra();
coletor.iniciar();