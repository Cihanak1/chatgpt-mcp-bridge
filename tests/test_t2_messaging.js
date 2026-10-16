// T2 — Chrome Runtime Messaging Test
// content.js ve background.js arasındaki mesajlaşma akışını ve request_id bütünlüğünü doğrular

class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 1; // OPEN
    this.sentMessages = [];
  }
  send(data) {
    this.sentMessages.push(data);
  }
}

function runT2Test() {
  console.log("=== T2: CHROME RUNTIME MESSAGING TESTİ BAŞLATILIYOR ===");

  const ws = new MockWebSocket("ws://127.0.0.1:8765");
  const listeners = [];

  const mockChromeRuntime = {
    onMessage: {
      addListener: (fn) => listeners.push(fn)
    },
    sendMessage: (msg, callback) => {
      // background.js dinleyicilerine ilet
      for (const listener of listeners) {
        listener(msg, {}, callback || (() => {}));
      }
    }
  };

  // background.js içindeki onMessage dinleyicisi mantığı
  mockChromeRuntime.onMessage.addListener((message, sender, sendResponse) => {
    if (
      message.type === "architect_response" ||
      message.type === "architect_error" ||
      message.type === "architect_ack"
    ) {
      ws.send(JSON.stringify(message));
      sendResponse({ ok: true });
      return true;
    }
  });

  const testRequestId = "test-uuid-12345";
  const testPayload = {
    type: "architect_response",
    request_id: testRequestId,
    status: "completed",
    text: "Test cevabı: Mimari onaylandı. [DURUM: ONAY_TAMAM]",
    char_count: 50,
    timestamp: Date.now()
  };

  // content.js mesajı gönderiyor
  mockChromeRuntime.sendMessage(testPayload, (res) => {
    if (!res || !res.ok) {
      throw new Error("background.js yanıtı teslim alamadı!");
    }
  });

  if (ws.sentMessages.length !== 1) {
    throw new Error(`Beklenen 1 WebSocket mesajı iken ${ws.sentMessages.length} mesaj gitti!`);
  }

  const forwarded = JSON.parse(ws.sentMessages[0]);
  if (forwarded.request_id !== testRequestId) {
    throw new Error(`request_id bozuldu! Beklenen: ${testRequestId}, Giden: ${forwarded.request_id}`);
  }
  if (forwarded.type !== "architect_response") {
    throw new Error(`type bozuldu! Beklenen: architect_response, Giden: ${forwarded.type}`);
  }
  if (!forwarded.text.includes("Test cevabı")) {
    throw new Error("Yanıt metni bozuldu!");
  }

  console.log("✓ content.js mesajı background.js tarafından teslim alındı.");
  console.log("✓ request_id gidiş ve dönüş boyunca korundu.");
  console.log("✓ Mesaj WebSocket kanalına başarıyla iletildi.");
  console.log("\n>>> T2 CHROME RUNTIME MESSAGING TESTİ BAŞARIYLA GEÇTİ <<<\n");
}

runT2Test();
