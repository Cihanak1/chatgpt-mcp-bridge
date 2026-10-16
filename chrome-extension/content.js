(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let badge = document.getElementById("__antigravity_bridge_badge");
  if (!badge) {
    badge = document.createElement("div");
    badge.id = "__antigravity_bridge_badge";
    badge.style.cssText =
      "position:fixed;bottom:16px;right:16px;z-index:99999;padding:6px 12px;border-radius:8px;font-size:12px;font-family:sans-serif;font-weight:600;background:#064e3b;color:#f8fafc;border:1px solid #10b981;box-shadow:0 4px 12px rgba(0,0,0,0.4);pointer-events:none;transition:all 0.2s;";
    badge.textContent = "🟢 Antigravity Köprüsü Aktif";
    document.body.appendChild(badge);
  }

  function setBadge(text, bg = "#064e3b", border = "#10b981") {
    if (badge) {
      badge.textContent = text;
      badge.style.background = bg;
      badge.style.borderColor = border;
    }
  }

  function logBridge(stage, data, requestId = "") {
    try {
      console.log(`[CONTENT][${stage}] id=${requestId} ${data}`);
      chrome.runtime.sendMessage({
        type: "bridge_log",
        stage: stage,
        data: String(data),
        request_id: requestId,
        timestamp: Date.now()
      });
    } catch (e) {}
  }

  // Service Worker keep-alive ping
  if (!window.__antigravityKeepAliveStarted) {
    window.__antigravityKeepAliveStarted = true;
    setInterval(() => {
      chrome.runtime.sendMessage({ type: "KEEP_ALIVE" }, () => {
        if (chrome.runtime.lastError) return;
      });
    }, 4000);
  }

  // Yeniden enjeksiyon durumunda eski dinleyiciyi temizle
  if (window.__antigravityMsgListener) {
    chrome.runtime.onMessage.removeListener(window.__antigravityMsgListener);
  }

  window.__antigravityMsgListener = (msg, sender, sendResponse) => {
    if (msg.type === "architect_request" || msg.type === "ASK_CHATGPT") {
      const requestId = msg.request_id;
      const promptText = msg.text || msg.prompt;

      logBridge("MSG_RECEIVED", `promptLen=${(promptText || "").length}`, requestId);

      // Anında ACK (Teslim Alma Onayı) döndür
      if (typeof sendResponse === "function") {
        sendResponse({ type: "architect_ack", request_id: requestId, status: "received" });
      }

      // Arka plan servisine de ACK bildir
      chrome.runtime.sendMessage({
        type: "architect_ack",
        request_id: requestId,
        status: "received",
        timestamp: Date.now()
      });

      handlePrompt(requestId, promptText);
      return true;
    }
  };
  chrome.runtime.onMessage.addListener(window.__antigravityMsgListener);

  function isStreaming() {
    return Boolean(
      document.querySelector('button[data-testid="stop-button"]') ||
      document.querySelector('.result-streaming') ||
      document.querySelector('.streaming') ||
      document.querySelector('button[aria-label*="Stop"]') ||
      document.querySelector('button[aria-label*="Durdur"]') ||
      document.querySelector('button[aria-label="Stop generating"]') ||
      document.querySelector('button[aria-label="Yanıt oluşturmayı durdur"]')
    );
  }

  function hasStatusTag(text) {
    if (!text) return false;
    return (
      text.includes("[DURUM: ONAY_TAMAM]") ||
      text.includes("[DURUM: REVIZYON_GEREKLI]") ||
      text.includes("[DURUM: EK_BILGI_ISTE]")
    );
  }

  // Sayfadaki mevcut asistan yanıt düğümlerini tespit et
  function getAllAssistantContainers() {
    // 1. data-message-author-role="assistant"
    const byRole = Array.from(document.querySelectorAll('[data-message-author-role="assistant"]'));
    if (byRole.length > 0) return byRole;

    // 2. data-message-model-slug veya agent-turn
    const byModel = Array.from(document.querySelectorAll('[data-message-model-slug], [class*="agent-turn"]'));
    if (byModel.length > 0) return byModel;

    // 3. .markdown veya .prose konteynerleri (ChatGPT yanıtlarında markdown / prose kullanılır)
    const byMarkdown = Array.from(document.querySelectorAll('.markdown, [class*="markdown"], .prose, [class*="prose"]')).filter((el) => {
      // Input textarea içindeki prose öğelerini hariç tut
      return !el.closest('#prompt-textarea') && !el.closest('[contenteditable="true"]');
    });
    if (byMarkdown.length > 0) return byMarkdown;

    // 4. Copy butonu barındıran ebeveyn turn konteynerleri (yalnızca asistan yanıtlarında copy butonu bulunur)
    const copyBtns = Array.from(document.querySelectorAll('button[data-testid*="copy"], button[aria-label*="Copy"], button[aria-label*="Kopyala"]'));
    if (copyBtns.length > 0) {
      const copyParents = copyBtns.map((b) => b.closest('[data-testid*="turn"], [class*="turn"], article, div[class*="group"]') || b.parentElement).filter(Boolean);
      if (copyParents.length > 0) return copyParents;
    }

    // 5. Kullanıcı rolü içermeyen article düğümleri
    const articles = Array.from(document.querySelectorAll('article')).filter((art) => {
      const isUser =
        art.querySelector('[data-message-author-role="user"]') ||
        art.querySelector('[data-testid="user-message"]');
      return !isUser;
    });
    if (articles.length > 0) return articles;

    // 6. Conversation turn düğümleri
    const turns = Array.from(document.querySelectorAll('[data-testid^="conversation-turn-"], [class*="conversation-turn"]')).filter((turn) => {
      const isUser =
        turn.querySelector('[data-message-author-role="user"]') ||
        turn.querySelector('[data-testid="user-message"]');
      return !isUser;
    });
    return turns;
  }

  function getLatestNewAssistantContainer(initialCount) {
    const currentList = getAllAssistantContainers();
    if (currentList.length > initialCount) {
      return currentList[currentList.length - 1];
    }
    return null;
  }

  // Bağlı DOM öğesinden temiz metin çıkarma
  function extractTextFromNode(node) {
    if (!node) return "";
    
    // 1. Doğrudan veya alt öğe olarak markdown / prose arama
    const contentEl =
      (node.classList && (node.classList.contains("markdown") || node.classList.contains("prose"))) ? node :
      node.querySelector('.markdown, [class*="markdown"], .prose, [class*="prose"], .whitespace-pre-wrap, [class*="whitespace-pre-wrap"]');
    
    if (contentEl) {
      const t = (contentEl.innerText || contentEl.textContent || "").trim();
      if (t.length > 0) return t;
    }

    // 2. Konteynerin kendi innerText değeri
    if (node.innerText && node.innerText.trim().length > 0) {
      return node.innerText.trim();
    }
    // 3. textContent fallback
    return (node.textContent || "").trim();
  }

  async function handlePrompt(requestId, promptText) {
    try {
      logBridge("DOM_CONTEXT", `url=${window.location.href} title=${document.title}`, requestId);
      setBadge("🟡 Mesaj Yazılıyor...", "#78350f", "#f59e0b");

      // İstek öncesi assistant mesaj sayısını kaydet
      const initialCount = getAllAssistantContainers().length;
      logBridge("INITIAL_COUNT", `count=${initialCount}`, requestId);

      const inputEl =
        document.querySelector("#prompt-textarea") ||
        document.querySelector('div[contenteditable="true"]');

      if (!inputEl) {
        throw { code: "NO_INPUT_ELEMENT", message: "ChatGPT metin giriş alanı (#prompt-textarea) bulunamadı." };
      }
      logBridge("INPUT_FOUND", `tag=${inputEl.tagName} id=${inputEl.id || "none"}`, requestId);

      inputEl.focus();
      await sleep(100);

      // Mevcut metni temizle
      document.execCommand("selectAll", false, null);
      document.execCommand("delete", false, null);
      await sleep(100);

      // 1. Yöntem: ClipboardEvent paste simülasyonu (ProseMirror için en doğal yöntem)
      let pasteSucceeded = false;
      try {
        const dt = new DataTransfer();
        dt.setData("text/plain", promptText);
        const pasteEvt = new ClipboardEvent("paste", {
          clipboardData: dt,
          bubbles: true,
          cancelable: true
        });
        inputEl.dispatchEvent(pasteEvt);
        if (inputEl.innerText && inputEl.innerText.trim().length > 0) {
          pasteSucceeded = true;
        }
      } catch (e) {
        console.warn("[CONTENT] Paste simülasyonu uyarısı:", e);
      }

      // 2. Yöntem: paste çalışmadıysa execCommand insertText
      if (!pasteSucceeded || !inputEl.innerText || inputEl.innerText.trim().length === 0) {
        const lines = promptText.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (i > 0) {
            document.execCommand("insertLineBreak");
          }
          if (lines[i].length > 0) {
            document.execCommand("insertText", false, lines[i]);
          }
        }
      }

      // React / ProseMirror state senkronizasyonu
      inputEl.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
      inputEl.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText" }));
      inputEl.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));

      // 3. Fallback: metin hala boşsa innerHTML kullan
      if (!inputEl.innerText || inputEl.innerText.trim().length === 0) {
        inputEl.innerHTML = promptText.split("\n").map((l) => `<p>${l || "<br>"}</p>`).join("");
        inputEl.dispatchEvent(new Event("input", { bubbles: true }));
      }

      logBridge("TEXT_ENTERED", `innerTextLen=${(inputEl.innerText || "").length}`, requestId);

      // Gönder butonunun aktifleşmesini bekle (en fazla 4 saniye)
      let sendBtn = null;
      for (let attempt = 0; attempt < 40; attempt++) {
        sendBtn =
          document.querySelector('button[data-testid="send-button"]') ||
          document.querySelector('button[data-testid="fruitjuice-send-button"]') ||
          document.querySelector('button[aria-label*="Send"]') ||
          document.querySelector('button[aria-label*="Gönder"]') ||
          document.querySelector('button[aria-label*="send"]') ||
          document.querySelector('button[aria-label*="prompt"]') ||
          document.querySelector('form button[type="submit"]') ||
          document.querySelector('button:has(svg path[d*="M15.192"])');

        if (sendBtn && !sendBtn.disabled) {
          break;
        }
        await sleep(100);
      }

      logBridge("SEND_BUTTON_STATUS", sendBtn ? `found=true disabled=${sendBtn.disabled}` : "not_found", requestId);

      if (sendBtn) {
        // Disabled durumunu kaldır ve tüm işaretçi/fare olaylarını sırayla tetikle
        sendBtn.removeAttribute("disabled");
        sendBtn.disabled = false;
        sendBtn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
        sendBtn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
        sendBtn.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true }));
        sendBtn.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
        sendBtn.click();
      }

      // İlaveten Form submit ve Enter tuşu yedeği
      const form = inputEl.closest("form");
      if (form && form.requestSubmit) {
        try { form.requestSubmit(); } catch (e) {}
      }
      inputEl.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true
        })
      );

      logBridge("PROMPT_SUBMITTED", "Waiting for response generation...", requestId);
      setBadge("🟡 ChatGPT Yanıtı Bekleniyor...", "#78350f", "#f59e0b");

      const responseText = await waitForCompleteResponse(initialCount, requestId);

      logBridge("RESPONSE_COMPLETED", `len=${responseText.length} preview=${responseText.substring(0, 80)}`, requestId);
      setBadge("🟢 Yanıt Alındı (" + responseText.length + " kr)", "#064e3b", "#10b981");

      // Standart architect_response protokolü
      chrome.runtime.sendMessage({
        type: "architect_response",
        request_id: requestId,
        status: "completed",
        text: responseText,
        char_count: responseText.length,
        timestamp: Date.now()
      });

      // Geriye dönük uyumluluk
      chrome.runtime.sendMessage({
        type: "CHATGPT_RESPONSE",
        payload: {
          request_id: requestId,
          status: "ok",
          text: responseText,
          response: responseText
        }
      });
    } catch (err) {
      const errObj = {
        code: err.code || "UNKNOWN_ERROR",
        message: err.message || String(err)
      };
      logBridge("ERROR", `code=${errObj.code} msg=${errObj.message}`, requestId);
      setBadge("🔴 Hata: " + errObj.message, "#7f1d1d", "#ef4444");

      // Standart architect_error protokolü
      chrome.runtime.sendMessage({
        type: "architect_error",
        request_id: requestId,
        status: "failed",
        error: errObj,
        timestamp: Date.now()
      });

      // Geriye dönük uyumluluk
      chrome.runtime.sendMessage({
        type: "CHATGPT_RESPONSE",
        payload: {
          request_id: requestId,
          status: "error",
          error: errObj.message
        }
      });
    }
  }

  async function waitForCompleteResponse(initialCount, requestId) {
    const startTime = Date.now();
    const maxTimeout = 160000;
    let lastLogTime = 0;

    // 1. Yanıtın başlamasını bekle (en fazla 30 saniye)
    let newAssistantNode = null;
    while (Date.now() - startTime < 30000) {
      // Hata kontrolü: Sayfada ChatGPT hata uyarısı belirdi mi?
      const errorEl = document.querySelector(
        '.text-token-text-error, div[class*="text-red-500"], div[class*="border-red-500"]'
      );
      if (errorEl && errorEl.innerText.trim().length > 0) {
        throw { code: "CHATGPT_UI_ERROR", message: errorEl.innerText.trim() };
      }

      if (isStreaming()) {
        logBridge("STREAMING_STARTED", "stop-button or streaming-class detected", requestId);
        break;
      }
      newAssistantNode = getLatestNewAssistantContainer(initialCount);
      if (newAssistantNode) {
        const text = extractTextFromNode(newAssistantNode);
        if (text.length > 0) {
          logBridge("TEXT_STARTED", `initialTextLen=${text.length}`, requestId);
          break;
        }
      }
      await sleep(250);
    }

    // 2. Yanıtın tamamlanmasını bekle
    let lastText = "";
    let stableMs = 0;

    while (Date.now() - startTime < maxTimeout) {
      await sleep(350);

      // Hata kontrolü
      const errorEl = document.querySelector(
        '.text-token-text-error, div[class*="text-red-500"], div[class*="border-red-500"]'
      );
      if (errorEl && errorEl.innerText.trim().length > 0) {
        throw { code: "CHATGPT_UI_ERROR", message: errorEl.innerText.trim() };
      }

      const streaming = isStreaming();
      newAssistantNode = getLatestNewAssistantContainer(initialCount);
      const currentText = extractTextFromNode(newAssistantNode);

      // Canlı rozet güncellemesi
      if (currentText.length > 0) {
        setBadge(`🟡 ChatGPT Yazıyor (${currentText.length} kr)...`, "#78350f", "#f59e0b");
      }

      // Her 4 saniyede bir log gönder
      if (Date.now() - lastLogTime > 4000) {
        lastLogTime = Date.now();
        logBridge("POLL_STATUS", `streaming=${streaming} curLen=${currentText.length} containers=${getAllAssistantContainers().length} stableMs=${stableMs}`, requestId);
      }

      // Kural 1: Protokol bitiş etiketi geldiyse
      if (hasStatusTag(currentText)) {
        if (!streaming) {
          return currentText;
        }
        if (currentText.length > 0 && currentText === lastText) {
          stableMs += 350;
          if (stableMs >= 700) {
            return currentText;
          }
        } else {
          stableMs = 0;
          lastText = currentText;
        }
        continue;
      }

      // Kural 2: Özel E2E test ifadesi geldiyse
      if (currentText.includes("KOPRU_E2E_BASARILI")) {
        if (!streaming) {
          return currentText;
        }
        if (currentText === lastText) {
          stableMs += 350;
          if (stableMs >= 700) {
            return currentText;
          }
        } else {
          stableMs = 0;
          lastText = currentText;
        }
        continue;
      }

      // Kural 3: Streaming bittiyse ve metin 1.4 saniye stabilse
      if (!streaming && currentText.length > 0) {
        if (currentText === lastText) {
          stableMs += 350;
          if (stableMs >= 1400) {
            return currentText;
          }
        } else {
          stableMs = 0;
          lastText = currentText;
        }
      } else {
        stableMs = 0;
        lastText = currentText;
      }
    }

    const fallback = extractTextFromNode(getLatestNewAssistantContainer(initialCount));
    if (fallback.length > 0) {
      return fallback;
    }

    throw { code: "TIMEOUT", message: "ChatGPT yanıt süresi zaman aşımına uğradı ve metin okunamadı." };
  }
})();