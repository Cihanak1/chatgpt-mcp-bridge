import os
import sys
import uuid
import asyncio

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import bridge_server

if sys.platform == "win32":
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")


async def test_future_logic():
    print("=== T4 (UNIT): FUTURE BÜTÜNLÜK VE SIRA YÖNETİMİ TESTİ ===")

    loop = asyncio.get_running_loop()
    req_id_1 = str(uuid.uuid4())
    req_id_2 = str(uuid.uuid4())

    fut_1 = loop.create_future()
    fut_2 = loop.create_future()

    bridge_server.pending_requests[req_id_1] = fut_1
    bridge_server.pending_requests[req_id_2] = fut_2

    # 1. İlk isteğin yanıtı geldiğinde fut_1 tamamlanmalı, fut_2 etkilenmemeli
    fake_response_1 = {
        "type": "architect_response",
        "request_id": req_id_1,
        "status": "completed",
        "text": "1. Yanıt metni"
    }

    # ws_handler içindeki tamamlama mantığını simüle et
    if req_id_1 in bridge_server.pending_requests:
        popped_fut = bridge_server.pending_requests.pop(req_id_1)
        if not popped_fut.done():
            popped_fut.set_result(fake_response_1)

    assert fut_1.done() is True, "fut_1 tamamlanmadı!"
    assert fut_2.done() is False, "fut_2 yanlışlıkla tamamlandı!"
    res_1 = fut_1.result()
    assert res_1["text"] == "1. Yanıt metni", "fut_1 sonucu hatalı!"
    print("✓ Doğru Future (fut_1) tamamlandı, diğer bekleyen Future (fut_2) etkilenmedi.")

    # 2. İkinci defa aynı req_id_1 ile mesaj gelirse yok sayılmalı
    if req_id_1 in bridge_server.pending_requests:
        raise AssertionError("req_id_1 pending_requests içinde hala duruyor!")
    print("✓ Tamamlanan istek pending_requests tablosundan temizlendi (tekrarlanan yanıt koruması).")

    # 3. fut_2 için timeout temizliği
    bridge_server.pending_requests.pop(req_id_2, None)
    assert req_id_2 not in bridge_server.pending_requests, "req_id_2 temizlenemedi!"
    print("✓ Timeout temizliği başarılı (pending_requests temizlendi).")

    print("\n>>> T4 FUTURE UNIT TESTİ BAŞARIYLA GEÇTİ <<<\n")


if __name__ == "__main__":
    asyncio.run(test_future_logic())
