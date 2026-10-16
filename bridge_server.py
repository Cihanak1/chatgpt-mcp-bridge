import os
import sys
import json
import uuid
import asyncio
import time
import datetime
import websockets
from mcp.server.fastmcp import FastMCP

if sys.platform == "win32":
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

WS_HOST = "127.0.0.1"
WS_PORT = 8765
LOG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "kopru_log.txt")

mcp = FastMCP("ChatGPT-Antigravity-Bridge")

connected_extensions = set()
# Posta kutusuna timestamp (zaman damgası) eklendi
mailbox = {"status": "IDLE", "response": "", "error": "", "timestamp": 0}

def log_durum(msg: str):
    """Hem stderr'e yazar hem de klasördeki kopru_log.txt dosyasına kaydeder."""
    zaman = datetime.datetime.now().strftime("%H:%M:%S")
    satir = f"[{zaman}] {msg}"
    print(satir, file=sys.stderr, flush=True)
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(satir + "\n")
    except:
        pass

def build_agent_envelope(mesaj: str, kod_ozeti: str, asama: str) -> str:
    zarf = [
        "=== [AJAN PROTOKOLÜ: ANTIGRAVITY IDE -> CHATGPT MİMAR] ===",
        f"AŞAMA: {asama}",
        "ROLÜN: Sen kıdemli yazılım mimarısın. Karşındaki kullanıcı bir insan değil, Antigravity IDE içindeki kodlama ajanıdır.",
        "------------------------------------------------------------",
        f"ANTIGRAVITY'NİN MESAJI:\n{mesaj}",
        "============================================================"
    ]
    return "\n".join(zarf)

async def ws_handler(websocket, *args):
    connected_extensions.add(websocket)
    log_durum("🟢 TARAYICI BAĞLANDI: ChatGPT sekmesi eklenti üzerinden bağlandı.")
    try:
        async for raw_message in websocket:
            try:
                data = json.loads(raw_message)
                msg_type = data.get("type")
                if msg_type == "PING":
                    continue
                
                req_id = data.get("request_id")
                
                if msg_type == "bridge_log":
                    stage = data.get("stage", "")
                    log_data = data.get("data", "")
                    log_durum(f"ℹ️ LOG [{stage}]: {log_data}")
                    continue
                
                if msg_type == "architect_ack":
                    log_durum(f"🟡 ACK: ChatGPT sekmesi mesajı teslim aldı (id={req_id}).")
                    continue

                status = data.get("status")
                if msg_type == "architect_error" or status in ("error", "failed"):
                    err = data.get("error", "Bilinmeyen Hata")
                    err_msg = err.get("message", str(err)) if isinstance(err, dict) else str(err)
                    log_durum(f"🔴 EKLENTİ HATASI: {err_msg}")
                    mailbox["status"] = "ERROR"
                    mailbox["error"] = err_msg
                elif msg_type == "architect_response" or status in ("completed", "ok") or msg_type == "CHATGPT_RESPONSE":
                    cevap = data.get("text") or data.get("response") or ""
                    log_durum(f"🟢 YANIT ALINDI: ChatGPT yazmayı bitirdi ({len(cevap)} karakter).")
                    mailbox["status"] = "COMPLETED"
                    mailbox["response"] = cevap
                else:
                    log_durum(f"ℹ️ DİĞER MESAJ: {raw_message[:100]}")
                    
            except Exception as e:
                log_durum(f"🔴 ÇÖZÜMLEME HATASI: {e}")
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        connected_extensions.discard(websocket)
        log_durum("🔴 TARAYICI KOPTU: ChatGPT sekmesi kapatıldı veya yenilendi.")

@mcp.tool()
async def chatgpt_baglanti_durumu() -> str:
    durum = "AKTIF" if connected_extensions else "PASIF"
    log_durum(f"IDE KONTROL: Bağlantı durumu soruldu -> {durum}")
    if connected_extensions:
        return "AKTIF: ChatGPT sekmesi bağlı."
    return "PASIF: ChatGPT sekmesi bağlı değil!"

@mcp.tool()
async def chatgpt_mesaj_gonder(mesaj: str) -> str:
    global mailbox
    
    if not connected_extensions:
        log_durum("🔴 IDE HATA: Eklenti bağlı değilken mesaj gönderilmeye çalışıldı.")
        return "HATA: Tarayıcıda açık bir ChatGPT sekmesi bulunamadı."
        
    if mailbox["status"] == "WAITING":
        gecen_sure = time.time() - mailbox["timestamp"]
        log_durum(f"🟡 IDE UYARI: Zaten beklenen bir yanıt var (Geçen süre: {int(gecen_sure)}s).")
        return "UYARI: Zaten beklenen bir mesaj var. Lütfen `chatgpt_yaniti_oku` aracını çağır."

    websocket = next(iter(connected_extensions))
    req_id = str(uuid.uuid4())
    zarfli_mesaj = build_agent_envelope(mesaj, "", "ISTISARE")
    
    payload = json.dumps({"type": "ASK_CHATGPT", "request_id": req_id, "prompt": zarfli_mesaj})
    
    mailbox["status"] = "WAITING"
    mailbox["response"] = ""
    mailbox["error"] = ""
    mailbox["timestamp"] = time.time()
    
    log_durum("🔵 IDE MESAJ ATTI: Mesaj tarayıcıya iletildi, yazma komutu verildi.")
    await websocket.send(payload)
    return "BAŞARILI: Mesaj iletildi. 10 saniye bekle ve 'chatgpt_yaniti_oku' aracını çağır."

@mcp.tool()
async def chatgpt_yaniti_oku() -> str:
    global mailbox
    
    if mailbox["status"] == "IDLE":
        return "BİLGİ: Posta kutusu boş."
        
    if mailbox["status"] == "WAITING":
        gecen_sure = time.time() - mailbox["timestamp"]
        # 120 Saniye Timeout Koruması (Kısır döngüyü kırar)
        if gecen_sure > 120:
            mailbox["status"] = "IDLE"
            log_durum("🔴 TIMEOUT: Eklenti 120 saniyedir yanıt vermedi! Döngü kırıldı.")
            return "HATA: ChatGPT 120 saniye içinde yanıt vermedi. Tarayıcı eklentisi çökmüş olabilir, lütfen tarayıcıdaki sayfayı F5 ile yenileyip tekrar deneyin."
            
        log_durum(f"🟡 IDE SORDU: Yanıt hazır mı? -> Hayır, hala yazıyor (Geçen süre: {int(gecen_sure)}s).")
        return f"DURUM: ChatGPT hala yazıyor... (Geçen süre: {int(gecen_sure)}s). Lütfen 10 saniye daha bekle ve tekrar çağır."
        
    if mailbox["status"] == "ERROR":
        err = mailbox["error"]
        mailbox["status"] = "IDLE"
        log_durum(f"🔴 IDE'YE HATA İLETİLDİ: {err}")
        return f"CHATGPT HATASI: {err}"
        
    if mailbox["status"] == "COMPLETED":
        cevap = mailbox["response"]
        mailbox["status"] = "IDLE"
        log_durum("🟢 IDE'YE YANIT İLETİLDİ: Yanıt başarıyla okundu.")
        return f"CHATGPT'DEN GELEN TAM YANIT:\n\n{cevap}"

async def run_mcp_mode():
    # Eski logları temizle
    with open(LOG_FILE, "w", encoding="utf-8") as f:
        f.write("=== KÖPRÜ BAŞLATILDI ===\n")
        
    async with websockets.serve(ws_handler, WS_HOST, WS_PORT):
        await mcp.run_stdio_async()

if __name__ == "__main__":
    asyncio.run(run_mcp_mode())
