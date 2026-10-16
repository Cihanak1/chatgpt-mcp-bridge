// T1 — DOM Extraction Test
// Node.js ortamında ChatGPT benzeri DOM yapısı üzerinde metin çıkarma doğrulaması

class MockElement {
  constructor(tagName, attributes = {}, text = "") {
    this.tagName = tagName.toUpperCase();
    this.attributes = attributes;
    this.children = [];
    this._text = text;
    this.parentNode = null;
  }

  getAttribute(name) {
    return this.attributes[name] || null;
  }

  setAttribute(name, val) {
    this.attributes[name] = val;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  get innerText() {
    if (this._text) return this._text;
    return this.children.map((c) => c.innerText).join(" ");
  }

  get textContent() {
    if (this._text) return this._text;
    return this.children.map((c) => c.textContent).join("");
  }

  querySelectorAll(selector) {
    const results = [];
    const traverse = (el) => {
      for (const child of el.children) {
        if (matches(child, selector)) {
          results.push(child);
        }
        traverse(child);
      }
    };
    traverse(this);
    return results;
  }

  querySelector(selector) {
    const all = this.querySelectorAll(selector);
    return all.length > 0 ? all[0] : null;
  }

  get classList() {
    const cls = this.attributes["class"] || "";
    return {
      contains: (c) => cls.split(/\s+/).includes(c)
    };
  }
}

function matches(el, selector) {
  if (selector === '[data-message-author-role="assistant"]') {
    return el.getAttribute("data-message-author-role") === "assistant";
  }
  if (selector === '[data-message-author-role="user"]') {
    return el.getAttribute("data-message-author-role") === "user";
  }
  if (selector === '[data-testid="user-message"]') {
    return el.getAttribute("data-testid") === "user-message";
  }
  if (selector === ".markdown") {
    return el.getAttribute("class") && el.getAttribute("class").includes("markdown");
  }
  if (selector === ".whitespace-pre-wrap") {
    return el.getAttribute("class") && el.getAttribute("class").includes("whitespace-pre-wrap");
  }
  if (selector === "article") {
    return el.tagName === "ARTICLE";
  }
  return false;
}

// content.js içindeki çıkarma mantığı
function extractTextFromNode(node) {
  if (!node) return "";
  if (node.classList && node.classList.contains("markdown")) {
    if (node.innerText && node.innerText.trim().length > 0) {
      return node.innerText.trim();
    }
  }
  const markdownEl = node.querySelector(".markdown");
  if (markdownEl && markdownEl.innerText && markdownEl.innerText.trim().length > 0) {
    return markdownEl.innerText.trim();
  }
  const preWrapEl = node.querySelector(".whitespace-pre-wrap");
  if (preWrapEl && preWrapEl.innerText && preWrapEl.innerText.trim().length > 0) {
    return preWrapEl.innerText.trim();
  }
  if (node.innerText && node.innerText.trim().length > 0) {
    return node.innerText.trim();
  }
  return (node.textContent || "").trim();
}

function getAllAssistantContainers(doc) {
  const byRole = doc.querySelectorAll('[data-message-author-role="assistant"]');
  if (byRole.length > 0) return byRole;

  const byMarkdown = doc.querySelectorAll('.markdown');
  if (byMarkdown.length > 0) return byMarkdown;

  const articles = doc.querySelectorAll('article').filter(art => {
    const isUser = art.querySelector('[data-message-author-role="user"]') ||
                   art.querySelector('[data-testid="user-message"]');
    return !isUser;
  });
  if (articles.length > 0) return articles;

  return [];
}

function getLatestNewAssistantContainer(doc, initialCount) {
  const currentList = getAllAssistantContainers(doc);
  if (currentList.length > initialCount) {
    return currentList[currentList.length - 1];
  }
  return null;
}

// TEST KOŞUMLARI
function runTests() {
  console.log("=== T1: DOM EXTRACTION TESTİ BAŞLATILIYOR ===");

  const root = new MockElement("div");

  // 1. Önceki konuşma (Turn 1: User, Turn 2: Assistant)
  const turn1 = root.appendChild(new MockElement("article"));
  turn1.appendChild(new MockElement("div", { "data-message-author-role": "user" }, "Merhaba"));

  const turn2 = root.appendChild(new MockElement("article"));
  const oldAssistant = turn2.appendChild(
    new MockElement("div", { "data-message-author-role": "assistant" })
  );
  oldAssistant.appendChild(
    new MockElement("div", { class: "markdown" }, "Önceki eski yanıt [DURUM: ONAY_TAMAM]")
  );

  const initialCount = getAllAssistantContainers(root).length;
  if (initialCount !== 1) {
    throw new Error(`Beklenen initialCount 1 iken ${initialCount} bulundu!`);
  }
  console.log("✓ Başlangıç asistan sayısı doğru tespit edildi: " + initialCount);

  // 2. Yeni konuşma ekleniyor (Turn 3: User, Turn 4: Yeni Assistant)
  const turn3 = root.appendChild(new MockElement("article"));
  turn3.appendChild(
    new MockElement("div", { "data-message-author-role": "user" }, "Yeni mimari soru")
  );

  const turn4 = root.appendChild(new MockElement("article"));
  const newAssistant = turn4.appendChild(
    new MockElement("div", { "data-message-author-role": "assistant" })
  );
  const expectedNewText =
    "Yeni mimari karar: Clean Architecture kullanılmalıdır.\n```python\ndef test(): pass\n```\n[DURUM: ONAY_TAMAM]";
  newAssistant.appendChild(new MockElement("div", { class: "markdown" }, expectedNewText));

  // 3. Yeni asistan node'unun seçildiğini doğrula (Eski mesaj seçilmemeli!)
  const selectedNode = getLatestNewAssistantContainer(root, initialCount);
  if (!selectedNode) {
    throw new Error("Yeni asistan düğümü bulunamadı!");
  }
  if (selectedNode === oldAssistant) {
    throw new Error("HATA: Eski asistan mesajı yanlışlıkla seçildi!");
  }
  console.log("✓ Eski mesaj atlandı, doğru yeni asistan mesajı seçildi.");

  // 4. Metin çıkarma doğrulaması
  const extractedText = extractTextFromNode(selectedNode);
  if (extractedText !== expectedNewText) {
    throw new Error(`Beklenen metin:\n${expectedNewText}\nAlınan metin:\n${extractedText}`);
  }
  console.log("✓ Markdown gövdesinden tam ve temiz metin çıkarıldı.");
  console.log("✓ Kod blokları ve Türkçe karakterler korundu.");

  console.log("\n>>> T1 DOM EXTRACTION TESTİ BAŞARIYLA GEÇTİ <<<\n");
}

runTests();
