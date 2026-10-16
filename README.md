# ChatGPT MCP Bridge

ChatGPT web arayüzünü yerel bir Model Context Protocol (MCP) sunucusuna bağlayan iki yönlü köprü aracı. OpenAI API anahtarına ihtiyaç duymadan, açık olan ChatGPT tarayıcı oturumunuzu Antigravity, Claude Desktop, Cursor gibi MCP destekli AI ajanları ve IDE'ler için bir araç (tool) haline getirir.

---

## Türkçe Dokümantasyon

### Mimari ve Çalışma Prensibi

Sistem üç temel bileşenin eşzamanlı haberleşmesiyle çalışır:

1. **MCP İstemcisi (IDE / Ajan):** `FastMCP` protokolü üzerinden yerel Python sürecine bağlanır ve standart JSON-RPC komutları iletir.
2. **Python Köprü Sunucusu (`bridge_server.py`):** Standart girdi/çıktı (stdio) üzerinden MCP komutlarını dinler ve `ws://127.0.0.1:8765` adresinde yerel bir WebSocket sunucusu çalıştırır.
3. **Chromium Tarayıcı Eklentisi (`chrome-extension`):** ChatGPT web sayfasına (`chatgpt.com`) bağlanır. Gelen mesajları ProseMirror giriş alanına enjekte ederek gönderir, streaming durumunu ve DOM üzerindeki asistan yanıtını milisaniye hassasiyetinde izler.

```text
[ AI Ajanı / IDE ] 
       │ (stdio - MCP JSON-RPC)
       ▼
[ bridge_server.py ] 
       │ (WebSocket - ws://127.0.0.1:8765)
       ▼
[ Chrome Extension (Manifest V3) ] 
       │ (Content Script / DOM Injection)
       ▼
[ ChatGPT Web (chatgpt.com) ]
```

### Özellikler

* **API Anahtarı Gerektirmez:** Kendi aktif tarayıcı oturumunuzu (Free, Plus veya Team) kullanır.
* **Gelişmiş DOM Takibi:** Modern ChatGPT ProseMirror giriş alanları, Tailwind Typography (`.prose`, `.markdown`) ve turn konteynerleri ile tam uyumludur.
* **Akıllı Yanıt Kararlılığı:** ChatGPT'nin yazma (streaming) sürecini takip eder; metin stabil hale gelmeden erken yanıt döndürmez.
* **Hata Ayıklama ve Dayanıklılık:** Zaman aşımı (timeout) koruması, bağlantı kopmalarında otomatik yeniden bağlanma ve ayrıntılı yerel loglama içerir.

---

### Gereksinimler

* Python 3.10 veya üzeri
* Chromium tabanlı modern bir tarayıcı (Google Chrome, Brave, Microsoft Edge vb.)
* Aktif bir ChatGPT oturumu (`https://chatgpt.com`)

---

### Kurulum Adımları

#### 1. Python Bağımlılıklarını Yükleyin
Bir sanal ortam (venv) oluşturun ve gerekli paketleri kurun:

```bash
# Depoyu klonlayın
git clone https://github.com/Cihanak1/chatgpt-mcp-bridge.git
cd chatgpt-mcp-bridge

# Sanal ortam oluşturun ve aktif edin
python -m venv venv

# Windows için:
venv\Scripts\activate
# Linux / macOS için:
source venv/bin/activate

# Paketleri yükleyin
pip install -r requirements.txt
```

#### 2. Tarayıcı Eklentisini Yükleyin
1. Tarayıcınızda uzantı yönetim sayfasını açın:
   * Chrome / Brave: `chrome://extensions/`
   * Edge: `edge://extensions/`
2. Sağ üst köşedeki **Geliştirici Modu (Developer Mode)** seçeneğini aktif edin.
3. **Paketlenmemiş öge yükle (Load unpacked)** butonuna tıklayın.
4. Bu depodaki `chrome-extension` klasörünü seçin.
5. Tarayıcınızda `https://chatgpt.com` sekmesini açın. Sayfanın sağ alt köşesinde yeşil renkli **"Antigravity Köprüsü Aktif"** rozetini gördüğünüzde eklenti hazırdır.

#### 3. MCP Konfigürasyonunu Ekleyin
MCP destekli uygulamanızın (Antigravity, Claude Desktop, Cursor vb.) `mcp_config.json` dosyasına sunucuyu tanımlayın:

```json
{
  "mcpServers": {
    "chatgpt-mimar": {
      "command": "C:\\path\\to\\venv\\Scripts\\python.exe",
      "args": [
        "C:\\path\\to\\chatgpt-mcp-bridge\\bridge_server.py"
      ]
    }
  }
}
```
*(Linux/macOS kullanıyorsanız `python` yolunu sanal ortamınızdaki ikili dosya ile güncelleyin.)*

---

### Kullanılabilir MCP Araçları

* **`chatgpt_baglanti_durumu`**: ChatGPT tarayıcı sekmesinin eklentiye bağlı olup olmadığını kontrol eder (`AKTIF` veya `PASIF`).
* **`chatgpt_mesaj_gonder`**: Verilen istemi (prompt) ChatGPT arayüzüne yazar ve gönderme butonunu tetikler.
* **`chatgpt_yaniti_oku`**: ChatGPT'nin yazmayı bitirip bitirmediğini denetler ve tamamlanan yanıtı geri döndürür.

---

### Testlerin Çalıştırılması

Depo içerisinde birim, mesajlaşma ve uçtan uca tarayıcı testlerini içeren bir test paketi bulunmaktadır:

```bash
# DOM çıkarma mantığını test edin
node tests/test_t1_dom_extraction.js

# Mesajlaşma protokolünü test edin
node tests/test_t2_messaging.js

# WebSocket ve Future çözümleme testini çalıştırın
python tests/test_t3_t4_websocket_future.py

# MCP dönüş testini çalıştırın
python tests/test_t5_mcp_return.py
```

---

### Güvenlik ve Gizlilik

* Tüm WebSocket iletişimi yalnızca yerel makinede (`127.0.0.1`) gerçekleşir.
* Kodlar herhangi bir üçüncü taraf sunucuya veya harici analitik servisine veri göndermez.
* ChatGPT ile yapılan tüm etkileşim doğrudan kendi tarayıcınızın OpenAI ile olan mevcut güvenli HTTPS bağlantısı üzerinden akar.

---

<br>

## English Documentation

### Architecture and Working Principle

The system works through the synchronized interaction of three main components:

1. **MCP Client (IDE / Agent):** Connects to the local Python process via `FastMCP` and sends standard JSON-RPC requests.
2. **Python Bridge Server (`bridge_server.py`):** Listens for MCP commands over stdio and operates a local WebSocket server at `ws://127.0.0.1:8765`.
3. **Chromium Extension (`chrome-extension`):** Injected into `chatgpt.com`. It receives incoming prompts, inserts them into the ProseMirror editor, triggers the submit button, and monitors the streaming assistant response in real time.

```text
[ AI Agent / IDE ] 
       │ (stdio - MCP JSON-RPC)
       ▼
[ bridge_server.py ] 
       │ (WebSocket - ws://127.0.0.1:8765)
       ▼
[ Chrome Extension (Manifest V3) ] 
       │ (Content Script / DOM Injection)
       ▼
[ ChatGPT Web (chatgpt.com) ]
```

### Features

* **No API Key Required:** Operates directly through your active browser session (Free, Plus, or Team).
* **Modern DOM Selectors:** Fully compatible with ProseMirror textareas, Tailwind Typography (`.prose`, `.markdown`), and turn containers.
* **Streaming & Stability Detection:** Actively detects response generation and ensures responses are stable before extraction.
* **Fault Tolerance:** Includes timeout protection, automatic reconnection on connection drops, and local file logging.

---

### Prerequisites

* Python 3.10+
* A modern Chromium-based browser (Chrome, Brave, Edge)
* An active session on `https://chatgpt.com`

---

### Step-by-Step Installation

#### 1. Setup Python Environment
```bash
# Clone the repository
git clone https://github.com/Cihanak1/chatgpt-mcp-bridge.git
cd chatgpt-mcp-bridge

# Create and activate virtual environment
python -m venv venv

# On Windows:
venv\Scripts\activate
# On Linux / macOS:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

#### 2. Load the Chrome Extension
1. Open your browser's extension page:
   * Chrome / Brave: `chrome://extensions/`
   * Edge: `edge://extensions/`
2. Enable **Developer Mode** in the upper right corner.
3. Click **Load unpacked**.
4. Select the `chrome-extension` directory from this repository.
5. Open `https://chatgpt.com`. A green badge indicating **"Antigravity Köprüsü Aktif"** will appear at the bottom right.

#### 3. Configure Your MCP Client
Add the following to your application's `mcp_config.json` (Antigravity, Claude Desktop, Cursor, etc.):

```json
{
  "mcpServers": {
    "chatgpt-mimar": {
      "command": "/path/to/venv/bin/python",
      "args": [
        "/path/to/chatgpt-mcp-bridge/bridge_server.py"
      ]
    }
  }
}
```

---

### Exposed MCP Tools

* **`chatgpt_baglanti_durumu`**: Checks whether the ChatGPT tab is connected (`AKTIF` or `PASIF`).
* **`chatgpt_mesaj_gonder`**: Enters the specified prompt into the ChatGPT UI and clicks the send button.
* **`chatgpt_yaniti_oku`**: Monitors streaming completion and retrieves the finalized response text.

---

### Running Tests

Unit and integration tests are available in the `tests/` directory:

```bash
# Run DOM extraction test
node tests/test_t1_dom_extraction.js

# Run messaging protocol test
node tests/test_t2_messaging.js

# Run WebSocket and future resolution test
python tests/test_t3_t4_websocket_future.py

# Run MCP tool return test
python tests/test_t5_mcp_return.py
```

---

### Security & Privacy

* All WebSocket traffic remains exclusively on localhost (`127.0.0.1`).
* No data is sent to third-party endpoints or telemetry servers.
* Interactions with ChatGPT use your browser's existing authenticated HTTPS session with OpenAI.

---

### License

MIT License. See [LICENSE](LICENSE) for details.
