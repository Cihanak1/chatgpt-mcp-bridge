let socket = null;
const WS_URL = "ws://127.0.0.1:8765";
const pendingSendQueue = [];

function connectWebSocket() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  socket = new WebSocket(WS_URL);

  socket.onopen = () => {
    console.log("[BRIDGE][BACKGROUND] WebSocket bağlantısı kuruldu (ws://127.0.0.1:8765).");
    // Kuyrukta bekleyen mesajları gönder
    while (pendingSendQueue.length > 0 && socket.readyState === WebSocket.OPEN) {
      const queuedMsg = pendingSendQueue.shift();
      socket.send(queuedMsg);
    }
  };

  socket.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === "RELOAD_EXTENSION") {
        console.log("[BACKGROUND] Reloading extension requested by Python bridge...");
        chrome.runtime.reload();
        return;
      }

      if (data.type === "REFRESH_CHATGPT_TAB") {
        const tabs = await chrome.tabs.query({ url: ["https://chatgpt.com/*", "https://chat.openai.com/*"] });
        if (tabs && tabs.length > 0) {
          const tab = tabs.find((t) => t.active) || tabs[0];
          console.log(`[BACKGROUND] Refreshing ChatGPT tab ${tab.id}...`);
          chrome.tabs.reload(tab.id);
        }
        return;
      }

      const isRequest = data.type === "architect_request" || data.type === "ASK_CHATGPT";

      if (isRequest) {
        const requestId = data.request_id;
        console.log(`[BACKGROUND][REQUEST_RECEIVED] id=${requestId}`);

        const tabs = await chrome.tabs.query({ url: ["https://chatgpt.com/*", "https://chat.openai.com/*"] });
        if (!tabs || tabs.length === 0) {
          sendToPython({
            type: "architect_error",
            request_id: requestId,
            status: "failed",
            error: {
              code: "NO_CHATGPT_TAB",
              message: "Tarayıcıda açık bir chatgpt.com sekmesi bulunamadı."
            },
            timestamp: Date.now()
          });
          return;
        }

        const targetTab = tabs.find((t) => t.active) || tabs[0];

        // Content script'i enjekte et ve ardından mesajı gönder
        try {
          await chrome.scripting.executeScript({
            target: { tabId: targetTab.id },
            files: ["content.js"]
          });
        } catch (e) {
          console.warn("[BACKGROUND] Script injection note:", e);
        }

        await new Promise((r) => setTimeout(r, 100));

        chrome.tabs.sendMessage(targetTab.id, data, (resp) => {
          if (chrome.runtime.lastError) {
            const errMsg = chrome.runtime.lastError.message || "";
            if (!errMsg.includes("message port closed")) {
              console.error(`[BACKGROUND][SEND_ERROR] id=${requestId} error=${errMsg}`);
              sendToPython({
                type: "architect_error",
                request_id: requestId,
                status: "failed",
                error: {
                  code: "TAB_MESSAGE_FAILED",
                  message: "Sekmeye mesaj iletilemedi: " + errMsg
                },
                timestamp: Date.now()
              });
            }
          } else {
            console.log(`[BACKGROUND][FORWARDED_TO_TAB] id=${requestId} tabId=${targetTab.id}`);
          }
        });
      }
    } catch (err) {
      console.error("[BACKGROUND] Mesaj işleme hatası:", err);
    }
  };

  socket.onclose = () => {
    console.warn("[BACKGROUND] WebSocket kapandı, 2 sn sonra yeniden bağlanılacak...");
    setTimeout(connectWebSocket, 2000);
  };

  socket.onerror = (err) => {
    console.error("[BACKGROUND] WebSocket hatası:", err);
    socket.close();
  };
}

function sendToPython(payload) {
  const jsonStr = JSON.stringify(payload);
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(jsonStr);
    console.log(`[BACKGROUND][WS_SENT] type=${payload.type} id=${payload.request_id || "none"}`);
  } else {
    console.warn(`[BACKGROUND][WS_BUFFERED] type=${payload.type} id=${payload.request_id || "none"}`);
    pendingSendQueue.push(jsonStr);
    connectWebSocket();
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (
    message.type === "architect_response" ||
    message.type === "architect_error" ||
    message.type === "architect_ack" ||
    message.type === "bridge_log"
  ) {
    sendToPython(message);
    sendResponse({ ok: true });
    return true;
  } else if (message.type === "CHATGPT_RESPONSE") {
    // Geriye dönük uyumluluk
    sendToPython(message.payload);
    sendResponse({ ok: true });
    return true;
  } else if (message.type === "KEEP_ALIVE") {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      connectWebSocket();
      sendResponse({ connected: false });
    } else {
      sendResponse({ connected: true });
    }
    return true;
  }
  return true;
});

connectWebSocket();