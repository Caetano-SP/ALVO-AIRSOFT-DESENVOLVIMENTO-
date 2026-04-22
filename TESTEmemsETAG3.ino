#include <Wire.h>
#include "Adafruit_TCS34725.h"
#include <driver/i2s.h>

// --- Definições de Pinos (LEDs e Fim de Curso) ---
#define LED_R11_PIN 2
#define LED_G_PIN   4
#define LED_R_PIN   3
#define FIMDECURSO_PIN 1

// --- Definições de Pinos (Microfone I2S INMP441) ---
#define I2S_WS_PIN  5
#define I2S_SD_PIN  6
#define I2S_SCK_PIN 7
#define I2S_PORT    I2S_NUM_0

// --- Sensor de cor ---
Adafruit_TCS34725 tcs = Adafruit_TCS34725(TCS34725_INTEGRATIONTIME_24MS, TCS34725_GAIN_16X);

// --- Parâmetros da Média Móvel ---
#define N 50
int bufferR[N];
int originalR = 0, mediaR = 0;
int limiar = 0;

// --- Variáveis da Máquina de Estados (Calibração Dupla) ---
enum EstadoSistema { CALIBRANDO_AMBIENTE, CALIBRANDO_TIROS, JOGO_NORMAL };
EstadoSistema estadoAtual = CALIBRANDO_AMBIENTE;

unsigned long tempoInicioEstado = 0;
int32_t picoAmbiente = 0;
int tirosCalibrados = 0;
long somaPicosTiros = 0;
unsigned long tempoUltimoTiro = 0;
unsigned long tempoPiscaCalibracao = 0;
bool estadoLedCalibracao = false;

int32_t LIMIAR_SOM = 0; 
const int MARGEM_SEGURANCA = 10000;
#define CHAVE_MODO_PIN FIMDECURSO_PIN // Se já tiver colocado, mantenha

// --- Estados do Sistema ---
bool ledR11 = false, ledG = false, ledR = false;
bool fimdecurso = false;
bool cicloPausado = false;
bool disparoAnterior = false; //antigo laser anteriror

unsigned long tempoLed = 0;
unsigned long tempoEspera = 0;
unsigned long tempoLedR = 0;
unsigned long tempoPisca = 0;
unsigned long tempoAguardar = 0;
bool piscando = false, aguardando = false;
int estadoPisca = 0;

const unsigned long TEMPO_ATIVACAO_MS = 200;
const unsigned long TEMPO_PISCA_MS = 100;
const unsigned long TEMPO_LED_R_MS = 2000;
const unsigned long TEMPO_AGUARDO_MIN = 500;
const unsigned long TEMPO_AGUARDO_MAX = 4500;
const unsigned long TEMPO_LED_DESLIGA = 500;

// --- Função de Média Móvel com Filtro ---
int media_movel_filtrada(int novoValor) {
  for (int i = N - 1; i > 0; i--) {
    bufferR[i] = bufferR[i - 1];
  }
  bufferR[0] = novoValor;

  long soma = 0;
  for (int i = 0; i < N; i++) {
    soma += bufferR[i];
  }
  return soma / N;
}

// --- Configuração do I2S para o Microfone ---
void setup_i2s() {
  i2s_config_t i2s_config = {
    .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
    .sample_rate = 16000,
    .bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT,
    .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
    .communication_format = I2S_COMM_FORMAT_STAND_I2S,
    .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count = 4,
    .dma_buf_len = 256,
    .use_apll = false,
    .tx_desc_auto_clear = false,
    .fixed_mclk = 0
  };

  i2s_pin_config_t pin_config = {
    .bck_io_num = I2S_SCK_PIN,
    .ws_io_num = I2S_WS_PIN,
    .data_out_num = I2S_PIN_NO_CHANGE,
    .data_in_num = I2S_SD_PIN
  };

  i2s_driver_install(I2S_PORT, &i2s_config, 0, NULL);
  i2s_set_pin(I2S_PORT, &pin_config);
}

int32_t ler_pico_i2s() {
  int32_t sampleBuffer[64];
  size_t bytesIn = 0;
  int32_t picoBloco = 0;

  // O timeout de 10ms do I2S serve como um "respiro" pro ESP32 não travar
  esp_err_t result = i2s_read(I2S_PORT, &sampleBuffer, sizeof(sampleBuffer), &bytesIn, 10 / portTICK_PERIOD_MS);

  if (result == ESP_OK && bytesIn > 0) {
    int samplesRead = bytesIn / 4;
    for (int i = 0; i < samplesRead; i++) {
      int32_t val = abs(sampleBuffer[i] >> 8);
      if (val > picoBloco) {
        picoBloco = val;
      }
    }
  }
  return picoBloco;
}
void calibrar_ambiente() {
  // Garante buzzer desligado para não interferir
  pinMode(LED_R11_PIN, OUTPUT);
  digitalWrite(LED_R11_PIN, LOW); 

  digitalWrite(LED_R_PIN, HIGH); // LED Vermelho indica calibração
  int32_t picoMaximo = 0;
  unsigned long tempoInicio = millis();

  while (millis() - tempoInicio < 4000) { // 4 segundos ouvindo
    int32_t sampleBuffer[64];
    size_t bytesIn = 0;
    i2s_read(I2S_PORT, &sampleBuffer, sizeof(sampleBuffer), &bytesIn, 10 / portTICK_PERIOD_MS);

    if (bytesIn > 0) {
      int samplesRead = bytesIn / 4;
      for (int i = 0; i < samplesRead; i++) {
        int32_t val = abs(sampleBuffer[i] >> 8);
        if (val > picoMaximo) picoMaximo = val;
      }
    }
  }

  LIMIAR_SOM = picoMaximo + MARGEM_SEGURANCA;
  digitalWrite(LED_R_PIN, LOW);
  digitalWrite(LED_G_PIN, HIGH); // Verde indica pronto
  delay(500);
  digitalWrite(LED_G_PIN, LOW);
}
void setup() {

  pinMode(LED_R11_PIN, OUTPUT);
  pinMode(LED_G_PIN, OUTPUT);
  pinMode(LED_R_PIN, OUTPUT);
  pinMode(FIMDECURSO_PIN, INPUT_PULLUP);
  
  Serial.begin(115200);

  // Inicializa I2C e sensor de cor
  Wire.begin();
  if (!tcs.begin()) {
    Serial.println("Erro no sensor TCS34725");
    while (1);
  }

  // Preenche buffer inicial do sensor de cor
  uint16_t r, g, b, c;
  for (int i = 0; i < N; i++) {
    tcs.getRawData(&r, &g, &b, &c);
    bufferR[i] = r;
    delay(5);
  }

  // Inicializa Microfone
  setup_i2s();
  calibrar_ambiente();
}
void loop() {
  // O microfone fica ouvindo o tempo todo, sem bloquear nada
  int32_t picoAtual = ler_pico_i2s();

  switch (estadoAtual) {
    
    // =======================================================
    // ESTADO 1: OUVINDO O AMBIENTE (4 SEGUNDOS)
    // =======================================================
    case CALIBRANDO_AMBIENTE:
      if (tempoInicioEstado == 0) {
        tempoInicioEstado = millis();
        digitalWrite(LED_R_PIN, HIGH); // Vermelho Fixo = Ouvindo
        digitalWrite(LED_G_PIN, LOW);
        Serial.println("Calibrando ambiente (4s)... Silencio.");
      }

      // Registra o maior barulho de fundo que ocorrer
      if (picoAtual > picoAmbiente) {
        picoAmbiente = picoAtual;
      }

      // Passou 4 segundos? Muda para o próximo estado
      if (millis() - tempoInicioEstado >= 4000) {
        Serial.print("Pico ambiente gravado: "); 
        Serial.println(picoAmbiente);
        Serial.println("ATIRE 5 VEZES NO ALVO!");
        estadoAtual = CALIBRANDO_TIROS;
      }
      break;

    // =======================================================
    // ESTADO 2: AGUARDANDO 5 TIROS PADRÃO
    // =======================================================
    case CALIBRANDO_TIROS:
      // Pisca os LEDs usando millis() para indicar que está esperando
      if (millis() - tempoPiscaCalibracao >= 150) {
        tempoPiscaCalibracao = millis();
        estadoLedCalibracao = !estadoLedCalibracao;
        digitalWrite(LED_R_PIN, estadoLedCalibracao);
        digitalWrite(LED_G_PIN, !estadoLedCalibracao);
      }

      // Se o som lido for um estalo alto (bem acima do ambiente)
      if (picoAtual > picoAmbiente + 150000) {
        // Debounce de 400ms: impede que o eco de 1 tiro conte como 2 tiros
        if (millis() - tempoUltimoTiro >= 400) { 
          somaPicosTiros += picoAtual;
          tirosCalibrados++;
          tempoUltimoTiro = millis();
          
          Serial.print("Tiro "); Serial.print(tirosCalibrados); 
          Serial.print("/5 - Pico: "); Serial.println(picoAtual);

          // Quando bater 5 tiros, finaliza a calibração
          if (tirosCalibrados >= 5) {
            int32_t mediaTiros = somaPicosTiros / 5;
            
            // INTELIGÊNCIA: O Limiar será a metade do caminho entre o silêncio e o tiro
            LIMIAR_SOM = picoAmbiente + ((mediaTiros - picoAmbiente) / 2);

            Serial.print("Media Forca dos Tiros: "); Serial.println(mediaTiros);
            Serial.print("LIMIAR DE JOGO DEFINIDO: "); Serial.println(LIMIAR_SOM);

            // Trava o LED no Verde para avisar que o jogo começou
            digitalWrite(LED_R_PIN, LOW);
            digitalWrite(LED_G_PIN, HIGH); 

            estadoAtual = JOGO_NORMAL; // Libera o alvo para jogar!
          }
        }
      }
      break;

    // =======================================================
    // ESTADO 3: JOGO NORMAL RODANDO
    // =======================================================
    case JOGO_NORMAL:
      bool eventoDetectado = false;
      bool modoMemsAtivo = (digitalRead(CHAVE_MODO_PIN) == LOW); // Sua Chave de Seleção

      if (modoMemsAtivo) {
        // --- DETECÇÃO POR SOM ---
        // Aqui usamos a variável que já lemos no topo do loop
        eventoDetectado = (picoAtual > LIMIAR_SOM); 
      } else {
        // --- DETECÇÃO POR LASER ---
        uint16_t r, g, b, c;
        tcs.getRawData(&r, &g, &b, &c);
        originalR = r;
        mediaR = media_movel_filtrada(originalR);
        limiar = mediaR + 5;
        eventoDetectado = (originalR > limiar);
      }

      fimdecurso = digitalRead(FIMDECURSO_PIN) == LOW;

      // Executa os seus modos antigos (piscar, esperar, etc)
      if (!fimdecurso) {
        modo_normal(eventoDetectado);
      } else {
        modo_fimdecurso(eventoDetectado);
      }

      digitalWrite(LED_R11_PIN, ledR11);
      digitalWrite(LED_G_PIN, ledG);
      digitalWrite(LED_R_PIN, ledR);

      disparoAnterior = eventoDetectado;
      break;
  }
}
void modo_normal(bool detectado) {
  ledR = false;
  if (detectado && !disparoAnterior) {
    ledG = true;
    ledR11 = true;
    tempoLed = millis();
    // Você pode adicionar um Serial.println("Disparo Normal Registrado!"); aqui para debugar
  }
  if (ledG && millis() - tempoLed >= TEMPO_ATIVACAO_MS) {
    ledG = false;
    ledR11 = false;
  }
}

void modo_fimdecurso(bool detectado) {
  if (!cicloPausado && !ledG && !ledR && !ledR11 && !aguardando) {
    ledR = true;
    tempoLedR = millis();
    piscando = true;
    estadoPisca = 0;
    tempoPisca = millis();
  }

  piscar_ledR11();
  
  if (ledR && millis() - tempoLedR >= TEMPO_LED_R_MS) {
    ledR = false;
    aguardando = true;
    tempoAguardar = millis() + random(TEMPO_AGUARDO_MIN, TEMPO_AGUARDO_MAX);
  }

  if (aguardando && millis() >= tempoAguardar) {
    aguardando = false;
  }

  if (detectado && !cicloPausado && !ledG && ledR && !ledR11 && !aguardando && !piscando) {
    ledR = false;
    ledG = true;
    ledR11 = true;
    tempoLed = millis();
    tempoEspera = millis() + random(TEMPO_AGUARDO_MIN, TEMPO_AGUARDO_MAX);
    cicloPausado = true;
  }

  if (ledG && millis() - tempoLed >= TEMPO_LED_DESLIGA) {
    ledG = false;
    ledR11 = false;
  }

  if (cicloPausado && millis() >= tempoEspera && !ledG && !ledR && !ledR11) {
    cicloPausado = false;
  }
}

void piscar_ledR11() {
  if (piscando) {
    if (estadoPisca < 4) {
      if (millis() - tempoPisca >= TEMPO_PISCA_MS) {
        ledR11 = !ledR11;
        tempoPisca = millis();
        estadoPisca++;
      }
    } else {
      piscando = false;
      ledR11 = false;
    }
  }
}